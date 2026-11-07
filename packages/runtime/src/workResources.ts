import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  type ResourceOwner,
  type ResourceReservation,
  type WorkRequest,
  type NodeExecution,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { fingerprint } from './versionIdentity.js';
import { claimTokenHash } from './leases.js';
export const resourceCollection = 'workResources';
export function resourceOwner({
  id: _id,
  tokenHash: _tokenHash,
  ...owner
}: ResourceReservation): ResourceOwner {
  return owner;
}

/** Atomic cooperative reservations, independent of claim expiry and run lifetime. */
export class WorkResources {
  constructor(
    private store: Store,
    private notify: (runId: string, message: string) => void,
  ) {}
  forWork(workId: string) {
    return this.store
      .forWork<ResourceReservation>(resourceCollection, workId)
      .map(resourceOwner);
  }
  forExecution(runId: string, executionId: string) {
    return this.store
      .forRuns<ResourceReservation>(resourceCollection, new Set([runId]))
      .filter((r) => r.executionId === executionId)
      .map(resourceOwner);
  }
  owners(names: string[]) {
    return names
      .map((name) =>
        this.store.get<ResourceReservation>(
          resourceCollection,
          fingerprint(name),
        ),
      )
      .filter((r) => r !== undefined)
      .map(resourceOwner);
  }
  acquireExecution(runId: string, execution: NodeExecution) {
    this.store.transaction(() => {
      if (this.owners(execution.resources ?? []).length)
        throw new InterlockError('Resource blocked before operation launch');
      execution.resourceAttempt = (execution.resourceAttempt ?? 0) + 1;
      execution.resourceActive = true;
      for (const name of execution.resources ?? []) {
        this.store.put(resourceCollection, {
          id: fingerprint(name),
          name,
          runId,
          executionId: execution.id,
          attempt: execution.resourceAttempt,
          state: 'claimed',
          acquiredAt: new Date().toISOString(),
          tokenHash: '',
        } satisfies ResourceReservation);
      }
    });
  }
  endExecution(runId: string, execution: NodeExecution, uncertain = false) {
    if (!execution.resources?.length) return;
    for (const r of this.store.forRuns<ResourceReservation>(
      resourceCollection,
      new Set([runId]),
    )) {
      if (
        r.executionId !== execution.id ||
        r.attempt !== execution.resourceAttempt ||
        r.state !== 'claimed'
      )
        continue;
      if (uncertain)
        this.store.put(resourceCollection, {
          ...r,
          state: 'uncertain',
          reason: 'operation interrupted; confirm stopped',
        });
      else this.store.remove(resourceCollection, r.id);
    }
    execution.resourceActive = false;
  }
  releaseExecution(
    runId: string,
    executionId: string,
    attempt: number,
    actor: string,
  ) {
    const records = this.store
      .forRuns<ResourceReservation>(resourceCollection, new Set([runId]))
      .filter((r) => r.executionId === executionId && r.attempt === attempt);
    return this.releaseRecords(records, attempt, actor, { runId, executionId });
  }
  private releaseRecords(
    records: ResourceReservation[],
    attempt: number,
    actor: string,
    target: { workId: string } | { runId: string; executionId: string },
  ) {
    if (records.some((r) => r.state !== 'uncertain'))
      throw new InterlockError(
        'Reservation still has an active claim or operation. Stop it before confirming it stopped.',
      );
    for (const r of records) {
      this.store.remove(resourceCollection, r.id);
      this.changed(
        r,
        `${actor}: confirmed attempt ${attempt} stopped; released ${r.name}`,
      );
    }
    this.refresh();
    return {
      applied: records.length > 0,
      ...target,
      attempt,
      released: records.length,
    };
  }
  private changed(r: ResourceReservation, message: string) {
    this.store.touchRun(r.runId);
    this.notify(r.runId, message);
  }
  acquire(work: WorkRequest) {
    const owners = (work.resources ?? [])
      .map((name) =>
        this.store.get<ResourceReservation>(
          resourceCollection,
          fingerprint(name),
        ),
      )
      .filter((r) => r !== undefined);
    if (owners.length)
      throw new InterlockError(
        'Resource blocked; inspect the run briefing before claiming. No claim was granted.',
      );
    for (const name of work.resources ?? []) {
      const record: ResourceReservation = {
        id: fingerprint(name),
        name,
        workId: work.id,
        runId: work.runId,
        attempt: work.attempt,
        tokenHash: claimTokenHash(work.token!),
        state: 'claimed',
        acquiredAt: new Date().toISOString(),
      };
      this.store.put(resourceCollection, record);
    }
  }
  end(
    work: WorkRequest,
    reason: 'completed' | 'failure' | 'expiry' | 'cancelled' | 'held',
  ) {
    for (const name of work.resources ?? []) {
      const r = this.store.get<ResourceReservation>(
        resourceCollection,
        fingerprint(name),
      );
      if (
        !r ||
        r.workId !== work.id ||
        r.attempt !== work.attempt ||
        !work.token ||
        r.tokenHash !== claimTokenHash(work.token)
      )
        continue;
      if (reason === 'completed' || reason === 'failure')
        this.store.remove(resourceCollection, r.id);
      else if (r.state !== 'uncertain')
        this.store.put(resourceCollection, {
          ...r,
          state: 'uncertain',
          reason,
        });
    }
  }
  release(workId: string, attempt: number, actor: string) {
    const records = this.store
      .forWork<ResourceReservation>(resourceCollection, workId)
      .filter((r) => r.attempt === attempt);
    return this.releaseRecords(records, attempt, actor, { workId });
  }

