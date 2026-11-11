import { EventTriggers } from './eventTriggers.js';
import { RunVersions } from './runVersions.js';
import {
  modelReferences,
  eligiblePresetChoices,
  inheritsWorkflowHarnessSettings,
  presetPermissions,
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
import { scriptOperationSchema, type ScriptOperation } from '@interlock/core';
import { runAttention } from './runAttention.js';
import { projectRun } from './runProjection.js';
import { WorkResources } from './workResources.js';
import { ExecutorManager } from './executors/manager.js';
import { resolveAndValidateCwd } from './workingDirectory.js';
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
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Store } from '@interlock/storage';
import { tidyWorkflow } from '@interlock/core/layout';
import {
  applyWorkflowPositions,
  sameWorkflowContent,
  workflowPositions,
  type WorkflowPositions,
} from '@interlock/core';
import {
  persistWorkflowPositions,
  readWorkflowLayout,
  saveWorkflowLayout,
} from './workflowLayouts.js';
import {
  calculateVisitCount,
  buildExecutionProvenance,
  buildRunExecutionProvenanceFile,
} from './nodeData.js';
export * from './nodeData.js';
import {
  assertContract,
  assertOwnPropertyContract,
  resolveBindingFields,
  matchRouting,
  type PathBinding,
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
  type FailureCategory,
  blankDefinition,
  definitionSchema,
  InterlockError,
  readPath,
  resolveFetch,
  resolveProvider,
  validateDefinition,
  applyWorkflowEdits,
  diagnoseDraft,
  summarizeDiagnostics,
  draftChanges,
  type DraftDiagnostic,
  validateWorkflowReferences,
  type Json,
  type NodeExecution,
  type Run,
  type RunAncestry,
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
  type SessionIdentity,
  type ModelSelection,
  modelSelectionSchema,
  draftLayoutSchema,
  type DraftLayout,
} from '@interlock/core';
import { assignmentInstructions } from './agentInstructions.js';
import { executeFetch, UncertainFetch } from './fetch.js';
import { executeScript } from './scripts.js';
import { RunStarts } from './runStarts.js';
import { RunAdmission } from './runAdmission.js';
import { HistoryRetention } from './historyRetention.js';
import { RunHistory, discoverRunTree } from './runHistory.js';
import {
  previewRunCancellationSchema,
  cancelRunTreeSchema,
  type RunCancellationPreview,
  type CancelRunTree,
} from '@interlock/core';
import { TrialEnvironments } from './trialEnvironments.js';
import { Continuation } from './continuation.js';
import { Prompts } from './prompts.js';
import { Variables } from './variables.js';
import { ModelAliases } from './modelAliases.js';
export { ModelAliases } from './modelAliases.js';
import { secretRedaction } from './secretRedaction.js';
import { nodeVariableReferences, variableReferences } from '@interlock/core';
import type { PollCheck } from '@interlock/core';
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

const now = () => new Date().toISOString();
const terminal = (s: string) =>
  ['completed', 'failed', 'cancelled'].includes(s);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const fetchHttpError = (status: number) =>
  status < 200 || status >= 300 ? `Fetch returned HTTP ${status}` : undefined;
function scriptEnvironmentId(id: string): string | undefined {
  // Legacy definitions can contain IDs that exceed portable spawn limits
  // or cannot be carried losslessly in a process environment.
  if (id.includes('\0') || Buffer.byteLength(id) > 16 * 1024) return;
  if (Buffer.from(id).toString() === id) return id;
}
type LocalOperationResult = {
  output: Json;
  httpError?: string;
  resolvedCwd?: string;
};
export interface Worker {
  modelSelection?: ModelSelection;
  session?: SessionIdentity;
  workerId: string;
  freshContext: boolean;
  tools: string[];
  skills: string[];
  claimTicket?: string;
}

