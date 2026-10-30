import { z } from 'zod';
import {
  continuitySchema,
  continuityGroupSchema,
  resultCheckSchema,
  resultRulesSchema,
  mutationSummarySchema,
  submissionSummarySchema,
  mutationDetailSchema,
  nextCallSchema,
  authoringSummarySchema,
  draftDiagnosticSchema,
  diagnosticSummarySchema,
  jsonSchema,
  contextPolicySchema,
  modelTierSchema,
  modelSelectionSchema,
} from '@interlock/core';

export const mcpMutationDetailSchema = mutationDetailSchema
  .default('summary')
  .describe(
    'summary (default) returns run status, bounded next work, a wait cursor and suggested next call. full includes the workflow definition, execution history and input/output payloads. Read selected values with get_run_result, or inspect an existing run with get_run instead of starting it again.',
  );

export { withNextCall } from '@interlock/core';

// SDK v1 requires an object root, so discovery describes both modes' fields.
// Required compact fields are validated by the runtime's complete summary schema.
// Legacy payloads stay open-ended and are never transformed by these schemas.
const inspectionFields = {
  run: z
    .object({ id: z.string(), status: mutationSummarySchema.shape.runStatus })
    .passthrough()
    .optional(),
  counterpartRunId: z.string().optional(),
  handledFailure: z
    .object({ runId: z.string(), executionId: z.string() })
    .optional(),
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
    resultCheck: resultCheckSchema.optional(),
    nextCall: nextCallSchema.optional(),
  })
  .describe(
    'Errors return isError:true and structured resultCheck instead of success fields. summary (default) requires ok, runId, runStatus, cursor, nextWork, next, nextDeadline, nextCall, workId and workRunId. runId identifies the continuation lifecycle; workRunId identifies the assignment run. full returns the work-owning run inspection with definition, executions, input/output payloads, work and events.',
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
          continuity: continuitySchema.optional(),
          context: z.object({
            tier: modelTierSchema.optional(),
            continuityGroup: continuityGroupSchema.optional(),
            mode: z.enum(['current', 'fresh']),
            tools: z.array(z.string()),
            skills: z.array(z.string()),
            instructions: z.string().optional(),
          }),
          attempt: z.number().int().nonnegative(),
          maxAttempts: z.number().int().positive(),
          maxLeaseExpiries: z.number().int().min(1).max(10).optional(),
          failureCount: z.number().int().nonnegative().optional(),
          leaseExpiryCount: z.number().int().nonnegative().optional(),
          holdRevision: z.number().int().nonnegative().optional(),
          heldClaimCount: z.number().int().nonnegative().optional(),
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

export const authoringDetailSchema = z
  .enum(['full', 'summary'])
  .default('full')
  .describe(
    'Use summary for an acknowledgment with id, draftRevision, latestVersion, draftMatchesLatest and archived, without a definition. full (default) returns the workflow record and draft. Read get_workflow when you need the full definition.',
  );
export const authoringResponseSchema = z
  .object({
    ...authoringSummarySchema.omit({ ok: true, draftMatchesLatest: true })
      .shape,
    ok: z.literal(true).optional(),
    draftMatchesLatest: z.boolean().nullable().optional(),
    draft: z.record(z.unknown()).optional(),
  })
  .passthrough()
  .describe(
    'Summary requires ok and draftMatchesLatest; full includes draft and workflow metadata.',
  );
const changeIds = z.object({
  added: z.array(z.string()),
  updated: z.array(z.string()),
  removed: z.array(z.string()),
});
export const editResponseSchema = z.object({
  applied: z.boolean(),
  draftRevision: z.number().int().positive(),
  changes: z.object({
    nodes: changeIds,
    edges: changeIds,
    settings: z.array(z.string()),
  }),
  diagnostics: z.array(draftDiagnosticSchema),
  diagnosticSummary: diagnosticSummarySchema.optional(),
});
export const claimResponseSchema = z
  .object({
    id: z.string(),
    runId: z.string(),
    executionId: z.string(),
    nodeId: z.string(),
    label: z.string(),
    status: z.literal('claimed'),
    token: z.string(),
    workerId: z.string(),
    leaseUntil: z.string(),
    claimLeaseSeconds: z.number().int().min(10).max(3600),
    leaseSeconds: z.number().int().min(10).max(3600).optional(),
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    maxLeaseExpiries: z.number().int().min(1).max(10).optional(),
    failureCount: z.number().int().nonnegative().optional(),
    leaseExpiryCount: z.number().int().nonnegative().optional(),
    holdRevision: z.number().int().nonnegative().optional(),
    heldClaimCount: z.number().int().nonnegative().optional(),
    prompt: z.string(),
    input: jsonSchema,
    outputSchema: z.record(z.unknown()),
    resultRules: resultRulesSchema.optional(),
    context: contextPolicySchema,
    modelSelection: modelSelectionSchema.optional(),
    continuity: continuitySchema.optional(),
    executionInstructions: z.string().optional(),
  })
  .passthrough();
