import { z } from 'zod';
import { jsonSchema } from './index.js';
import { budgetPolicySchema } from './budgets.js';
import { runVersionPolicySchema } from './runVersions.js';

import { runTagsSchema } from './runTags.js';

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
    title: z.string().trim().min(1).max(200).optional(),
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
export const runTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe(
    'Optional run title, shown before the external task title and workflow name.',
  );
export function runDisplayTitle(run: {
  title?: string;
  externalTask?: ExternalTask;
  workflowName: string;
}) {
  return run.title ?? run.externalTask?.title ?? run.workflowName;
}
export const startDependencySchema = z.union([
  z.object({ requestId: startRequestIdSchema }).strict(),
  z.object({ externalTask: externalTaskIdentitySchema }).strict(),
]);
export type StartDependency = z.infer<typeof startDependencySchema>;
export interface RunAdmission {
  queuedAt: string;
  priority: number;
  position: number;
  after: { reference: StartDependency; runId?: string }[];
  blockers: string[];
  admittedAt?: string;
}
export const runStartOptionsSchema = z
  .object({
    versionPolicy: runVersionPolicySchema
      .optional()
      .describe(
        'Default pinned. latest-compatible checks the newest published definition before creating each execution; existing work and captures stay fixed.',
      ),
    requestId: startRequestIdSchema
      .optional()
      .describe(
        'Library-wide ordinary-start key. Identical retries recover the original run without advancing it; conflicting reuse or deleted history rejects. Use a new key for a new attempt.',
      ),
    externalTask: externalTaskSchema.optional(),
    title: runTitleSchema.optional(),
    tags: runTagsSchema.optional(),
    priority: z
      .number()
      .int()
      .min(-1000000)
      .max(1000000)
      .optional()
      .describe('Higher first, FIFO ties, default 0.'),
    onActiveExternalTask: z
      .enum(['allow', 'reuse', 'reject', 'cancel_previous'])
      .optional()
      .describe(
        'Library-wide active/queued task policy. Default allow; others require externalTask.',
      ),
    after: z
      .array(startDependencySchema)
      .min(1)
      .max(32)
      .optional()
      .describe(
        'Wait for every referenced run or continue-as-new chain to succeed. Missing, failed or cancelled dependencies remain queued with blockers. Task identities pin the newest retained match when resolved.',
      ),
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
