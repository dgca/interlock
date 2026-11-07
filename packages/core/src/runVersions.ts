import { z } from 'zod';

export const runVersionPolicySchema = z.enum(['pinned', 'latest-compatible']);
export type RunVersionPolicy = z.infer<typeof runVersionPolicySchema>;
export const runVersionReadSchema = z
  .object({
    runId: z.string().min(1),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export const setRunVersionPolicySchema = z
  .object({
    runId: z.string().min(1),
    expectedRevision: z.number().int().min(0),
    policy: runVersionPolicySchema,
  })
  .strict();
export const runVersionPreviewSchema = z
  .object({
    runId: z.string().min(1),
    version: z.number().int().positive(),
    recapturePrompts: z.boolean().default(false),
  })
  .strict();
export const runVersionApplySchema = runVersionPreviewSchema
  .extend({
    confirmation: z.string().min(1).max(128),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export interface RunVersionChange {
  fromVersion: number;
  toVersion: number;
  at: string;
  reason: string;
  recapturePrompts: boolean;
}
export interface RunVersionBlocker {
  version: number;
  nodeId: string;
  reasons: string[];
}
