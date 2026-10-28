import { z } from 'zod';
const count = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
export const holdCategorySchema = z.enum([
  'provider_limit',
  'service_unavailable',
  'credentials',
  'other',
]);
const change = {
  workId: z.string().min(1),
  expectedAttempt: count,
  expectedRevision: count.describe(
    'Current holdRevision, or 0 before the first hold.',
  ),
  actor: z.string().trim().min(1).max(200),
};
export const workHoldRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...change,
      action: z.literal('hold'),
      category: holdCategorySchema,
      reason: z.string().trim().min(1).max(1000),
      checkpointRef: z.string().trim().min(1).max(2048),
      token: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ ...change, action: z.literal('resume') }).strict(),
  z
    .object({
      action: z.literal('history'),
      workId: z.string().min(1),
      offset: count.max(1_000_000).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
]);
export type WorkHoldRequest = z.input<typeof workHoldRequestSchema>;
export type WorkHoldChange = Exclude<
  z.infer<typeof workHoldRequestSchema>,
  { action: 'history' }
>;
export interface WorkHold {
  revision: number;
  category: z.infer<typeof holdCategorySchema>;
  reason: string;
  checkpointRef: string;
  actor: string;
  heldAt: string;
  remainingMs?: number;
}
export interface WorkHoldInterval extends WorkHold {
  id: string;
  workId: string;
  runId: string;
  executionId: string;
  attempt: number;
  endedAt?: string;
  endedBy?: string;
  endReason?: 'resumed' | 'cancelled';
}
export interface WorkHoldHistory {
  workId: string;
  items: WorkHoldInterval[];
  total: number;
  nextOffset: number | null;
  wallMs: number;
  declaredHeldMs: number;
  elapsedExcludingHoldsMs: number;
}
export class HoldDeadlineError extends Error {}
