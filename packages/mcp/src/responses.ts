import { z } from 'zod';
import {
  mutationSummarySchema,
  submissionSummarySchema,
  mutationDetailSchema,
  briefingQuerySchema,
  resultQuerySchema,
  waitQuerySchema,
} from '@interlock/core';

export const mcpMutationDetailSchema = mutationDetailSchema
  .default('summary')
  .describe(
    'summary (default) returns run status, bounded next work, a wait cursor and suggested next call. full includes the workflow definition, execution history and input/output payloads. Read selected values with get_run_result, or inspect an existing run with get_run instead of starting it again.',
  );

const nextCallSchema = z
  .discriminatedUnion('tool', [
    z.object({
      tool: z.literal('get_run_result'),
      arguments: resultQuerySchema.pick({ id: true }),
    }),
    z.object({
      tool: z.literal('get_run_briefing'),
      arguments: briefingQuerySchema.pick({ id: true }),
    }),
    z.object({
      tool: z.literal('wait_for_run_change'),
      arguments: waitQuerySchema.pick({ id: true, cursor: true }),
    }),
  ])
  .nullable()
  .describe(
    'Suggested read-only call, not an executed action. null when next is claim_work: choose from nextWork and claim with your own workerId and actual capabilities. A completed run can still have independent detached work. Result reads use the default byte limit; select a narrower path if the value exceeds it.',
  );

export function withNextCall<T extends z.infer<typeof mutationSummarySchema>>(
  summary: T,
): T & { nextCall: z.infer<typeof nextCallSchema> } {
  const id = summary.runId;
  let nextCall: z.infer<typeof nextCallSchema> = null;
  switch (summary.next) {
    case 'inspect_result':
      nextCall = {
        tool:
          summary.runStatus === 'completed'
            ? 'get_run_result'
            : 'get_run_briefing',
        arguments: { id },
      };
      break;
    case 'inspect_failure':
      nextCall = { tool: 'get_run_briefing', arguments: { id } };
      break;
    case 'wait_for_worker':
    case 'wait_for_change':
      nextCall = {
        tool: 'wait_for_run_change',
        arguments: { id, cursor: summary.cursor },
      };
      break;
  }
  return { ...summary, nextCall };
}

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
    nextCall: nextCallSchema.optional(),
  })
  .describe(
    'summary (default) requires ok, runId, runStatus, cursor, nextWork, next, nextDeadline and nextCall. full returns inspection with run, definition, work, descendants and events, including execution input/output payloads.',
  );

export const submitResponseSchema = z
  .object({
    ...inspectionFields,
    ...submissionSummarySchema.partial().shape,
    nextCall: nextCallSchema.optional(),
  })
  .describe(
    'summary (default) requires ok, runId, runStatus, cursor, nextWork, next, nextDeadline, nextCall, workId and workRunId. runId identifies the continuation lifecycle; workRunId identifies the assignment run. full returns the work-owning run inspection with definition, executions, input/output payloads, work and events.',
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
          leaseSeconds: z
            .number()
            .int()
            .min(10)
            .max(3600)
            .optional()
            .describe(
              'Configured Agent claim duration. A claim override wins; omission here means 300 seconds.',
            ),
          availableUntil: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .describe(
    'Structured wrapper for the JSON text array. summary (default) items include identity, run ancestry, label, context requirements, attempts and any unclaimed deadline. full items also include the composed prompt, captured saved prompts, input and output contract.',
  );
