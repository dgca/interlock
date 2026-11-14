import { z } from 'zod';

export const runStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
]);

/** Run ID of the last item already read; the next page starts after it. */
export const runPageCursorSchema = z.string().min(1);

/** Full run records, newest first. The default page returns small stores whole. */
export const runListQuerySchema = z.object({
  limit: z.number().int().min(1).max(1000).default(1000),
  afterRunId: runPageCursorSchema.optional(),
});
