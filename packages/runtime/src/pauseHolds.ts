import { randomUUID } from 'node:crypto';
import {
  InterlockError,
  pauseCreateSchema,
  pauseListSchema,
  elapsedExcludingPausesMs,
  type PauseCreate,
  type PauseList,
  type PauseHold,
  type Run,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

/** Scope evaluation and persistent intervals shared by admission and active clocks. */
export class PauseHolds {
  constructor(
    private store: Store,
    private notify: (run: Run, hold: PauseHold) => void,
  ) {}
  applicable(workflowId: string) {
    return this.store.pauseHolds(workflowId);
  }
  list(input: PauseList = {}) {
    const q = pauseListSchema.parse(input);
    if (q.scope === 'workflow' && !q.workflowId)
      throw new InterlockError('workflow scope requires workflowId');
    const holds = this.store
      .pauseHolds(q.workflowId)
      .filter((h) => !q.scope || h.scope === q.scope);
    return {
      items: holds.slice(q.offset, q.offset + q.limit),
      total: holds.length,
      nextOffset: q.offset + q.limit < holds.length ? q.offset + q.limit : null,
    };
  }
  create(input: PauseCreate) {
    const q = pauseCreateSchema.parse(input);
    if (
      q.target.scope === 'workflow' &&
      !this.store.get('workflows', q.target.workflowId)
    )
      throw new InterlockError('Workflow not found');
    return this.store.transaction(() => {
      const hold: PauseHold = {
        id: randomUUID(),
        ...q.target,
        actor: q.actor,
        reason: q.reason,
        createdAt: new Date().toISOString(),
      };
      this.store.put('pauseHolds', hold);
      this.refresh();
      this.touch(hold);
      return hold;
    });
  }
  resume(id: string) {
    return this.store.transaction(() => {
      const hold = this.store.get<PauseHold>('pauseHolds', id);
      if (!hold)
        throw new InterlockError(
          'Pause hold not found; inspect active holds and release an exact ID',
        );
      if (hold.releasedAt) return { applied: false, hold };
      hold.releasedAt = new Date().toISOString();
      this.store.put('pauseHolds', hold);
      this.refresh();
      this.touch(hold);
      return { applied: true, hold };
    });
  }
  private touch(hold: PauseHold) {
    for (const run of this.store.activeRuns())
      if (hold.scope === 'library' || hold.workflowId === run.workflowId) {
        this.store.touchRun(run.id);
        this.notify(run, hold);
      }
  }
  assert(run: Run) {
    if (this.applicable(run.workflowId).length)
      throw new InterlockError(
        'Execution paused; inspect pause holds and release only your exact hold ID. Other holds must also clear.',
      );
  }
  elapsed(run: Run, start: string, end = new Date().toISOString()) {
    return elapsedExcludingPausesMs(
      Date.parse(start),
      Date.parse(end),
      this.store.pauseHolds(run.workflowId, true),
    );
  }
  refresh() {
    for (const work of this.store.work('available')) {
      const run = this.store.get<Run>('runs', work.runId);
      if (!run) continue;
      const holds = this.applicable(run.workflowId);
      if (holds.length) {
        if (work.pauseBlocked) continue;
        work.pauseBlocked = {
          since: holds[0].createdAt,
          remainingMs:
            work.budgetBlocked?.remainingMs ??
            work.resourceBlocked?.remainingMs ??
            (work.availableUntil
              ? Math.max(0, Date.parse(work.availableUntil) - Date.now())
              : undefined),
        };
        work.availableUntil = undefined;
      } else {
        if (!work.pauseBlocked) continue;
        if (
          !work.budgetBlocked &&
          !work.resourceBlocked &&
          work.pauseBlocked.remainingMs !== undefined
        )
          work.availableUntil = new Date(
            Date.now() + work.pauseBlocked.remainingMs,
          ).toISOString();
        work.pauseBlocked = undefined;
      }
      this.store.put('work', work);
    }
  }
}