  assertDelete(runIds: Set<string>) {
    if (
      this.store.forRuns<ResourceReservation>(resourceCollection, runIds).length
    )
      throw new InterlockError(
        'Resource reservations remain. Stop the old workers and reconcile their resources before deleting history.',
      );
  }
  refresh() {
    for (const r of this.store.resourcesForReconciliation()) {
      if (r.state === 'uncertain' || r.executionId) continue;
      const work = this.store.get<WorkRequest>('work', r.workId!);
      if (
        work?.status === 'claimed' &&
        work.attempt === r.attempt &&
        work.token &&
        claimTokenHash(work.token) === r.tokenHash &&
        Date.parse(work.leaseUntil ?? '') > Date.now()
      )
        continue;
      this.store.put(resourceCollection, {
        ...r,
        state: 'uncertain',
        reason: 'claim no longer active',
      });
      this.changed(
        r,
        `Attempt ${r.attempt} no longer has an active claim; confirm it stopped before reusing ${r.name}`,
      );
    }
    for (const work of this.store.resourceAdmissionWork()) {
      if (work.status !== 'available') {
        if (work.resourceBlocked) {
          work.resourceBlocked = undefined;
          this.store.put('work', work);
        }
        continue;
      }
      const owners = (work.resources ?? [])
        .map((name) =>
          this.store.get<ResourceReservation>(
            resourceCollection,
            fingerprint(name),
          ),
        )
        .filter((r) => r !== undefined)
        .map(resourceOwner);
      if (owners.length) {
        if (isDeepStrictEqual(work.resourceBlocked?.owners, owners)) continue;
        work.resourceBlocked = {
          owners,
          remainingMs:
            work.resourceBlocked?.remainingMs ??
            work.pauseBlocked?.remainingMs ??
            work.budgetBlocked?.remainingMs ??
            (work.availableUntil
              ? Math.max(0, Date.parse(work.availableUntil) - Date.now())
              : undefined),
        };
        work.availableUntil = undefined;
      } else {
        if (!work.resourceBlocked) continue;
        if (
          !work.budgetBlocked &&
          !work.pauseBlocked &&
          work.resourceBlocked.remainingMs !== undefined
        )
          work.availableUntil = new Date(
            Date.now() + work.resourceBlocked.remainingMs,
          ).toISOString();
        work.resourceBlocked = undefined;
      }
      this.store.put('work', work);
    }
  }
}
