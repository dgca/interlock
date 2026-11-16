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
import { readBranchValue } from './nodeData.js';
export * from './nodeData.js';
import {
  assertContract,
  assertOwnPropertyContract,
  resolveBindingFields,
  type ToolCallInput,
  workTools,
  workHoldRequestSchema,
  HoldDeadlineError,
  type WorkHoldRequest,
  ResultRejection,
  type ResultCheck,
  DEFAULT_BATCH_MAX_ITEMS,
  isStartedRunSchema,
  isPollWait,
  hasFailureRoute,
  decideJoin,
  blankDefinition,
  InterlockError,
  readPath,
  resolveFetch,
  type Json,
  type NodeExecution,
  type Run,
  type Workflow,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkRequest,
  composePrompt,
  continuationLimitSchema,
  type RunStartOptions,
  type BudgetPolicy,
  type ContextHandoffInput,
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
  type RunCancellationPreview,
  type CancelRunTree,
} from '@interlock/core';
import { TrialEnvironments } from './trialEnvironments.js';
import { ManagedWorkspaces } from './workspaces.js';
import { Continuation } from './continuation.js';
import { Prompts } from './prompts.js';
import { WorkflowMemory } from './memory.js';
import { Variables } from './variables.js';
import { ModelAliases } from './modelAliases.js';
export { ModelAliases } from './modelAliases.js';
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
import { claimTokenHash, expiredClaimMessage } from './leases.js';

