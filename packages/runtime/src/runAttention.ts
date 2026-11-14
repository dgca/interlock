import type {
  RequestSummary,
  RunAttention,
  RunAttentionReason,
} from '@interlock/core';

/** The legacy run summary retains a representative step for existing callers. */
export function runAttention(requests: RequestSummary[]): RunAttention[] {
  const result = new Map<string, RunAttention>();
  for (const { cardId, target, reason: stated } of requests) {
    if (!target.executionId) continue;
    const reason: RunAttentionReason =
      (stated ?? target.kind === 'permission')
        ? 'approval'
        : target.kind === 'resource' || target.kind === 'script'
          ? 'recovery'
          : target.kind === 'launcher'
            ? 'stalled'
            : target.kind;
    const entry = result.get(cardId);
    if (entry) {
      if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    } else {
      result.set(cardId, {
        runId: cardId,
        reasons: [reason],
        target: { runId: target.runId, executionId: target.executionId },
      });
    }
  }
  return [...result.values()];
}
