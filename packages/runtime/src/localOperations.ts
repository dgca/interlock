import { rmSync } from 'node:fs';
import {
  InterlockError,
  type Json,
  type NodeExecution,
  type PathBinding,
  type PollCheck,
  resolveFetch,
  type Run,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import {
  type BackgroundScripts,
  UncertainScript,
} from './backgroundScripts.js';
import {
  checkPrivateNetwork,
  executeFetch,
  redirectPolicy,
  UncertainFetch,
} from './fetch.js';
import { writeExecutionProvenanceFile } from './nodeData.js';
import type { ScriptApprovals } from './scriptApprovals.js';
import { baseEnvironment, executeScript, scriptFailure } from './scripts.js';
import { secretRedaction } from './secretRedaction.js';
import type { TrialEnvironments } from './trialEnvironments.js';
import type { Variables } from './variables.js';
import type { ManagedWorkspaces } from './workspaces.js';
import { resolveAndValidateCwd } from './workingDirectory.js';

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export const fetchHttpError = (status: number) =>
  status < 200 || status >= 300 ? `Fetch returned HTTP ${status}` : undefined;
function scriptEnvironmentId(id: string): string | undefined {
  // Legacy definitions can contain IDs that exceed portable spawn limits
  // or cannot be carried losslessly in a process environment.
  if (id.includes('\0') || Buffer.byteLength(id) > 16 * 1024) return;
  if (Buffer.from(id).toString() === id) return id;
}
export type LocalOperationResult = {
  output: Json;
  httpError?: string;
  resolvedCwd?: string;
};

/** Runs a Script, Fetch or polling check in this process for the Engine. */
export class LocalOperations {
  constructor(
    private readonly store: Store,
    private readonly run: (id: string) => Run,
    private readonly save: (run: Run) => void,
    private readonly event: (run: Run, type: string, text: string) => void,
    private readonly definition: (
      run: Pick<Run, 'workflowId' | 'version'>,
    ) => WorkflowDefinition,
    private readonly bindingSource: (
      run: Run,
      input: Json,
    ) => (binding: PathBinding) => Json | undefined,
    private readonly getAllowedRoots: () => string[],
    private readonly cwd: string,
    private readonly scriptApprovals: ScriptApprovals,
    private readonly trials: TrialEnvironments,
    private readonly workspaces: ManagedWorkspaces,
    private readonly variables: Variables,
    private readonly backgroundScripts: BackgroundScripts,
    private readonly isStopped: () => boolean,
    /** The server's MCP address and, only when required, its API token. */
    private readonly server: () => {
      mcpUrl?: string;
      apiToken?: string;
    } = () => ({}),
  ) {}
  private get stopped() {
    return this.isStopped();
  }
  private scriptContextEnvironment(
    run: Run,
    execution: NodeExecution,
  ): Record<`INTERLOCK_${string}`, string | undefined> {
    const batchOwnerId = run.batchNodeId ? run.parentRunId : undefined;
    let itemIndex = run.batchItemIndex;
    if (batchOwnerId && itemIndex === undefined) {
      // Older item runs only retain their position in the owning Batch execution.
      const batch = this.run(batchOwnerId).executions.findLast(
        (step) =>
          step.nodeId === run.batchNodeId && step.childRunIds.includes(run.id),
      );
      itemIndex = batch?.childRunIds.indexOf(run.id);
    }
    return {
      INTERLOCK_RUN_ID: run.id,
      INTERLOCK_ROOT_RUN_ID: run.parentRunId
        ? this.store.runAncestry(run.id).rootRunId
        : run.id,
      INTERLOCK_WORKFLOW_ID: scriptEnvironmentId(run.workflowId),
      INTERLOCK_WORKFLOW_VERSION: String(run.version),
      INTERLOCK_NODE_ID: scriptEnvironmentId(execution.nodeId),
      INTERLOCK_EXECUTION_ID: execution.id,
      INTERLOCK_ATTEMPT: String(execution.attempt ?? 1),
      INTERLOCK_BATCH_OWNER_RUN_ID: batchOwnerId,
      INTERLOCK_BATCH_ITEM_INDEX: itemIndex?.toString(),
      INTERLOCK_POLL_CHECK_NUMBER:
        execution.kind === 'wait'
          ? String((execution.check?.count ?? 0) + 1)
          : undefined,
    };
  }
  async localOperation(
    run: Run,
    operation: Extract<WorkflowNode, { kind: 'script' | 'fetch' }> | PollCheck,
    execution: NodeExecution,
    signal: AbortSignal,
    label = 'label' in operation ? operation.label : 'Polling check',
  ): Promise<LocalOperationResult> {
    const { input } = execution;
    if (operation.kind === 'script')
      this.scriptApprovals.assertApproved(run, execution, operation);
    const environment = this.trials.execution(run);
    if (environment && operation.kind === 'fetch')
      throw new InterlockError(
        'Unsupported Fetch operation in a local Git trial',
      );
    const ids =
      operation.kind === 'fetch'
        ? operation.headers.flatMap((f) =>
            f.value.kind === 'variable' ? [f.value.variableId] : [],
          )
        : (operation.environment ?? []).map((e) => e.variableId);
    const resolved = this.variables.resolve(run, ids);
    const { mcpUrl, apiToken } =
      operation.kind === 'script' ? this.server() : {};
    const server = { url: mcpUrl && new URL(mcpUrl).origin, apiToken };
    // The API token is redacted like a Secret wherever the Script's text lands.
    const scriptSecrets = server.apiToken
      ? [...resolved.secrets, server.apiToken]
      : resolved.secrets;
    let redact = secretRedaction(scriptSecrets);
    try {
      const variableName = (id: string) =>
        run.variableCaptures?.find((c) => c.referenceId === id)?.name ?? id;
      if (operation.kind === 'fetch') {
        const deliveredSecrets = new Set<string>();
        for (const field of operation.headers) {
          if (field.value.kind !== 'variable') continue;
          const { variableId, prefix = '', suffix = '' } = field.value;
          const value = resolved.value(variableId);
          if (/[^\t\x20-\x7e\x80-\xff]/.test(prefix + value + suffix))
            throw new InterlockError(
              `${label}: header ${field.name} cannot use variable ${variableName(variableId)}. Replace its value with valid header text without control characters or non-Latin-1 characters.`,
            );
          if (resolved.secrets.includes(value)) {
            // Headers trims only outer HTTP whitespace. Literal prefix and
            // suffix text can keep one side of the secret away from the edge.
            let delivered = value;
            if (/^[ \t]*$/.test(prefix))
              delivered = delivered.replace(/^[ \t]+/, '');
            if (/^[ \t]*$/.test(suffix))
              delivered = delivered.replace(/[ \t]+$/, '');
            if (delivered && delivered !== value)
              deliveredSecrets.add(delivered);
          }
        }
        if (deliveredSecrets.size)
          redact = secretRedaction([...resolved.secrets, ...deliveredSecrets]);
        const request = resolveFetch(operation, input, resolved.value);
        await checkPrivateNetwork(operation, request.url, (target, text) => {
          if (this.stopped) return;
          const latest = this.run(run.id);
          const step = latest.executions.find((e) => e.id === execution.id);
          if (latest.status !== 'running' || !step) return;
          step.privateNetwork = target;
          this.save(latest);
          this.event(latest, 'node.private_network', text);
        });
        const response = await executeFetch(
          request,
          operation.timeoutMs,
          signal,
          redirectPolicy(operation, resolved.secrets.length > 0),
        );
        const error = operation.failOnHttpError
          ? fetchHttpError(response.status)
          : undefined;
        return {
          output: redact.json(response),
          httpError: error ? redact.text(error) : undefined,
        };
      }
      for (const entry of operation.environment ?? []) {
        if (resolved.value(entry.variableId).includes('\0'))
          throw new InterlockError(
            `${label}: environment ${entry.name} cannot use variable ${variableName(entry.variableId)}. Replace its value with text that contains no NUL bytes.`,
          );
      }
      const inherited = baseEnvironment(operation, environment?.env);
      const bindings = Object.fromEntries(
        (operation.environment ?? []).map((entry) => [
          entry.name,
          resolved.value(entry.variableId),
        ]),
      );
      const definition = this.definition(run);
      // Node cwd, then the run's workspace, then workflow cwd.
      const workspace =
        operation.cwd === undefined
          ? this.workspaces.path(run, definition)
          : undefined;
      const cwdBinding =
        operation.cwd ?? (workspace ? undefined : definition.cwd);
      let effectiveCwd = environment?.cwd ?? workspace ?? this.cwd;
      if (cwdBinding !== undefined) {
        const source = this.bindingSource(run, input);
        const allowed = this.getAllowedRoots();
        const result = resolveAndValidateCwd(
          cwdBinding,
          source,
          allowed.length ? allowed : undefined,
        );
        if (result.error) {
          throw new InterlockError(`${label}: ${result.error}`);
        }
        effectiveCwd = result.resolvedCwd!;
      }
      execution.resolvedCwd = effectiveCwd;
      if (
        'executionMode' in operation &&
        operation.executionMode === 'background'
      ) {
        const launch = !execution.background;
        if (launch)
          this.backgroundScripts.prepare(run, execution, operation.timeoutMs);
        if (launch) {
          const provenanceFile = writeExecutionProvenanceFile(run, execution);
          this.backgroundScripts.launch(
            run,
            execution,
            operation.command,
            input,
            effectiveCwd,
            operation.language,
            {
              ...inherited,
              ...this.scriptContextEnvironment(run, execution),
              // Progress snapshots redact only saved Secrets: no API token here.
              INTERLOCK_URL: server.url,
              INTERLOCK_API_TOKEN: undefined,
              INTERLOCK_EXECUTION_PROVENANCE_FILE: provenanceFile,
              ...bindings,
            },
            resolved.secrets.length > 0,
            provenanceFile,
          );
        }
        const output = await this.backgroundScripts.monitor(
          run,
          execution,
          resolved.secrets,
          signal,
          (receipt) => {
            if (this.stopped) return;
            const latest = this.run(run.id);
            const current = latest.executions.find(
              (step) => step.id === execution.id,
            );
            if (!current?.background || latest.status !== 'running') return;
            const next = {
              ...current.background,
              state: receipt.outcome
                ? ('completed' as const)
                : ('running' as const),
              supervisorPid: receipt.pid,
              supervisorStart: receipt.start,
              progress: receipt.progress,
            };
            if (JSON.stringify(next) !== JSON.stringify(current.background)) {
              current.background = next;
              this.save(latest);
            }
          },
        );
        return { output, resolvedCwd: effectiveCwd };
      }
      const provenanceFile = writeExecutionProvenanceFile(run, execution);
      const launch = (env: NodeJS.ProcessEnv) =>
        executeScript(
          operation.command,
          input,
          operation.timeoutMs,
          effectiveCwd,
          signal,
          operation.language,
          env,
          scriptSecrets.length ? redact.text : undefined,
        );
      let output: Json;
      try {
        output = await launch({
          ...inherited,
          ...this.scriptContextEnvironment(run, execution),
          INTERLOCK_URL: server.url,
          INTERLOCK_API_TOKEN: server.apiToken,
          INTERLOCK_EXECUTION_PROVENANCE_FILE: provenanceFile,
          ...bindings,
        }).catch((error: unknown) => {
          // E2BIG comes from spawn before the Script process can start.
          if (
            error instanceof Error &&
            (error as NodeJS.ErrnoException).code === 'E2BIG'
          )
            return launch({
              ...inherited,
              INTERLOCK_EXECUTION_PROVENANCE_FILE: provenanceFile,
              ...bindings,
            });
          throw error;
        });
      } finally {
        try {
          rmSync(provenanceFile, { force: true });
        } catch {
          /* ignore */
        }
      }
      return { output: redact.json(output), resolvedCwd: effectiveCwd };
    } catch (error) {
      if (error instanceof UncertainScript) throw error;
      if (error instanceof UncertainFetch)
        throw new UncertainFetch(redact.text(message(error)));
      const text = scriptFailure(operation, message(error), environment?.env);
      throw new InterlockError(redact.text(text));
    }
  }
}
