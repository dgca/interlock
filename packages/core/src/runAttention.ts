/** Compact presentation data. Does not contain prompts, inputs, or claim tokens. */
export type RunAttentionReason =
  'approval' | 'question' | 'model' | 'recovery' | 'stalled';
export type RunAttention = {
  runId: string;
  reasons: RunAttentionReason[];
  target: { runId: string; executionId: string };
};
