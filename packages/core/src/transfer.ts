import { z } from 'zod';
import { definitionSchema } from './index.js';

export const workflowBundleSchema = z.object({
  format: z.literal('interlock-workflows'),
  formatVersion: z.literal(1),
  rootId: z.string().min(1),
  workflows: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(120),
        description: z.string(),
        ownerWorkflowId: z.string().nullable(),
        draft: definitionSchema,
        draftRevision: z.number().int().positive(),
        versions: z.array(
          z.object({
            version: z.number().int().positive(),
            definition: definitionSchema,
          }),
        ),
      }),
    )
    .min(1),
});
export type WorkflowBundle = z.infer<typeof workflowBundleSchema>;
