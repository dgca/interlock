import { z } from 'zod';
import { jsonSchema } from './index.js';
import { budgetPolicySchema } from './budgets.js';

export const startRequestIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/\S/, 'Use a nonblank caller-generated request key');
export const externalTaskIdentitySchema = z
  .object({
    system: z.string().trim().min(1).max(64),
    id: z.string().trim().min(1).max(200),
  })
  .strict();
export const externalTaskSchema = externalTaskIdentitySchema
  .extend({
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ['https:', 'http:'].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, 'Use an HTTP(S) link without embedded credentials')
      .optional(),
  })
  .describe(
    'Non-secret correlation only; does not authorize work or update an external board.',
  );
export type ExternalTask = z.infer<typeof externalTaskSchema>;
export const runStartOptionsSchema = z
  .object({
    requestId: startRequestIdSchema
      .optional()
      .describe(
        'Library-wide ordinary-start key. Identical retries recover the original run without advancing it; conflicting reuse or deleted history rejects. Use a new key for a new attempt.',
      ),
    externalTask: externalTaskSchema.optional(),
  })
  .strict();
export type RunStartOptions = z.input<typeof runStartOptionsSchema>;
export const runStartSchema = z.object({
  workflowId: z.string(),
  version: z.number().int().positive().optional(),
  input: z.lazy(() => jsonSchema),
  budget: budgetPolicySchema.optional(),
  ...runStartOptionsSchema.shape,
});
export type RunStartRequest = z.infer<typeof runStartSchema>;
export interface RunStartReceipt {
  /** SHA-256 of the opaque caller key; no input or prompt bodies are retained here. */
  id: string;
  requestHash: string;
  runId: string;
  workflowId: string;
  version: number;
  createdAt: string;
  deletedAt?: string;
}
