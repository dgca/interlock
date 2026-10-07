import { z } from 'zod';
import { definitionSchema } from './index.js';
import { workflowBundleSchema } from './transfer.js';

export const legacyImportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().default(''),
  definition: definitionSchema.optional(),
  ownerWorkflowId: z.string().min(1).nullable().optional(),
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
