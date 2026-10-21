import { z } from 'zod';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = count.refine((n) => n > 0, 'Must be positive');
const identity = z.string().trim().min(1).max(200);
export const tokenFields = [
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'reasoningOutputTokens',
] as const;
export const modelUsageSchema = z
  .object({
    provider: identity,
    model: identity,
    inputTokens: count.optional(),
    outputTokens: count.optional(),
    cachedInputTokens: count.optional(),
    reasoningOutputTokens: count.optional(),
    cost: z
      .object({
        amountMicros: count,
        currency: z.string().regex(/^[A-Z]{3}$/),
        source: z.string().trim().min(1).max(300),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [subset, total] of [
      ['cachedInputTokens', 'inputTokens'],
      ['reasoningOutputTokens', 'outputTokens'],
    ] as const)
      if (
        value[subset] !== undefined &&
        value[total] !== undefined &&
        value[subset]! > value[total]!
      )
        context.addIssue({
          code: 'custom',
          path: [subset],
          message: `${subset} cannot exceed ${total}`,
        });
  });
export const usageSnapshotSchema = z
  .object({
    sequence: positive,
    final: z.boolean().default(false),
    models: z.array(modelUsageSchema).min(1).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.models.map(modelKey);
    if (new Set(keys).size !== keys.length)
      context.addIssue({
        code: 'custom',
        path: ['models'],
        message: 'Provider/model pairs must be unique',
      });
  });
export const reportUsageSchema = z
  .object({
    workId: z.string().min(1),
    attempt: positive,
    token: z.string().min(1).max(500),
    snapshot: usageSnapshotSchema,
  })
  .strict();
export const usageQuerySchema = z
  .object({
    runId: z.string().min(1),
    includeDescendants: z.boolean().default(false),
    groupBy: z.enum(['run', 'node', 'worker', 'attempt']).default('node'),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;
export type UsageReportInput = z.input<typeof reportUsageSchema>;
export type UsageQuery = z.input<typeof usageQuerySchema>;
export type UsageOutcome =
  'claimed' | 'completed' | 'failed' | 'expired' | 'cancelled' | 'unknown';
/** Internal persisted receipt. Never return tokenHash through inspection. */
export interface UsageAttempt {
  id: string;
  workId: string;
  runId: string;
  nodeId: string;
  label: string;
  workerId: string | null;
  attempt: number;
  outcome: UsageOutcome;
  tokenHash?: string;
  claimedAt: string | null;
  endedAt?: string;
  reportedAt?: string;
  snapshot?: UsageSnapshot;
}
export type UsageCoverage = 'unknown' | 'partial' | 'complete';
export interface UsageMetric {
  value: number | null;
  coverage: UsageCoverage;
  overflow: boolean;
}
export function modelKey(model: Pick<ModelUsage, 'provider' | 'model'>) {
  return JSON.stringify([model.provider, model.model]);
}
export function summarizeUsageMetric(
  values: (number | undefined)[],
  final: boolean,
): UsageMetric {
  const known = values.filter((n): n is number => n !== undefined);
  const sum = known.reduce((total, n) => total + BigInt(n), 0n);
  const overflow = sum > BigInt(Number.MAX_SAFE_INTEGER);
  return {
    value: known.length && !overflow ? Number(sum) : null,
    coverage: !known.length
      ? 'unknown'
      : final && known.length === values.length && !overflow
        ? 'complete'
        : 'partial',
    overflow,
  };
}
export function summarizeUsage(attempts: UsageAttempt[]) {
  const models = attempts.flatMap(
    (attempt) => attempt.snapshot?.models ?? [undefined],
  );
  const final =
    attempts.length > 0 && attempts.every((attempt) => attempt.snapshot?.final);
  const outcomes: Record<UsageOutcome, number> = {
    claimed: 0,
    completed: 0,
    failed: 0,
    expired: 0,
    cancelled: 0,
    unknown: 0,
  };
  for (const attempt of attempts) outcomes[attempt.outcome]++;
  const tokens = Object.fromEntries(
    tokenFields.map((field) => [
      field,
      summarizeUsageMetric(
        models.map((model) => model?.[field]),
        final,
      ),
    ]),
  ) as Record<(typeof tokenFields)[number], UsageMetric>;
  const currencies = [
    ...new Set(
      models.flatMap((model) => (model?.cost ? [model.cost.currency] : [])),
    ),
  ].sort();
  const costs = currencies.map((currency) => ({
    currency,
    // Known costs in other currencies are neither missing nor converted.
    amountMicros: summarizeUsageMetric(
      models
        .filter((model) => !model?.cost || model.cost.currency === currency)
        .map((model) => model?.cost?.amountMicros),
      final,
    ),
  }));
  const reportedCosts = models.filter((model) => model?.cost).length;
  return {
    attempts: attempts.length,
    reportedAttempts: attempts.filter((attempt) => attempt.snapshot).length,
    finalAttempts: attempts.filter((attempt) => attempt.snapshot?.final).length,
    outcomes,
    tokens,
    costs,
    costCoverage: (!reportedCosts
      ? 'unknown'
      : final &&
          reportedCosts === models.length &&
          costs.every((cost) => !cost.amountMicros.overflow)
        ? 'complete'
        : 'partial') as UsageCoverage,
  };
}
