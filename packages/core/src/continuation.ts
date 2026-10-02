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
      'Opaque cursor from the preceding briefing or wait for this run. Invalid or restarted cursors recover with reset:true.',
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
