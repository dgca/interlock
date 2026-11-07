import type { RunProjection, RunWaiting } from '@interlock/core';

const labels: Record<RunWaiting['kind'], string> = {
  claim_queue: 'Waiting for an agent',
  managed_launch: 'Waiting for managed launch',
  human_request: 'Person needed',
  input_node: 'Waiting for external input',
  hold: 'On hold',
  pause: 'Paused',
  budget: 'Budget blocked',
  resource: 'Waiting for a shared resource',
  timer: 'Waiting for a timer',
  poll: 'Waiting for a polling check',
  admission_queue: 'Queued for admission',
};
export function runProjectionText(run: RunProjection, waitingText?: string) {
  const actor = { agent: 'Agent', person: 'Person', engine: 'Engine' }[
    run.actor
  ];
  return [
    run.stage,
    run.waiting
      ? run.waiting.kind === 'admission_queue'
        ? `Queued · ${run.waiting.detail.message ?? `Position ${run.waiting.detail.position ?? 1}`}`
        : (waitingText ?? labels[run.waiting.kind])
      : null,
    actor,
  ]
    .filter(Boolean)
    .join(' · ');
}
