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

export type HistorySelection = z.input<typeof historyPreviewSchema>;
export type HistoryDeletion = z.infer<typeof historyDeletionSchema>;

export const retentionPolicySchema = z
  .object({
    maxAgeDays: z
      .number()
      .int()
      .min(1)
      .max(36500)
      .optional()
      .describe(
        'Expire when every tree member was last updated before this many days ago.',
      ),
    maxCompletedRuns: z
      .number()
      .int()
      .min(0)
      .max(1000000)
      .optional()
      .describe(
        'Retain newest terminal whole trees in this scope pool; zero keeps none. Protected trees count but cannot be deleted.',
      ),
  })
  .strict()
  .refine(
    (policy) =>
      policy.maxAgeDays !== undefined || policy.maxCompletedRuns !== undefined,
    'Set at least one retention threshold',
  );
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
export const retentionScopeSchema = z
  .object({
    workflowId: runId
      .optional()
      .describe(
        'Workflow override; omit for library policy. Children follow their root workflow.',
      ),
  })
  .strict();
export const retentionUpdateSchema = retentionScopeSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  policy: z
    .union([retentionPolicySchema, z.null(), z.literal('inherit')])
    .describe(
      'Whole policy replacement. null disables; inherit removes a workflow override. Enabling authorizes permanent scheduled history deletion.',
    ),
});
export interface RetentionSettings {
  scope: 'library' | 'workflow';
  workflowId?: string;
  revision: number;
  policy?: RetentionPolicy | null;
  effectivePolicy: RetentionPolicy | null;
  inherited: boolean;
}
export interface RetentionState {
  id: string;
  nextCheckAt: string | null;
  lastSweep: {
    checkedAt: string;
    candidates: number;
    protectedTrees: number;
    deletedRoots: number;
    deletedRuns: number;
    removedDocumentBytes: number;
  } | null;
  lastError: string | null;
}

export const historyRequestSchema = z
  .object({
    request: z.discriminatedUnion('action', [
      historyPreviewSchema.extend({ action: z.literal('preview') }),
      historyDeletionSchema.extend({ action: z.literal('delete') }),
      retentionScopeSchema.extend({ action: z.literal('settings') }),
      retentionUpdateSchema.extend({ action: z.literal('configure') }),
      z.object({ action: z.literal('status') }).strict(),
    ]),
  })
  .strict();
