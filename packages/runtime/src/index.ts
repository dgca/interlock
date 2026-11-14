import { EventTriggers } from './eventTriggers.js';
import { RunVersions } from './runVersions.js';
import {
  modelReferences,
  agentAliasReference,
  selectsPreset,
} from '@interlock/core';
import { runDoctor } from './doctor.js';
import { generateWorkflowReport } from './report.js';
import type {
  DoctorOptions,
  DoctorReport,
  ReportFilter,
  WorkflowReport,
} from '@interlock/core';
import {
  sourceQuiescence,
  uncertainClaimCollection,
  type UncertainClaim,
  uncertainOperationCollection,
  type UncertainOperation,
} from './quiescence.js';
import { Stalls } from './stalls.js';
import { WorkflowTriggers } from './workflowTriggers.js';
import { PauseHolds } from './pauseHolds.js';
import { BackgroundScripts, UncertainScript } from './backgroundScripts.js';
import type { ScriptOperation } from '@interlock/core';
import { runAttention } from './runAttention.js';
import { Requests } from './requests.js';
import { WorkflowBoards } from './workflowBoards.js';
import { captureHumanInput } from './humanInput.js';
import { RunInspection } from './runInspection.js';
import { WorkflowAuthoring } from './workflowAuthoring.js';
import { WorkflowDeletion } from './workflowDeletion.js';
import { AgentExecutorSettings } from './agentExecutorSettings.js';
import { BackgroundScriptControl } from './backgroundScriptControl.js';
import {
  fetchHttpError,
  LocalOperations,
  type LocalOperationResult,
} from './localOperations.js';
import { WorkResources } from './workResources.js';
import { ExecutorManager } from './executors/manager.js';
export type {
  HarnessAdapter,
  HarnessRun,
  HarnessResult,
} from './executors/contracts.js';
import {
  resourceNamesSchema,
  workResourceRequestSchema,
  type WorkResourceRequest,
} from '@interlock/core';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Store } from '@interlock/storage';
import type { WorkflowPositions } from '@interlock/core';
import {
  calculateVisitCount,
  buildExecutionProvenance,
  readBranchValue,
} from './nodeData.js';
export * from './nodeData.js';
import {
  assertContract,
  assertOwnPropertyContract,
  resolveBindingFields,
  matchRouting,
  type PathBinding,
  toolCallRequestSchema,
  type ToolCallInput,
  workHoldRequestSchema,
  HoldDeadlineError,
  type WorkHoldRequest,
  checkAgentResult,
  ResultRejection,
  type ResultCheck,
  DEFAULT_BATCH_MAX_ITEMS,
  STARTED_RUN_SCHEMA,
  isStartedRunSchema,
  isPollWait,
  hasTimeoutRoute,
  hasFailureRoute,
  parallelBranchPort,
  decideJoin,
  type JoinCancel as Why,
  type FailureCategory,
  blankDefinition,
  InterlockError,
  readPath,
  resolveFetch,
  resolveProvider,
  type Json,
  type NodeExecution,
  type Run,
  type Workflow,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkRequest,
  type ModelUsage,
  composePrompt,
  promptIds,
  continuationLimitSchema,
  runStartSchema,
  runStartOptionsSchema,
  type RunStartOptions,
  type BudgetPolicy,
  type ContextHandoffInput,
  modelSelectionSchema,
  type DraftLayout,
} from '@interlock/core';
import { UncertainFetch } from './fetch.js';
import { ScriptApprovals } from './scriptApprovals.js';
import { RunStarts } from './runStarts.js';
import { StartCosts } from './startCosts.js';
import { automatedStarts } from './automatedStarts.js';
import { RunAdmission } from './runAdmission.js';
import { HistoryRetention } from './historyRetention.js';
import { RunHistory } from './runHistory.js';
import {
  cancelRunTreeSchema,
  type RunCancellationPreview,
  type CancelRunTree,
} from '@interlock/core';
import { TrialEnvironments } from './trialEnvironments.js';
import { ManagedWorkspaces } from './workspaces.js';
import { Continuation } from './continuation.js';
import { Prompts } from './prompts.js';
import { Variables } from './variables.js';
import { ModelAliases } from './modelAliases.js';
export { ModelAliases } from './modelAliases.js';
import { variableReferences } from '@interlock/core';
import { VersionCleanup } from './versionCleanup.js';
import { Ownership } from './ownership.js';
import { Testbench } from './testbench.js';
import { Simulations } from './simulation.js';
import { Usage } from './usage.js';
import { RunChains } from './runChains.js';
import { Budgets } from './budgets.js';
import { WorkHolds } from './workHolds.js';
import { ExternalInputs } from './externalInputs.js';
import { AssignmentSizes } from './assignmentSize.js';
import { ContextContinuityGroups } from './contextContinuity.js';
import { claimTokenHash, leaseCounts, expiredClaimMessage } from './leases.js';

class ExpiredClaimError extends InterlockError {}
type Cb = (() => void)[];
const now = () => new Date().toISOString();
const terminal = (s: string) =>
  ['completed', 'failed', 'cancelled'].includes(s);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export type { Worker } from './engineTypes.js';
