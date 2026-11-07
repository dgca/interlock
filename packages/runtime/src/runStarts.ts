import {
  InterlockError,
  type Run,
  type RunStartRequest,
  type RunStartReceipt,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { fingerprint } from './versionIdentity.js';

const collection = 'runStarts';
/** Resolve receipts and create all initial state under the same storage transaction. */
export class RunStarts {
  constructor(private store: Store) {}
  resolve(q: RunStartRequest, create: () => { run: Run; reused: boolean }) {
    return this.store.transaction(() => {
      if (q.requestId === undefined) {
        const { run, reused } = create();
        return { id: run.id, replayed: reused };
      }
      const id = fingerprint(q.requestId);
      const requestHash = fingerprint({
        workflowId: q.workflowId,
        input: q.input,
        version: q.version ?? null,
        budget: q.budget ?? null,
        externalTask: q.externalTask ?? null,
        ...(q.tags !== undefined ? { tags: q.tags } : {}),
        ...(q.versionPolicy !== undefined
          ? { versionPolicy: q.versionPolicy }
          : {}),
        ...(q.priority !== undefined ? { priority: q.priority } : {}),
        ...(q.after !== undefined ? { after: q.after } : {}),
        ...(q.onActiveExternalTask !== undefined
          ? { onActiveExternalTask: q.onActiveExternalTask }
          : {}),
      });
      const receipt = this.store.get<RunStartReceipt>(collection, id);
      if (receipt) {
        if (receipt.requestHash !== requestHash)
          throw new InterlockError(
            'Run start requestId was already used with different arguments; no run was started',
          );
        if (receipt.deletedAt || !this.store.get<Run>('runs', receipt.runId))
          throw new InterlockError(
            'Run start refers to deleted or missing history; no run was started. Use a new requestId for an explicit new attempt',
          );
        return { id: receipt.runId, replayed: true };
      }
      // Fail closed if a receipt was removed while its original run survives.
      if (
        this.store.findRuns({
          requestId: q.requestId,
          limit: 1,
          rootOnly: false,
        }).length
      )
        throw new InterlockError(
          'Run start receipt is unavailable; inspect retained runs before choosing a new requestId. No run was started',
        );
      const { run, reused } = create();
      this.store.put<RunStartReceipt>(collection, {
        id,
        requestHash,
        runId: run.id,
        workflowId: run.workflowId,
        version: run.version,
        createdAt: run.createdAt,
      });
      return { id: run.id, replayed: reused };
    });
  }
  deleted(runIds: Set<string>) {
    for (const receipt of this.store.forRuns<RunStartReceipt>(
      collection,
      runIds,
    ))
      this.store.put(collection, {
        ...receipt,
        deletedAt: receipt.deletedAt ?? new Date().toISOString(),
      });
  }
}
