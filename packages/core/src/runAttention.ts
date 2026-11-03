/** Compact presentation data. Does not contain prompts, inputs, or claim tokens. */
export type RunAttentionReason = 'approval' | 'question' | 'recovery';
export type RunAttention = {
  runId: string;
  reasons: RunAttentionReason[];
  target: { runId: string; executionId: string };
};
