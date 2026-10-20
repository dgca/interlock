import type { WorkRequest } from '@interlock/core';

type ManualClaim = Readonly<{
  token: string;
  workerId: string;
  attempt: number;
  leaseUntil: string;
}>;

// Application-lifetime credentials only. Never retain assignment bodies here.
const claims = new Map<string, ManualClaim>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const manualClaims = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get(id: string) {
    return claims.get(id);
  },
  forget(id: string) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    if (claims.delete(id)) notify();
  },
  remember(work: WorkRequest) {
    if (
      work.status !== 'claimed' ||
      !work.token ||
      !work.workerId ||
      !work.leaseUntil
    )
      return;
    // A late response from an older attempt cannot replace a newer claim.
    if ((claims.get(work.id)?.attempt ?? 0) > work.attempt) return;
    const remaining = Date.parse(work.leaseUntil) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      this.forget(work.id);
      return;
    }
    clearTimeout(timers.get(work.id));
    claims.set(
      work.id,
      Object.freeze({
        token: work.token,
        workerId: work.workerId,
        attempt: work.attempt,
        leaseUntil: work.leaseUntil,
      }),
    );
    const id = work.id;
    timers.set(
      id,
      setTimeout(() => this.forget(id), remaining),
    );
    notify();
  },
  observe(work: Omit<WorkRequest, 'token'>) {
    const claim = claims.get(work.id);
    if (!claim || work.attempt < claim.attempt) return;
    if (
      work.status !== 'claimed' ||
      work.attempt !== claim.attempt ||
      work.workerId !== claim.workerId
    ) {
      this.forget(work.id);
    } else if (
      work.leaseUntil &&
      Date.parse(work.leaseUntil) > Date.parse(claim.leaseUntil)
    ) {
      // A refreshed server snapshot can confirm a renewal whose response was lost.
      this.remember({ ...work, token: claim.token });
    }
  },
  token(id: string) {
    const claim = claims.get(id);
    if (!claim || Date.parse(claim.leaseUntil) <= Date.now()) {
      this.forget(id);
      throw new Error(
        'This page no longer holds an active claim. Refresh the run to check its status.',
      );
    }
    return claim.token;
  },
};

/** Remove recognizable old Interlock claims, including panels never revisited. */
export function removeLegacyManualClaims() {
  try {
    const storage = window.sessionStorage;
    for (const key of Object.keys(storage)) {
      if (!key.startsWith('claim:')) continue;
      try {
        const value = JSON.parse(storage.getItem(key) ?? 'null');
        if (
          value &&
          value.id === key.slice(6) &&
          value.workerId === 'manual-ui' &&
          typeof value.token === 'string' &&
          typeof value.runId === 'string' &&
          typeof value.prompt === 'string'
        )
          storage.removeItem(key);
      } catch {
        // Other applications can share this origin and use the same key prefix.
      }
    }
  } catch {
    // Embedded hosts may deny storage access. Claims never depend on it.
  }
}
