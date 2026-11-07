import type { RunAttention, RunSummary } from '@interlock/core';
export type RunTab = 'active' | 'attention' | 'history';
export const runTab = (value: string | null): RunTab =>
  value === 'history' || value === 'attention' ? value : 'active';
export function attentionText(entry: RunAttention) {
  const labels = {
    approval: 'Approval requested',
    question: 'Answer needed',
    model: 'Choose a model',
    recovery: 'Recovery needed',
  };
  return entry.reasons.map((reason) => labels[reason]).join(' · ');
}

export const waitReasonText: Record<
  NonNullable<RunSummary['waitReason']>,
  string
> = {
  held: 'Assignment on hold',
  agent: 'Waiting for an agent',
  managed: 'Waiting for a harness',
  claimed: 'Agent working',
  external_input: 'External input needed',
  external_review: 'Review external input',
  timer: 'Waiting for a timer',
  child: 'Waiting for a child run',
};
