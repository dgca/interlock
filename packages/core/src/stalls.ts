import { z } from 'zod';

export const MAX_ACTIVE_CLOCK_MS = 2_592_000_000;
export const activeClockMsSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_ACTIVE_CLOCK_MS);
const threshold = activeClockMsSchema.nullable().optional();
export const stallFields = {
  unclaimedStallMs: threshold.describe(
    'Active available ms. Omit inherits; null disables.',
  ),
  claimedIdleStallMs: threshold.describe(
    'Idle active ms since progress/renewal. Omit inherits; null disables.',
  ),
  humanWaitStallMs: threshold.describe(
    'Unheld external-input active ms. Omit inherits; null disables.',
  ),
  runStallMs: threshold.describe(
    'Active ms without transition/progress. Omit inherits; null disables.',
  ),
};
export const idleRecoverySchema = z
  .object({
    maxRecoveries: z.number().int().min(0).max(10).default(0),
    message: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .default(
        'This assignment has stalled. Continue the task and return its required result, or report the blocker.',
      ),
  })
  .strict();
export const stallPolicySchema = z
  .object({
    ...stallFields,
    idleRecovery: idleRecoverySchema.nullable().optional(),
  })
  .strict();
export type StallPolicy = z.infer<typeof stallPolicySchema>;
export type StallKind = keyof typeof stallFields;
export interface StallRecord {
  id: string;
  runId: string;
  executionId: string;
  nodeId: string;
  workId?: string;
  attempt?: number;
  kind: StallKind;
  since: string;
  detectedAt: string;
  thresholdMs: number;
  activeMs: number;
  resolvedAt?: string;
}
export interface ActiveClockHold {
  id: string;
  runId: string;
  workId?: string;
  createdAt: string;
  releasedAt?: string;
}
export const stallSettingsUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    policy: stallPolicySchema,
  })
  .strict();
export const stallRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings') }).strict(),
  stallSettingsUpdateSchema.extend({ action: z.literal('configure') }),
  z
    .object({
      action: z.literal('inspect'),
      runId: z.string().min(1),
      offset: z.number().int().min(0).max(1_000_000).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
]);
