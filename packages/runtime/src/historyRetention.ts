import {
  InterlockError,
  retentionScopeSchema,
  retentionUpdateSchema,
  type RetentionPolicy,
  type RetentionSettings,
  type RetentionState,
  type Workflow,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { RunHistory } from './runHistory.js';

const intervalMs = 3_600_000;
const batchLimit = 100;
type PolicyRecord = {
  id: string;
  revision: number;
  policy?: RetentionPolicy | null;
};

/** Local operational policy. Only the existing guarded history path deletes runs. */
export class HistoryRetention {
  private failedState?: RetentionState;
  constructor(
    private store: Store,
    private history: RunHistory,
  ) {}
  private id(workflowId?: string) {
    return workflowId ? `workflow:${workflowId}` : 'library';
  }
  settings(input: unknown = {}): RetentionSettings {
    const { workflowId } = retentionScopeSchema.parse(input);
    if (workflowId && !this.store.get<Workflow>('workflows', workflowId))
      throw new InterlockError('Workflow not found');
    const record = this.store.get<PolicyRecord>(
      'historyRetention',
      this.id(workflowId),
    );
    const inherited = !!workflowId && record?.policy === undefined;
    const library =
      this.store.get<PolicyRecord>('historyRetention', 'library')?.policy ??
      null;
    const policy = workflowId ? record?.policy : (record?.policy ?? null);
    return {
      scope: workflowId ? 'workflow' : 'library',
      ...(workflowId ? { workflowId } : {}),
      revision: record?.revision ?? 0,
      policy,
      effectivePolicy: inherited ? library : (policy ?? null),
      inherited,
    };
  }
  configure(input: unknown) {
    const query = retentionUpdateSchema.parse(input);
    return this.store.transaction(() => {
      const current = this.settings({ workflowId: query.workflowId });
      if (current.revision !== query.expectedRevision)
        throw new InterlockError(
          'Retention settings changed; reload before saving',
        );
      if (!query.workflowId && query.policy === 'inherit')
        throw new InterlockError('Only workflow retention can inherit');
      this.store.put('historyRetention', {
        id: this.id(query.workflowId),
        revision: current.revision + 1,
        ...(query.policy === 'inherit' ? {} : { policy: query.policy }),
      });
      const enabled = this.store
        .list<PolicyRecord>('historyRetention')
        .some((record) => !!record.policy);
      this.store.put('historyRetentionState', {
        ...this.state(),
        nextCheckAt: enabled ? new Date().toISOString() : null,
      });
      this.failedState = undefined;
      return this.settings({ workflowId: query.workflowId });
    });
  }
  deleteWorkflow(workflowId: string) {
    this.store.remove('historyRetention', this.id(workflowId));
    if (
      !this.store
        .list<PolicyRecord>('historyRetention')
        .some((record) => !!record.policy)
    ) {
      const state = this.state();
      if (state.nextCheckAt !== null) {
        this.store.put('historyRetentionState', {
          ...state,
          nextCheckAt: null,
        });
        this.failedState = undefined;
      }
    }
  }
  private state(): RetentionState {
    return (
      this.failedState ??
      this.store.get<RetentionState>('historyRetentionState', 'library') ?? {
        id: 'library',
        nextCheckAt: null,
        lastSweep: null,
        lastError: null,
      }
    );
  }
  status() {
    const { id: _id, ...state } = this.state();
    return {
      ...state,
      intervalMs,
      batchLimit,
      storage: this.store.storageSpace(),
    };
  }
  tick() {
    const at = Date.now();
    const state = this.state();
    if (state.nextCheckAt && Date.parse(state.nextCheckAt) > at) return;
    const policies = new Map(
      this.store
        .list<PolicyRecord>('historyRetention')
        .map((record) => [record.id, record.policy]),
    );
    if (![...policies.values()].some((policy) => !!policy)) return;
    try {
      this.store.transaction(() => {
        const pools = new Map<
          string,
          {
            policy: RetentionPolicy;
            trees: ReturnType<RunHistory['trees']>['roots'];
          }
        >();
        for (const tree of this.history.trees().roots) {
          if (
            !tree.members.every((run) =>
              ['completed', 'failed', 'cancelled'].includes(run.status),
            )
          )
            continue;
          const overrideId = this.id(tree.root.workflowId);
          const poolId =
            policies.get(overrideId) !== undefined ? overrideId : 'library';
          const policy = policies.get(poolId);
          if (!policy) continue;
          const pool = pools.get(poolId) ?? { policy, trees: [] };
          pool.trees.push(tree);
          pools.set(poolId, pool);
        }
        const candidates: ReturnType<RunHistory['trees']>['roots'] = [];
        for (const { policy, trees } of pools.values()) {
          trees.sort(
            (a, b) =>
              b.updatedAt.localeCompare(a.updatedAt) ||
              a.root.id.localeCompare(b.root.id),
          );
          trees.forEach((tree, index) => {
            if (
              (policy.maxCompletedRuns !== undefined &&
                index >= policy.maxCompletedRuns) ||
              (policy.maxAgeDays !== undefined &&
                Date.parse(tree.updatedAt) <
                  at - policy.maxAgeDays * 86_400_000)
            )
              candidates.push(tree);
          });
        }
        candidates.sort(
          (a, b) =>
            a.updatedAt.localeCompare(b.updatedAt) ||
            a.root.id.localeCompare(b.root.id),
        );
        const roots: { runId: string; confirmation: string }[] = [];
        let protectedTrees = 0,
          eligible = 0;
        // Preview batches keep both returned detail and confirmation work bounded.
        for (let offset = 0; offset < candidates.length; offset += batchLimit) {
          const recent = candidates
            .slice(offset, offset + batchLimit)
            .filter((tree) => Date.parse(tree.updatedAt) > at - 60_000);
          protectedTrees += recent.length;
          const selected = candidates
            .slice(offset, offset + batchLimit)
            .filter((tree) => !recent.includes(tree));
          if (!selected.length) continue;
          const preview = this.history.preview({
            rootRunIds: selected.map((tree) => tree.root.id),
            limit: batchLimit,
          });
          for (const item of preview.items) {
            if (!item.canDelete) {
              protectedTrees++;
              continue;
            }
            eligible++;
            if (roots.length < batchLimit)
              roots.push({
                runId: item.rootRunId,
                confirmation: item.confirmation!,
              });
          }
        }
        const result = roots.length
          ? this.history.delete({ roots, acknowledgeHistoryLoss: true })
          : null;
        this.store.put('historyRetentionState', {
          id: 'library',
          nextCheckAt: new Date(
            at +
              (eligible > batchLimit ||
              candidates.some(
                (tree) => Date.parse(tree.updatedAt) > at - 60_000,
              )
                ? 60_000
                : intervalMs),
          ).toISOString(),
          lastError: null,
          lastSweep: {
            checkedAt: new Date(at).toISOString(),
            candidates: candidates.length,
            protectedTrees,
            deletedRoots: result?.deletedRoots ?? 0,
            deletedRuns: result?.deletedRuns ?? 0,
            removedDocumentBytes: result?.removedDocumentBytes ?? 0,
          },
        } satisfies RetentionState);
      });
      this.failedState = undefined;
    } catch (error) {
      this.failedState = {
        ...state,
        nextCheckAt: new Date(at + intervalMs).toISOString(),
        lastError: (error instanceof Error
          ? error.message
          : 'Retention sweep failed'
        ).slice(0, 1000),
      };
      try {
        this.store.put('historyRetentionState', this.failedState);
      } catch {
        /* Keep the retry deadline in memory when storage itself is unavailable. */
      }
    }
  }
}
