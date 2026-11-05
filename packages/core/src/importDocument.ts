import { z } from 'zod';
import { definitionSchema, InterlockError } from './index.js';
import { workflowBundleSchema } from './transfer.js';
import { variableReferences } from './variables.js';

export const legacyImportSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().default(''),
    definition: definitionSchema.optional(),
    ownerWorkflowId: z.string().min(1).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.definition && variableReferences(value.definition).length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Variable references require a format 4 portable bundle with explicit local bindings. Export the workflow as a bundle.',
      });
  });

export function parseImportDocument(data: unknown) {
  if (data && typeof data === 'object' && 'format' in data)
    return {
      kind: 'bundle' as const,
      bundle: workflowBundleSchema.parse(data),
    };
  return { kind: 'legacy' as const, workflow: legacyImportSchema.parse(data) };
}
export type ImportDocument = ReturnType<typeof parseImportDocument>;

/** Preserve legacy payloads for server validation while rejecting implicit credential attachment. */
export function assertLegacyVariableFree(data: unknown) {
  const definition =
    data && typeof data === 'object' && 'definition' in data
      ? data.definition
      : undefined;
  const parsed = definitionSchema.safeParse(definition);
  if (parsed.success && variableReferences(parsed.data).length)
    throw new InterlockError(
      'Variable references require a format 4 portable bundle with explicit local bindings. Export the workflow as a bundle.',
    );
}
