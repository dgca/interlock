import { z } from 'zod';
import { definitionSchema } from './index.js';
import { savedPromptSchema, promptIds } from './prompts.js';

export const workflowBundleSchema = z
  .object({
    format: z.literal('interlock-workflows'),
    formatVersion: z.union([z.literal(1), z.literal(2)]),
    prompts: z.array(savedPromptSchema).optional(),
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
  })
  .superRefine((bundle, ctx) => {
    if (
      bundle.formatVersion === 1 &&
      (bundle.prompts?.length ||
        bundle.workflows.some((w) =>
          [w.draft, ...w.versions.map((v) => v.definition)].some(
            (d) => promptIds(d).length,
          ),
        ))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Saved prompts require bundle formatVersion 2',
      });
  });
export type WorkflowBundle = z.infer<typeof workflowBundleSchema>;
