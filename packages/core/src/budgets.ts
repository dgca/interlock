import { z } from 'zod';
import {
  summarizeUsage,
  summarizeUsageMetric,
  selectedUsageReport,
  type UsageAttempt,
  type UsageMetric,
} from './usage.js';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const limit = z
  .object({ max: count, warnAt: count.optional() })
  .strict()
  .refine(
    (value) => value.warnAt === undefined || value.warnAt <= value.max,
    'Warning threshold cannot exceed the maximum',
  );
export const budgetPolicySchema = z
  .object({
    scope: z
      .enum(['run', 'lifecycle', 'tree'])
      .describe(
        'run only; lifecycle includes ordinary descendants; tree also includes detached descendants.',
      ),
    unknownUsage: z
      .enum(['allow', 'block'])
      .describe(
        'Allow incomplete reports with warnings, or block until final figures are available. No attempts means zero consumption.',
      ),
    limits: z
      .object({
        claims: limit.optional(),
        inputTokens: limit.optional(),
        outputTokens: limit.optional(),
        cost: z
          .object({
            currency: z.string().regex(/^[A-Z]{3}$/),
            threshold: limit,
          })
          .strict()
          .optional(),
      })
      .strict()
      .refine(
        (value) => Object.values(value).some((v) => v !== undefined),
        'At least one limit is required',
      )
      .describe(
        'Choose at least one limit. Reaching max blocks new claims; warnAt is advisory and cannot exceed max. Cost uses integer millionths of the stated currency.',
      ),
  })
  .strict();
export const setBudgetSchema = z
  .object({
    runId: z.string().min(1),
    expectedRevision: count
      .max(Number.MAX_SAFE_INTEGER - 1)
      .describe('Current local budget revision, or 0 if never configured.'),
    budget: budgetPolicySchema
      .nullable()
      .describe(
        'Replace policy and re-evaluate retained history; null disables the local policy.',
      ),
  })
  .strict();
export type SetBudgetInput = z.input<typeof setBudgetSchema>;
export type BudgetPolicy = z.infer<typeof budgetPolicySchema>;
export interface BudgetRecord {
  id: string;
  revision: number;
  budget: BudgetPolicy | null;
  updatedAt: string;
}
export interface BudgetBlock {
  runIds: string[];
  since: string;
  remainingMs?: number;
}

export function evaluateBudget(policy: BudgetPolicy, attempts: UsageAttempt[]) {
  const totals = summarizeUsage(attempts);
  const zero: UsageMetric = { value: 0, coverage: 'complete', overflow: false };
  const models = attempts.flatMap(
    (attempt) => selectedUsageReport(attempt)?.snapshot.models ?? [undefined],
  );
  const cost = policy.limits.cost;
  const metrics: {
    metric: string;
    limit: z.infer<typeof limit>;
    usage: UsageMetric;
    currency?: string;
  }[] = [];
  if (policy.limits.claims)
    metrics.push({
      metric: 'claims',
      limit: policy.limits.claims,
      usage: { ...zero, value: attempts.length },
    });
  for (const metric of ['inputTokens', 'outputTokens'] as const) {
    const threshold = policy.limits[metric];
    if (threshold)
      metrics.push({
        metric,
        limit: threshold,
        usage: attempts.length ? totals.tokens[metric] : zero,
      });
  }
  if (cost)
    metrics.push({
      metric: 'cost',
      currency: cost.currency,
      limit: cost.threshold,
      usage: attempts.length
        ? summarizeUsageMetric(
            models.map((model) =>
              model?.cost?.currency === cost.currency
                ? model.cost.amountMicros
                : undefined,
            ),
            attempts.every(
              (attempt) => selectedUsageReport(attempt)?.snapshot.final,
            ),
          )
        : zero,
    });
  const checks = metrics.map(({ metric, currency, limit, usage }) => {
    const reasons: string[] = [],
      warnings: string[] = [];
    if (usage.overflow || (usage.value !== null && usage.value >= limit.max))
      reasons.push('limit_reached');
    if (usage.coverage !== 'complete') {
      if (policy.unknownUsage === 'block') reasons.push('usage_incomplete');
      else warnings.push('usage_incomplete');
    }
    if (
      limit.warnAt !== undefined &&
      (usage.overflow || (usage.value !== null && usage.value >= limit.warnAt))
    )
      warnings.push('warning_threshold');
    return {
      metric,
      ...(currency ? { currency } : {}),
      ...limit,
      ...usage,
      reasons,
      warnings,
    };
  });
  return {
    state: checks.some((check) => check.reasons.length)
      ? ('blocked' as const)
      : checks.some((check) => check.warnings.length)
        ? ('warning' as const)
        : ('ready' as const),
    attempts: attempts.length,
    inFlight: attempts.filter((attempt) => attempt.outcome === 'claimed')
      .length,
    checks,
  };
}
