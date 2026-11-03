import type { WorkRequest } from '@interlock/core';

type Work = Pick<WorkRequest, 'managedExecution'>;
export function needsManagedAttention(work: Work) {
  return (
    work.managedExecution?.state === 'needs_human' ||
    work.managedExecution?.state === 'interrupted'
  );
}
export function managedAttentionLabel(work: Work) {
  return work.managedExecution?.state === 'interrupted'
    ? 'Recovery needed'
    : 'Waiting for your response';
}
