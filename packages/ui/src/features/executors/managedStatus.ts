import type { WorkRequest } from '@interlock/core';

type Work = Pick<WorkRequest, 'managedExecution'> &
  Partial<Pick<WorkRequest, 'status'>>;
export function needsManagedAttention(work: Work) {
  return (
    work.managedExecution?.state === 'needs_human' ||
    (work.managedExecution?.state === 'needs_model' &&
      work.status === 'held') ||
    work.managedExecution?.state === 'interrupted'
  );
}
export function managedAttentionLabel(work: Work) {
  return work.managedExecution?.state === 'needs_model'
    ? 'Choose a model'
    : work.managedExecution?.state === 'interrupted'
      ? 'Recovery needed'
      : 'Waiting for your response';
}
