import { z } from 'zod';

const scope = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('library') }).strict(),
  z
    .object({ scope: z.literal('workflow'), workflowId: z.string().min(1) })
    .strict(),
]);
export const pauseCreateSchema = z
  .object({
    target: scope,
    actor: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const pauseListSchema = z
  .object({
    scope: z
      .enum(['library', 'workflow'])
      .optional()
      .describe('Optional scope filter. workflow requires workflowId.'),
    workflowId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Include library holds and holds for this workflow; omission lists library holds only.',
      ),
    offset: z.number().int().min(0).max(1_000_000).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export const pauseResumeSchema = z.object({ id: z.string().min(1) }).strict();
export const pauseRequestSchema = z.discriminatedUnion('action', [
  pauseListSchema.extend({ action: z.literal('list') }),
  pauseCreateSchema.extend({ action: z.literal('pause') }),
  pauseResumeSchema.extend({ action: z.literal('resume') }),
]);
export type PauseCreate = z.input<typeof pauseCreateSchema>;
export type PauseList = z.input<typeof pauseListSchema>;
export interface PauseHold {
  id: string;
  scope: 'library' | 'workflow';
  workflowId?: string;
  actor: string;
  reason: string;
  createdAt: string;
  releasedAt?: string;
}
export interface PauseBlock {
  since: string;
  remainingMs?: number;
}

/** Union intervals before subtraction so overlapping independent holds count once. */
export function elapsedExcludingPausesMs(
  start: number,
  end: number,
  holds: PauseHold[],
) {
  let pausedMs = 0,
    until = start;
  const intervals = holds
    .map((h) => [
      Math.max(start, Date.parse(h.createdAt)),
      Math.min(end, h.releasedAt ? Date.parse(h.releasedAt) : end),
    ])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  for (const [a, b] of intervals) {
    pausedMs += Math.max(0, b - Math.max(until, a));
    until = Math.max(until, b);
  }
  return {
    wallMs: Math.max(0, end - start),
    pausedMs,
    activeMs: Math.max(0, end - start - pausedMs),
  };
}
