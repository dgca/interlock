import { z } from 'zod';

export const modelTierSchema = z
  .enum(['max', 'balanced', 'fast'])
  .describe(
    'Advisory capability preference for current or fresh context. The executor maps tiers to models; required continuity and isolation take precedence. Omit for executor default.',
  );

export const modelSelectionSchema = z
  .object({
    tier: modelTierSchema.optional(),
    provider: z.string().trim().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Declare at least one of tier, provider, or model',
  })
  .describe(
    'Optional executor-declared selection for this claim attempt, not measured usage. May differ from context.tier; missing values stay unknown. report_usage records models actually used separately.',
  );

export type ModelTier = z.infer<typeof modelTierSchema>;
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
