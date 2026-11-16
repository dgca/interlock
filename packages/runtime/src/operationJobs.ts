import { isDeepStrictEqual } from 'node:util';
import {
  assertContract,
  hasFailureRoute,
  InterlockError,
  isPollWait,
  readPath,
  type Json,
  type NodeExecution,
  type Run,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import {
  type BackgroundScripts,
  UncertainScript,
} from './backgroundScripts.js';
import { message, now, terminal } from './engineHelpers.js';
import { UncertainFetch } from './fetch.js';
import {
  fetchHttpError,
  type LocalOperations,
  type LocalOperationResult,
} from './localOperations.js';
import type { PauseHolds } from './pauseHolds.js';
import type { ScriptApprovals } from './scriptApprovals.js';
import type { StepCompletion } from './stepCompletion.js';
import type { TrialEnvironments } from './trialEnvironments.js';
import type { Variables } from './variables.js';
import type { WorkResources } from './workResources.js';

/**
 * Server-side step jobs: admits Script, Fetch and polling Wait steps against
 * their resources, starts due operations and polling checks as local jobs,
 * settles their results, and times out polling Waits.
 */
export class OperationJobs {
  constructor(
    private readonly store: Store,
    private readonly options: {
      substituteOperation?: (
        node:
          | Extract<WorkflowNode, { kind: 'script' | 'fetch' }>
          | { kind: 'script' | 'fetch' },
        execution: NodeExecution,
      ) => Promise<Json>;
    },
    private readonly isStopped: () => boolean,
    private readonly nowMs: () => number,
    private readonly now: () => string,
    private readonly run: (id: string) => Run,
    private readonly save: (run: Run) => void,
    private readonly event: (run: Run, type: string, text: string) => void,
    private readonly definition: (
      run: Pick<Run, 'workflowId' | 'version'>,
    ) => WorkflowDefinition,
    private readonly pump: () => void,
    private readonly finish: StepCompletion['finish'],
    private readonly fail: StepCompletion['fail'],
    private readonly failOperation: StepCompletion['failOperation'],
    private readonly localJobs: Map<string, AbortController>,
    private readonly listeners: Set<() => void>,
    private readonly operations: LocalOperations,
    private readonly scriptApprovals: ScriptApprovals,
    private readonly backgroundScripts: BackgroundScripts,
    private readonly variables: Variables,
    private readonly trials: TrialEnvironments,
    private readonly pauses: PauseHolds,
    private readonly resources: WorkResources,
  ) {}
  private get stopped() {
    return this.isStopped();
  }
  startDue() {
    for (const {
      run: state,
      execution: current,
    } of this.store.activeRunState()) {
      if (!current) continue;
      const duePoll =
        current.kind === 'wait' &&
        state.status === 'waiting' &&
        current.status === 'waiting' &&
        current.nextCheckAt &&
        Date.parse(current.nextCheckAt) <= this.nowMs();
      const localOperation =
        state.status === 'running' &&
        current.status === 'running' &&
        (current.kind === 'script' || current.kind === 'fetch');
      if (
        (!duePoll && !localOperation) ||
        (current.resources?.length && !current.resourceActive) ||
        this.localJobs.has(current.id) ||
        (this.pauses.applicable(state.workflowId).length && !current.background)
      )
        continue;
      const run = this.run(state.id);
      const execution = run.executions.at(-1)!;
      if (duePoll) {
        this.runPollCheck(run, execution);
        continue;
      }
      const node = this.definition(run).nodes.find(
        (n) => n.id === execution.nodeId,
      )!;
      if (node.kind !== 'script' && node.kind !== 'fetch') continue;
      this.markOperationStarted(run, execution);
      const controller = new AbortController();
      this.localJobs.set(execution.id, controller);
      const job: Promise<LocalOperationResult> = (() => {
        try {
          controller.signal.throwIfAborted();
          const environment = this.trials.execution(run);
          if (
            environment &&
            (node.kind === 'fetch' || this.options.substituteOperation)
          )
            throw new InterlockError(
              'Unsupported operation in a local Git trial',
            );
          return this.options.substituteOperation
            ? this.options
                .substituteOperation(node, execution)
                .then((output) => ({
                  output,
                  httpError:
                    node.kind === 'fetch' && node.failOnHttpError
                      ? fetchHttpError((output as { status: number }).status)
                      : undefined,
                }))
            : this.operations.localOperation(
                run,
                node,
                execution,
                controller.signal,
              );
        } catch (error) {
          return Promise.reject(error);
        }
      })();
      void job
        .then(
          (operation) => ({ ok: true as const, ...operation }),
          (error) => ({
            ok: false as const,
            error: message(error),
            uncertain:
              error instanceof UncertainScript ||
              error instanceof UncertainFetch,
          }),
        )
        .then((result) => {
          if (this.stopped) return;
          this.store.transaction(() => {
            const latest = this.run(run.id);
            if (
              latest.status !== 'running' ||
              latest.executions.at(-1)?.id !== execution.id
            )
              return;
            const current = latest.executions.at(-1)!;
            this.resources.endExecution(
              latest.id,
              current,
              !result.ok &&
                (result.uncertain ||
                  (!!current.background &&
                    current.background.state !== 'completed')),
            );
            if (result.ok && result.resolvedCwd) {
              current.resolvedCwd = result.resolvedCwd;
            }
            if (!result.ok) {
              if (
                current.background &&
                (result.uncertain || current.background.state !== 'completed')
              ) {
                current.background.state = 'uncertain';
                this.fail(latest, current, node.label + ': ' + result.error);
                return;
              }
              if (result.uncertain && current.resources?.length) {
                this.fail(latest, current, node.label + ': ' + result.error);
                return;
              }
              if (current.background) current.background.state = 'completed';
              this.failOperation(
                latest,
                current,
                node,
                result.error,
                'execution',
              );
              return;
            }
            if (current.background) current.background.state = 'completed';
            const output = result.output;
            if (node.kind === 'fetch') {
              current.output = output;
              if (result.httpError) {
                this.failOperation(
                  latest,
                  current,
                  node,
                  result.httpError,
                  'http',
                );
                return;
              }
            }
            try {
              // Retain returned data even if its success contract rejects it.
              if (hasFailureRoute(node)) current.output = output;
              assertContract(node.outputSchema, output, `${node.label} output`);
            } catch (error) {
              this.failOperation(
                latest,
                current,
                node,
                message(error),
                'output',
              );
              return;
            }
            this.finish(latest, current, node, output);
          });
        })
        .catch((error) => {
          if (this.stopped) return;
          this.store.transaction(() => {
            const latest = this.run(run.id);
            if (
              latest.status === 'running' &&
              latest.executions.at(-1)?.id === execution.id
            ) {
              const current = latest.executions.at(-1)!;
              this.resources.endExecution(latest.id, current, true);
              this.fail(latest, current, message(error));
            }
          });
        })
        .finally(() => {
          this.localJobs.delete(execution.id);
          this.pump();
        });
    }
  }
  admitOperation(run: Run, execution: NodeExecution, acquire = true) {
    if (!execution.resources?.length || execution.resourceActive) return true;
    const owners = this.resources.owners(execution.resources);
    if (owners.length) {
      if (!isDeepStrictEqual(execution.resourceBlocked?.owners, owners)) {
        execution.resourceBlocked = {
          owners,
          since: execution.resourceBlocked?.since ?? now(),
          remainingMs:
            execution.resourceBlocked?.remainingMs ??
            (execution.timeoutAt
              ? Math.max(0, Date.parse(execution.timeoutAt) - this.nowMs())
              : undefined),
        };
        // Only resource queue time is excluded from the polling Wait deadline.
        execution.timeoutAt = undefined;
        this.save(run);
      }
      return false;
    }
    if (execution.resourceBlocked?.remainingMs !== undefined)
      execution.timeoutAt = new Date(
        this.nowMs() + execution.resourceBlocked.remainingMs,
      ).toISOString();
    const wasBlocked = !!execution.resourceBlocked;
    execution.resourceBlocked = undefined;
    if (!acquire) {
      if (wasBlocked) this.save(run);
      return false;
    }
    this.resources.acquireExecution(run.id, execution);
    execution.operationStartedAt = now();
    this.save(run);
    return true;
  }
  refreshTerminalScripts() {
    for (const run of this.store.terminalBackgroundRuns()) {
      if (!terminal(run.status)) continue;
      for (const execution of run.executions) {
        if (
          !execution.background ||
          !['launching', 'running'].includes(execution.background.state)
        )
          continue;
        try {
          const node = this.definition(run).nodes.find(
            (n) => n.id === execution.nodeId,
          );
          if (node?.kind !== 'script') continue;
          const resolved = this.variables.resolve(
            run,
            (node.environment ?? []).map((entry) => entry.variableId),
          );
          const snapshot = this.backgroundScripts.snapshot(
            run,
            execution,
            resolved.secrets,
          );
          if (snapshot?.state === 'completed') {
            execution.background = snapshot;
            this.save(run);
          }
        } catch {
          execution.background.state = 'uncertain';
          this.save(run);
        }
      }
    }
  }
  finishPollTimeout(
    run: Run,
    execution: NodeExecution,
    node: WorkflowNode,
  ): boolean {
    if (!execution.timeoutAt || Date.parse(execution.timeoutAt) > this.nowMs())
      return false;
    if (this.localJobs.has(execution.id))
      this.resources.uncertainExecution(
        run.id,
        execution,
        'Polling check timed out while remote work may still be active',
      );
    this.localJobs.get(execution.id)?.abort();
    if (execution.resourceActive)
      this.resources.endExecution(run.id, execution, true);
    this.event(
      run,
      'node.timed_out',
      `${node.label}: no passing check before ${execution.timeoutAt}`,
    );
    this.finish(run, execution, node, execution.input, 'timeout');
    return true;
  }
  private markOperationStarted(run: Run, execution: NodeExecution) {
    if (execution.resources?.length && execution.operationStartedAt) return;
    if (!execution.resources?.length)
      execution.resourceAttempt = (execution.resourceAttempt ?? 0) + 1;
    execution.operationStartedAt = now();
    this.save(run);
  }
  private pollCheckChanged(runId: string) {
    if (this.stopped) return;
    this.store.touchRun(runId);
    queueMicrotask(() => this.listeners.forEach((listener) => listener()));
  }
  /**
   * Run a polling Wait's check when it is due. The check is a server-side job
   * like a Script or Fetch step, but the execution stays `waiting`: a passing
   * result finishes the step, anything else schedules the next check. A check
   * interrupted by a restart simply runs again.
   */
  private runPollCheck(run: Run, execution: NodeExecution) {
    const node = this.definition(run).nodes.find(
      (n) => n.id === execution.nodeId,
    );
    if (!node || !isPollWait(node)) return;
    if (
      !execution.nextCheckAt ||
      Date.parse(execution.nextCheckAt) > this.nowMs() ||
      (execution.timeoutAt && Date.parse(execution.timeoutAt) <= this.nowMs())
    )
      return;
    const { timing } = node;
    if (
      timing.check.kind === 'script' &&
      this.scriptApprovals.hold(run, execution, timing.check) !== undefined
    )
      return;
    this.markOperationStarted(run, execution);
    const controller = new AbortController();
    this.localJobs.set(execution.id, controller);
    this.pollCheckChanged(run.id);
    const job: Promise<{ output: Json; resolvedCwd?: string }> =
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        const environment = this.trials.execution(run);
        if (environment && timing.check.kind === 'fetch')
          throw new InterlockError(
            'Unsupported Fetch probe in a local Git trial',
          );
        if (this.options.substituteOperation) {
          return this.options
            .substituteOperation(timing.check as any, execution)
            .then((output) => {
              if (
                timing.check.kind === 'fetch' &&
                (timing.check as any).failOnHttpError
              ) {
                const httpError = fetchHttpError(
                  (output as { status: number }).status,
                );
                if (httpError) throw new InterlockError(httpError);
              }
              return { output };
            });
        }
        return this.operations
          .localOperation(
            run,
            timing.check,
            execution,
            controller.signal,
            node.label,
          )
          .then(({ output, httpError, resolvedCwd }) => {
            if (httpError) throw new InterlockError(httpError);
            return { output, resolvedCwd };
          });
      });
    const settle = (result: {
      output?: Json;
      error?: string;
      uncertain?: boolean;
      resolvedCwd?: string;
    }) => {
      if (this.stopped) return;
      this.store.transaction(() => {
        const latest = this.run(run.id);
        const current = latest.executions.at(-1);
        if (
          latest.status !== 'waiting' ||
          current?.id !== execution.id ||
          current.status !== 'waiting'
        )
          return;
        this.resources.endExecution(latest.id, current, result.uncertain);
        if (result.resolvedCwd) current.resolvedCwd = result.resolvedCwd;
        if (this.finishPollTimeout(latest, current, node)) return;
        const checked = this.now();
        current.check = {
          count: (current.check?.count ?? 0) + 1,
          at: checked,
          output: result.output,
          error: result.error,
        };
        if (result.uncertain && current.resources?.length) {
          current.nextCheckAt = checked;
          current.resumeAt = checked;
          this.admitOperation(latest, current);
          return;
        }
        if (result.error === undefined) {
          let value: Json;
          try {
            value = readPath(result.output!, timing.path);
          } catch (error) {
            this.fail(
              latest,
              current,
              `${node.label}: check output ${message(error).replace(/^Input /, '')}`,
            );
            return;
          }
          if (isDeepStrictEqual(value, timing.equals)) {
            const input = current.input;
            const output =
              input !== null &&
              typeof input === 'object' &&
              !Array.isArray(input) &&
              result.output !== null &&
              typeof result.output === 'object' &&
              !Array.isArray(result.output)
                ? { ...input, ...(result.output as Record<string, Json>) }
                : result.output!;
            try {
              this.finish(latest, current, node, output);
            } catch (error) {
              this.fail(latest, current, message(error));
            }
            return;
          }
        }
        current.nextCheckAt = new Date(
          Date.parse(checked) + timing.everyMs,
        ).toISOString();
        current.resumeAt = current.nextCheckAt;
        this.save(latest);
      });
    };
    void job
      .then(
        (res) => settle({ output: res.output, resolvedCwd: res.resolvedCwd }),
        (error) =>
          settle({
            error: message(error),
            uncertain: error instanceof UncertainFetch,
          }),
      )
      .finally(() => {
        this.localJobs.delete(execution.id);
        this.pollCheckChanged(run.id);
        this.pump();
      });
  }
}
