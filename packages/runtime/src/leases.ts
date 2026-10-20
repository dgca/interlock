import { createHash } from 'node:crypto';
import type { WorkRequest } from '@interlock/core';

export const claimTokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export function leaseCounts(work: WorkRequest) {
  return work.maxLeaseExpiries === undefined
    ? `attempt ${work.attempt}/${work.maxAttempts}`
    : `claim ${work.attempt}, failures ${work.failureCount ?? 0}/${work.maxAttempts}, expiries ${work.leaseExpiryCount ?? 0}/${work.maxLeaseExpiries}`;
}

export function expiredClaimMessage(
  work: WorkRequest,
  token: string,
  runStatus: string,
) {
  const receipt = work.expiredClaims?.find(
    (r) => r.tokenHash === claimTokenHash(token),
  );
  if (!receipt) return undefined;
  const prefix = `Claim expired at ${receipt.expiredAt}; ${leaseCounts(work)}. `;
  if (work.status === 'failed')
    return (
      prefix +
      `Assignment failed: ${work.error ?? 'retry budget exhausted'}. Inspect the run before explicitly retrying the failed step.`
    );
  if (
    work.status === 'cancelled' ||
    work.status === 'timed_out' ||
    work.status === 'completed'
  )
    return (
      prefix +
      `Assignment is ${work.status}; it cannot be reclaimed. Inspect the existing run.`
    );
  if (['failed', 'cancelled', 'completed'].includes(runStatus))
    return (
      prefix +
      `Run is ${runStatus}; this assignment cannot continue. Inspect the existing run.`
    );
  if (receipt.attempt < work.attempt)
    return (
      prefix +
      'The assignment was reclaimed after this claim expired; this token is invalid. Rediscover work and inspect the current assignment before continuing.'
    );
  if (work.status === 'available')
    return (
      prefix +
      'The assignment is currently available again. Call claim_work (CLI: interlock claim) to obtain a new token before submitting or renewing. Availability can change before the claim. Preserve completed work and check for external side effects before repeating it.'
    );
  return (
    prefix +
    'This token is no longer active. Inspect the existing run and rediscover work.'
  );
}
