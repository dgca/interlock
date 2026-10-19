import { z } from 'zod';

export const briefingQuerySchema = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      'Requested run ID. Includes all descendants; detached lifecycle boundaries remain explicit.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe(
      'Maximum records in each snapshot list. Totals and progress remain complete.',
    ),
});
export const waitQuerySchema = briefingQuerySchema.extend({
  cursor: z
    .string()
    .max(2048)
    .describe(
      'Opaque cursor from a briefing, wait, or summary-mode mutation for this runId. Invalid or restarted cursors recover with reset:true.',
    ),
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(60000)
    .default(30000)
    .describe(
      'Finite wait in milliseconds. Zero checks immediately. Configure the client request timeout above this duration.',
    ),
});
export const resultQuerySchema = z.object({
  id: z.string().min(1).describe('Run containing the requested data.'),
  executionId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Execution reference from the briefing. Omit for the run input/output.',
    ),
  field: z
    .enum(['input', 'output'])
    .default('output')
    .describe('Persisted field to read. Unavailable outputs return an error.'),
  path: z
    .string()
    .max(2048)
    .default('')
    .describe(
      'Dot-separated keys or array indices; blank selects the whole field.',
    ),
  maxBytes: z
    .number()
    .int()
    .min(1)
    .max(262144)
    .default(65536)
    .describe(
      'Maximum UTF-8 JSON bytes of the selected value. Oversized selections error; narrow the path.',
    ),
});
export type BriefingQuery = z.infer<typeof briefingQuerySchema>;
export type WaitQuery = z.infer<typeof waitQuerySchema>;
export type ResultQuery = z.infer<typeof resultQuerySchema>;

export const continuationLimitSchema = briefingQuerySchema.shape.limit;
export const mutationDetailSchema = z
  .enum(['full', 'summary'])
  .default('full')
  .describe(
    'Use summary for compact continuation without definitions or execution payloads. Omission and full preserve the original inspection response.',
  );
export const continuationWorkSchema = z.object({
  id: z.string(),
  runId: z.string(),
  executionId: z.string(),
  workflowId: z.string(),
  parentRunId: z.string().optional(),
  parentMode: z.literal('detached').optional(),
  rootRunId: z.string(),
  rootWorkflowId: z.string(),
  lifecycleRunId: z.string(),
  nodeId: z.string(),
  label: z.string(),
  status: z.literal('available'),
  context: z.object({
    mode: z.enum(['current', 'fresh']),
    tools: z.array(z.string()),
    skills: z.array(z.string()),
  }),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  workerId: z.string().optional(),
  leaseUntil: z.string().optional(),
  availableUntil: z.string().optional(),
});
export const mutationSummarySchema = z.object({
  ok: z.literal(true),
  runId: z
    .string()
    .describe(
      'Continuation lifecycle ID. Use with the returned cursor for wait_for_run_change.',
    ),
  runStatus: z.enum(['running', 'waiting', 'completed', 'failed', 'cancelled']),
  cursor: z.string(),
  nextWork: z.object({
    items: z.array(continuationWorkSchema).max(100),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  next: z.enum([
    'claim_work',
    'wait_for_worker',
    'wait_for_change',
    'inspect_failure',
    'inspect_result',
  ]),
  nextDeadline: z
    .object({
      runId: z.string(),
      executionId: z.string().optional(),
      workId: z.string().optional(),
      kind: z.enum([
        'wait',
        'poll_check',
        'poll_timeout',
        'unclaimed',
        'claim_lease',
      ]),
      at: z.string(),
    })
    .nullable(),
});
export const submissionSummarySchema = mutationSummarySchema.extend({
  workId: z.string(),
  workRunId: z
    .string()
    .describe(
      'Run owning the submitted assignment. May differ from the continuation runId.',
    ),
});
