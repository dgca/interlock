import { z } from 'zod';

export const continueAsNewSchema = z
  .object({
    maxRuns: z
      .number()
      .int()
      .min(2)
      .max(10000)
      .describe('Total runs in this chain, including the first.'),
  })
  .strict();
export const runChainLinkSchema = z.object({
  rootRunId: z.string(),
  index: z.number().int().positive(),
  previousRunId: z.string().optional(),
  nextRunId: z.string().optional(),
});
export type RunChainLink = z.infer<typeof runChainLinkSchema>;
export interface RunChain {
  id: string;
  latestRunId: string;
  runCount: number;
  maxRuns: number;
  cancelledAt?: string;
}
export const cancelRunSchema = z.object({
  id: z.string().min(1),
  scope: z
    .enum(['run', 'chain'])
    .default('run')
    .describe(
      'run keeps existing descendant cancellation; chain stops the latest successor and prevents future continuation, from any chain member. Detached descendants remain independent.',
    ),
});
