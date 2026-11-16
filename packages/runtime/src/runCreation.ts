import { randomUUID } from 'node:crypto';
import {
  assertContract,
  InterlockError,
  parallelBranchPort,
  promptIds,
  runStartOptionsSchema,
  runStartSchema,
  variableReferences,
  type BudgetPolicy,
  type Json,
  type Run,
  type RunStartOptions,
  type Workflow,
  type WorkflowDefinition,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Budgets } from './budgets.js';
import { callerExecutorCapture } from './callerExecutor.js';
import { type Cb, now } from './engineHelpers.js';
import type { WorkflowMemory } from './memory.js';
import type { ModelAliases } from './modelAliases.js';
import type { Prompts } from './prompts.js';
import { RunAdmission } from './runAdmission.js';
import type { RunChains } from './runChains.js';
import type { RunStarts } from './runStarts.js';
import type { Testbench } from './testbench.js';
import type { Usage } from './usage.js';
import type { Variables } from './variables.js';
import type { VersionCleanup } from './versionCleanup.js';

/**
 * Creates runs: validates and admits a requested start, and allocates the
 * run record for top-level starts, child, item and branch runs, and
 * continue-as-new successors.
 */
export class RunCreation {
  constructor(
    private readonly store: Store,
    private readonly options: { substituteOperation?: unknown },
    private readonly workflow: (id: string) => Workflow,
    private readonly run: (id: string) => Run,
    private readonly save: (run: Run) => void,
    private readonly event: (run: Run, type: string, text: string) => void,
    private readonly definition: (
      run: Pick<Run, 'workflowId' | 'version'>,
    ) => WorkflowDefinition,
    private readonly cancelTree: (id: string, afterCommit?: Cb) => void,
    private readonly pump: () => void,
    private readonly starts: RunStarts,
    private readonly versions: VersionCleanup,
    private readonly budgets: Budgets,
    private readonly chains: RunChains,
    private readonly testbench: Testbench,
    private readonly prompts: Prompts,
    private readonly variables: Variables,
    private readonly memory: WorkflowMemory,
    private readonly modelAliases: ModelAliases,
    private readonly usage: Usage,
  ) {}
  newRun(
    workflowId: string,
    version: number,
    input: Json,
    parentRunId?: string,
    batchNodeId?: string,
    comparison?: import('@interlock/core').ComparisonRunContext,
    continuedFrom?: Run,
    startOptions?: RunStartOptions,
    schedule?: Run['schedule'],
    triggerChain?: string[],
    parallelBranch?: Run['parallelBranch'],
    parentExecutionId?: string,
  ): Run {
    const w = this.workflow(workflowId);
    // Preserve existing dispatch-time failures for invalid nested pins; cleanup
    // dependencies are rejected before startup so deleted history is not replayed.
    this.versions.assertRunnable({ workflowId, version }, true);
    const definition = this.definition({ workflowId, version });
    const targetVersion = this.store.getVersion(workflowId, version);
    const rollover = definition.nodes.find(
      (n) => n.kind === 'exit' && n.continueAsNew,
    );
    const sameWorkflowChild = Boolean(batchNodeId || parallelBranch);
    if (rollover && ((parentRunId && !sameWorkflowChild) || comparison))
      throw new InterlockError(
        'Continue-as-new workflows require standalone runs; nested and comparison execution are unsupported',
      );
    const itemRoute = batchNodeId
      ? definition.edges.find(
          (e) => e.source === batchNodeId && e.port === 'item',
        )
      : parallelBranch
        ? definition.edges.find(
            (e) =>
              e.source === parallelBranch.nodeId &&
              e.port === parallelBranchPort(parallelBranch.id),
          )
        : undefined;
    if (sameWorkflowChild && !itemRoute)
      throw new InterlockError(
        parallelBranch
          ? 'Parallel branch start not found'
          : 'Batch item route not found',
      );
    if (!parentRunId)
      assertContract(definition.inputSchema, input, 'Workflow input');
    let depth = 0,
      parent = parentRunId;
    while (parent) {
      if (++depth > 10)
        throw new InterlockError('Nested workflow depth exceeded 10');
      parent = this.run(parent).parentRunId;
    }
    comparison ??= parentRunId ? this.run(parentRunId).comparison : undefined;
    const capturedPrompts = comparison
      ? this.testbench.promptsFor(comparison)
      : undefined;
    const inherit =
      continuedFrom ??
      (sameWorkflowChild && parentRunId ? this.run(parentRunId) : undefined);
    const time = now();
    triggerChain ??=
      continuedFrom?.triggerChain ??
      (parentRunId ? this.run(parentRunId).triggerChain : undefined);
    const versionPolicy =
      continuedFrom?.versionPolicy ??
      (batchNodeId && parentRunId
        ? this.run(parentRunId).versionPolicy
        : startOptions?.versionPolicy);
    const tags =
      continuedFrom?.tags ??
      startOptions?.tags ??
      (parentRunId ? this.run(parentRunId).tags : undefined);
    const run: Run = {
      ...(tags !== undefined ? { tags: structuredClone(tags) } : {}),
      ...(triggerChain ? { triggerChain: [...triggerChain] } : {}),
      ...(startOptions?.requestId !== undefined
        ? { startRequestId: startOptions.requestId }
        : {}),
      ...(startOptions?.externalTask
        ? { externalTask: startOptions.externalTask }
        : {}),
      ...(comparison ? { comparison } : {}),
      ...(continuedFrom?.externalTask
        ? { externalTask: continuedFrom.externalTask }
        : {}),
      ...((continuedFrom?.title ?? startOptions?.title)
        ? { title: continuedFrom?.title ?? startOptions?.title }
        : {}),
      id: randomUUID(),
      workflowId,
      workflowName: parallelBranch
        ? `${w.name} · ${parallelBranch.key}`
        : w.name,
      version,
      ...(versionPolicy ? { versionPolicy } : {}),
      parentRunId,
      batchNodeId,
      ...(parallelBranch ? { parallelBranch, parentExecutionId } : {}),
      status: 'running',
      input,
      cursor:
        itemRoute?.target ??
        definition.nodes.find((n) => n.kind === 'entry')!.id,
      value: input,
      executions: [],
      createdAt: time,
      updatedAt: time,
      promptSnapshots: inherit
        ? inherit.promptSnapshots
        : capturedPrompts
          ? promptIds(definition).map((id) => {
              const prompt = capturedPrompts.find((p) => p.id === id);
              if (!prompt)
                throw new InterlockError(
                  `Comparison prompt capture ${id} is missing`,
                );
              return prompt;
            })
          : this.prompts.capture(
              definition,
              targetVersion?.pinnedPromptRevisions,
            ),
      ...(variableReferences(definition).length
        ? {
            variableCaptures: this.options.substituteOperation
              ? []
              : inherit
                ? this.variables.capture(
                    definition,
                    inherit.variableCaptures ?? [],
                  )
                : comparison
                  ? this.variables.capture(
                      definition,
                      this.testbench.variablesFor(comparison),
                    )
                  : this.variables.capture(definition),
          }
        : {}),
      ...this.memory.capture(workflowId, inherit, comparison),
      ...(() => {
        const captures = this.options.substituteOperation
          ? []
          : this.modelAliases.capture(
              definition,
              inherit
                ? (inherit.modelAliasCaptures ?? [])
                : comparison
                  ? this.testbench.modelAliasesFor(comparison)
                  : undefined,
            );
        const ref = definition.agentModel;
        const ignored =
          ref &&
          (inherit
            ? inherit.ignoredWorkflowModelAlias === ref
            : !this.options.substituteOperation &&
              !this.modelAliases.usesReference(definition, ref) &&
              !this.modelAliases.capturedAlias(captures, ref) &&
              !this.modelAliases.get(ref) &&
              !!this.modelAliases.requirement(ref));
        return {
          modelAliasCaptures: captures,
          ...(ignored ? { ignoredWorkflowModelAlias: ref } : {}),
        };
      })(),
    };
    if (
      !parentRunId &&
      !continuedFrom &&
      rollover?.kind === 'exit' &&
      rollover.continueAsNew
    )
      this.chains.start(run, rollover.continueAsNew.maxRuns);
    if (schedule ?? continuedFrom?.schedule)
      run.schedule = schedule ?? continuedFrom?.schedule;
    Object.assign(run, callerExecutorCapture(this.store, run, w, definition));
    new RunAdmission(this.store).queue(run, definition, startOptions);
    this.save(run);
    this.usage.prices.start(run, continuedFrom?.id);
    this.event(
      run,
      run.status === 'queued' ? 'run.queued' : 'run.started',
      `${run.status === 'queued' ? 'Queued' : 'Started'} ${w.name} v${version}`,
    );
    return run;
  }
  startRun(
    workflowId: string,
    input: Json,
    version?: number,
    budget?: BudgetPolicy,
    options?: RunStartOptions,
    deferredEffects?: (() => void)[],
  ) {
    const metadata = runStartOptionsSchema.parse(options ?? {});
    const q = runStartSchema.parse({
      workflowId,
      input,
      version,
      budget,
      ...metadata,
    });
    if (
      q.onActiveExternalTask &&
      q.onActiveExternalTask !== 'allow' &&
      !q.externalTask
    )
      throw new InterlockError('onActiveExternalTask requires externalTask');
    if (
      q.after?.some(
        (reference) =>
          'requestId' in reference && reference.requestId === q.requestId,
      )
    )
      throw new InterlockError('A start cannot depend on its own requestId');
    const afterCommit: (() => void)[] = [];
    const result = this.starts.resolve(q, () => {
      const w = this.workflow(q.workflowId);
      if (
        w.archived ||
        (w.ownerWorkflowId && this.workflow(w.ownerWorkflowId).archived)
      )
        throw new InterlockError('Restore this workflow before starting it');
      // Validate before task policy mutations. Replays deliberately skip this callback.
      this.versions.assertRunnable(
        { workflowId: q.workflowId, version: q.version ?? w.latestVersion },
        true,
      );
      assertContract(
        this.definition({
          workflowId: q.workflowId,
          version: q.version ?? w.latestVersion,
        }).inputSchema,
        q.input,
        'Workflow input',
      );
      const policy = q.onActiveExternalTask ?? 'allow';
      const matching =
        q.externalTask && policy !== 'allow'
          ? this.store
              .activeRuns()
              .filter(
                (run) =>
                  run.externalTask?.system === q.externalTask!.system &&
                  run.externalTask?.id === q.externalTask!.id,
              )
          : [];
      if (matching.length && policy === 'reuse')
        return { run: matching[0], reused: true };
      if (matching.length && policy === 'reject')
        throw new InterlockError(
          'An active run already exists for externalTask',
        );
      const run = this.newRun(
        q.workflowId,
        q.version ?? w.latestVersion,
        q.input,
        undefined,
        undefined,
        undefined,
        undefined,
        q,
      );
      if (q.budget)
        this.budgets.set({
          runId: run.id,
          expectedRevision: 0,
          budget: q.budget,
        });
      if (policy === 'cancel_previous')
        for (const previous of matching)
          this.cancelTree(previous.id, afterCommit);
      return { run, reused: false };
    });
    if (deferredEffects) {
      deferredEffects.push(...afterCommit);
      if (!result.replayed) deferredEffects.push(() => this.pump());
    } else {
      for (const effect of afterCommit) effect();
      if (!result.replayed) this.pump();
    }
    return result.id;
  }
}