class ResultProcessingError extends InterlockError {
  constructor(
    readonly setting: 'routing' | 'outputBindings',
    message: string,
  ) {
    super(message);
  }
}
export class Engine {
  readonly stalls: Stalls;
  readonly triggers: WorkflowTriggers;
  readonly history: RunHistory;
  readonly retention: HistoryRetention;
  readonly executors: ExecutorManager;
  readonly continuation: Continuation;
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
  private readonly resources: WorkResources;
  readonly contextGroups: ContextContinuityGroups;
  private readonly starts: RunStarts;
  private readonly trials: TrialEnvironments;
  private localJobs = new Map<string, AbortController>();
  private backgroundScripts: BackgroundScripts;
  private stopped = false;
  private listeners = new Set<() => void>();
  constructor(
    readonly store: Store,
    private cwd: string,
    private options: {
      trialRoot?: string;
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
    this.executors = new ExecutorManager(this, cwd);
    this.simulations = new Simulations(store, cwd);
    this.chains = new RunChains(store);
    this.continuation = new Continuation(
      store,
      (id) => this.projectionState(id),
      (id) => this.quiescence(id),
    );
    this.externalInputs = new ExternalInputs(store, {
      run: (id) => this.run(id),
      node: (run, execution) => {
        const node = this.definition(run).nodes.find(
          (node) => node.id === execution.nodeId,
        );
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
    });
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
    this.modelAliases = new ModelAliases(store, (id) =>
      this.executors.configuredPresetProfile(
        this.executors.profiles().find((profile) => profile.id === id),
      ),
    );
    this.assignmentSizes = new AssignmentSizes(store, this.prompts, (work) =>
      this.describeWork(work),
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
          definition.nodes.flatMap((node) =>
            node.kind === 'agent' &&
            node.executorMode === 'preset' &&
            node.model
              ? [node.model]
              : [],
          ),
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
    this.triggers = new WorkflowTriggers(
      store,
      (trigger, input, slot) => {
        const workflow = this.workflow(trigger.workflowId);
        const q = {
          workflowId: trigger.workflowId,
          input,
          version: workflow.latestVersion,
          requestId: `schedule:${trigger.id}:${slot}`,
          ...(trigger.tags !== undefined ? { tags: trigger.tags } : {}),
        };
        const result = this.starts.resolve(q, () => ({
          run: this.newRun(
            trigger.workflowId,
            q.version,
            input,
            undefined,
            undefined,
            undefined,
            undefined,
            q,
            {
              triggerId: trigger.id,
              scheduledAt: slot,
              waitForPrevious: trigger.overlapPolicy === 'queue',
              previousRunIds: store
                .activeRuns()
                .filter((r) => r.schedule?.triggerId === trigger.id)
                .map((r) => r.id),
            },
          ),
          reused: false,
        }));
        return this.run(result.id);
      },
      new EventTriggers(
        store,
        (trigger, payload, eventId, chain) => {
          const workflow = this.workflow(trigger.workflowId);
          const q = {
            workflowId: trigger.workflowId,
            version: workflow.latestVersion,
            input: payload as unknown as Json,
            requestId: `event:${trigger.id}:${eventId}`,
            ...(trigger.tags !== undefined ? { tags: trigger.tags } : {}),
          };
          const result = this.starts.resolve(q, () => ({
            run: this.newRun(
              trigger.workflowId,
              q.version,
              q.input,
              undefined,
              undefined,
              undefined,
              undefined,
              q,
              undefined,
              chain,
            ),
            reused: false,
          }));
          return this.run(result.id);
        },
        (runId) => this.quiescence(runId),
      ),
    );
    this.history = new RunHistory(
      store,
      (ids) => this.starts.deleted(ids),
      (ids) => {
        const blockers: string[] = [];
        if (
          this.localJobs.size > 0 &&
          store
            .runTrees(ids)
            .some((run) =>
              run.executions.some((execution) =>
                this.localJobs.has(execution.id),
              ),
            )
        )
          blockers.push(
            'Native operations are still closing. Retry after they stop.',
          );
        if (
          store
            .runTrees(ids)
            .some((run) =>
              run.executions.some(
                (execution) =>
                  execution.background &&
                  ['launching', 'running', 'uncertain'].includes(
                    execution.background.state,
                  ),
              ),
            )
        )
          blockers.push(
            'Background Scripts must have a verified outcome or explicit stopped reconciliation before deleting history.',
          );
        if (
          store
            .runTrees(ids)
            .some((run) =>
              run.executions.some((execution) =>
                execution.childRunIds?.some((id) => !ids.has(id)),
              ),
            )
        )
          blockers.push(
            'Incomplete descendant history must be recovered before cleanup.',
          );
        try {
          this.executors.assertDelete(ids);
        } catch (error) {
          if (!(error instanceof InterlockError)) throw error;
          blockers.push(error.message);
        }
        if (
          store.forRuns<UncertainClaim>(uncertainClaimCollection, ids).length ||
          store.forRuns<UncertainOperation>(uncertainOperationCollection, ids)
            .length
        )
          blockers.push(
            'Uncertain claims or operations must be confirmed stopped before deleting history.',
          );
        if (
          store
            .pendingEventDeliveries()
            .some(
              (delivery) => !delivery.runId && ids.has(delivery.sourceRunId),
            )
        )
          blockers.push(
            'Pending lifecycle deliveries retain their source tree until dispatch or suppression.',
          );
        if (
          store
            .pendingScheduleFires()
            .some((fire) => fire.runId && ids.has(fire.runId)) ||
          store
            .pendingEventDeliveries()
            .some((delivery) => delivery.runId && ids.has(delivery.runId))
        )
          blockers.push(
            'Trigger outcomes must be observed before deleting history.',
          );
        if (
          store
            .queuedRuns()
            .some((run) =>
              run.admission?.after.some(
                (dependency) => dependency.runId && ids.has(dependency.runId),
              ),
            )
        )
          blockers.push(
            'Queued admission dependencies retain this history until promotion or cancellation.',
          );
        return blockers;
      },
      () =>
        queueMicrotask(() => this.listeners.forEach((listener) => listener())),
    );
    this.retention = new HistoryRetention(store, this.history);
    this.trials = new TrialEnvironments(store, options.trialRoot, () =>
      this.pump(),
    );
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
    for (const id of this.trials.recover()) this.cancelTree(id);
    // Deterministic ownership survives a lost process outcome. Background supervisors
    // keep their reservation while authenticated recovery establishes their result.
    for (const run of store.runs()) {
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
    // A process interruption gives no evidence that local work or remote side effects completed.
    for (const run of store.runs()) {
      const execution = run.executions.at(-1);
      if (
        run.status === 'waiting' &&
        execution?.kind === 'wait' &&
        execution.operationStartedAt
      ) {
        this.resources.uncertainExecution(
          run.id,
          execution,
          'Service interrupted during polling check',
          true,
        );
        execution.operationStartedAt = undefined;
        this.save(run);
      }
      if (
        run.status === 'running' &&
        (execution?.kind === 'script' || execution?.kind === 'fetch') &&
        execution.status === 'running' &&
        !execution.background &&
        (!execution.resources?.length || execution.operationStartedAt)
      ) {
        this.resources.uncertainExecution(
          run.id,
          execution,
          'Service interrupted during operation',
          true,
        );
        this.fail(
          run,
          execution,
          `Service interrupted during ${execution.kind} execution. Inspect side effects before retrying.`,
        );
      }
    }
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
  private event(run: Run, type: string, text: string) {
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
      at: now(),
      ...this.projectRun(run.id, run),
    };
    this.store.put('events', event);
    this.triggers?.events.capture(run, event);
    queueMicrotask(() => this.listeners.forEach((listener) => listener()));
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
    const w = this.store.get<Workflow>('workflows', id);
    if (!w) throw new InterlockError('Workflow not found');
    return { ...w, ownerWorkflowId: w.ownerWorkflowId ?? null };
  }
  describeWorkflow(workflow: Workflow) {
    const latest = this.store.getVersion(workflow.id, workflow.latestVersion);
    const layout = readWorkflowLayout(this.store, workflow.id);
    return {
      ...workflow,
      draft: applyWorkflowPositions(workflow.draft, layout.positions),
      layoutRevision: layout.revision,
      draftMatchesLatest: latest
        ? sameWorkflowContent(workflow.draft, latest.definition)
        : null,
    };
  }
  saveLayout(input: {
    id: string;
    expectedRevision: number;
    positions: WorkflowPositions;
  }) {
    return saveWorkflowLayout(this.store, input);
  }
  authoringSummary(workflow: Workflow) {
    const { id, draftRevision, latestVersion, draftMatchesLatest, archived } =
      this.describeWorkflow(workflow);
    return {
      ok: true as const,
      id,
      draftRevision,
      latestVersion,
      draftMatchesLatest,
      archived,
    };
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
  private arrangeDraft(definition: WorkflowDefinition, layout?: DraftLayout) {
    const parsed = definitionSchema.parse(definition);
    if (layout === undefined) return parsed;
    draftLayoutSchema.parse(layout);
    if (layout === 'preserve') return parsed;
    return definitionSchema.parse(tidyWorkflow(parsed));
  }
  create(
    name: string,
    description = '',
    definition = blankDefinition(),
    ownerWorkflowId: string | null = null,
    layout?: DraftLayout,
  ): Workflow {
    if (ownerWorkflowId) {
      const owner = this.workflow(ownerWorkflowId);
      if (owner.ownerWorkflowId)
        throw new InterlockError('Children cannot own workflows');
      if (owner.archived)
        throw new InterlockError('Restore the parent before creating a child');
    }
    const time = now();
    const workflow: Workflow = {
      id: randomUUID(),
      ownerWorkflowId,
      name,
      description,
      archived: false,
      draft: this.arrangeDraft(definition, layout),
      draftRevision: 1,
      latestVersion: 0,
      createdAt: time,
      updatedAt: time,
    };
    validateWorkflowReferences(
      workflow.id,
      workflow.draft,
      this.store.workflows(),
    );
    this.store.put('workflows', workflow);
    return workflow;
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
    return this.store.transaction(() => {
      const w = this.workflow(id);
      if (
        (patch.draft || patch.layout !== undefined) &&
        patch.draftRevision !== w.draftRevision
      )
        throw new InterlockError(
          'Draft changed elsewhere. Reload before saving.',
        );
      const metadataChanged =
        (patch.name !== undefined && patch.name !== w.name) ||
        (patch.description !== undefined &&
          patch.description !== w.description) ||
        (patch.archived !== undefined && patch.archived !== w.archived);
      if (patch.name !== undefined) w.name = patch.name;
      if (patch.description !== undefined) w.description = patch.description;
      if (patch.archived !== undefined) w.archived = patch.archived;
      let contentChanged = false;
      if (patch.draft || patch.layout !== undefined) {
        const next = this.arrangeDraft(
          patch.draft ?? this.describeWorkflow(w).draft,
          patch.layout,
        );
        validateWorkflowReferences(w.id, next, this.store.workflows());
        contentChanged = !sameWorkflowContent(w.draft, next);
        const positions = workflowPositions(next);
        const before = workflowPositions(this.describeWorkflow(w).draft);
        const savedPositions = readWorkflowLayout(this.store, id).positions;
        persistWorkflowPositions(
          this.store,
          id,
          patch.layout === 'preserve'
            ? Object.fromEntries(
                Object.entries(positions).filter(
                  ([nodeId]) =>
                    !Object.hasOwn(before, nodeId) &&
                    !Object.hasOwn(savedPositions, nodeId),
                ),
              )
            : !contentChanged || patch.layout === 'tidy'
              ? positions
              : Object.fromEntries(
                  Object.entries(positions).filter(
                    ([nodeId, position]) =>
                      !Object.hasOwn(before, nodeId) ||
                      !isDeepStrictEqual(before[nodeId], position),
                  ),
                ),
        );
        if (contentChanged) {
          w.draft =
            patch.layout === 'preserve'
              ? applyWorkflowPositions(next, workflowPositions(w.draft))
              : next;
          w.draftRevision++;
        }
      }
      if (metadataChanged || contentChanged) {
        w.updatedAt = now();
        this.store.put('workflows', w);
      }
      return w;
    });
  }
  validateDraft(id: string, candidate?: unknown) {
    const w = this.workflow(id);
    const result = diagnoseDraft(candidate === undefined ? w.draft : candidate);
    this.addReferenceDiagnostics(w.id, result.definition, result.diagnostics);
    return {
      draftRevision: w.draftRevision,
      saveable: !result.diagnostics.some(
        (d) => d.category === 'save' && d.severity === 'error',
      ),
      publishable: !result.diagnostics.some(
        (d) => d.category !== 'contract' && d.severity === 'error',
      ),
      diagnostics: result.diagnostics,
    };
  }
  private addReferenceDiagnostics(
    id: string,
    definition: WorkflowDefinition | undefined,
    diagnostics: DraftDiagnostic[],
  ) {
    if (definition) {
      const workflows = this.store.workflows();
      for (const [i, node] of definition.nodes.entries()) {
        for (const reference of nodeVariableReferences(node)) {
          try {
            this.variables.get(reference);
          } catch {
            diagnostics.push({
              severity: 'error',
              category: 'publication',
              code: 'missing_variable',
              nodeId: node.id,
              path: `nodes.${i}`,
              message: `Variable ${reference || '(not selected)'} is missing. Select or provision it in Variables.`,
            });
          }
        }
        if (node.kind === 'agent') {
          for (const [j, promptId] of (node.promptIds ?? []).entries())
            if (!this.store.get('prompts', promptId))
              diagnostics.push({
                severity: 'error',
                category: 'publication',
                code: 'missing_prompt',
                nodeId: node.id,
                path: `nodes.${i}.promptIds.${j}`,
                message: `Saved prompt ${promptId} does not exist.`,
              });
        }
        if (node.kind !== 'workflow') continue;
        try {
          validateWorkflowReferences(
            id,
            { ...definition, nodes: [node] },
            workflows,
          );
        } catch (error) {
          diagnostics.push({
            severity: 'error',
            category: 'save',
            code: 'workflow_ownership',
            nodeId: node.id,
            path: `nodes.${i}.workflowId`,
            message: (error as Error).message,
          });
        }
        if (
          node.version !== null &&
          !this.store.getVersion(node.workflowId, node.version)
        )
          diagnostics.push({
            severity: 'error',
            category: 'publication',
            code: 'missing_workflow_version',
            nodeId: node.id,
            path: `nodes.${i}.version`,
            message: 'Referenced workflow version does not exist.',
          });
      }
    }
  }
  editDraft(
    id: string,
    draftRevision: number,
    edits: unknown,
    diagnosticsMode: 'all' | 'summary' = 'all',
    layout?: DraftLayout,
  ) {
    return this.store.transaction(() => {
      const w = this.workflow(id);
      const displayedDraft = this.describeWorkflow(w).draft;
      const before =
        diagnosticsMode === 'summary' ? this.validateDraft(id).diagnostics : [];
      const project = (diagnostics: DraftDiagnostic[]) =>
        diagnosticsMode === 'summary'
          ? summarizeDiagnostics(before, diagnostics)
          : { diagnostics };
      const unchanged = draftChanges(w.draft, w.draft);
      const failure = (diagnostics: DraftDiagnostic[]) => ({
        applied: false,
        draftRevision: w.draftRevision,
        changes: unchanged,
        ...project(diagnostics),
      });
      if (draftRevision !== w.draftRevision)
        return failure([
          {
            severity: 'error',
            category: 'save',
            code: 'stale_revision',
            path: 'draftRevision',
            message: 'Draft changed elsewhere. Reload before editing.',
          },
        ]);
      const result = applyWorkflowEdits(displayedDraft, edits);
      if (!result.definition) return failure(result.diagnostics);
      this.addReferenceDiagnostics(id, result.definition, result.diagnostics);
      const validation = result;
      if (
        validation.diagnostics.some(
          (d) => d.category === 'save' && d.severity === 'error',
        )
      ) {
        // The latest node edit touching a rejected reference identifies its operation.
        for (const diagnostic of validation.diagnostics) {
          if (
            diagnostic.category !== 'save' ||
            !diagnostic.nodeId ||
            !Array.isArray(edits)
          )
            continue;
          for (let i = edits.length - 1; i >= 0; i--) {
            const edit = edits[i] as {
              op: string;
              id?: string;
              node?: { id?: string };
            };
            if (
              (edit.op === 'update_node' && edit.id === diagnostic.nodeId) ||
              (edit.op === 'add_node' && edit.node?.id === diagnostic.nodeId)
            ) {
              diagnostic.operationIndex = i;
              break;
            }
          }
        }
        return failure(validation.diagnostics);
      }
      result.definition = this.arrangeDraft(result.definition, layout);
      const changes = draftChanges(displayedDraft, result.definition);
      const changed = !sameWorkflowContent(w.draft, result.definition);
      const beforePositions = workflowPositions(displayedDraft);
      const savedPositions = readWorkflowLayout(this.store, id).positions;
      persistWorkflowPositions(
        this.store,
        id,
        Object.fromEntries(
          Object.entries(workflowPositions(result.definition)).filter(
            ([nodeId, position]) =>
              layout === 'preserve'
                ? !Object.hasOwn(beforePositions, nodeId) &&
                  !Object.hasOwn(savedPositions, nodeId)
                : !Object.hasOwn(beforePositions, nodeId) ||
                  !isDeepStrictEqual(beforePositions[nodeId], position),
          ),
        ),
      );
      if (changed) {
        w.draft =
          layout === 'preserve'
            ? applyWorkflowPositions(
                result.definition,
                workflowPositions(w.draft),
              )
            : result.definition;
        w.draftRevision++;
        w.updatedAt = now();
        this.store.put('workflows', w);
      }
      return {
        applied: true,
        draftRevision: w.draftRevision,
        changes,
        ...project(validation.diagnostics),
      };
    });
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
    return this.store.transaction(() => {
      const parent = this.workflow(input.ownerWorkflowId);
      if (parent.draftRevision !== input.parentDraftRevision)
        throw new InterlockError(
          'Draft changed elsewhere. Reload before creating a child.',
        );
      const child = this.create(input.name, '', blankDefinition(), parent.id);
      const draft = definitionSchema.parse(input.parent.definition);
      if (input.nodeId) {
        const node = draft.nodes.find((n) => n.id === input.nodeId);
        if (!node || node.kind !== 'workflow')
          throw new InterlockError('Workflow node not found');
        node.workflowId = child.id;
        node.version = null;
      }
      validateWorkflowReferences(parent.id, draft, this.store.workflows());
      parent.draft = draft;
      parent.name = input.parent.name;
      parent.description = input.parent.description;
      parent.draftRevision++;
      parent.updatedAt = now();
      this.store.put('workflows', parent);
      return { parent, child };
    });
  }
  useChildVersion(input: {
    id: string;
    childId: string;
    nodeId: string;
    version: number;
    draftRevision: number;
  }) {
    return this.store.transaction(() => {
      const parent = this.workflow(input.id);
      const child = this.workflow(input.childId);
      if (parent.draftRevision !== input.draftRevision)
        throw new InterlockError(
          'Draft changed elsewhere. Reload before selecting a version.',
        );
      if (child.ownerWorkflowId !== parent.id)
        throw new InterlockError('Child does not belong to this workflow');
      if (!this.store.getVersion(child.id, input.version))
        throw new InterlockError('Workflow version not found');
      const node = parent.draft.nodes.find((n) => n.id === input.nodeId);
      if (!node || node.kind !== 'workflow' || node.workflowId !== child.id)
        throw new InterlockError(
          'The parent no longer references this child at that node',
        );
      node.version = input.version;
      parent.draftRevision++;
      parent.updatedAt = now();
      this.store.put('workflows', parent);
      return parent;
    });
  }
  deleteWorkflow(id: string) {
    const result = this.store.transaction(() => {
      this.workflow(id);
      this.testbench.assertDeletable(id);
      this.simulations.assertDeletable(id);
      if (this.store.workflows().some((w) => w.ownerWorkflowId === id))
        throw new InterlockError(
          'Delete the children first. Parent deletion with children is not available yet.',
        );
      const references = (definition: WorkflowDefinition) =>
        definition.nodes.some(
          (node) => node.kind === 'workflow' && node.workflowId === id,
        );
      const versions =
        this.store.list<import('@interlock/core').WorkflowVersion>('versions');
      const blockers: string[] = [];
      let hasPublishedReferences = false;
      for (const workflow of this.store.workflows()) {
        if (workflow.id === id) continue;
        const referencedVersions = versions
          .filter(
            (version) =>
              version.workflowId === workflow.id &&
              references(version.definition),
          )
          .map((version) => version.version)
          .sort((a, b) => a - b);
        const locations: string[] = [];
        if (references(workflow.draft)) locations.push('draft');
        if (referencedVersions.length) {
          hasPublishedReferences = true;
          locations.push(
            `published versions ${referencedVersions.map((version) => `v${version}${version === workflow.latestVersion ? ' (latest)' : ''}`).join(', ')}`,
          );
        }
        if (!locations.length) continue;
        const latest =
          workflow.latestVersion > 0 &&
          !referencedVersions.includes(workflow.latestVersion)
            ? `; latest v${workflow.latestVersion} does not reference it`
            : '';
        blockers.push(
          `"${workflow.name}" (${workflow.id}): ${locations.join('; ')}${latest}`,
        );
      }
      if (blockers.length)
        throw new InterlockError(
          `Cannot delete: referenced by ${blockers.join('; ')}. ${
            hasPublishedReferences
              ? 'Published references are immutable. Preview explicit old-version cleanup to remove obsolete callers after reviewing history loss. Remove current draft references first, or archive this workflow to preserve its versions and history.'
              : 'Remove these draft references first, or archive this workflow to preserve its history.'
          }`,
        );
      const runs = this.store.runs();
      const removed = new Set(
        runs.filter((run) => run.workflowId === id).map((run) => run.id),
      );
      for (const run of runs)
        if (
          removed.has(run.id) &&
          run.parentRunId &&
          !removed.has(run.parentRunId)
        )
          throw new InterlockError(
            'Cannot delete a workflow with runs belonging to another workflow.',
          );
      let changed = true;
      while (changed) {
        changed = false;
        for (const run of runs)
          if (
            run.parentRunId &&
            removed.has(run.parentRunId) &&
            !removed.has(run.id)
          ) {
            removed.add(run.id);
            changed = true;
          }
      }
      if (runs.some((run) => removed.has(run.id) && !terminal(run.status)))
        throw new InterlockError(
          'Cancel or finish active runs before deleting this workflow.',
        );
      this.executors.assertDelete(removed);
      for (const work of this.store.work())
        if (removed.has(work.runId)) this.store.remove('work', work.id);
      this.usage.removeRuns(removed);
      this.chains.removeRuns(removed);
      this.holds.removeRuns(removed);
      this.budgets.removeRuns(removed);
      this.contextGroups.removeRuns(removed);
      this.executors.removeRuns(removed);
      for (const event of this.store.list<import('@interlock/core').RunEvent>(
        'events',
      ))
        if (removed.has(event.runId)) this.store.remove('events', event.id);
      this.resources.assertDelete(removed);
      if (
        this.store.forRuns<UncertainClaim>(uncertainClaimCollection, removed)
          .length ||
        this.store.forRuns<UncertainOperation>(
          uncertainOperationCollection,
          removed,
        ).length
      )
        throw new InterlockError(
          'Uncertain claims or operations must be confirmed stopped before deleting workflow history.',
        );
      if (
        this.store
          .pendingEventDeliveries()
          .some(
            (delivery) =>
              !delivery.runId &&
              removed.has(delivery.sourceRunId) &&
              delivery.workflowId !== id,
          )
      )
        throw new InterlockError(
          'Pending lifecycle deliveries retain this source history until dispatch or suppression.',
        );
      this.starts.deleted(removed);
      for (const collection of [
        'externalInputValues',
        'externalInputReceipts',
        'stalls',
        'activeClockHolds',
      ]) {
        for (const record of this.store.forRuns<{ id: string }>(
          collection,
          removed,
        ))
          this.store.remove(collection, record.id);
      }
      for (const runId of removed) this.store.remove('runs', runId);
      for (const version of this.store.list<
        import('@interlock/core').WorkflowVersion & { id: string }
      >('versions'))
        if (version.workflowId === id)
          this.store.remove('versions', version.id);
      for (const version of this.store.list<
        import('@interlock/core').DeletedWorkflowVersion & { id: string }
      >('deletedVersions'))
        if (version.workflowId === id)
          this.store.remove('deletedVersions', version.id);
      this.testbench.deleteWorkflow(id);
      this.simulations.deleteWorkflow(id);
      for (const trigger of this.store.workflowTriggers(id)) {
        this.store.deleteScheduleFires(trigger.id);
        this.store.remove('workflowTriggers', trigger.id);
        this.store.deleteEventHistory(trigger.id);
      }
      this.retention.deleteWorkflow(id);
      this.store.remove('workflowLayouts', id);
      this.store.remove('workflows', id);
      return { id };
    });
    queueMicrotask(() => this.listeners.forEach((listener) => listener()));
    return result;
  }
  clone(id: string) {
    const w = this.workflow(id);
    if (this.store.workflows().some((child) => child.ownerWorkflowId === id))
      throw new InterlockError(
        'Cloning a workflow with children is not available yet.',
      );
    return this.create(
      `${w.name} copy`,
      w.description,
      this.describeWorkflow(w).draft,
    );
  }
  publish(id: string | string[], cascade = false) {
    const targetIds = Array.isArray(id) ? id : [id];
    return this.store.transaction(() => {
      if (!cascade && targetIds.length === 1)
        return this.publishVersion(targetIds[0]);
      const workflows = this.store.workflows();
      const definitions = new Map(
        workflows.map((w) => [
          w.id,
          targetIds.includes(w.id)
            ? w.draft
            : this.store.getVersion(w.id, w.latestVersion)?.definition,
        ]),
      );
      for (const targetId of targetIds) this.workflow(targetId);
      const affected = new Set(targetIds);
      if (cascade) {
        let changed = true;
        while (changed) {
          changed = false;
          for (const w of workflows) {
            if (
              !affected.has(w.id) &&
              definitions
                .get(w.id)
                ?.nodes.some(
                  (n) => n.kind === 'workflow' && affected.has(n.workflowId),
                )
            ) {
              affected.add(w.id);
              changed = true;
            }
          }
        }
      }
      const ordered: string[] = [];
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const visit = (workflowId: string) => {
        if (visiting.has(workflowId))
          throw new InterlockError(
            'Cannot cascade publication through a dependency cycle. Publish versions explicitly.',
          );
        if (visited.has(workflowId)) return;
        visiting.add(workflowId);
        for (const node of definitions.get(workflowId)!.nodes)
          if (node.kind === 'workflow' && affected.has(node.workflowId))
            visit(node.workflowId);
        visiting.delete(workflowId);
        visited.add(workflowId);
        ordered.push(workflowId);
      };
      for (const workflowId of affected) visit(workflowId);
      for (const workflowId of ordered) {
        const w = this.workflow(workflowId);
        if (!targetIds.includes(workflowId)) {
          if (!sameWorkflowContent(w.draft, definitions.get(workflowId)!))
            throw new InterlockError(
              `Cannot cascade: "${w.name}" has unpublished definition edits. Publish or discard them first.`,
            );
        }
        if (cascade) {
          let updated = false;
          for (const node of w.draft.nodes) {
            if (node.kind === 'workflow' && affected.has(node.workflowId)) {
              node.version = this.workflow(node.workflowId).latestVersion;
              updated = true;
            }
          }
          if (updated) {
            w.draftRevision++;
            this.store.put('workflows', w);
          }
        }
        this.publishVersion(workflowId);
      }
      return this.workflow(targetIds[targetIds.length - 1]);
    });
  }
  private publishVersion(id: string) {
    const w = this.workflow(id);
    const definition = validateDefinition(this.describeWorkflow(w).draft);
    for (const reference of variableReferences(definition))
      this.variables.get(reference);
    this.prompts.capture(definition);
    validateWorkflowReferences(w.id, definition, this.store.workflows());
    for (const n of definition.nodes) {
      if (
        n.kind === 'workflow' &&
        (n.version === null || !this.store.getVersion(n.workflowId, n.version))
      )
        throw new InterlockError(
          `${n.label}: referenced workflow version does not exist`,
        );
    }
    const pinnedPromptRevisions = definition.pinPromptsAtPublish
      ? Object.fromEntries(
          promptIds(definition).map((promptId) => [
            promptId,
            this.prompts.get(promptId).revision,
          ]),
        )
      : undefined;
    w.latestVersion++;
    w.updatedAt = now();
    this.store.version({
      workflowId: id,
      version: w.latestVersion,
      definition,
      ...(pinnedPromptRevisions ? { pinnedPromptRevisions } : {}),
      createdAt: now(),
    });
    this.store.put('workflows', w);
    return w;
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
    return this.inspect(
      this.startRun(workflowId, input, version, budget, options),
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
    return this.continuation.summary(
      this.startRun(workflowId, input, version, budget, options),
      bounded,
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
  runAttention() {
    return runAttention(this.store);
  }
  private projectionState(id: string) {
    const state = this.store.continuation(id);
    for (const execution of state.executions)
      if (execution.kind === 'wait' && this.localJobs.has(execution.id))
        execution.pollCheckRunning = true;
    for (const work of state.work)
      if (work.executor) work.managedExecution = this.executors.describe(work);
    return state;
  }
  projectRun(id: string, override?: Run) {
    return projectRun(this.store, id, this.projectionState(id), override);
  }
  inspect(id: string) {
    const run = this.run(id);
    const handledFailure = this.handledWorkflowFailure(run);
    const allRuns = this.store.runs();
    if (run.batchNodeId && run.parentRunId && !run.parentExecutionId) {
      const invocation = allRuns
        .find((parent) => parent.id === run.parentRunId)
        ?.executions.find((step) => step.childRunIds.includes(run.id));
      if (invocation) {
        run.parentExecutionId = invocation.id;
        run.batchItemIndex ??= invocation.childRunIds.indexOf(run.id);
      }
    }
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const child of allRuns)
        if (
          child.parentRunId &&
          ids.has(child.parentRunId) &&
          !ids.has(child.id)
        ) {
          ids.add(child.id);
          changed = true;
        }
    }
    const chain = this.chains.read(run);
    return {
      run: { ...run, ...this.projectRun(id) },
      externalInputHeldByRunId: this.store.externalInputHoldOwner(run.id),
      ...(handledFailure ? { handledFailure } : {}),
      ...(chain
        ? {
            chain: {
              ...chain,
              latestStatus: this.run(chain.latestRunId).status,
            },
          }
        : {}),
      counterpartRunId: this.testbench.counterpart(run),
      descendants: allRuns
        .filter((child) => child.id !== id && ids.has(child.id))
        .map((child) => ({ ...child, ...this.projectRun(child.id) })),
      descendantWork: this.store
        .work()
        .filter((work) => ids.has(work.runId))
        .map((work) => {
          const { token, ...visible } = this.describeWork(work);
          return {
            ...visible,
            ...(work.holdRevision
              ? { holdHistory: this.holds.history(work.id) }
              : {}),
          };
        }),
      definition:
        this.store.getVersion(run.workflowId, run.version)?.definition ?? null,
      definitionAvailable: Boolean(
        this.store.getVersion(run.workflowId, run.version),
      ),
      work: this.store
        .work()
        .filter((w) => w.runId === id)
        .map((work) => {
          const { token, ...visible } = this.describeWork(work);
          return {
            ...visible,
            ...(work.holdRevision
              ? { holdHistory: this.holds.history(work.id) }
              : {}),
          };
        }),
      stalls: this.stalls.inspect(id),
      events: this.store.events(id),
      quiescence: this.quiescence(id),
      children: this.store.runs().filter((r) => r.parentRunId === id),
    };
  }
  private definition(
    run: Pick<Run, 'workflowId' | 'version'>,
  ): WorkflowDefinition {
    const snapshot = this.store.getVersion(run.workflowId, run.version);
    if (!snapshot)
      throw new InterlockError('Published workflow version not found');
    return snapshot.definition;
  }
  private handledWorkflowFailure(run: Run) {
    if (
      run.status !== 'failed' ||
      !run.parentRunId ||
      run.parentMode === 'detached'
    )
      return undefined;
    const parent = this.run(run.parentRunId);
    const caller = parent.executions.find(
      (execution) =>
        execution.kind === 'workflow' &&
        execution.port === 'failed' &&
        execution.childRunIds.includes(run.id),
    );
    return caller ? { runId: parent.id, executionId: caller.id } : undefined;
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
  private bindingSource(run: Run, input: Json) {
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
      (e) => e.source === node.id && e.port === port,
    );
    if (!edge && node.kind !== 'exit')
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
      edge?.targetHandle === 'end' ||
      edge?.targetHandle === 'join'
    ) {
      run.status = 'completed';
      run.output = output;
      this.event(
        run,
        'run.completed',
        run.parallelBranch
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
        if (node.batchId !== run.batchNodeId)
          throw new InterlockError('Execution cannot cross Batch groups');
        if (
          node.parallelId !== run.parallelBranch?.nodeId ||
          node.parallelBranchId !== run.parallelBranch?.id
        )
          throw new InterlockError('Execution cannot cross Parallel branches');
        this.chargeStep(run, node, definition.maxSteps);
        this.event(run, 'node.started', node.label);
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
        execution.status = 'waiting';
        execution.externalInput = { revision: 0 };
        run.status = 'waiting';
        this.save(run);
        this.event(
          run,
          'node.waiting',
          `${node.label}: waiting for external input`,
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
        const cwdBinding = node.cwd ?? definition.cwd;
        let resolvedCwd: string | undefined;
        let cwdBlocked: { reason: string; path?: string } | undefined;
        if (cwdBinding !== undefined) {
          const source = this.bindingSource(run, execution.input);
          const allowed = this.getAllowedRoots();
          const result = resolveAndValidateCwd(
            cwdBinding,
            source,
            allowed.length ? allowed : undefined,
          );
          if (result.error) {
            cwdBlocked = {
              reason: `${node.label}: ${result.error}`,
            };
          } else {
            resolvedCwd = result.resolvedCwd;
            execution.resolvedCwd = resolvedCwd;
          }
        }
        if (node.context.continuityGroup) {
          const groupState = this.contextGroups.describe(
            run.id,
            node.context.continuityGroup,
          );
          if (groupState.session && groupState.cwd) {
            resolvedCwd = groupState.cwd;
            execution.resolvedCwd = resolvedCwd;
            cwdBlocked = undefined;
          }
        }
        const executorSettings = this.agentExecutorSettings(
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
        const value = this.readBranchValue(run, execution, node.path);
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
              this.readBranchValue(run, execution, node.path),
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
    const failed = children.find(
      (child) =>
        (child.status === 'failed' || child.status === 'cancelled') &&
        !execution.retryChildRunIds?.includes(child.id),
    );
    if (failed)
      throw new InterlockError(
        `Parallel branch "${failed.parallelBranch?.key}" ${failed.status}: ${failed.error ?? failed.id}`,
      ); // The ordinary failure path cancels unfinished waited descendants.

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
    // Any child resumed or dispatched above needs a chance to advance first.
    if (
      active === 0 &&
      !execution.retryChildRunIds?.length &&
      children.length === node.branches.length &&
      children.every((child) => child.status === 'completed')
    ) {
      const output: Json = Object.fromEntries(
        children.map((child) => [child.parallelBranch!.key, child.output!]),
      );
      this.finish(run, execution, node, output, 'complete');
      return true;
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
  private agentExecutorSettings(
    run: Run,
    definition: WorkflowDefinition,
    node: Extract<WorkflowDefinition['nodes'][number], { kind: 'agent' }>,
  ): Partial<WorkRequest> | undefined {
    if (node.executor === null) return {};
    const captures = run.modelAliasCaptures;
    const legacy = node.executorMode === undefined;
    const direct = node.executorMode === 'harness';
    const target = node.model ?? definition.agentModel;
    const alias =
      !direct && target
        ? captures
          ? this.modelAliases.capturedAlias(captures, target)
          : this.modelAliases.get(target)
        : undefined;
    const workflowRef = definition.agentModel;
    const workflowHasPreset =
      !!workflowRef &&
      (run.ignoredWorkflowModelAlias === workflowRef ||
        !!(captures
          ? this.modelAliases.capturedAlias(captures, workflowRef)
          : this.modelAliases.get(workflowRef)));
    const preset =
      !this.options.substituteOperation &&
      (node.executorMode === 'preset' ||
        (captures !== undefined && alias?.permissions !== undefined));
    const profiles = this.executors.profiles();
    let executor = node.executor ?? definition.executor;
    let model = target;
    let effort =
      node.effort !== undefined ? node.effort : definition.agentEffort;
    let effortSource: WorkRequest['executorEffortSource'] =
      node.effort === undefined ? 'workflow' : 'node';
    let permissions = definition.agentPermissions;
    let permissionSource: WorkRequest['executorPermissionsSource'] = direct
      ? permissions
        ? 'workflow'
        : 'harness'
      : undefined;
    let selection: WorkRequest['modelAliasSelection'];

    if (direct && node.executor) {
      if (
        !inheritsWorkflowHarnessSettings(
          node.executor,
          definition.executor,
          workflowHasPreset,
        )
      ) {
        model = node.model;
        effort = node.effort;
      }
    } else if (target) {
      const candidates = this.modelAliases.expandCandidates(captures, target);
      if (preset) {
        const override = presetPermissions(
          alias?.permissions,
          definition.agentPermissions,
        );
        const binding = node.context.continuityGroup
          ? this.contextGroups.describe(run.id, node.context.continuityGroup)
              .session
          : undefined;
        const choices = alias && [
          ...eligiblePresetChoices(
            candidates,
            executor,
            (id) =>
              !binding || binding.executorId === id
                ? this.executors.configuredPresetProfile(
                    profiles.find((profile) => profile.id === id),
                  )
                : undefined,
            override,
          ),
        ];
        // Probe in parallel but never select a fallback before its predecessors resolve.
        const readiness =
          choices &&
          choices.map((choice) =>
            this.executors.presetProfileReady(choice.profile),
          );
        const first =
          readiness && readiness.findIndex((ready) => ready !== false);
        if (
          typeof first === 'number' &&
          first >= 0 &&
          readiness &&
          readiness[first] === undefined
        )
          return undefined;
        const choice =
          choices && typeof first === 'number' && first >= 0
            ? choices[first]
            : undefined;
        if (!choice)
          throw new InterlockError(
            `Agent preset "${target}" has no eligible harness for ${node.label}.`,
          );
        executor = choice.executor;
        model = choice.candidate.model;
        selection = choice.candidate.modelAliasSelection;
        permissions = override ?? choice.profile.permissions;
        permissionSource = !override
          ? 'harness'
          : override === definition.agentPermissions
            ? 'workflow'
            : 'preset';
        if (node.effort === undefined) {
          const inheritEffort =
            node.model === undefined ||
            inheritsWorkflowHarnessSettings(
              choice.executor,
              definition.executor,
              workflowHasPreset,
            );
          effort =
            choice.candidate.effort !== undefined
              ? choice.candidate.effort
              : inheritEffort
                ? definition.agentEffort
                : undefined;
          effortSource =
            choice.candidate.effort !== undefined && node.model
              ? 'node'
              : 'workflow';
        }
      } else if (legacy) {
        // Existing definitions keep alias-first routing, including the stored fallback
        // to the first candidate when a profile is disabled after run start.
        const candidate =
          candidates.find(
            (candidate) =>
              !candidate.profileId ||
              profiles.some(
                (profile) =>
                  profile.id === candidate.profileId && profile.enabled,
              ),
          ) ?? candidates[0];
        executor = candidate?.profileId ?? executor;
        model = candidate?.model ?? model;
        selection = candidate?.modelAliasSelection;
        if (candidate?.effort !== undefined) {
          effort = candidate.effort;
          effortSource = 'node';
        }
      }
    }

    return {
      ...(selection ? { modelAliasSelection: selection } : {}),
      ...(model
        ? {
            executorModel: model,
            executorModelSource: node.model ? 'node' : 'workflow',
          }
        : {}),
      ...(executor
        ? {
            executor,
            ...(effort !== undefined
              ? { executorEffort: effort, executorEffortSource: effortSource }
              : {}),
            ...(permissions ? { executorPermissions: permissions } : {}),
            ...(permissionSource
              ? { executorPermissionsSource: permissionSource }
              : {}),
          }
        : {}),
    };
  }

  pump() {
    if (this.stopped) return;
    this.store.transaction(() => {
      this.refreshTerminalScripts();
      this.triggers.tick();
      this.pauses.refresh();
      this.budgets.refresh();
      this.resources.refresh();
      for (const work of this.store.work('claimed'))
        if (this.stalls.deadlineExpired(work)) {
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
        } else if (Date.parse(work.leaseUntil!) <= this.nowMs()) {
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
        // Earlier advances can cancel or resume descendants in this same pass.
        for (const { id } of this.store.activeRuns()) {
          const candidate = this.run(id);
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
    for (const run of this.store.activeRuns()) {
      const execution = run.executions.at(-1);
      if (
        !execution ||
        (execution.resources?.length && !execution.resourceActive) ||
        this.localJobs.has(execution.id) ||
        (this.pauses.applicable(run.workflowId).length && !execution.background)
      )
        continue;
      if (execution.kind === 'wait') {
        if (run.status === 'waiting' && execution.status === 'waiting')
          this.runPollCheck(run, execution);
        continue;
      }
      if (
        run.status !== 'running' ||
        (execution.kind !== 'script' && execution.kind !== 'fetch') ||
        execution.status !== 'running'
      )
        continue;
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
            : this.localOperation(run, node, execution, controller.signal);
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
  private readBranchValue(
    run: Run,
    execution: NodeExecution,
    path: string,
  ): Json {
    const normalized = path.replace(/^\$\./, '');
    if (normalized.startsWith('execution.')) {
      const hasInputExecution =
        execution.input !== null &&
        typeof execution.input === 'object' &&
        Object.hasOwn(execution.input, 'execution');
      if (!hasInputExecution) {
        const parts = normalized.split('.');
        const targetNodeId = parts[1];
        const propPath = parts.slice(2).join('.');
        const previous = run.executions.findLast(
          (candidate) =>
            candidate.nodeId === targetNodeId &&
            candidate.status === 'completed',
        );
        if (propPath === 'visitCount') {
          return previous?.provenance?.visitCount ?? 0;
        }
        if (!previous || !previous.provenance) {
          return null;
        }
        return readPath(previous.provenance as unknown as Json, propPath);
      }
    }
    return readPath(execution.input, path);
  }
  private writeExecutionProvenanceFile(
    run: Run,
    execution: NodeExecution,
  ): string {
    const data = buildRunExecutionProvenanceFile(run);
    const filePath = join(
      tmpdir(),
      `interlock-provenance-${run.id}-${execution.id}.json`,
    );
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return filePath;
  }
  private async localOperation(
    run: Run,
    operation: Extract<WorkflowNode, { kind: 'script' | 'fetch' }> | PollCheck,
    execution: NodeExecution,
    signal: AbortSignal,
    label = 'label' in operation ? operation.label : 'Polling check',
  ): Promise<LocalOperationResult> {
    const { input } = execution;
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
    let redact = secretRedaction(resolved.secrets);
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
        const response = await executeFetch(
          resolveFetch(operation, input, resolved.value),
          operation.timeoutMs,
          signal,
          { allowRedirects: !resolved.secrets.length },
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
      const inherited = environment?.env ?? process.env;
      const bindings = Object.fromEntries(
        (operation.environment ?? []).map((entry) => [
          entry.name,
          resolved.value(entry.variableId),
        ]),
      );
      const definition = this.definition(run);
      const cwdBinding = operation.cwd ?? definition.cwd;
      let effectiveCwd = environment?.cwd ?? this.cwd;
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
          const provenanceFile = this.writeExecutionProvenanceFile(
            run,
            execution,
          );
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
              INTERLOCK_EXECUTION_PROVENANCE_FILE: provenanceFile,
              ...bindings,
            },
            resolved.secrets.length > 0,
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
      const provenanceFile = this.writeExecutionProvenanceFile(run, execution);
      const launch = (env: NodeJS.ProcessEnv) =>
        executeScript(
          operation.command,
          input,
          operation.timeoutMs,
          effectiveCwd,
          signal,
          operation.language,
          env,
          resolved.secrets.length ? redact.text : undefined,
        );
      let output: Json;
      try {
        output = await launch({
          ...inherited,
          ...this.scriptContextEnvironment(run, execution),
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
      throw new InterlockError(redact.text(message(error)));
    }
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
        return this.localOperation(
          run,
          timing.check,
          execution,
          controller.signal,
          node.label,
        ).then(({ output, httpError, resolvedCwd }) => {
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
  private describeWork(work: WorkRequest): WorkRequest {
    const {
      expiredClaims: _receipts,
      holdReceipt: _holdReceipt,
      ...visible
    } = work;
    work = visible;
    const reservations = work.resources?.length
      ? this.resources.forWork(work.id)
      : [];
    work = {
      ...work,
      ...(this.executors.describe(work)
        ? { managedExecution: this.executors.describe(work) }
        : {}),
      ...(reservations.length ? { resourceReservations: reservations } : {}),
    };
    const instructions = assignmentInstructions(work, {
      lifecycleRunId: this.lifecycleRunId(work.runId),
    });
    return instructions
      ? { ...work, executionInstructions: instructions }
      : work;
  }
  private lifecycleRunId(id: string) {
    let run = this.run(id);
    while (run.parentRunId && run.parentMode !== 'detached')
      run = this.run(run.parentRunId);
    return run.id;
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
      .map((work) => this.describeWork(work));
  }
  workSummaries(runId?: string) {
    const ancestry = new Map<string, RunAncestry>();
    return this.available(runId).map((work) => ({
      id: work.id,
      runId: work.runId,
      ...this.store.runAncestry(work.runId, ancestry),
      nodeId: work.nodeId,
      label: work.label,
      status: work.status,
      context: work.context,
      ...(work.executor
        ? {
            executor: work.executor,
            ...(work.executorModel
              ? { executorModel: work.executorModel }
              : {}),
            ...(work.executorModelSource
              ? { executorModelSource: work.executorModelSource }
              : {}),
            ...(work.executorEffort !== undefined
              ? {
                  executorEffort: work.executorEffort,
                  executorEffortSource: work.executorEffortSource,
                }
              : {}),
            ...(work.executorPermissions
              ? { executorPermissions: work.executorPermissions }
              : {}),
            managedExecution: this.executors.describe(work),
          }
        : {}),
      ...(work.trialEnvironment
        ? { trialEnvironmentId: work.trialEnvironment.id }
        : {}),
      ...(work.continuity ? { continuity: work.continuity } : {}),
      attempt: work.attempt,
      ...(work.resources ? { resources: work.resources } : {}),
      maxAttempts: work.maxAttempts,
      maxLeaseExpiries: work.maxLeaseExpiries,
      failureCount: work.failureCount,
      leaseExpiryCount: work.leaseExpiryCount,
      ...(work.holdRevision ? { holdRevision: work.holdRevision } : {}),
      ...(work.heldClaimCount ? { heldClaimCount: work.heldClaimCount } : {}),
      maxExecutionMs: work.maxExecutionMs,
      claimedAt: work.claimedAt,
      lastActivityAt: work.lastActivityAt,
      leaseSeconds: work.leaseSeconds,
      availableUntil: work.availableUntil,
    }));
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
      return this.describeWork(work);
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
      return this.describeWork(work);
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
      ...this.continuation.summary(this.lifecycleRunId(workRunId), bounded),
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
    const input = scriptOperationSchema.parse(request);
    const run = this.run(input.runId);
    const execution = run.executions.find(
      (step) => step.id === input.executionId,
    );
    if (!execution?.background)
      throw new InterlockError('Background Script execution not found');
    if (
      input.action === 'inspect' &&
      ['launching', 'running'].includes(execution.background.state)
    ) {
      try {
        const node = this.definition(run).nodes.find(
          (node) => node.id === execution.nodeId,
        );
        if (node?.kind !== 'script')
          throw new InterlockError('Script node not found');
        const resolved = this.variables.resolve(
          run,
          (node.environment ?? []).map((entry) => entry.variableId),
        );
        const snapshot = this.backgroundScripts.snapshot(
          run,
          execution,
          resolved.secrets,
        );
        if (snapshot) {
          execution.background = snapshot;
          this.save(run);
        }
      } catch {
        execution.background.state = 'uncertain';
        if (!terminal(run.status))
          this.fail(
            run,
            execution,
            'Background supervisor or protected receipts cannot be verified. Inspect processes and reconcile stopped.',
          );
        else this.save(run);
      }
    }
    if (
      input.action === 'stop' &&
      ['launching', 'running', 'uncertain'].includes(execution.background.state)
    ) {
      try {
        this.backgroundScripts.stop(run.id, execution.id);
        if (!terminal(run.status)) {
          this.cancelTree(run.id);
          return this.manageScript({
            action: 'inspect',
            runId: run.id,
            executionId: execution.id,
          });
        }
      } catch (error) {
        execution.background.state = 'uncertain';
        if (!terminal(run.status)) this.fail(run, execution, message(error));
        else this.save(run);
        throw new InterlockError(message(error));
      }
    }
    const background = execution.background;
    if (input.action === 'reconcile')
      this.store.transaction(() => {
        if (background.state !== 'uncertain')
          throw new InterlockError(
            'Only uncertain background Scripts can be reconciled',
          );
        background.state = 'reconciled';
        this.resources.endExecution(run.id, execution, true);
        this.resources.releaseExecution(
          run.id,
          execution.id,
          execution.resourceAttempt ?? 1,
          'script reconciliation',
        );
        this.save(run);
        this.event(
          run,
          'script.reconciled',
          'Original Script confirmed stopped and effects inspected: ' +
            input.reason,
        );
      });
    return {
      runId: run.id,
      executionId: execution.id,
      status: execution.status,
      background: execution.background,
    };
  }
  private cancelTree(id: string, afterCommit?: (() => void)[]) {
    const run = this.run(id);
    if (terminal(run.status)) return;
    for (const child of this.store
      .runs()
      .filter((r) => r.parentRunId === id && r.parentMode !== 'detached'))
      this.cancelTree(child.id, afterCommit);
    this.cancelOne(run, afterCommit);
  }
  private cancelOne(run: Run, afterCommit?: (() => void)[], reason?: string) {
    const id = run.id;
    run.status = 'cancelled';
    if (reason) run.cancellationReason = reason;
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
    if (execution && !terminal(execution.status))
      execution.status = 'cancelled';
    for (const work of this.store
      .work()
      .filter(
        (w) =>
          w.runId === id && ['available', 'claimed', 'held'].includes(w.status),
      )) {
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
  private cancellationSelection(id: string, includeDetached: boolean) {
    return discoverRunTree(this.store.historyRuns(), id, includeDetached);
  }
  private cancellationReference(run: ReturnType<Store['historyRuns']>[number]) {
    return {
      id: run.id,
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      status: run.status,
      ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
      ...(run.parentMode === 'detached'
        ? { parentMode: 'detached' as const }
        : {}),
    };
  }
  previewRunCancellation(input: RunCancellationPreview) {
    const query = previewRunCancellationSchema.parse(input);
    return this.store.transaction(() => {
      const active = this.cancellationSelection(
        query.id,
        query.includeDetached,
      ).filter((run) => !terminal(run.status));
      const items = active
        .slice(query.offset, query.offset + query.limit)
        .map((run) => this.cancellationReference(run));
      return {
        rootRunId: query.id,
        includeDetached: query.includeDetached,
        items,
        total: active.length,
        offset: query.offset,
        nextOffset:
          query.offset + items.length < active.length
            ? query.offset + items.length
            : null,
        truncated:
          query.offset > 0 || query.offset + items.length < active.length,
      };
    });
  }
  cancelRunTree(input: CancelRunTree) {
    const query = cancelRunTreeSchema.parse(input);
    const afterCommit: (() => void)[] = [];
    const result = this.store.transaction(() => {
      const selected = this.cancellationSelection(
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
          items: active
            .slice(0, query.limit)
            .map((run) =>
              this.cancellationReference({ ...run, status: 'cancelled' }),
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
      if (this.handledWorkflowFailure(run))
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
