import {
  InterlockError,
  previewRunCancellationSchema,
  type ManagedWorkspace,
  type RunCancellationPreview,
  type Run,
  type RunAncestry,
  type WorkRequest,
} from '@interlock/core';
import type { ProjectionState, Store } from '@interlock/storage';
import { assignmentInstructions } from './agentInstructions.js';
import type { ExecutorManager } from './executors/manager.js';
import {
  type sourceQuiescence,
  uncertainClaimCollection,
  type UncertainClaim,
  uncertainOperationCollection,
  type UncertainOperation,
} from './quiescence.js';
import { discoverRunTree } from './runHistory.js';
import type { RunChains } from './runChains.js';
import { createRunProjector } from './runProjection.js';
import type { Stalls } from './stalls.js';
import type { Testbench } from './testbench.js';
import type { WorkHolds } from './workHolds.js';
import type { WorkResources } from './workResources.js';

const terminal = (s: string) =>
  ['completed', 'failed', 'cancelled'].includes(s);

/** Read-only run, work and history projections the Engine exposes. */
export class RunInspection {
  constructor(
    private readonly store: Store,
    private readonly run: (id: string) => Run,
    private readonly localJobs: Map<string, AbortController>,
    private readonly executors: ExecutorManager,
    private readonly resources: WorkResources,
    private readonly holds: WorkHolds,
    private readonly chains: RunChains,
    private readonly testbench: Testbench,
    private readonly stalls: Stalls,
    private readonly quiescence: (
      runId: string,
    ) => ReturnType<typeof sourceQuiescence>,
    private readonly available: (runId?: string) => WorkRequest[],
  ) {}
  overlayProjection<T extends ProjectionState>(state: T): T {
    for (const execution of state.executions)
      if (execution.kind === 'wait' && this.localJobs.has(execution.id))
        execution.pollCheckRunning = true;
    for (const work of state.work)
      if (work.executor) work.managedExecution = this.executors.describe(work);
    return state;
  }
  projectRun(id: string, override?: Run) {
    const children = override?.executions.at(-1)?.childRunIds ?? [];
    return createRunProjector(
      this.store,
      this.overlayProjection(this.store.currentProjection([id, ...children])),
      override,
    )(id);
  }
  projectRuns<T extends { id: string }>(runs: T[]) {
    const project = createRunProjector(
      this.store,
      this.overlayProjection(
        this.store.currentProjection(runs.map((run) => run.id)),
      ),
    );
    return runs.map((run) => ({ ...run, ...project(run.id) }));
  }
  inspect(id: string) {
    const run = this.run(id);
    const handledFailure = this.handledWorkflowFailure(run);
    if (run.batchNodeId && run.parentRunId && !run.parentExecutionId) {
      const invocation = this.store
        .get<Run>('runs', run.parentRunId)
        ?.executions.find((step) => step.childRunIds.includes(run.id));
      if (invocation) {
        run.parentExecutionId = invocation.id;
        run.batchItemIndex ??= invocation.childRunIds.indexOf(run.id);
      }
    }
    const ids = new Set([id]);
    const descendants = this.store
      .runTrees(ids)
      .filter((child) => child.id !== id);
    for (const child of descendants) ids.add(child.id);
    const descendantWork = this.store
      .forRuns<WorkRequest>('work', ids)
      .map((work) => {
        const { token, ...visible } = this.describeWork(work);
        return {
          ...visible,
          ...(work.holdRevision
            ? { holdHistory: this.holds.history(work.id) }
            : {}),
        };
      });
    const definition = this.store.getVersion(run.workflowId, run.version);
    const chain = this.chains.read(run);
    const workspace = this.workspace(run);
    return {
      run: { ...run, ...this.projectRun(id) },
      ...(workspace ? { workspace } : {}),
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
      descendants: descendants.map((child) => ({
        ...child,
        ...this.projectRun(child.id),
      })),
      descendantWork,
      definition: definition?.definition ?? null,
      definitionAvailable: Boolean(definition),
      work: descendantWork.filter((work) => work.runId === id),
      stalls: this.stalls.inspect(id),
      events: this.store.events(id),
      quiescence: this.quiescence(id),
      children: descendants.filter((child) => child.parentRunId === id),
    };
  }
  /** The managed worktree this run works in: its own, or its owner's. */
  private workspace(run: Run) {
    let current: Run | undefined = run;
    for (let depth = 0; current && depth < 64; depth++) {
      const w = this.store.get<ManagedWorkspace>('workspaces', current.id);
      if (w)
        return {
          path: w.path,
          branch: w.branch,
          state: w.state,
          ...(w.error ? { error: w.error } : {}),
        };
      const next: string | undefined =
        current.chain && current.chain.rootRunId !== current.id
          ? current.chain.rootRunId
          : current.parentRunId;
      current = next ? this.store.get<Run>('runs', next) : undefined;
    }
    return undefined;
  }
  handledWorkflowFailure(run: Run) {
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
  describeWork(work: WorkRequest): WorkRequest {
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
  lifecycleRunId(id: string) {
    let run = this.run(id);
    while (run.parentRunId && run.parentMode !== 'detached')
      run = this.run(run.parentRunId);
    return run.id;
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
  cancellationSelection(id: string, includeDetached: boolean) {
    return discoverRunTree(this.store.historyRuns(), id, includeDetached);
  }
  cancellationReference(run: ReturnType<Store['historyRuns']>[number]) {
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
  historyDeletionBlockers(ids: Set<string>) {
    const { store } = this;
    const blockers: string[] = [];
    if (
      this.localJobs.size > 0 &&
      store
        .runTrees(ids)
        .some((run) =>
          run.executions.some((execution) => this.localJobs.has(execution.id)),
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
        .some((delivery) => !delivery.runId && ids.has(delivery.sourceRunId))
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
  }
}
