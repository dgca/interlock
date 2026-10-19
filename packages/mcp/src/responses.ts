import { z } from 'zod';
import {
  mutationSummarySchema,
  submissionSummarySchema,
} from '@interlock/core';

// SDK v1 requires an object root, so discovery describes both modes' fields.
// Required compact fields are validated by the runtime's complete summary schema.
// Legacy payloads stay open-ended and are never transformed by these schemas.
const inspectionFields = {
  run: z
    .object({ id: z.string(), status: mutationSummarySchema.shape.runStatus })
    .passthrough()
    .optional(),
  counterpartRunId: z.string().optional(),
  descendants: z.array(z.record(z.unknown())).optional(),
  descendantWork: z.array(z.record(z.unknown())).optional(),
  definition: z.record(z.unknown()).nullable().optional(),
  definitionAvailable: z.boolean().optional(),
  work: z.array(z.record(z.unknown())).optional(),
  events: z.array(z.record(z.unknown())).optional(),
  children: z.array(z.record(z.unknown())).optional(),
};

export const startResponseSchema = z
  .object({
    ...inspectionFields,
    ...mutationSummarySchema.partial().shape,
  })
  .describe(
    'full or omitted detail returns inspection with run, definition, work, descendants and events. summary returns all compact fields: ok, runId, runStatus, cursor, nextWork, next, nextDeadline.',
  );

export const submitResponseSchema = z
  .object({
    ...inspectionFields,
    ...submissionSummarySchema.partial().shape,
  })
  .describe(
    'Same modes as start_run. summary additionally requires workId and workRunId. Full retains the original work-owning run inspection.',
  );

export const workListResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          runId: z.string(),
          nodeId: z.string(),
          label: z.string(),
          status: z.literal('available'),
          context: z.object({
            mode: z.enum(['current', 'fresh']),
            tools: z.array(z.string()),
            skills: z.array(z.string()),
            instructions: z.string().optional(),
          }),
          attempt: z.number().int().nonnegative(),
          maxAttempts: z.number().int().positive(),
          availableUntil: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .describe(
    'Structured wrapper for the JSON text array. full items include prompt/input/output contract; summary items include run ancestry and omit those bodies.',
  );
