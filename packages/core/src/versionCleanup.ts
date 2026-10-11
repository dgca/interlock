import { z } from 'zod';

export const versionReferenceSchema = z
  .object({
    workflowId: z
      .string()
      .min(1)
      .describe('Exact workflow ID; cleanup preserves the workflow record.'),
    version: z
      .number()
      .int()
      .positive()
      .describe(
        'Exact obsolete published version number. Latest versions are protected.',
      ),
  })
  .strict();

export const versionSelectionSchema = z
  .object({
    versions: z
      .array(versionReferenceSchema)
      .min(1)
      .max(1000)
      .describe(
        'Explicit unique workflow/version pairs to preview or delete, 1 through 1000 entries. Include historical caller versions explicitly; no automatic cascade.',
      ),
  })
  .strict();

export const versionDeletionSchema = versionSelectionSchema.extend({
  confirmation: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .describe(
      'Impact confirmation returned by preview_version_deletion for this exact set. A changed impact requires another preview and human agreement.',
    ),
  acknowledgeHistoryLoss: z
    .literal(true)
    .describe(
      'Set true only after the person explicitly agrees that affected history loses graph inspection and retry until original definitions are restored from a backup.',
    ),
});

export const deletedVersionSchema = z.object({
  version: z.number().int().positive(),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
  deletedAt: z.string().datetime(),
});

export type VersionReference = z.infer<typeof versionReferenceSchema>;
export type DeletedWorkflowVersion = z.infer<typeof deletedVersionSchema> & {
  workflowId: string;
};