import { now, terminal, message } from './engineHelpers.js';
export type { Worker } from './engineTypes.js';
import { type Worker } from './engineTypes.js';
import { ToolCalls } from './toolCalls.js';
import { StepCompletion } from './stepCompletion.js';
import { RunCreation } from './runCreation.js';
import { RunCancellation } from './runCancellation.js';
import { RunRetry } from './runRetry.js';
import { WorkClaims } from './workClaims.js';
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
  readonly memory: WorkflowMemory;
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
  private readonly completion: StepCompletion;
  private readonly creation: RunCreation;
  private readonly cancellation: RunCancellation;
  private readonly retries: RunRetry;
  private readonly claims: WorkClaims;
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
      engine: this,
      definition: (run) => this.definition(run),
      save: (run) => this.save(run),
      event: (run, type, text) => this.event(run, type, text),
      fail: (run, execution, error) => this.fail(run, execution, error),
      withClaim: (id, token, action) => this.withClaim(id, token, action),
      cancel: (run, reason) => this.cancelOne(run, undefined, reason),
      paused: (run) => this.pauses.applicable(run.workflowId).length > 0,
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
    this.boards = new WorkflowBoards(store, this.requests, this, () =>
      this.notify(),
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
    this.memory = new WorkflowMemory(store, this);
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
    this.creation = new RunCreation(
      store,
      options,
      (id) => this.workflow(id),
      (id) => this.run(id),
      (run) => this.save(run),
      (run, type, text) => this.event(run, type, text),
      (run) => this.definition(run),
      (id, afterCommit) => this.cancelTree(id, afterCommit),
      () => this.pump(),
      this.starts,
      this.versions,
      this.budgets,
      this.chains,
      this.testbench,
      this.prompts,
      this.variables,
      this.memory,
      this.modelAliases,
      this.usage,
    );
    this.cancellation = new RunCancellation(
      store,
      (id) => this.run(id),
      (run) => this.save(run),
      (run, type, text) => this.event(run, type, text),
      () => this.pump(),
      (id) => this.inspect(id),
      this.localJobs,
      this.backgroundScripts,
      this.resources,
      this.usage,
      this.holds,
      this.chains,
      this.inspection,
    );
    this.retries = new RunRetry(
      store,
      (id) => this.run(id),
      (run) => this.save(run),
      (run, type, text) => this.event(run, type, text),
      () => this.pump(),
      (id) => this.inspect(id),
      this.chains,
      this.inspection,
      this.versions,
      this.testbench,
    );
    this.claims = new WorkClaims(
      store,
      () => this.nowMs(),
      (id) => this.run(id),
      (run, type, text) => this.event(run, type, text),
      (run) => this.definition(run),
      () => this.pump(),
      (id) => this.inspect(id),
      (...args) => this.prepareResult(...args),
      (run, execution, error) => this.fail(run, execution, error),
      (id) => this.cancelTree(id),
      this.pauses,
      this.executors,
      this.trials,
      this.budgets,
      this.contextGroups,
      this.resources,
      this.usage,
      this.stalls,
      this.inspection,
    );
    this.completion = new StepCompletion(
      store,
      (id) => this.run(id),
      (run) => this.save(run),
      (run, type, text) => this.event(run, type, text),
      (run) => this.definition(run),
      (id) => this.cancelTree(id),
      (...args) => this.newRun(...args),
      this.chains,
      this.executors,
      this.resources,
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
  event(run: Run, type: string, text: string, boardColumnId?: string) {
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
  private newRun(...args: Parameters<RunCreation['newRun']>) {
    return this.creation.newRun(...args);
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
  private startRun(...args: Parameters<RunCreation['startRun']>) {
    return this.creation.startRun(...args);
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
  private fail(...args: Parameters<StepCompletion['fail']>) {
    return this.completion.fail(...args);
  }
  private failOperation(...args: Parameters<StepCompletion['failOperation']>) {
    return this.completion.failOperation(...args);
  }
  private failWorkflow(...args: Parameters<StepCompletion['failWorkflow']>) {
    return this.completion.failWorkflow(...args);
  }
  private bindingSource(...args: Parameters<StepCompletion['bindingSource']>) {
    return this.completion.bindingSource(...args);
  }
  private prepareResult(...args: Parameters<StepCompletion['prepareResult']>) {
    return this.completion.prepareResult(...args);
  }
  private finish(...args: Parameters<StepCompletion['finish']>) {
    return this.completion.finish(...args);
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
          prompt: composePrompt(
            node.prompt,
            savedPrompts,
            this.memory.section(run, node.id, executorSettings),
          ),
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
          ...workTools(definition, node.id),
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
          delete child.callerExecutor; // Detached starts keep their own agent.
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
    return this.claims.claim(workId, worker, leaseSeconds);
  }
  private withClaim<T>(
    id: string,
    token: string,
    action: (work: WorkRequest) => T,
  ): T {
    return this.claims.withClaim(id, token, action);
  }
  /** Run one Agent tool call under the caller's active claim and wait for its result. */
  callTool(input: ToolCallInput, signal?: AbortSignal) {
    return this.toolCalls.call(input, signal);
  }
  renew(id: string, token: string, leaseSeconds?: number) {
    return this.claims.renew(id, token, leaseSeconds);
  }
  preflightResult(id: string, token: string, output: Json): ResultCheck {
    return this.claims.preflightResult(id, token, output);
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
        this.toolCalls.settle(work, 'calling Agent submitted its result');
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
  private releaseFailure(...args: Parameters<WorkClaims['releaseFailure']>) {
    return this.claims.releaseFailure(...args);
  }
  reportFailure(id: string, token: string, error: string) {
    return this.claims.reportFailure(id, token, error);
  }
  manageScript(request: ScriptOperation): {
    runId: string;
    executionId: string;
    status: NodeExecution['status'];
    background: NonNullable<NodeExecution['background']>;
  } {
    return this.scriptControl.manageScript(request);
  }
  private cancelTree(...args: Parameters<RunCancellation['cancelTree']>) {
    return this.cancellation.cancelTree(...args);
  }
  private cancelOne(...args: Parameters<RunCancellation['cancelOne']>) {
    return this.cancellation.cancelOne(...args);
  }
  previewRunCancellation(input: RunCancellationPreview) {
    return this.inspection.previewRunCancellation(input);
  }
  cancelRunTree(input: CancelRunTree) {
    return this.cancellation.cancelRunTree(input);
  }
  cancel(id: string, scope: 'run' | 'chain' = 'run') {
    return this.cancellation.cancel(id, scope);
  }
  private resumeStep(...args: Parameters<RunRetry['resumeStep']>) {
    return this.retries.resumeStep(...args);
  }
  retry(id: string) {
    return this.retries.retry(id);
  }
}

export { runDoctor } from './doctor.js';
export { generateWorkflowReport } from './report.js';
