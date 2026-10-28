import { createHash } from 'node:crypto';
import {
  InterlockError,
  HoldDeadlineError,
  type WorkHoldChange,
  type WorkHoldHistory,
  type WorkHoldInterval,
  type WorkRequest,
  type Run,
  type UsageOutcome,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
const collection = 'workHolds';
export class WorkHolds {
  constructor(
    private store: Store,
    private endUsage: (work: WorkRequest, outcome: UsageOutcome) => void,
    private unclaimedMs: (work: WorkRequest) => number | undefined,
    private notify: (runId: string, type: string, message: string) => void,
  ) {}
  history(workId: string, offset = 0, limit = 20): WorkHoldHistory {
    const work = this.store.get<WorkRequest>('work', workId);
    if (!work) throw new InterlockError('Assignment not found');
    const run = this.store.get<Run>('runs', work.runId)!;
    const execution = run.executions.find((e) => e.id === work.executionId);
    const endAt =
      work.endedAt ??
      execution?.completedAt ??
      (['completed', 'failed', 'cancelled', 'timed_out'].includes(work.status)
        ? run.updatedAt
        : undefined);
    const end = endAt ? Date.parse(endAt) : Date.now();
    const intervals = this.store
      .list<WorkHoldInterval>(collection)
      .filter((h) => h.workId === workId)
      .sort((a, b) => b.revision - a.revision);
    const wallMs = Math.max(0, end - Date.parse(work.createdAt));
    const declaredHeldMs = intervals.reduce(
      (sum, h) =>
        sum +
        Math.max(
          0,
          (h.endedAt ? Date.parse(h.endedAt) : end) - Date.parse(h.heldAt),
        ),
      0,
    );
    return {
      workId,
      items: intervals.slice(offset, offset + limit),
      total: intervals.length,
      nextOffset: offset + limit < intervals.length ? offset + limit : null,
      wallMs,
      declaredHeldMs,
      elapsedExcludingHoldsMs: Math.max(0, wallMs - declaredHeldMs),
    };
  }
  private summary(work: WorkRequest, applied: boolean) {
    return {
      applied,
      workId: work.id,
      runId: work.runId,
      status: work.status,
      attempt: work.attempt,
      holdRevision: work.holdRevision ?? 0,
    };
  }
  change(q: WorkHoldChange) {
    const work = this.store.get<WorkRequest>('work', q.workId);
    if (!work) throw new InterlockError('Assignment not found');
    const run = this.store.get<Run>('runs', work.runId)!;
    if (
      !['running', 'waiting'].includes(run.status) ||
      !['available', 'claimed', 'held'].includes(work.status)
    )
      throw new InterlockError(
        'Assignment is no longer active; inspect the run',
      );
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(q))
      .digest('hex');
    if (work.holdReceipt === fingerprint) return this.summary(work, false);
    if (
      (work.holdRevision ?? 0) !== q.expectedRevision ||
      work.attempt !== q.expectedAttempt
    )
      throw new InterlockError(
        'Assignment attempt or hold revision changed; inspect before changing the hold',
      );
    const atMs = Date.now(),
      at = new Date(atMs).toISOString();
    if (
      (work.leaseUntil && Date.parse(work.leaseUntil) <= atMs) ||
      (work.availableUntil && Date.parse(work.availableUntil) <= atMs)
    )
      throw new HoldDeadlineError(
        'Assignment deadline elapsed; inspect current work before holding it',
      );
    if (q.action === 'hold') {
      if (work.status === 'held')
        throw new InterlockError(
          'Assignment is already held; inspect or resume it',
        );
      if (q.token && (work.status !== 'claimed' || work.token !== q.token))
        throw new InterlockError('Claim token does not match');
      const remainingMs =
        work.status === 'claimed'
          ? this.unclaimedMs(work)
          : (work.budgetBlocked?.remainingMs ??
            (work.availableUntil
              ? Math.max(0, Date.parse(work.availableUntil) - atMs)
              : undefined));
      const hold = {
        revision: q.expectedRevision + 1,
        category: q.category,
        reason: q.reason,
        checkpointRef: q.checkpointRef,
        actor: q.actor,
        heldAt: at,
        ...(remainingMs === undefined ? {} : { remainingMs }),
      };
      if (work.status === 'claimed') {
        this.endUsage(work, 'held');
        work.heldClaimCount = (work.heldClaimCount ?? 0) + 1;
      }
      work.hold = hold;
      this.store.put<WorkHoldInterval>(collection, {
        ...hold,
        id: `${work.id}:${hold.revision}`,
        workId: work.id,
        runId: work.runId,
        executionId: work.executionId,
        attempt: work.attempt,
      });
      work.status = 'held';
      work.token = undefined;
      work.leaseUntil = undefined;
      work.availableUntil = undefined;
      this.notify(
        work.runId,
        'work.held',
        `${work.label}: held for ${q.category}`,
      );
    } else {
      if (work.status !== 'held' || !work.hold)
        throw new InterlockError('Assignment is not held');
      const remainingMs = work.hold.remainingMs;
      this.close(work, at, q.actor, 'resumed');
      work.status = 'available';
      work.workerId = undefined;
      work.modelSelection = undefined;
      work.claimLeaseSeconds = undefined;
      if (work.budgetBlocked) work.budgetBlocked.remainingMs = remainingMs;
      else if (remainingMs !== undefined)
        work.availableUntil = new Date(atMs + remainingMs).toISOString();
      this.notify(
        work.runId,
        'work.resumed',
        `${work.label}: resumed; a fresh claim is required`,
      );
    }
    work.holdRevision = q.expectedRevision + 1;
    work.holdReceipt = fingerprint;
    this.store.put('work', work);
    return this.summary(work, true);
  }
  close(
    work: WorkRequest,
    at: string,
    actor: string,
    reason: 'resumed' | 'cancelled',
  ) {
    if (!work.hold) return;
    const id = `${work.id}:${work.hold.revision}`;
    const interval = this.store.get<WorkHoldInterval>(collection, id)!;
    this.store.put(collection, {
      ...interval,
      endedAt: at,
      endedBy: actor,
      endReason: reason,
    });
    work.hold = undefined;
    if (reason === 'cancelled') {
      work.holdRevision = (work.holdRevision ?? 0) + 1;
      work.holdReceipt = undefined;
    }
  }
  removeRuns(ids: Set<string>) {
    for (const h of this.store.list<WorkHoldInterval>(collection))
      if (ids.has(h.runId)) this.store.remove(collection, h.id);
  }
}
