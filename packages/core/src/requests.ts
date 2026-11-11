import { z } from 'zod';
import { jsonSchema, type Json } from './index.js';
import { startRequestIdSchema } from './runStarts.js';

const id = z.string().min(1).max(300);
const step = { runId: id, executionId: id };
const managed = { ...step, managedExecutionId: id };
const human = z.object({ kind: z.literal('human'), ...step }).strict();
export const requestTargetSchema = z.discriminatedUnion('kind', [
  human,
  z
    .object({ kind: z.literal('permission'), ...managed, requestId: id })
    .strict(),
  z.object({ kind: z.literal('question'), ...managed, requestId: id }).strict(),
  z.object({ kind: z.literal('model'), ...managed }).strict(),
  z.object({ kind: z.literal('recovery'), ...managed }).strict(),
  z
    .object({
      kind: z.literal('resource'),
      ...step,
      workId: id.optional(),
      attempt: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('script'), ...step }).strict(),
  z
    .object({
      kind: z.literal('stalled'),
      runId: id,
      executionId: id.optional(),
      stallId: id,
    })
    .strict(),
]);
export type RequestTarget = z.infer<typeof requestTargetSchema>;
export function requestKey(target: RequestTarget) {
  return JSON.stringify([
    target.kind,
    target.runId,
    target.executionId,
    'managedExecutionId' in target ? target.managedExecutionId : undefined,
    'requestId' in target
      ? target.requestId
      : 'stallId' in target
        ? target.stallId
        : undefined,
    'attempt' in target ? target.attempt : undefined,
    'workId' in target ? target.workId : undefined,
  ]);
}

export const requestListSchema = z
  .object({
    boardId: id.optional(),
    runId: id.optional(),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type RequestList = z.infer<typeof requestListSchema>;
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const value = z
  .unknown()
  .refine(
    (value): value is Json => jsonSchema.safeParse(value).success,
    'Expected a JSON value',
  );
export const humanResponseSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('answer'),
      target: human,
      expectedRevision: revision.describe(
        'Current revision from get. Use 0 for a new Human input request.',
      ),
      submissionId: startRequestIdSchema.describe(
        'Stable key for replaying an identical submission after uncertain delivery.',
      ),
      value: value.describe(
        'Text for text answers, or {choice, comment?} for single choice. Use the output value of the selected choice.',
      ),
    })
    .strict(),
  z
    .object({
      action: z.literal('accept'),
      target: human,
      expectedRevision: revision.min(1),
    })
    .strict(),
]);
export type HumanResponse = z.infer<typeof humanResponseSchema>;
export const workflowRequestSchema = z.discriminatedUnion('action', [
  requestListSchema.extend({ action: z.literal('list') }),
  z.object({ action: z.literal('get'), target: requestTargetSchema }).strict(),
  ...humanResponseSchema.options,
]);
export type RequestSummary = {
  cardId: string;
  target: RequestTarget;
  label: string;
  since: string;
};
