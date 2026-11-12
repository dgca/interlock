import type { RunProjection, RunStatus, RunWaiting } from '@interlock/core';

const labels: Record<RunWaiting['kind'], string> = {
  claim_queue: 'Waiting for an agent',
  managed_launch: 'Waiting for managed launch',
  human_request: 'Waiting for your response',
  input_node: 'Waiting for external input',
  hold: 'On hold',
  pause: 'Paused',
  budget: 'Budget blocked',
  resource: 'Waiting for a shared resource',
  timer: 'Waiting for a timer',
  poll: 'Waiting for a polling check',
  admission_queue: 'Queued for admission',
};
export function runDisplayStatus({
  status,
  waiting,
}: {
  status: RunStatus;
  waiting?: RunWaiting | null;
}): RunStatus {
  if ((status !== 'waiting' && status !== 'running') || waiting === undefined)
    return status;
  // A claim leaves the stored status waiting while the projected work can run.
  return waiting ? 'waiting' : 'running';
}

export function runProjectionLabels(run: RunProjection, waitingText?: string) {
  const actor = { agent: 'Agent', person: 'Person', engine: 'Engine' }[
    run.actor
  ];
  const waiting = run.waiting;
  const reason =
    waiting?.kind === 'human_request' && !waiting.detail.workId
      ? 'Human input needed'
      : waiting
        ? labels[waiting.kind]
        : null;
  return {
    stage: run.stage,
    waiting:
      waiting?.kind === 'admission_queue'
        ? `Queued · ${waiting.detail.message ?? `Position ${waiting.detail.position ?? 1}`}`
        : (waitingText ?? reason),
    activity: !waiting && run.actor === 'agent' ? 'Agent working' : null,
    actor,
  };
}

export function runProjectionText(run: RunProjection, waitingText?: string) {
  const labels = runProjectionLabels(run, waitingText);
  return [
    labels.stage,
    labels.waiting ?? labels.activity,
    labels.activity ? null : labels.actor,
  ]
    .filter(Boolean)
    .join(' · ');
}
