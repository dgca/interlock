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

/** Labels for a managed attempt's state in the execution panel. */
export const managedStateLabels = {
  starting: 'Starting',
  running: 'Working',
  needs_human: 'Waiting for you',
  needs_model: 'Choose a model',
  completed: 'Completed',
  failed: 'Attempt ended',
  interrupted: 'Recovery needed',
  held: 'Stopped at budget',
};
