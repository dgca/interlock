import {
  InterlockError,
  type Workflow,
  type WorkflowDefinition,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Budgets } from './budgets.js';
import type { ContextContinuityGroups } from './contextContinuity.js';
import type { ExecutorManager } from './executors/manager.js';
import type { HistoryRetention } from './historyRetention.js';
import {
  uncertainClaimCollection,
  type UncertainClaim,
  uncertainOperationCollection,
  type UncertainOperation,
} from './quiescence.js';
import type { RunChains } from './runChains.js';
import type { RunStarts } from './runStarts.js';
import type { Simulations } from './simulation.js';
import type { Testbench } from './testbench.js';
import type { Usage } from './usage.js';
import type { WorkHolds } from './workHolds.js';
import type { WorkResources } from './workResources.js';

const terminal = (s: string) =>
  ['completed', 'failed', 'cancelled'].includes(s);

/** Deletes a workflow with its versions, runs and run-scoped records. */
export class WorkflowDeletion {
  constructor(
    private readonly store: Store,
    private readonly workflow: (id: string) => Workflow,
    private readonly testbench: Testbench,
    private readonly simulations: Simulations,
    private readonly executors: ExecutorManager,
    private readonly usage: Usage,
    private readonly chains: RunChains,
    private readonly holds: WorkHolds,
    private readonly budgets: Budgets,
    private readonly contextGroups: ContextContinuityGroups,
    private readonly resources: WorkResources,
    private readonly starts: RunStarts,
    private readonly retention: HistoryRetention,
    private readonly listeners: Set<() => void>,
  ) {}
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
}
