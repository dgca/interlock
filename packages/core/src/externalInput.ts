import { z } from 'zod';
import { jsonSchema, type Json } from './index.js';
import { startRequestIdSchema } from './runStarts.js';

const runId = z.string().min(1);
const target = { runId, executionId: z.string().min(1) };
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
// Validate without rebuilding records. Idempotency hashes must retain every JSON key.
const submittedJson = z
  .unknown()
  .refine(
    (value): value is Json => jsonSchema.safeParse(value).success,
    'Expected a JSON value',
  );
const submit = z
  .object({
    action: z.literal('submit'),
    ...target,
    value: submittedJson,
    requestId: startRequestIdSchema,
    expectedRevision: revision.optional(),
  })
  .strict();
const accept = z
  .object({
    action: z.literal('accept'),
    ...target,
    expectedRevision: revision.min(1),
  })
  .strict();
const hold = z
  .object({ action: z.literal('hold'), runId, expectedRevision: revision })
  .strict();
const release = hold.extend({ action: z.literal('release') });
export const externalInputMutationSchema = z.discriminatedUnion('action', [
  submit,
  accept,
  hold,
  release,
]);
export const externalInputStatusSchema = z
  .object({
    action: z.literal('status'),
    runId,
    executionId: target.executionId.optional(),
    includeValue: z.boolean().optional(),
  })
  .strict();
export const externalInputRequestSchema = z.discriminatedUnion('action', [
  externalInputStatusSchema,
  submit,
  accept,
  hold,
  release,
]);

export type ExternalInputMutation = z.infer<typeof externalInputMutationSchema>;
export type ExternalInputStatusQuery = z.infer<
  typeof externalInputStatusSchema
>;
export type ExternalInputMetadata = {
  revision: number;
  submittedAt?: string;
  acceptedAt?: string;
  source?: import('./humanInput.js').HumanAnswerSource;
};
export type ExternalInputHold = { revision: number; heldAt?: string };
