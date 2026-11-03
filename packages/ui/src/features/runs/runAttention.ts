import type { RunAttention } from '@interlock/core';
export type RunTab = 'active' | 'attention' | 'history';
export const runTab = (value: string | null): RunTab =>
  value === 'history' || value === 'attention' ? value : 'active';
export function attentionText(entry: RunAttention) {
  const labels = {
    approval: 'Approval requested',
    question: 'Answer needed',
    recovery: 'Recovery needed',
  };
  return entry.reasons.map((reason) => labels[reason]).join(' · ');
}
