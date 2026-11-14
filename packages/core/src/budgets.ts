import { z } from 'zod';
import {
  summarizeUsage,
  summarizeUsageMetric,
  selectedUsageReport,
  type UsageAttempt,
  type RunUsageReport,
  type UsageMetric,
} from './usage.js';
import { summarizePricing } from './pricing.js';

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
        'All scopes include continue-as-new chain members: run only those; lifecycle also ordinary descendants; tree also detached descendants.',
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
  /** Blocking reasons across the governing budgets. */
  reasons?: ('limit_reached' | 'usage_incomplete')[];
  /** A managed attempt was stopped at the limit; the next claim resumes it. */
  stopped?: { attempt: number; reason: string };
}
const incomplete =
  'usage is incomplete under unknownUsage:block; report final figures for the attempt, or set unknownUsage to allow';
/** The waiting reason for a budget-blocked assignment, from its live reasons. */
export function budgetWaitMessage(block: BudgetBlock, attempt: number) {
  const limit = block.reasons?.includes('limit_reached') ?? true,
    unknown = block.reasons?.includes('usage_incomplete') ?? false;
  const stopped = block.stopped?.attempt === attempt ? block.stopped : null;
  if (!stopped)
    return unknown && !limit
      ? `Claim blocked: ${incomplete}.`
      : 'Claim blocked by run budget';
  return limit
    ? `Stopped at the run budget limit: ${stopped.reason}. Raise the budget to resume${unknown ? `; the stopped attempt's ${incomplete}` : ''}.`
    : `Stopped at the run budget limit (${stopped.reason}). The limit now allows it, but the stopped attempt's ${incomplete}.`;
}

export function evaluateBudget(
  policy: BudgetPolicy,
  attempts: UsageAttempt[],
  runReports: RunUsageReport[] = [],
) {
  const totals = summarizeUsage(attempts, runReports);
  const zero: UsageMetric = { value: 0, coverage: 'complete', overflow: false };
  const hasUsageScope = attempts.length > 0 || runReports.length > 0;
  const models = [
    ...attempts.flatMap(
      (attempt) => selectedUsageReport(attempt)?.snapshot.models ?? [undefined],
    ),
    ...runReports.flatMap((report) => report.snapshot.models),
  ];
  const cost = policy.limits.cost;
  const metrics: {
    metric: string;
    limit: z.infer<typeof limit>;
    usage: UsageMetric;
    currency?: string;
    pricing?: ReturnType<typeof summarizePricing>;
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
        usage: hasUsageScope ? totals.tokens[metric] : zero,
      });
  }
  if (cost)
    metrics.push({
      metric: 'cost',
      currency: cost.currency,
      limit: cost.threshold,
      usage: hasUsageScope
        ? summarizeUsageMetric(
            models.map((model) =>
              model?.cost?.currency === cost.currency
                ? model.cost.amountMicros
                : undefined,
            ),
            attempts.every(
              (attempt) => selectedUsageReport(attempt)?.snapshot.final,
            ) && runReports.every((report) => report.snapshot.final),
          )
        : zero,
      // Derived costs and unpriced models, when the caller priced the usage.
      pricing: summarizePricing(models),
    });
  const checks = metrics.map(({ metric, currency, limit, usage, pricing }) => {
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
      ...(pricing ? { pricing } : {}),
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
