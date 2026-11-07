import { z } from 'zod';

export const runWaitingSchema = z.object({
  kind: z.enum([
    'claim_queue',
    'managed_launch',
    'human_request',
    'input_node',
    'hold',
    'pause',
    'budget',
    'resource',
    'timer',
    'poll',
    'admission_queue',
  ]),
  detail: z.object({
    runId: z.string(),
    nodeId: z.string(),
    executionId: z.string().optional(),
    workId: z.string().optional(),
    message: z.string().max(500).optional(),
    pauseCount: z.number().int().optional(),
    resumeAt: z.string().optional(),
    nextCheckAt: z.string().optional(),
    timeoutAt: z.string().optional(),
    lastCheck: z
      .object({
        count: z.number(),
        at: z.string(),
        output: z.string().max(512).optional(),
        truncated: z.boolean(),
        error: z.string().max(500).optional(),
      })
      .optional(),
  }),
  since: z.string(),
});
export const runProjectionSchema = z.object({
  stage: z.string().nullable(),
  waiting: runWaitingSchema.nullable(),
  actor: z.enum(['agent', 'person', 'engine']),
});
export type RunWaiting = z.infer<typeof runWaitingSchema>;
export type RunProjection = z.infer<typeof runProjectionSchema>;