import { ResultProcessingError, type Worker } from './engineTypes.js';
import { ToolCalls } from './toolCalls.js';
import { recoverInterruptedOperations } from './interruptedOperations.js';
export class Engine {
  readonly stalls: Stalls;
  readonly triggers: WorkflowTriggers;
  readonly history: RunHistory;
  readonly retention: HistoryRetention;
  readonly executors: ExecutorManager;
  readonly continuation: Continuation;
  readonly toolCalls: ToolCalls;
  readonly prompts: Prompts;
  readonly variables: Variables;
  readonly modelAliases: ModelAliases;
  readonly versions: VersionCleanup;
  readonly ownership: Ownership;
  readonly testbench: Testbench;
  readonly simulations: Simulations;
  readonly usage: Usage;
  private readonly chains: RunChains;
  readonly runVersions: RunVersions;
  readonly budgets: Budgets;
  readonly assignmentSizes: AssignmentSizes;
  readonly pauses: PauseHolds;
  readonly holds: WorkHolds;
  readonly externalInputs: ExternalInputs;
  readonly requests: Requests;
  readonly scriptApprovals: ScriptApprovals;
  readonly boards: WorkflowBoards;
  private readonly resources: WorkResources;
  readonly contextGroups: ContextContinuityGroups;
  private readonly starts: RunStarts;
  readonly startCosts: StartCosts;
  private readonly trials: TrialEnvironments;
  readonly workspaces: ManagedWorkspaces;
  private readonly inspection: RunInspection;
  private readonly authoring: WorkflowAuthoring;
  private readonly deletion: WorkflowDeletion;
  private readonly agentSettings: AgentExecutorSettings;
  private readonly operations: LocalOperations;
  private readonly scriptControl: BackgroundScriptControl;
  private localJobs = new Map<string, AbortController>();
  private backgroundScripts: BackgroundScripts;
  private stopped = false;
  private listeners = new Set<() => void>();
  constructor(
    readonly store: Store,
    private cwd: string,
    private options: {
      trialRoot?: string;
      workspaceRoot?: string;
      allowedRoots?: string[];
      clock?: { now: () => number };
      substituteWorkflow?: (
        node: Extract<WorkflowNode, { kind: 'workflow' }>,
        execution: NodeExecution,
      ) => Promise<Json> | undefined;
      substituteOperation?: (
        node:
          | Extract<WorkflowNode, { kind: 'script' | 'fetch' }>
          | { kind: 'script' | 'fetch' },
        execution: NodeExecution,
      ) => Promise<Json>;
    } = {},
  ) {
    this.stalls = new Stalls(store, (run, type, message) =>
      this.event(run, type, message),
    );
    this.pauses = new PauseHolds(store, (run, hold) =>
      this.event(
        run,
        hold.releasedAt ? 'execution.pause_released' : 'execution.paused',
        `${hold.actor}: ${hold.releasedAt ? 'released pause' : 'paused'} ${hold.id}`,
      ),
    );
    this.backgroundScripts = new BackgroundScripts(store);
    this.scriptApprovals = new ScriptApprovals(store, {
      save: (run) => this.save(run),
      event: (run, message) => this.event(run, 'node.waiting', message),
    });
    this.executors = new ExecutorManager(this, cwd);
    this.simulations = new Simulations(store, cwd);
    this.chains = new RunChains(store);
    this.toolCalls = new ToolCalls(store, {
      run: (id) => this.run(id),
      definition: (run) => this.definition(run),
      save: (run) => this.save(run),
      event: (run, type, text) => this.event(run, type, text),
      fail: (run, execution, error) => this.fail(run, execution, error),
      cancel: (run, reason) => this.cancelOne(run, undefined, reason),
      paused: (run) => this.pauses.applicable(run.workflowId).length > 0,
      subscribe: (listener) => this.subscribe(listener),
      nowMs: () => this.nowMs(),
    });
    this.continuation = new Continuation(
      store,
      (id) => this.inspection.overlayProjection(this.store.continuation(id)),
      (id) => this.quiescence(id),
    );
    this.externalInputs = new ExternalInputs(store, {
      run: (id) => this.run(id),
      node: (run, execution) => {
        const node = this.definition({
          ...run,
          version: execution.version ?? run.version,
        }).nodes.find((node) => node.id === execution.nodeId);
        if (node?.kind !== 'input')
          throw new InterlockError('External-input node definition not found');
        return node;
      },
      complete: (run, execution, node, value) =>
        this.finish(run, execution, node, value),
      save: (run) => this.save(run),
      event: (run, type, message) => this.event(run, type, message),
      pump: () => this.pump(),
      assertUnpaused: (run) => this.pauses.assert(run),
      paused: (run) => this.pauses.applicable(run.workflowId).length > 0,
    });
    this.requests = new Requests(store, this.externalInputs, (id) =>
      this.projectRun(id),
    );
    this.boards = new WorkflowBoards(
      store,
      this.requests,
      (id) => this.projectRun(id),
      () => this.nowMs(),
      () => this.notify(),
    );
    this.holds = new WorkHolds(
      store,
      (work, outcome) => this.usage.ended(work, outcome),
      (work) => {
        const node = this.definition(this.run(work.runId)).nodes.find(
          (n) => n.id === work.nodeId,
        );
        return node?.kind === 'agent' ? node.unclaimedTimeoutMs : undefined;
      },
      (runId, type, message) => this.event(this.run(runId), type, message),
    );
    this.prompts = new Prompts(store);
    this.variables = new Variables(store);
    this.authoring = new WorkflowAuthoring(
      store,
      this.variables,
      this.prompts,
      this.scriptApprovals,
    );
    this.modelAliases = new ModelAliases(store, (id) =>
      this.executors.configuredPresetProfile(
        this.executors.profiles().find((profile) => profile.id === id),
      ),
    );
    this.assignmentSizes = new AssignmentSizes(store, this.prompts, (work) =>
      this.inspection.describeWork(work),
    );
    this.versions = new VersionCleanup(store);
    this.runVersions = new RunVersions(store, {
      input: (run, definition) => {
        const node = definition.nodes.find((node) => node.id === run.cursor)!;
        return node.inputBindings
          ? resolveBindingFields(
              node.inputBindings,
              this.bindingSource(run, run.value),
            )
          : run.value;
      },
      prompts: (definition, pins) => this.prompts.capture(definition, pins),
      validateCaptures: (run, definition) => {
        this.variables.capture(definition, run.variableCaptures ?? []);
        const explicitPresets = new Set(
          definition.nodes.flatMap((node) => {
            if (node.kind !== 'agent' || !selectsPreset(node, definition))
              return [];
            const ref = agentAliasReference(node, definition);
            return ref ? [ref] : [];
          }),
        );
        for (const ref of modelReferences(definition)) {
          const inherited = this.modelAliases.capturedAlias(
            run.modelAliasCaptures ?? [],
            ref,
          );
          if (inherited) continue;
          const originalLiteral =
            run.modelAliasCaptures !== undefined &&
            modelReferences(this.definition(run)).includes(ref) &&
            run.ignoredWorkflowModelAlias !== ref;
          if (
            explicitPresets.has(ref) ||
            (!originalLiteral &&
              this.modelAliases.requirement(ref) &&
              (run.ignoredWorkflowModelAlias !== ref ||
                this.modelAliases.usesReference(definition, ref)))
          )
            throw new InterlockError(
              `Model alias capture ${ref} is missing. Start a new run to capture it.`,
            );
        }
      },
      save: (run) => this.save(run),
      event: (run, type, message) => this.event(run, type, message),
      assertRunnable: (run) => this.versions.assertRunnable(run, true),
    });
    this.ownership = new Ownership(store);
    this.usage = new Usage(store, (runId) => {
      this.budgets.refresh();
      this.resources.refresh();
      this.event(
        this.run(runId),
        'work.usage_reported',
        'Reported usage updated',
      );
    });
    this.budgets = new Budgets(store, this.usage, (runId, blocked) =>
      this.event(
        this.run(runId),
        'run.budget_updated',
        blocked
          ? 'Agent claims blocked by budget'
          : 'Budget updated; claim eligibility rechecked',
      ),
    );
    this.contextGroups = new ContextContinuityGroups(store, (runId) =>
      this.event(
        this.run(runId),
        'context.updated',
        'Context continuity binding updated',
      ),
    );
    this.resources = new WorkResources(store, (id, message) => {
      if (store.get('runs', id))
        this.event(this.run(id), 'work.resources', message);
    });
    this.starts = new RunStarts(store);
    this.startCosts = new StartCosts(store, this.usage, (run, text) =>
      this.event(run, 'run.cost_warning', text),
    );
    const automated = automatedStarts({
      store,
      starts: this.starts,
      costs: this.startCosts,
      workflow: (id) => this.workflow(id),
      run: (id) => this.run(id),
      newRun: (q, schedule, chain) =>
        this.newRun(
          q.workflowId,
          q.version,
          q.input,
          undefined,
          undefined,
          undefined,
          undefined,
          q,
          schedule,
          chain,
        ),
    });
    this.triggers = new WorkflowTriggers(
      store,
      automated.schedule,
      new EventTriggers(store, automated.event, (runId) =>
        this.quiescence(runId),
      ),
    );
    this.history = new RunHistory(
      store,
      (ids) => this.starts.deleted(ids),
      (ids) => this.inspection.historyDeletionBlockers(ids),
      () =>
        queueMicrotask(() => this.listeners.forEach((listener) => listener())),
    );
    this.retention = new HistoryRetention(store, this.history);
    this.trials = new TrialEnvironments(store, options.trialRoot, () =>
      this.pump(),
    );
    this.workspaces = new ManagedWorkspaces(this, this.trials, options);
    this.testbench = new Testbench(
      store,
      {
        create: (workflowId, version, input, comparison, budget) => {
          const run = this.newRun(
            workflowId,
            version,
            input,
            undefined,
            undefined,
            comparison,
          );
          if (budget)
            this.budgets.set({ runId: run.id, expectedRevision: 0, budget });
          return this.run(run.id);
        },
        cancel: (id) => this.cancelTree(id),
      },
      this.usage,
      this.trials,
      this.modelAliases,
    );
    this.inspection = new RunInspection(
      store,
      (id) => this.run(id),
      this.localJobs,
      this.executors,
      this.resources,
      this.holds,
      this.chains,
      this.testbench,
      this.stalls,
      (id) => this.quiescence(id),
      (runId) => this.available(runId),
    );
    this.agentSettings = new AgentExecutorSettings(
      this.modelAliases,
      this.executors,
      this.contextGroups,
      options,
    );
    this.operations = new LocalOperations(
      store,
      (id) => this.run(id),
      (run) => this.save(run),
      (run, type, text) => this.event(run, type, text),
      (run) => this.definition(run),
      (run, input) => this.bindingSource(run, input),
      () => this.getAllowedRoots(),
      cwd,
      this.scriptApprovals,
      this.trials,
      this.workspaces,
      this.variables,
      this.backgroundScripts,
      () => this.stopped,
      () => this.executors,
    );
    this.scriptControl = new BackgroundScriptControl(
      store,
      (id) => this.run(id),
      (run) => this.save(run),
      (run, type, text) => this.event(run, type, text),
      (run) => this.definition(run),
      (run, execution, error) => this.fail(run, execution, error),
      (id) => this.cancelTree(id),
      this.variables,
      this.backgroundScripts,
      this.resources,
    );
    this.deletion = new WorkflowDeletion(
      store,
      (id) => this.workflow(id),
      this.testbench,
      this.simulations,
      this.executors,
      this.usage,
      this.chains,
      this.holds,
      this.budgets,
      this.contextGroups,
      this.resources,
      this.starts,
      this.retention,
      this.listeners,
    );
    for (const id of this.trials.recover()) this.cancelTree(id);
    // Deterministic ownership survives a lost process outcome. Background supervisors
    // keep their reservation while authenticated recovery establishes their result.
    for (const run of store.runScopes.withActiveResources()) {
      let changed = false;
      for (const execution of run.executions) {
        if (!execution.resourceActive) continue;
        if (
          run.status === 'running' &&
          execution.background &&
          ['launching', 'running', 'completed'].includes(
            execution.background.state,
          )
        )
          continue;
        this.resources.endExecution(run.id, execution, true);
        changed = true;
      }
      if (changed) this.save(run);
    }
    recoverInterruptedOperations(store, this.resources, {
      save: (run) => this.save(run),
      fail: (run, execution, error) => this.fail(run, execution, error),
    });
  }
  nowMs(): number {
    return this.options.clock ? this.options.clock.now() : Date.now();
  }
  now(): string {
    return new Date(this.nowMs()).toISOString();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify() {
    queueMicrotask(() => this.listeners.forEach((listener) => listener()));
  }
  private event(run: Run, type: string, text: string, boardColumnId?: string) {
    if (type === 'external_input.held' || type === 'external_input.released')
      this.stalls.hold(
        `input:${run.id}`,
        run.id,
        type === 'external_input.held',
      );
    const event = {
      id: randomUUID(),
      runId: run.id,
      type,
      message: text,
      ...(boardColumnId ? { boardColumnId } : {}),
      at: now(),
      ...this.projectRun(run.id, run),
    };
    this.store.put('events', event);
    this.triggers?.events.capture(run, event);
    this.notify();
  }
  private save(run: Run) {
    run.updatedAt = now();
    this.store.put('runs', run);
  }
  getAllowedRoots(): string[] {
    const serverSettingsRoots = this.store.get<{
      id: string;
      allowedRoots?: string[];
    }>('executorSettings', 'shared')?.allowedRoots;
    return [
      ...(this.options.allowedRoots ?? []),
      ...(serverSettingsRoots ?? []),
    ];
  }
  workflow(id: string) {
    return this.authoring.workflow(id);
  }
  describeWorkflow(workflow: Workflow) {
    return this.authoring.describeWorkflow(workflow);
  }
  saveLayout(input: {
    id: string;
    expectedRevision: number;
    positions: WorkflowPositions;
  }) {
    return this.authoring.saveLayout(input);
  }
  authoringSummary(workflow: Workflow) {
    return this.authoring.authoringSummary(workflow);
  }
  run(id: string) {
    const run = this.store.get<Run>('runs', id);
    if (!run) throw new InterlockError('Run not found');
    return run;
  }
  doctor(options?: DoctorOptions): Promise<DoctorReport> {
    return runDoctor(this, options);
  }
  report(filter: ReportFilter): WorkflowReport {
    return generateWorkflowReport(this.store, this, filter);
  }
  create(
    name: string,
    description = '',
    definition = blankDefinition(),
    ownerWorkflowId: string | null = null,
    layout?: DraftLayout,
  ): Workflow {
    return this.authoring.create(
      name,
      description,
      definition,
      ownerWorkflowId,
      layout,
    );
  }
  update(
    id: string,
    patch: {
      name?: string;
      description?: string;
      archived?: boolean;
      draft?: WorkflowDefinition;
      draftRevision?: number;
      layout?: DraftLayout;
    },
  ) {
    return this.authoring.update(id, patch);
  }
  validateDraft(id: string, candidate?: unknown) {
    return this.authoring.validateDraft(id, candidate);
  }
  editDraft(
    id: string,
    draftRevision: number,
    edits: unknown,
    diagnosticsMode: 'all' | 'summary' = 'all',
    layout?: DraftLayout,
  ) {
    return this.authoring.editDraft(
      id,
      draftRevision,
      edits,
      diagnosticsMode,
      layout,
    );
  }
  createChild(input: {
    ownerWorkflowId: string;
    name: string;
    parentDraftRevision: number;
    parent: {
      name: string;
      description: string;
      definition: WorkflowDefinition;
    };
    nodeId?: string;
  }) {
    return this.authoring.createChild(input);
  }
  useChildVersion(input: {
    id: string;
    childId: string;
    nodeId: string;
    version: number;
    draftRevision: number;
  }) {
    return this.authoring.useChildVersion(input);
  }
  deleteWorkflow(id: string) {
    return this.deletion.deleteWorkflow(id);
  }
  clone(id: string) {
    return this.authoring.clone(id);
  }
  publish(id: string | string[], cascade = false) {
    return this.authoring.publish(id, cascade);
  }
  private pinnedVersion(node: Extract<WorkflowNode, { kind: 'workflow' }>) {
    if (node.version === null)
      throw new InterlockError(
        'Cannot execute an unpublished workflow reference',
      );
    return node.version;
  }
  private newRun(
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
      promptSnapshots: continuedFrom
        ? continuedFrom.promptSnapshots
        : sameWorkflowChild && parentRunId
          ? this.run(parentRunId).promptSnapshots
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
              : continuedFrom
                ? this.variables.capture(
                    definition,
                    continuedFrom.variableCaptures ?? [],
                  )
                : sameWorkflowChild && parentRunId
                  ? this.variables.capture(
                      definition,
                      this.run(parentRunId).variableCaptures ?? [],
                    )
                  : comparison
                    ? this.variables.capture(
                        definition,
                        this.testbench.variablesFor(comparison),
                      )
                    : this.variables.capture(definition),
          }
        : {}),
      ...(() => {
        const parent =
          continuedFrom ??
          (sameWorkflowChild && parentRunId
            ? this.run(parentRunId)
            : undefined);
        const captures = this.options.substituteOperation
          ? []
          : this.modelAliases.capture(
              definition,
              parent
                ? (parent.modelAliasCaptures ?? [])
                : comparison
                  ? this.testbench.modelAliasesFor(comparison)
                  : undefined,
            );
        const ref = definition.agentModel;
        const ignored =
          ref &&
          (parent
            ? parent.ignoredWorkflowModelAlias === ref
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
  start(
    workflowId: string,
    input: Json,
    version?: number,
    budget?: BudgetPolicy,
    options?: RunStartOptions,
  ) {
    return this.startCosts.attach(
      workflowId,
      this.inspect(this.startRun(workflowId, input, version, budget, options)),
    );
  }
  startSummary(
    workflowId: string,
    input: Json,
    version?: number,
    limit = 20,
    budget?: BudgetPolicy,
    options?: RunStartOptions,
  ) {
    const bounded = continuationLimitSchema.parse(limit);
    return this.startCosts.attach(
      workflowId,
      this.continuation.summary(
        this.startRun(workflowId, input, version, budget, options),
        bounded,
      ),
    );
  }
  private startRun(
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
  runAttention(requests = this.requests.current()) {
    return runAttention(requests);
  }
  projectRun(id: string, override?: Run) {
    return this.inspection.projectRun(id, override);
  }
  projectRuns<T extends { id: string }>(runs: T[]) {
    return this.inspection.projectRuns(runs);
  }
  inspect(id: string) {
    return this.inspection.inspect(id);
  }
  private definition(
    run: Pick<Run, 'workflowId' | 'version'>,
  ): WorkflowDefinition {
    const snapshot = this.store.getVersion(run.workflowId, run.version);
    if (!snapshot)
      throw new InterlockError('Published workflow version not found');
    return snapshot.definition;
  }
  private fail(run: Run, execution: NodeExecution, error: string) {
    if (execution.resourceActive)
      this.resources.endExecution(run.id, execution, true);
    for (const id of execution.childRunIds)
      if (
        this.run(id).parentMode !== 'detached' &&
        !terminal(this.run(id).status)
      )
        this.cancelTree(id);
    execution.status = 'failed';
    execution.error = error;
    execution.completedAt = now();
    run.status = 'failed';
    run.error = error;
    this.save(run);
    this.event(run, 'node.failed', `${execution.label}: ${error}`);
  }
  private failOperation(
    run: Run,
    execution: NodeExecution,
    node: WorkflowNode,
    error: string,
    category: FailureCategory,
    child?: Run,
  ) {
    if (!hasFailureRoute(node)) return this.fail(run, execution, error);
    const edge = this.definition(run).edges.find(
      (e) => e.source === node.id && e.port === 'failed',
    );
    if (
      !edge ||
      (edge.targetHandle === 'end' && edge.target !== run.batchNodeId) ||
      (edge.targetHandle === 'join' &&
        edge.target !== run.parallelBranch?.nodeId)
    )
      return this.fail(run, execution, `${error}; invalid Failed route`);
    const value: Json = {
      input: execution.input,
      error: {
        nodeId: node.id,
        executionId: execution.id,
        kind: node.kind,
        category,
        message: error,
        ...(child
          ? {
              child: {
                runId: child.id,
                workflowId: child.workflowId,
                version: child.version,
                executionId: child.executions.at(-1)?.id ?? null,
              },
            }
          : {}),
      },
      output: execution.output ?? null,
    };
    execution.status = 'failed';
    execution.error = error;
    execution.port = 'failed';
    execution.completedAt = now();
    run.value = value;
    if (edge.targetHandle === 'end' || edge.targetHandle === 'join') {
      run.status = 'completed';
      run.output = value;
      this.event(
        run,
        'run.completed',
        run.parallelBranch ? 'Branch result returned' : 'Item result returned',
      );
    } else {
      run.cursor = edge.target;
      run.status = 'running';
    }
    this.save(run);
    this.event(run, 'node.failed', `${execution.label}: ${error}`);
    this.event(
      run,
      'node.failure_routed',
      `${execution.label}: followed Failed`,
    );
  }
  private failWorkflow(
    run: Run,
    node: Extract<WorkflowNode, { kind: 'workflow' }>,
    child: Run,
    error: string,
    category: 'child' | 'output',
  ) {
    // A failed write must not leave a routed port or value in the terminal
    // failure path. The child and caller history remain independently inspectable.
    this.store.transaction(() => {
      const routed = structuredClone(run),
        execution = routed.executions.at(-1)!;
      if (category === 'output') execution.output = child.output;
      this.failOperation(routed, execution, node, error, category, child);
    });
  }
  private bindingSource(
    run: Run,
    input: Json,
  ): (b: PathBinding) => Json | undefined {
    if (run.toolCall)
      return this.bindingSource(this.run(run.parentRunId!), input);
    let workflowRun = run;
    while (
      (workflowRun.batchNodeId || workflowRun.parallelBranch) &&
      workflowRun.parentRunId
    )
      workflowRun = this.run(workflowRun.parentRunId);
    let root = workflowRun;
    while (root.parentRunId) root = this.run(root.parentRunId);
    const sources = {
      input,
      runInput: workflowRun.input,
      rootInput: root.input,
      itemInput: run.input,
    };
    return (binding: PathBinding): Json | undefined => {
      if (binding.source === 'itemInput' && !run.batchNodeId)
        throw new InterlockError(
          'itemInput is only available inside a Batch item run',
        );
      if (binding.source === 'execution') {
        const previous = run.executions.findLast(
          (candidate) =>
            candidate.nodeId === binding.nodeId &&
            candidate.status === 'completed',
        );
        return (previous?.provenance ?? undefined) as unknown as
          Json | undefined;
      }
      if (binding.source !== 'node') return sources[binding.source];
      const previous = run.executions.findLast(
        (candidate) =>
          candidate.nodeId === binding.nodeId &&
          candidate.status === 'completed',
      );
      return previous?.output;
    };
  }
  private prepareResult(run: Run, node: WorkflowNode, result: Json) {
    let port = 'default';
    if (node.routing) {
      try {
        const matched = matchRouting(node.routing, result, (nodeId, path) => {
          const previous = run.executions.findLast(
            (e) => e.nodeId === nodeId && e.status === 'completed',
          );
          if (path === 'visitCount')
            return previous?.provenance?.visitCount ?? 0;
          if (!previous?.provenance) return null;
          return readPath(previous.provenance as unknown as Json, path);
        });
        if (matched === undefined)
          throw new InterlockError(
            `No result branch matched at "${node.routing.path || '$'}"`,
          );
        port = matched;
      } catch (error) {
        throw new ResultProcessingError(
          'routing',
          `${node.label} result routing: ${message(error)}`,
        );
      }
    }
    try {
      const output = node.outputBindings
        ? resolveBindingFields(
            node.outputBindings,
            this.bindingSource(run, result),
          )
        : result;
      return { port, output };
    } catch (error) {
      throw new ResultProcessingError(
        'outputBindings',
        `${node.label} output fields: ${message(error)}`,
      );
    }
  }
  private finish(
    run: Run,
    execution: NodeExecution,
    node: WorkflowNode,
    output: Json,
    port: WorkflowEdge['port'] = 'default',
  ) {
    // Lifecycle routes bypass success-result validation, routing and shaping.
    const timeout = port === 'timeout' && hasTimeoutRoute(node);
    if (!timeout) {
      const assertOutput =
        node.kind === 'input' || node.kind === 'parallel'
          ? assertOwnPropertyContract
          : assertContract;
      assertOutput(
        node.kind === 'workflow' && node.mode === 'detached'
          ? STARTED_RUN_SCHEMA
          : node.outputSchema,
        output,
        `${node.label} output`,
      );
    }
    let rawResult: Json | undefined;
    if (port === 'default' && (node.routing || node.outputBindings)) {
      try {
        const prepared = this.prepareResult(run, node, output);
        if (node.outputBindings) rawResult = output;
        output = prepared.output;
        port = prepared.port;
      } catch (error) {
        execution.result = output;
        this.fail(run, execution, message(error));
        return;
      }
    }
    const edge = this.definition(run).edges.find(
      (e) => e.source === node.id && e.port === port && e.kind !== 'tool',
    );
    if (!edge && node.kind !== 'exit' && !run.toolCall)
      throw new InterlockError(
        'Missing outgoing route; connect item paths to End',
      );
    if (edge?.targetHandle === 'end' && edge.target !== run.batchNodeId)
      throw new InterlockError('End must belong to the current Batch group');
    if (
      edge?.targetHandle === 'join' &&
      edge.target !== run.parallelBranch?.nodeId
    )
      throw new InterlockError(
        'Join must belong to the current Parallel group',
      );
    if (node.kind === 'exit' && !node.continueAsNew)
      assertContract(
        this.definition(run).outputSchema,
        output,
        'Workflow output',
      );
    if (node.kind === 'exit' && node.continueAsNew) {
      // A nested savepoint prevents a committed orphan if either write fails.
      // Copies keep rollback IDs out of the engine's failure path.
      this.store.transaction(() => {
        const previous = structuredClone(run);
        assertContract(
          this.definition(previous).inputSchema,
          output,
          'Successor workflow input',
        );
        const successor = this.chains.next(previous, () =>
          this.newRun(
            previous.workflowId,
            previous.version,
            output,
            undefined,
            undefined,
            undefined,
            previous,
          ),
        );
        const step = previous.executions.at(-1)!;
        const visitCount = calculateVisitCount(previous.executions, node.id);
        step.provenance = buildExecutionProvenance({
          node,
          execution: step,
          visitCount,
          attempt: step.attempt ?? 1,
          endedAt: now(),
        });
        step.output = output;
        step.port = port;
        step.status = 'completed';
        step.completedAt = now();
        previous.value = output;
        previous.status = 'completed';
        // A continuing Exit produces a checkpoint, not a final workflow result.
        this.save(previous);
        this.event(
          previous,
          'run.continued',
          `Continued as run ${successor.id}`,
        );
        this.event(previous, 'node.completed', step.label);
      });
      return;
    }
    const visitCount = calculateVisitCount(run.executions, node.id);
    let managed:
      | {
          profileId?: string | null;
          harness?: string | null;
          sessionId?: string | null;
          requestedModel?: string | null;
          actualModel?: string | null;
          provider?: string | null;
          effort?: string | null;
          usage?: ModelUsage[] | null;
        }
      | undefined;
    let attempt = execution.attempt ?? 1;
    if (node.kind === 'agent') {
      const work = this.store
        .work(undefined, run.id)
        .find((w) => w.executionId === execution.id);
      if (work) {
        attempt = work.attempt;
        managed = this.executors.executionProvenance(work.id, work.attempt);
        if (
          !managed &&
          (work.executorModel || work.modelSelection || node.model)
        ) {
          const actualModel =
            work.modelSelection?.model ??
            work.executorModel ??
            node.model ??
            null;
          const provider = resolveProvider({
            model: actualModel,
            catalogProvider: work.modelSelection?.provider,
            prefixOverrides: this.executors.settings().providerPrefixes,
          });
          managed = {
            profileId: work.executor ?? null,
            harness: null,
            sessionId: null,
            requestedModel: work.executorModel ?? node.model ?? null,
            actualModel,
            provider,
            effort: work.executorEffort ?? null,
            usage: null,
          };
        }
      }
    }
    execution.provenance = buildExecutionProvenance({
      node,
      execution,
      visitCount,
      managed,
      attempt,
      endedAt: now(),
    });
    if (rawResult !== undefined) execution.result = rawResult;
    execution.output = output;
    execution.port = port;
    execution.status = 'completed';
    execution.completedAt = now();
    run.value = output;
    if (
      node.kind === 'exit' ||
      run.toolCall ||
      edge?.targetHandle === 'end' ||
      edge?.targetHandle === 'join'
    ) {
      run.status = 'completed';
      run.output = output;
      this.event(
        run,
        'run.completed',
        run.toolCall
          ? 'Tool result returned'
          : run.parallelBranch
            ? 'Branch result returned'
            : run.batchNodeId
              ? 'Item result returned'
              : 'Workflow completed',
      );
    } else {
      run.cursor = edge!.target;
      run.status = 'running';
    }
    this.save(run);
    this.event(run, 'node.completed', execution.label);
  }
  private advance(run: Run): boolean {
    if (run.status === 'queued' || terminal(run.status)) return false;
    if (this.pauses.applicable(run.workflowId).length) {
      const pending = run.executions.at(-1);
      if (pending?.resourceBlocked) this.admitOperation(run, pending, false);
      return false;
    }
    const pending = run.executions.at(-1);
    if (!pending || terminal(pending.status)) this.runVersions.advance(run);
    const definition = this.definition(run),
      node = definition.nodes.find((n) => n.id === run.cursor)!;
    const workspace = this.workspaces.gate(run, definition);
    if (typeof workspace === 'boolean') return workspace;
    if (workspace && pending && !terminal(pending.status)) {
      this.fail(run, pending, workspace);
      return true;
    }
    let execution = run.executions.at(-1);
    const starting = !execution || terminal(execution.status);
    if (!execution || terminal(execution.status)) {
      const attempt = run.nextScriptAttempt;
      delete run.nextScriptAttempt;
      execution = {
        id: randomUUID(),
        version: run.version,
        nodeId: node.id,
        kind: node.kind,
        label: node.label,
        input: run.value,
        status: 'running',
        startedAt: now(),
        childRunIds: [],
        nextItem: 0,
        ...(attempt === undefined ? {} : { attempt }),
      };
      run.executions.push(execution);
      try {
        if (workspace) throw new InterlockError(workspace);
        if (!run.toolCall && node.batchId !== run.batchNodeId)
          throw new InterlockError('Execution cannot cross Batch groups');
        if (
          !run.toolCall &&
          (node.parallelId !== run.parallelBranch?.nodeId ||
            node.parallelBranchId !== run.parallelBranch?.id)
        )
          throw new InterlockError('Execution cannot cross Parallel branches');
        this.chargeStep(run, node, definition.maxSteps);
        const stageId = node.stageId ?? node.boardColumnId;
        const mapped = stageId
          ? this.store.workflowBoardStageColumn(run.workflowId, stageId)
          : undefined;
        const column =
          mapped === undefined && !node.stageId ? node.boardColumnId : mapped;
        this.event(run, 'node.started', node.label, column ?? undefined);
        if (node.inputBindings) {
          execution.originalInput = run.value;
          execution.input = resolveBindingFields(
            node.inputBindings,
            this.bindingSource(run, run.value),
          );
        }
        if (node.kind === 'entry')
          assertContract(definition.inputSchema, run.input, 'Workflow input');
        const assertInput =
          node.kind === 'parallel' ? assertOwnPropertyContract : assertContract;
        assertInput(node.inputSchema, execution.input, `${node.label} input`);
        if (
          (node.kind === 'script' ||
            node.kind === 'fetch' ||
            isPollWait(node)) &&
          node.resources?.length
        )
          execution.resources = resourceNamesSchema
            .parse(
              Object.values(
                resolveBindingFields(
                  Object.fromEntries(
                    node.resources.map((binding, i) => [String(i), binding]),
                  ),
                  this.bindingSource(run, execution.input),
                ),
              ),
            )
            .sort();
      } catch (error) {
        this.fail(run, execution, message(error));
        return true;
      }
    }
    try {
      if (node.kind === 'input') {
        if (execution.status === 'waiting') return false;
        if (node.humanInput)
          execution.humanInput = captureHumanInput(
            node.humanInput,
            execution.input,
          );
        execution.status = 'waiting';
        execution.externalInput = { revision: 0 };
        run.status = 'waiting';
        this.save(run);
        this.event(
          run,
          'node.waiting',
          `${node.label}: waiting for ${node.humanInput ? 'human' : 'external'} input`,
        );
        return true;
      }
      if (node.kind === 'agent') {
        if (execution.status === 'waiting') {
          const work = this.store
            .work('available', run.id)
            .find((w) => w.executionId === execution!.id);
          if (node.unclaimedTimeoutMs === undefined) return false;
          if (
            work?.budgetBlocked ||
            work?.resourceBlocked ||
            !work?.availableUntil ||
            Date.parse(work.availableUntil) > this.nowMs()
          )
            return false;
          work.status = 'timed_out';
          this.store.put('work', work);
          this.event(
            run,
            'work.timed_out',
            `${node.label}: unclaimed deadline reached`,
          );
          this.finish(run, execution, node, execution.input, 'timeout');
          return true;
        }
        const savedPrompts = (node.promptIds ?? []).map((id) => {
          const snapshot = run.promptSnapshots?.find((p) => p.id === id);
          if (!snapshot)
            throw new InterlockError(`Missing captured prompt ${id}`);
          return snapshot;
        });
        const trialEnvironment = this.trials.context(run);
        const resources = node.resources?.length
          ? resourceNamesSchema
              .parse(
                Object.values(
                  resolveBindingFields(
                    Object.fromEntries(
                      node.resources.map((binding, i) => [String(i), binding]),
                    ),
                    this.bindingSource(run, execution.input),
                  ),
                ),
              )
              .sort()
          : undefined;
        const definition = this.definition(run);
        const { resolvedCwd, cwdBlocked } = this.workspaces.agentCwd(
          run,
          node,
          definition,
          this.bindingSource(run, execution.input),
        );
        if (resolvedCwd) execution.resolvedCwd = resolvedCwd;
        const executorSettings = this.agentSettings.resolve(
          run,
          definition,
          node,
        );
        if (!executorSettings) {
          // The async version check will resume this same node execution.
          if (starting) this.save(run);
          return false;
        }
        const work: WorkRequest = {
          ...executorSettings,
          ...(resources ? { resources } : {}),
          ...(resolvedCwd ? { resolvedCwd } : {}),
          ...(cwdBlocked ? { cwdBlocked } : {}),
          id: randomUUID(),
          runId: run.id,
          executionId: execution.id,
          nodeId: node.id,
          label: node.label,
          prompt: composePrompt(node.prompt, savedPrompts),
          ...(savedPrompts.length ? { savedPrompts } : {}),
          input: execution.input,
          context: trialEnvironment
            ? {
                ...node.context,
                skills: [
                  ...new Set([
                    ...node.context.skills,
                    'interlock-local-trials',
                  ]),
                ],
              }
            : node.context,
          ...(trialEnvironment ? { trialEnvironment } : {}),
          ...(node.context.continuityGroup
            ? {
                continuity: this.contextGroups.describe(
                  run.id,
                  node.context.continuityGroup,
                ),
              }
            : {}),
          outputSchema: node.outputSchema,
          ...(node.resultRules ? { resultRules: node.resultRules } : {}),
          status: 'available',
          attempt: 0,
          maxAttempts: node.maxAttempts,
          ...(node.maxLeaseExpiries === undefined
            ? {}
            : {
                maxLeaseExpiries: node.maxLeaseExpiries,
                failureCount: 0,
                leaseExpiryCount: 0,
              }),
          maxExecutionMs: node.maxExecutionMs,
          leaseSeconds: node.leaseSeconds,
          availableUntil:
            node.unclaimedTimeoutMs === undefined
              ? undefined
              : new Date(this.nowMs() + node.unclaimedTimeoutMs).toISOString(),
          createdAt: now(),
        };
        this.store.put('work', work);
        this.budgets.refresh();
        this.resources.refresh();
        execution.status = 'waiting';
        run.status = 'waiting';
        this.save(run);
        this.event(run, 'work.available', `Awaiting agent: ${node.label}`);
        return true;
      }
      if (isPollWait(node)) {
        if (!execution.nextCheckAt) {
          const started = this.nowMs();
          execution.nextCheckAt = new Date(started).toISOString();
          execution.resumeAt = execution.nextCheckAt;
          if (node.timing.timeoutMs !== undefined)
            execution.timeoutAt = new Date(
              started + node.timing.timeoutMs,
            ).toISOString();
          execution.status = 'waiting';
          run.status = 'waiting';
          this.save(run);
          this.event(
            run,
            'node.waiting',
            `${node.label}: checking every ${Math.round(node.timing.everyMs / 1000)}s${execution.timeoutAt ? ` until ${execution.timeoutAt}` : ''}`,
          );
        }
        if (
          !execution.resourceBlocked &&
          this.finishPollTimeout(run, execution, node)
        )
          return true;
        if (Date.parse(execution.nextCheckAt!) <= this.nowMs())
          this.admitOperation(run, execution);
        return false;
      }
      if (node.kind === 'wait') {
        if (!execution.resumeAt) {
          if (node.timing.kind === 'duration') {
            execution.resumeAt = new Date(
              this.nowMs() + node.timing.ms,
            ).toISOString();
          } else {
            const value = readPath(execution.input, node.timing.path);
            if (
              typeof value !== 'string' ||
              !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
                value,
              ) ||
              !Number.isFinite(Date.parse(value)) ||
              new Date(value.slice(0, 10) + 'T00:00:00Z')
                .toISOString()
                .slice(0, 10) !== value.slice(0, 10)
            )
              throw new InterlockError(
                'Wait requires an ISO timestamp with a timezone, such as 2026-09-10T12:00:00Z',
              );
            execution.resumeAt = new Date(value).toISOString();
          }
          execution.status = 'waiting';
          run.status = 'waiting';
          this.save(run);
          this.event(
            run,
            'node.waiting',
            `${node.label}: waiting until ${execution.resumeAt}`,
          );
        }
        if (Date.parse(execution.resumeAt) > this.nowMs()) return false;
        this.finish(run, execution, node, execution.input);
        return true;
      }
      if (node.kind === 'script' || node.kind === 'fetch') {
        const held =
          node.kind === 'script'
            ? this.scriptApprovals.hold(run, execution, node)
            : undefined;
        if (held !== undefined) return held;
        let changed = starting;
        if (node.kind === 'fetch' && !execution.request) {
          execution.request = resolveFetch(node, execution.input);
          changed = true;
        }
        if (changed) this.save(run);
        this.admitOperation(run, execution);
        return false;
      }
      if (node.kind === 'workflow' && node.mode === 'detached') {
        if (!isStartedRunSchema(node.outputSchema))
          throw new InterlockError(
            `${node.label}: Start and continue requires the fixed Started run output contract`,
          );
        const version = this.pinnedVersion(node);
        const target = this.definition({
          workflowId: node.workflowId,
          version,
        });
        assertContract(
          target.inputSchema,
          execution.input,
          `${node.label}: workflow input`,
        );
        // A savepoint protects child creation if finishing the dispatch fails.
        // Mutate a copy so the failure path never retains rolled-back child IDs.
        this.store.transaction(() => {
          const dispatched = structuredClone(run);
          const step = dispatched.executions.at(-1)!;
          const child = step.childRunIds.length
            ? this.run(step.childRunIds[0])
            : this.newRun(node.workflowId, version, step.input, run.id);
          child.parentMode = 'detached';
          child.parentExecutionId = step.id;
          this.save(child);
          step.childRunIds = [child.id];
          this.finish(dispatched, step, node, {
            runId: child.id,
            workflowId: child.workflowId,
            version: child.version,
          });
        });
        return true;
      }
      if (
        node.kind === 'workflow' &&
        this.options.substituteWorkflow &&
        execution
      ) {
        if (starting) this.save(run);
        const stepExecution = execution;
        const executionId = stepExecution.id;
        if (
          !stepExecution.childRunIds.length &&
          !this.localJobs.has(executionId)
        ) {
          const substituted = this.options.substituteWorkflow(
            node,
            stepExecution,
          );
          if (substituted) {
            const controller = new AbortController();
            this.localJobs.set(executionId, controller);
            void substituted
              .then(
                (output) => {
                  if (this.stopped) return;
                  this.store.transaction(() => {
                    const latest = this.run(run.id);
                    if (
                      latest.status !== 'running' ||
                      latest.executions.at(-1)?.id !== executionId
                    )
                      return;
                    const current = latest.executions.at(-1)!;
                    if (hasFailureRoute(node)) current.output = output;
                    try {
                      assertContract(
                        node.outputSchema,
                        output,
                        `${node.label}: workflow output`,
                      );
                      this.finish(latest, current, node, output);
                    } catch (error) {
                      if (hasFailureRoute(node)) {
                        this.failOperation(
                          latest,
                          current,
                          node,
                          message(error),
                          'output',
                        );
                      } else {
                        this.fail(latest, current, message(error));
                      }
                    }
                  });
                },
                (error) => {
                  if (this.stopped) return;
                  this.store.transaction(() => {
                    const latest = this.run(run.id);
                    if (
                      latest.status !== 'running' ||
                      latest.executions.at(-1)?.id !== executionId
                    )
                      return;
                    const current = latest.executions.at(-1)!;
                    if (hasFailureRoute(node)) {
                      this.failOperation(
                        latest,
                        current,
                        node,
                        message(error),
                        'child',
                      );
                    } else {
                      this.fail(latest, current, message(error));
                    }
                  });
                },
              )
              .finally(() => {
                this.localJobs.delete(executionId);
                this.pump();
              });
            return true;
          }
        } else if (this.localJobs.has(executionId)) {
          return false;
        }
      }
      if (node.kind === 'parallel')
        return this.advanceParallel(run, execution, node, starting);
      if (node.kind === 'workflow' || node.kind === 'batch') {
        const value =
          node.kind !== 'workflow'
            ? readPath(execution.input, node.itemsPath)
            : [execution.input];
        if (!Array.isArray(value))
          throw new InterlockError('Batch input must resolve to an array');
        if (
          node.kind === 'batch' &&
          value.length > (node.maxItems ?? DEFAULT_BATCH_MAX_ITEMS)
        )
          throw new InterlockError(
            `Batch input has ${value.length} items; limit is ${node.maxItems ?? DEFAULT_BATCH_MAX_ITEMS} items (maxItems). Raise Maximum items or split the input.`,
          );
        let children = execution.childRunIds.map((id) => this.run(id));
        if (node.kind === 'workflow' || node.failurePolicy === 'all') {
          const failed = children.find(
            (c) =>
              (c.status === 'failed' || c.status === 'cancelled') &&
              !execution!.retryChildRunIds?.includes(c.id),
          );
          if (failed) {
            if (
              node.kind === 'workflow' &&
              hasFailureRoute(node) &&
              failed.status === 'failed'
            ) {
              this.failWorkflow(
                run,
                node,
                failed,
                `Child run ${failed.id}: ${failed.error ?? 'failed'}`,
                'child',
              );
              return true;
            }
            for (const child of children)
              if (!terminal(child.status)) this.cancelTree(child.id);
            throw new InterlockError(
              `Child run ${failed.id}: ${failed.error ?? failed.status}${node.kind === 'batch' ? `; ${children.filter((c) => c.status === 'completed').length} of ${value.length} Batch items completed` : ''}`,
            );
          }
        }
        let changed = starting;
        const concurrency = node.kind !== 'workflow' ? node.concurrency : 1;
        let active = children.filter((c) => !terminal(c.status)).length;
        while (execution.retryChildRunIds?.length && active < concurrency) {
          this.resumeStep(this.run(execution.retryChildRunIds.shift()!));
          active++;
          changed = true;
        }
        while (
          execution.nextItem < value.length &&
          active < concurrency &&
          !execution.retryChildRunIds?.length
        ) {
          if (node.kind === 'workflow' && hasFailureRoute(node))
            assertContract(
              this.definition({
                workflowId: node.workflowId,
                version: this.pinnedVersion(node),
              }).inputSchema,
              execution.input,
              `${node.label}: workflow input`,
            );
          if (node.kind === 'workflow' && hasFailureRoute(node)) {
            // Dispatch configuration and persistence failures are terminal, not
            // child outcomes. Commit allocation and its caller link together.
            const dispatched = this.store.transaction(() => {
              const copy = structuredClone(run),
                step = copy.executions.at(-1)!;
              const child = this.newRun(
                node.workflowId,
                this.pinnedVersion(node),
                step.input,
                run.id,
              );
              step.childRunIds.push(child.id);
              step.nextItem++;
              step.status = 'waiting';
              copy.status = 'waiting';
              this.save(copy);
              return copy;
            });
            Object.assign(run, dispatched);
            execution = run.executions.at(-1)!;
          } else {
            const child = this.newRun(
              node.kind === 'batch' ? run.workflowId : node.workflowId,
              node.kind === 'batch' ? run.version : this.pinnedVersion(node),
              value[execution.nextItem],
              run.id,
              node.kind === 'batch' ? node.id : undefined,
            );
            if (node.kind === 'batch') {
              child.workflowName = `${node.label} · item ${execution.nextItem + 1}`;
              child.batchItemIndex = execution.nextItem;
              child.parentExecutionId = execution.id;
              this.save(child);
            }
            execution.childRunIds.push(child.id);
            execution.nextItem++;
          }
          active++;
          changed = true;
        }
        children = execution.childRunIds.map((id) => this.run(id));
        if (
          !execution.retryChildRunIds?.length &&
          execution.nextItem === value.length &&
          children.every((c) => terminal(c.status))
        ) {
          const output: Json =
            node.kind === 'workflow'
              ? children[0].output!
              : node.failurePolicy === 'collect'
                ? children.map((c) => ({
                    runId: c.id,
                    status: c.status,
                    output: c.output ?? null,
                    error: c.error ?? null,
                  }))
                : children.map((c) => c.output!);
          if (node.kind === 'workflow' && hasFailureRoute(node)) {
            try {
              assertContract(node.outputSchema, output, `${node.label} output`);
            } catch (error) {
              this.failWorkflow(
                run,
                node,
                children[0],
                message(error),
                'output',
              );
              return true;
            }
          }
          this.finish(
            run,
            execution,
            node,
            output,
            node.kind === 'batch' ? 'complete' : 'default',
          );
          return true;
        }
        if (
          changed ||
          execution.status !== 'waiting' ||
          run.status !== 'waiting'
        ) {
          execution.status = 'waiting';
          run.status = 'waiting';
          this.save(run);
        }
        return changed;
      }
      if (node.kind === 'switch') {
        const value = readBranchValue(run, execution, node.path);
        const port =
          node.cases.find((entry) => isDeepStrictEqual(value, entry.equals))
            ?.port ?? node.default;
        if (port === undefined)
          throw new InterlockError(
            `${node.label}: no case matched ${JSON.stringify(value)} ${node.path ? `at input field "${node.path}"` : 'for the whole input'}`,
          );
        this.finish(run, execution, node, execution.input, port);
        return true;
      }
      if (
        node.kind !== 'entry' &&
        node.kind !== 'exit' &&
        node.kind !== 'condition'
      )
        throw new InterlockError('Unsupported node type in published workflow');
      this.finish(
        run,
        execution,
        node,
        execution.input,
        node.kind === 'condition'
          ? isDeepStrictEqual(
              readBranchValue(run, execution, node.path),
              node.equals,
            )
            ? 'true'
            : 'false'
          : 'default',
      );
      return true;
    } catch (error) {
      this.fail(run, execution, message(error));
      return true;
    }
  }
  private chargeStep(run: Run, node: WorkflowNode, limit: number) {
    const owner = run.parallelBranch ? this.run(run.parentRunId!) : run;
    const branchSteps =
      (owner.parallelSteps ?? 0) + (run.parallelBranch ? 1 : 0);
    if (owner.executions.length + branchSteps > limit)
      throw new InterlockError(
        `Workflow step limit exceeded (${limit} steps); could not start ${node.label}`,
      );
    if (run.parallelBranch) {
      const group = owner.executions.at(-1);
      if (
        terminal(owner.status) ||
        group?.kind !== 'parallel' ||
        group.id !== run.parentExecutionId
      )
        throw new InterlockError(
          'Parallel branch no longer belongs to the active invocation',
        );
      owner.parallelSteps = branchSteps;
      // advance runs within the pump transaction, together with the branch execution.
      this.save(owner);
    }
  }
  private advanceParallel(
    run: Run,
    execution: NodeExecution,
    node: Extract<WorkflowNode, { kind: 'parallel' }>,
    starting: boolean,
  ) {
    const children = execution.childRunIds.map((id) => this.run(id));
    const join = decideJoin(node, children, execution.retryChildRunIds);
    // The ordinary failure path cancels unfinished waited descendants.
    if (join.kind === 'fail') throw new InterlockError(join.error);
    if (join.kind === 'complete') {
      try {
        this.finish(run, execution, node, join.output, 'complete');
      } catch (error) {
        join.cancel = { reason: `${node.label} failed: ${message(error)}` };
        throw error;
      } finally {
        for (const id of execution.childRunIds)
          this.cancelTree(id, undefined, join.cancel);
      }
      return true;
    }
    let changed = starting;
    let active = children.filter((child) => !terminal(child.status)).length;
    while (execution.retryChildRunIds?.length && active < node.concurrency) {
      this.resumeStep(this.run(execution.retryChildRunIds.shift()!));
      active++;
      changed = true;
    }
    while (
      execution.nextItem < node.branches.length &&
      active < node.concurrency &&
      !execution.retryChildRunIds?.length
    ) {
      const branch = node.branches[execution.nextItem];
      const next = { ...execution, childRunIds: [...execution.childRunIds] };
      this.store.transaction(() => {
        const child = this.newRun(
          run.workflowId,
          run.version,
          structuredClone(execution.input),
          run.id,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { nodeId: node.id, id: branch.id, key: branch.key },
          execution.id,
        );
        next.childRunIds.push(child.id);
        next.nextItem++;
        next.status = 'waiting';
        this.save({
          ...run,
          status: 'waiting',
          executions: [...run.executions.slice(0, -1), next],
        });
      });
      Object.assign(execution, next);
      active++;
      changed = true;
    }
    if (changed || execution.status !== 'waiting' || run.status !== 'waiting') {
      execution.status = 'waiting';
      run.status = 'waiting';
      this.save(run);
    }
    return changed;
  }
  stop() {
    if (this.stopped) return;
    void this.executors.stop();
    this.trials.stop();
    this.workspaces.stop();
    this.simulations.stop();
    this.continuation.stop();
    this.stopped = true;
    this.store.transaction(() => {
      for (const run of this.store.activeRuns()) {
        const execution = run.executions.at(-1);
        if (execution?.resourceActive && !execution.background) {
          this.resources.endExecution(run.id, execution, true);
          this.save(run);
        }
      }
    });
    for (const controller of this.localJobs.values()) controller.abort();
  }
  private admitOperation(run: Run, execution: NodeExecution, acquire = true) {
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
  pump() {
    if (this.stopped) return;
    this.store.transaction(() => {
      this.refreshTerminalScripts();
      this.triggers.tick();
      this.pauses.refresh();
      this.budgets.refresh();
      this.resources.refresh();
      for (const state of this.store.workState('claimed')) {
        const deadline = this.stalls.deadlineExpired(state);
        if (!deadline && !(Date.parse(state.leaseUntil!) <= this.nowMs()))
          continue;
        const work = this.store.get<WorkRequest>('work', state.id);
        if (work?.status !== 'claimed' || work.attempt !== state.attempt)
          continue;
        if (deadline) {
          this.event(
            this.run(work.runId),
            'work.execution_timed_out',
            `${work.label}: maximum active execution duration reached`,
          );
          this.releaseFailure(
            work,
            'Maximum active execution duration reached',
            'deadline',
          );
        } else {
          work.expiredClaims = [
            ...(work.expiredClaims ?? []),
            {
              tokenHash: claimTokenHash(work.token!),
              expiredAt: work.leaseUntil!,
              attempt: work.attempt,
            },
          ];
          this.releaseFailure(work, 'Worker lease expired', 'expiry');
        }
      }
      this.toolCalls.tick();
      const continuedChains = new Set<string>();
      let changed = true,
        rounds = 0;
      while (changed && rounds++ < 2000) {
        this.pauses.refresh();
        this.budgets.refresh();
        this.resources.refresh();
        changed = this.testbench.advance();
        if (
          new RunAdmission(this.store).promote((run) =>
            this.event(run, 'run.admitted', 'Start admitted'),
          )
        )
          changed = true;
        const due = this.store.dueAgentExecutions(
          new Date(this.nowMs()).toISOString(),
        );
        // Earlier advances can cancel or resume descendants in this same pass.
        for (const { run, execution } of this.store.activeRunState()) {
          if (run.status === 'queued') continue;
          if (
            execution?.status === 'waiting' &&
            execution.nodeId === run.cursor &&
            !execution.resourceBlocked &&
            (execution.kind === 'input' ||
              (execution.kind === 'agent' && !due.has(execution.id)) ||
              (execution.kind === 'wait' &&
                execution.resumeAt &&
                Date.parse(execution.resumeAt) > this.nowMs() &&
                (!execution.timeoutAt ||
                  Date.parse(execution.timeoutAt) > this.nowMs())))
          )
            continue;
          const candidate = this.run(run.id);
          if (candidate.chain && continuedChains.has(candidate.chain.rootRunId))
            continue;
          const before = this.chains.read(candidate)?.latestRunId;
          if (this.advance(candidate)) changed = true;
          if (
            candidate.chain &&
            this.chains.read(candidate)?.latestRunId !== before
          )
            continuedChains.add(candidate.chain.rootRunId);
        }
      }
      this.resources.refresh();
    });
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
    this.store.transaction(() => {
      this.stalls.tick();
      const attentionList = this.runAttention();
      const attention = new Set(attentionList.map((item) => item.runId));
      for (const item of attentionList) {
        if (!this.store.get('eventAttentionStates', item.runId)) {
          this.store.put('eventAttentionStates', {
            id: item.runId,
            runId: item.runId,
          });
          const run = this.run(item.runId);
          this.event(run, 'needs_attention', 'Run needs attention');
        }
      }
      for (const state of this.store.list<{ id: string }>(
        'eventAttentionStates',
      ))
        if (!attention.has(state.id))
          this.store.remove('eventAttentionStates', state.id);
      this.triggers.events.tick();
    });
    this.retention.tick();
    this.trials.pump(new Set(this.localJobs.keys()));
    this.workspaces.pump(new Set(this.localJobs.keys()));
  }
  quiescence(runId: string) {
    return sourceQuiescence(this.store, runId, new Set(this.localJobs.keys()));
  }
  private refreshTerminalScripts() {
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
  private finishPollTimeout(
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
  available(runId?: string, options: { advance?: boolean } = {}) {
    if (options.advance !== false) this.pump();
    const within = (id: string): boolean => {
      if (!runId || id === runId) return true;
      const parent = this.run(id).parentRunId;
      return parent ? within(parent) : false;
    };
    return this.store
      .work('available')
      .filter(
        (w) =>
          !w.pauseBlocked &&
          !w.budgetBlocked &&
          !w.resourceBlocked &&
          !w.cwdBlocked &&
          within(w.runId),
      )
      .map((work) => this.inspection.describeWork(work));
  }
  workSummaries(runId?: string) {
    return this.inspection.workSummaries(runId);
  }
  manageWorkHold(input: WorkHoldRequest) {
    const q = workHoldRequestSchema.parse(input);
    if (q.action === 'history')
      return this.holds.history(q.workId, q.offset, q.limit);
    if (q.action === 'resume') this.executors.assertResume(q.workId);
    this.pump();
    try {
      return this.store.transaction(() => {
        const before = this.store.get<WorkRequest>('work', q.workId);
        const result = this.holds.change(q);
        if (
          result.applied &&
          q.action === 'hold' &&
          before?.status === 'claimed'
        )
          this.resources.end(before, 'held');
        this.pauses.refresh();
        this.budgets.refresh();
        this.resources.refresh();
        return result;
      });
    } catch (error) {
      if (error instanceof HoldDeadlineError) {
        this.pump();
        throw new InterlockError(error.message);
      }
      throw error;
    }
  }
  manageWorkResources(input: WorkResourceRequest) {
    const q = workResourceRequestSchema.parse(input);
    if (q.action === 'inspect')
      return 'workId' in q
        ? {
            workId: q.workId,
            reservations: this.resources.forWork(q.workId),
            uncertainClaims: this.store
              .forWork<UncertainClaim>(uncertainClaimCollection, q.workId)
              .map(({ id: _id, ...claim }) => claim),
          }
        : {
            runId: q.runId,
            executionId: q.executionId,
            reservations: this.resources.forExecution(q.runId, q.executionId),
            uncertainOperations: this.store
              .forRuns<UncertainOperation>(
                uncertainOperationCollection,
                new Set([q.runId]),
              )
              .filter((operation) => operation.executionId === q.executionId)
              .map(({ id: _id, ...operation }) => operation),
          };
    this.pump();
    const result = this.store.transaction(() =>
      'workId' in q
        ? this.resources.release(q.workId, q.expectedAttempt, q.actor)
        : this.resources.releaseExecution(
            q.runId,
            q.executionId,
            q.expectedAttempt,
            q.actor,
          ),
    );
    this.pump();
    return result;
  }
  handoffContext(input: ContextHandoffInput) {
    this.pump();
    return this.contextGroups.handoff(input);
  }
  claim(workId: string, worker: Worker, leaseSeconds?: number) {
    const modelSelection =
      worker.modelSelection === undefined
        ? undefined
        : modelSelectionSchema.parse(worker.modelSelection);
    this.pump();
    const claimed = this.store.transaction(() => {
      const work = this.store.get<WorkRequest>('work', workId);
      if (!work || work.status !== 'available')
        throw new InterlockError('Work is not available');
      if (work.cwdBlocked) {
        throw new InterlockError(work.cwdBlocked.reason);
      }
      this.pauses.assert(this.run(work.runId));
      this.executors.assertClaim(work, worker);
      this.trials.context(this.run(work.runId));
      if (work.context.mode === 'fresh' && !worker.freshContext)
        throw new InterlockError('This assignment requires fresh context');
      const missingTools = work.context.tools.filter(
        (t) => !worker.tools.includes(t),
      );
      const missingSkills = work.context.skills.filter(
        (s) => !worker.skills.includes(s),
      );
      if (missingTools.length || missingSkills.length)
        throw new InterlockError(
          `Missing capabilities: ${[...missingTools, ...missingSkills].join(', ')}`,
        );
      this.budgets.assertClaim(work.runId);
      work.status = 'claimed';
      work.availableUntil = undefined;
      work.attempt++;
      work.claimedAt = now();
      work.lastActivityAt = work.claimedAt;
      work.idleNudge = undefined;
      work.workerId = worker.workerId;
      work.modelSelection = modelSelection;
      this.contextGroups.claimed(work, worker.session);
      work.token = randomUUID();
      work.claimLeaseSeconds = leaseSeconds ?? work.leaseSeconds ?? 300;
      work.leaseUntil = new Date(
        this.nowMs() + work.claimLeaseSeconds * 1000,
      ).toISOString();
      this.resources.acquire(work);
      this.executors.claimed(work);
      if (work.resolvedCwd) {
        const run = this.run(work.runId);
        const execution = run.executions.find((e) => e.id === work.executionId);
        if (execution) {
          execution.resolvedCwd = work.resolvedCwd;
          this.store.put('runs', run);
        }
      }
      this.store.put('work', work);
      this.event(
        this.run(work.runId),
        'work.claimed',
        `${work.label} claimed by ${worker.workerId}`,
      );
      this.usage.claimed(work);
      this.budgets.refresh();
      this.resources.refresh();
      return this.inspection.describeWork(work);
    });
    this.executors.claimCommitted(workId);
    return claimed;
  }
  private owned(id: string, token: string) {
    const work = this.store.get<WorkRequest>('work', id);
    if (!work || work.token !== token)
      throw new InterlockError(
        (work &&
          expiredClaimMessage(work, token, this.run(work.runId).status)) ||
          'Claim token does not match',
      );
    if (work.status === 'completed') return work;
    if (work.status !== 'claimed')
      throw new InterlockError('Claim no longer active');
    if (this.stalls.deadlineExpired(work))
      throw new ExpiredClaimError('Maximum active execution duration reached');
    if (Date.parse(work.leaseUntil!) <= this.nowMs())
      throw new ExpiredClaimError('Claim expired');
    return work;
  }
  private withClaim<T>(
    id: string,
    token: string,
    action: (work: WorkRequest) => T,
  ): T {
    this.pump();
    try {
      return this.store.transaction(() => action(this.owned(id, token)));
    } catch (error) {
      // The deadline can cross between the initial pump and the ownership check.
      // Process that expiry after rollback so its receipt and budget survive rejection.
      if (error instanceof ExpiredClaimError) {
        this.pump();
        const work = this.store.get<WorkRequest>('work', id)!;
        throw new InterlockError(
          expiredClaimMessage(work, token, this.run(work.runId).status) ??
            error.message,
        );
      }
      throw error;
    }
  }
  /** Run one Agent tool call under the caller's active claim and wait for its result. */
  async callTool(input: ToolCallInput, signal?: AbortSignal) {
    const q = toolCallRequestSchema.parse(input);
    const runId = this.withClaim(q.workId, q.token, (work) =>
      this.toolCalls.begin(work, q),
    );
    this.pump();
    const work = this.store.get<WorkRequest>('work', q.workId)!;
    return this.toolCalls.wait(runId, work, q.waitMs, signal);
  }
  renew(id: string, token: string, leaseSeconds?: number) {
    return this.withClaim(id, token, (work) => {
      if (work.status !== 'claimed')
        throw new InterlockError('Work already completed');
      work.lastActivityAt = now();
      work.idleNudge = undefined;
      work.leaseUntil = new Date(
        this.nowMs() + (leaseSeconds ?? work.claimLeaseSeconds ?? 300) * 1000,
      ).toISOString();
      this.store.put('work', work);
      return this.inspection.describeWork(work);
    });
  }
  /** Read-only: do not pump, renew, or process expired claims. */
  preflightResult(id: string, token: string, output: Json): ResultCheck {
    const work = this.store.get<WorkRequest>('work', id);
    const report = (
      code: ResultCheck['code'],
      claimUsable = false,
    ): ResultCheck => ({
      code,
      accepted: false,
      alreadyAccepted: code === 'already_accepted',
      claimUsable,
      canSubmit: code === 'ready' || code === 'already_accepted',
      nextAction:
        code === 'ready'
          ? 'submit'
          : code === 'invalid_result'
            ? 'correct_result'
            : code === 'already_accepted' || code === 'completed_conflict'
              ? 'read_result'
              : 'inspect_work',
      diagnostics: { items: [], total: 0, truncated: false },
    });
    if (!work) return report('not_found');
    if (work.status === 'cancelled') return report('cancelled');
    if (work.status === 'held') return report('held');
    if (work.token !== token) {
      const expired = work.expiredClaims?.some(
        (receipt) => receipt.tokenHash === claimTokenHash(token),
      );
      return report(
        expired
          ? work.status === 'claimed'
            ? 'replaced'
            : 'expired'
          : 'invalid_claim',
      );
    }
    if (work.status === 'completed')
      return report(
        isDeepStrictEqual(work.output, output)
          ? 'already_accepted'
          : 'completed_conflict',
      );
    if (work.status !== 'claimed') return report('inactive');
    if (
      Date.parse(work.leaseUntil!) <= this.nowMs() ||
      this.stalls.deadlineExpired(work)
    )
      return report('expired');
    const diagnostics = checkAgentResult(
      work.outputSchema,
      work.resultRules,
      work.input,
      output,
    );
    let inspectMapping = false;
    if (!diagnostics.total) {
      const run = this.run(work.runId);
      const node = this.definition(run).nodes.find(
        (n) => n.id === work.nodeId,
      )!;
      try {
        if (node.routing || node.outputBindings)
          this.prepareResult(run, node, output);
      } catch (error) {
        inspectMapping =
          error instanceof ResultProcessingError &&
          error.setting === 'outputBindings';
        diagnostics.items.push({
          path: '',
          schemaPath:
            error instanceof ResultProcessingError ? `#/${error.setting}` : '#',
          rule: 'result_mapping',
          message: message(error).slice(0, 512),
          pathTruncated: false,
        });
        diagnostics.total = 1;
      }
    }
    return {
      ...report(diagnostics.total ? 'invalid_result' : 'ready', true),
      ...(inspectMapping ? { nextAction: 'inspect_work' as const } : {}),
      diagnostics,
    };
  }
  submit(id: string, token: string, output: Json) {
    return this.inspect(this.submitWork(id, token, output));
  }
  submitSummary(id: string, token: string, output: Json, limit = 20) {
    const bounded = continuationLimitSchema.parse(limit);
    const workRunId = this.submitWork(id, token, output);
    return {
      ...this.continuation.summary(
        this.inspection.lifecycleRunId(workRunId),
        bounded,
      ),
      workId: id,
      workRunId,
    };
  }
  private resultRejection(id: string, token: string, check: ResultCheck) {
    const work = this.store.get<WorkRequest>('work', id);
    return new ResultRejection(
      check,
      (work && expiredClaimMessage(work, token, this.run(work.runId).status)) ||
        '',
    );
  }
  private submitWork(id: string, token: string, output: Json) {
    this.pump();
    let runId: string;
    try {
      runId = this.store.transaction(() => {
        const check = this.preflightResult(id, token, output);
        if (!check.canSubmit) throw this.resultRejection(id, token, check);
        const work = this.store.get<WorkRequest>('work', id)!;
        if (work.status === 'completed') return work.runId;
        const run = this.run(work.runId),
          execution = run.executions.find((e) => e.id === work.executionId)!;
        const node = this.definition(run).nodes.find(
          (n) => n.id === work.nodeId,
        )!;
        this.finish(run, execution, node, output);
        this.usage.ended(work, 'completed');
        this.resources.end(work, 'completed');
        work.status = 'completed';
        work.output = output;
        this.store.put('work', work);
        return run.id;
      });
    } catch (error) {
      if (
        error instanceof ResultRejection &&
        error.resultCheck.code === 'expired'
      ) {
        // The lease can cross its deadline after the initial pump. Recover outside rollback.
        this.pump();
        throw this.resultRejection(
          id,
          token,
          this.preflightResult(id, token, output),
        );
      }
      throw error;
    }
    this.pump();
    return runId;
  }
  private releaseFailure(
    work: WorkRequest,
    error: string,
    reason: 'failure' | 'expiry' | 'deadline' = 'failure',
  ) {
    this.resources.end(work, reason === 'deadline' ? 'expiry' : reason);
    this.usage.ended(work, reason === 'expiry' ? 'expired' : 'failed');
    if (reason === 'expiry' && work.trialEnvironment) {
      work.status = 'failed';
      work.error =
        'Local trial lease expired; stop the worker and reconcile cleanup before starting a new comparison';
      work.token = undefined;
      work.leaseUntil = undefined;
      this.store.put('work', work);
      this.event(this.run(work.runId), 'work.lease_expired', work.error);
      for (const id of this.trials.interrupt(this.run(work.runId)))
        this.cancelTree(id);
      return;
    }
    if (work.maxLeaseExpiries !== undefined) {
      if (reason === 'expiry')
        work.leaseExpiryCount = (work.leaseExpiryCount ?? 0) + 1;
      else work.failureCount = (work.failureCount ?? 0) + 1;
    }
    const exhausted =
      work.maxLeaseExpiries === undefined
        ? work.attempt - (work.heldClaimCount ?? 0) >= work.maxAttempts
        : (work.failureCount ?? 0) >= work.maxAttempts ||
          (work.leaseExpiryCount ?? 0) >= work.maxLeaseExpiries;
    if (reason === 'expiry') {
      this.event(
        this.run(work.runId),
        'work.lease_expired',
        `${work.label} (${work.id}): claim expired at ${work.leaseUntil} on ${leaseCounts(work)}. ` +
          (exhausted
            ? 'No attempts remain under the configured budget; inspect the run before explicitly retrying the failed step. '
            : 'Another attempt is available; inspect the run and reclaim available work. ') +
          'Renew before expiry or choose a longer claim lease.',
      );
      if (exhausted && work.maxLeaseExpiries !== undefined)
        error = 'Lease expiry budget exhausted';
    }
    work.error = error;
    work.token = undefined;
    work.leaseUntil = undefined;
    const run = this.run(work.runId);
    if (reason === 'deadline' && work.trialEnvironment) {
      const interrupted = this.trials.interrupt(run);
      work.status = 'failed';
      this.store.put('work', work);
      this.fail(
        run,
        run.executions.find((e) => e.id === work.executionId)!,
        error,
      );
      for (const id of interrupted) if (id !== run.id) this.cancelTree(id);
      this.executors.deadlineRevoked(work);
      return;
    }

    if (exhausted) {
      work.status = 'failed';
      this.fail(
        run,
        run.executions.find((e) => e.id === work.executionId)!,
        error,
      );
    } else {
      work.status = 'available';
      work.availableSince = now();
      work.lastActivityAt = undefined;
      const node = this.definition(run).nodes.find((n) => n.id === work.nodeId);
      work.availableUntil =
        node?.kind === 'agent' && node.unclaimedTimeoutMs !== undefined
          ? new Date(this.nowMs() + node.unclaimedTimeoutMs).toISOString()
          : undefined;
      this.event(run, 'work.retry', `${work.label}: ${error}`);
    }
    this.store.put('work', work);
    if (reason === 'deadline') this.executors.deadlineRevoked(work);
  }
  reportFailure(id: string, token: string, error: string) {
    const runId = this.withClaim(id, token, (work) => {
      if (work.status === 'completed')
        throw new InterlockError('Work already completed');
      this.releaseFailure(work, error);
      return work.runId;
    });
    this.pump();
    return this.inspect(runId);
  }
  manageScript(request: ScriptOperation): {
    runId: string;
    executionId: string;
    status: NodeExecution['status'];
    background: NonNullable<NodeExecution['background']>;
  } {
    return this.scriptControl.manageScript(request);
  }
  /** Records why on each run and unfinished step; joins cancel in their transaction. */
  private cancelTree(id: string, afterCommit?: Cb, why?: Why) {
    const run = this.run(id);
    if (terminal(run.status)) return;
    for (const child of this.store.runScopes.attachedChildIds(id))
      this.cancelTree(child, afterCommit, why);
    this.cancelOne(run, afterCommit, why?.reason, why);
  }
  private cancelOne(run: Run, afterCommit?: Cb, reason?: string, why?: Why) {
    const id = run.id;
    run.status = 'cancelled';
    if (reason) run.cancellationReason = reason;
    if (why?.join) run.cancellationKind = 'join';
    const execution = run.executions.at(-1);
    if (execution?.resourceActive)
      this.resources.endExecution(run.id, execution, true);
    if (execution && this.localJobs.has(execution.id))
      this.resources.uncertainExecution(
        run.id,
        execution,
        'Cancelled request may still be running remotely',
      );
    const stop = () => {
      if (
        execution?.background &&
        ['launching', 'running'].includes(execution.background.state)
      ) {
        try {
          this.backgroundScripts.stop(run.id, execution.id);
        } catch {
          execution.background.state = 'uncertain';
          execution.error =
            'Background stop could not verify the supervisor. Inspect processes and reconcile stopped.';
          if (afterCommit) this.save(run);
        }
      }
      if (execution) this.localJobs.get(execution.id)?.abort();
    };
    // Atomic task replacement must commit cancellation and its receipt before
    // requesting external stops. A rolled-back start leaves the old job alone.
    if (afterCommit) afterCommit.push(stop);
    else stop();
    if (execution && !terminal(execution.status)) {
      execution.status = 'cancelled';
      if (why) execution.error = why.reason;
    }
    for (const work of this.store
      .work(undefined, id)
      .filter((w) => ['available', 'claimed', 'held'].includes(w.status))) {
      this.resources.end(work, 'cancelled');
      this.usage.ended(work, 'cancelled');
      this.holds.close(work, now(), reason ?? 'run cancellation', 'cancelled');
      work.status = 'cancelled';
      work.endedAt = now();
      work.token = undefined;
      this.store.put('work', work);
    }
    this.save(run);
    this.event(
      run,
      'run.cancelled',
      reason ? `Run cancelled: ${reason}` : 'Run cancelled',
    );
  }
  previewRunCancellation(input: RunCancellationPreview) {
    return this.inspection.previewRunCancellation(input);
  }
  cancelRunTree(input: CancelRunTree) {
    const query = cancelRunTreeSchema.parse(input);
    const afterCommit: (() => void)[] = [];
    const result = this.store.transaction(() => {
      const selected = this.inspection.cancellationSelection(
        query.id,
        query.includeDetached,
      );
      const active = selected.filter((run) => !terminal(run.status));
      for (const member of selected) {
        const run = this.run(member.id);
        if (run.chain) this.chains.cancel(run);
        if (!terminal(run.status))
          this.cancelOne(run, afterCommit, query.reason);
      }
      return {
        rootRunId: query.id,
        includeDetached: query.includeDetached,
        reason: query.reason,
        cancelled: {
          items: active.slice(0, query.limit).map((run) =>
            this.inspection.cancellationReference({
              ...run,
              status: 'cancelled',
            }),
          ),
          total: active.length,
          truncated: active.length > query.limit,
        },
      };
    });
    // Never stop external work until all cancellation state and lifecycle receipts commit.
    for (const effect of afterCommit) effect();
    this.pump();
    return result;
  }
  cancel(id: string, scope: 'run' | 'chain' = 'run') {
    this.store.transaction(() =>
      this.cancelTree(
        scope === 'chain' ? this.chains.cancel(this.run(id)) : id,
      ),
    );
    this.pump();
    return this.inspect(id);
  }
  private assertResumeSafe(run: Run, checked = new Set<string>()) {
    if (checked.has(run.id)) return;
    checked.add(run.id);
    if (run.parallelBranch) {
      const attached = new Set(
        this.store
          .continuation(run.id)
          .runs.filter((child) => child.lifecycleRunId === run.id)
          .map((child) => child.id),
      );
      const claim = this.store.forRuns<UncertainClaim>(
        uncertainClaimCollection,
        attached,
      )[0];
      if (claim)
        throw new InterlockError(
          `Confirm stopped for revoked work ${claim.workId}, attempt ${claim.attempt}, before retrying the Parallel group`,
        );
      const operation = this.store.forRuns<UncertainOperation>(
        uncertainOperationCollection,
        attached,
      )[0];
      if (operation)
        throw new InterlockError(
          `Confirm stopped for run ${operation.runId}, execution ${operation.executionId}, before retrying the Parallel group`,
        );
    }
    const uncertain = run.executions.find(
      (step) => step.background?.state === 'uncertain',
    );
    if (uncertain)
      throw new InterlockError(
        `Reconcile the uncertain background Script in run ${run.id}, execution ${uncertain.id}, with stopped:true after inspecting processes and effects before retrying`,
      );
    const execution = run.executions.at(-1);
    if (
      execution?.kind !== 'workflow' &&
      execution?.kind !== 'batch' &&
      execution?.kind !== 'parallel'
    )
      return;
    for (const id of execution.childRunIds) {
      const child = this.run(id);
      if (
        child.parentMode !== 'detached' &&
        (child.status === 'failed' || child.status === 'cancelled')
      )
        this.assertResumeSafe(child, checked);
    }
  }
  private resumeStep(run: Run) {
    // Retry admission also applies when a Workflow or Batch resumes a retained child.
    this.assertResumeSafe(run);
    const execution = run.executions.at(-1);
    run.status = 'running';
    run.error = undefined;
    if (!execution) {
      this.save(run);
      return;
    }
    // Cancellation can land between steps. Keep the completed execution and
    // its forwarded value so the next step starts at the persisted cursor.
    if (execution.nodeId === run.cursor && execution.status !== 'completed') {
      run.value = Object.hasOwn(execution, 'originalInput')
        ? execution.originalInput!
        : execution.input;
      if (execution.kind === 'script' || execution.kind === 'wait')
        run.nextScriptAttempt = (execution.attempt ?? 1) + 1;
      // Only dispatched child runs have progress to retain. Initialization
      // failures must resolve bindings and validate input again on retry.
      if (
        (execution.kind === 'batch' ||
          execution.kind === 'workflow' ||
          execution.kind === 'parallel') &&
        execution.childRunIds.length > 0
      ) {
        execution.status = 'waiting';
        execution.error = undefined;
        execution.completedAt = undefined;
        execution.retryChildRunIds = execution.childRunIds.filter((id) => {
          const child = this.run(id);
          return child.status === 'failed' || child.status === 'cancelled';
        });
      }
    }
    this.save(run);
    this.event(run, 'run.retried', 'Explicit retry requested');
  }
  retry(id: string) {
    this.store.transaction(() => {
      const run = this.run(id);
      if (run.status !== 'failed')
        throw new InterlockError('Only failed runs can be retried');
      if (run.parallelBranch)
        throw new InterlockError(
          'Retry the failed Parallel group from its parent run',
        );
      this.assertResumeSafe(run);
      this.chains.assertRetry(run);
      if (this.inspection.handledWorkflowFailure(run))
        throw new InterlockError(
          'This child failure was handled by its Workflow Failed route; inspect the parent recovery instead of retrying the child',
        );
      this.versions.assertRunnable(run);
      if (run.parentRunId && run.parentMode !== 'detached')
        this.versions.assertRunnable(this.run(run.parentRunId));
      if (
        run.parentRunId &&
        run.parentMode !== 'detached' &&
        terminal(this.run(run.parentRunId).status)
      )
        throw new InterlockError('Retry the failed parent run instead');
      this.testbench.assertRetryCapacity(run);
      if (run.parentRunId && run.parentMode !== 'detached') {
        const parent = this.run(run.parentRunId);
        const execution = parent.executions.at(-1);
        if (execution?.kind === 'batch' && execution.childRunIds.includes(id)) {
          execution.retryChildRunIds ??= [];
          if (!execution.retryChildRunIds.includes(id))
            execution.retryChildRunIds.push(id);
          this.save(parent);
          this.event(
            run,
            'run.retry-queued',
            'Explicit retry queued within parent concurrency limit',
          );
          return;
        }
      }
      this.resumeStep(run);
    });
    this.pump();
    return this.inspect(id);
  }
}

export { runDoctor } from './doctor.js';
export { generateWorkflowReport } from './report.js';
