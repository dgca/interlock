import { z } from 'zod';

const selection = {
  id: z.string().min(1),
  includeDetached: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
};
export const previewRunCancellationSchema = z
  .object({
    ...selection,
    offset: z.number().int().min(0).default(0),
  })
  .strict();
export const cancelRunTreeSchema = z
  .object({
    ...selection,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export type RunCancellationPreview = z.input<
  typeof previewRunCancellationSchema
>;
export type CancelRunTree = z.input<typeof cancelRunTreeSchema>;
