import { z } from 'zod';

export const resourceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[^\x00-\x1f\x7f]+$/,
    'Resource names cannot contain control characters',
  );
export const resourceNamesSchema = z
  .array(resourceNameSchema)
  .min(1)
  .max(8)
  .superRefine((names, ctx) => {
    if (new Set(names).size !== names.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Resource requirements must be distinct',
      });
  });
export const resourceOwnerSchema = z.object({
  name: resourceNameSchema,
  workId: z.string().optional(),
  executionId: z.string().optional(),
  runId: z.string(),
  attempt: z.number().int().positive(),
  state: z.enum(['claimed', 'uncertain']),
  acquiredAt: z.string(),
  reason: z.string().optional(),
});
export type ResourceOwner = z.infer<typeof resourceOwnerSchema>;
/** Internal reservation. Never return tokenHash in inspection or tool responses. */
export interface ResourceReservation extends ResourceOwner {
  id: string;
  tokenHash: string;
}
export interface ResourceBlock {
  owners: ResourceOwner[];
  remainingMs?: number;
  since?: string;
}
const executionTarget = {
  runId: z.string().min(1),
  executionId: z.string().min(1),
};
const releaseFields = {
  expectedAttempt: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
  confirmStopped: z
    .literal(true)
    .describe(
      'Attest that this exact attempt and its subprocesses have stopped using every reserved resource. Cancellation or interruption alone is insufficient.',
    ),
  actor: z.string().trim().min(1).max(200),
};
export const workResourceRequestSchema = z.union([
  z
    .object({ action: z.literal('inspect'), workId: z.string().min(1) })
    .strict(),
  z.object({ action: z.literal('inspect'), ...executionTarget }).strict(),
  z
    .object({
      action: z.literal('release'),
      workId: z.string().min(1),
      ...releaseFields,
    })
    .strict(),
  z
    .object({
      action: z.literal('release'),
      ...executionTarget,
      ...releaseFields,
    })
    .strict(),
]);
export type WorkResourceRequest = z.input<typeof workResourceRequestSchema>;
