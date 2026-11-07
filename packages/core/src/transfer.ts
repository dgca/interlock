import { webhookConfigSchema } from './webhooks.js';
import { scheduleConfigSchema } from './workflowTriggers.js';
import { z } from 'zod';
import { definitionSchema } from './index.js';
import { savedPromptSchema, promptIds } from './prompts.js';
import { deletedVersionSchema } from './versionCleanup.js';
import { variableRequirementSchema, variableReferences } from './variables.js';
import { modelAliasRequirementSchema } from './modelAliases.js';

export const workflowBundleSchema = z
  .object({
    format: z.literal('interlock-workflows'),
    formatVersion: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
    ]),
    variables: z.array(variableRequirementSchema).max(4096).optional(),
    prompts: z.array(savedPromptSchema).optional(),
    modelAliases: z.array(modelAliasRequirementSchema).max(4096).optional(),
    rootId: z.string().min(1),
    workflows: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().trim().min(1).max(120),
          description: z.string(),
          ownerWorkflowId: z.string().nullable(),
          schedules: z
            .array(
              z
                .object({
                  id: z.string().min(1),
                  config: scheduleConfigSchema,
                  enabled: z.boolean().default(false),
                })
                .strict(),
            )
            .optional(),
          webhooks: z
            .array(
              z
                .object({
                  id: z.string().min(1),
                  config: webhookConfigSchema,
                  enabled: z.boolean().default(false),
                })
                .strict(),
            )
            .max(4096)
            .optional(),
          draft: definitionSchema,
          draftRevision: z.number().int().positive(),
          deletedVersions: z.array(deletedVersionSchema).optional(),
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
      bundle.formatVersion < 7 &&
      bundle.workflows.some((w) => w.webhooks?.length)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Webhooks require bundle formatVersion 7',
      });
    if (bundle.formatVersion < 6 && bundle.modelAliases?.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Model aliases require bundle formatVersion 6',
      });
    if (
      bundle.formatVersion < 5 &&
      bundle.workflows.some((w) => w.schedules?.length)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Schedules require bundle formatVersion 5',
      });
    const references = new Set(
      bundle.workflows.flatMap((w) => [
        ...[w.draft, ...w.versions.map((v) => v.definition)].flatMap(
          variableReferences,
        ),
        ...(w.webhooks ?? []).map((t) => t.config.authentication.secretId),
      ]),
    );
    for (const w of bundle.workflows)
      for (const hook of w.webhooks ?? [])
        if (
          !bundle.variables?.some(
            (v) =>
              v.id === hook.config.authentication.secretId &&
              v.kind === 'secret',
          )
        )
          ctx.addIssue({
            code: 'custom',
            message: 'Webhook authentication requires a Secret requirement',
          });
    const required = new Set((bundle.variables ?? []).map((v) => v.id));
    if (
      required.size !== (bundle.variables?.length ?? 0) ||
      [...references].some((id) => !required.has(id)) ||
      [...required].some((id) => !references.has(id)) ||
      ((required.size || references.size) && bundle.formatVersion < 4)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Variables require formatVersion 4 and one safe requirement for every referenced identity',
      });
    if (
      bundle.formatVersion < 3 &&
      bundle.workflows.some((w) => w.deletedVersions?.length)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Deleted version identities require bundle formatVersion 3',
      });
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
