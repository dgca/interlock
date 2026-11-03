import { z } from 'zod';

const runId = z.string().min(1).max(256);
export const historyPreviewSchema = z
  .object({
    workflowId: runId
      .optional()
      .describe(
        'Filter by the root workflow. Descendants remain part of its tree.',
      ),
    before: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe(
        'Only trees whose runs were all last updated before this timestamp.',
      ),
    rootRunIds: z
      .array(runId)
      .min(1)
      .max(100)
      .optional()
      .describe(
        'Exact tree or chain roots. Child runs and later chain members cannot be deleted separately.',
      ),
    offset: z.number().int().min(0).max(1000000).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();

export const historyDeletionSchema = z
  .object({
    roots: z
      .array(
        z
          .object({
            runId,
            confirmation: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .describe(
                'This root’s confirmation from a current eligible preview. Changed history requires a fresh preview.',
              ),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    acknowledgeHistoryLoss: z
      .literal(true)
      .describe(
        'Explicitly acknowledge permanent loss of selected run trees, values, work, usage and audit history. Workflows and published versions are preserved.',
      ),
  })
  .strict();

export const historyRequestSchema = z
  .object({
    request: z.discriminatedUnion('action', [
      historyPreviewSchema.extend({ action: z.literal('preview') }),
      historyDeletionSchema.extend({ action: z.literal('delete') }),
    ]),
  })
  .strict();

export type HistorySelection = z.input<typeof historyPreviewSchema>;
export type HistoryDeletion = z.infer<typeof historyDeletionSchema>;
