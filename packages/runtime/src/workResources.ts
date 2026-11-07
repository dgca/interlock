import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  type ResourceOwner,
  type ResourceReservation,
  type WorkRequest,
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
    if (records.some((r) => r.state !== 'uncertain'))
      throw new InterlockError(
        'Reservation still has an active claim. Hold or cancel that attempt before confirming it stopped.',
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
      workId,
      attempt,
      released: records.length,
    };
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
      if (r.state === 'uncertain') continue;
      const work = this.store.get<WorkRequest>('work', r.workId);
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
