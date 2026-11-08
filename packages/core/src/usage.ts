import { z } from 'zod';
import type { ModelTier, ModelSelection } from './modelTiers.js';
import {
  sessionIdentitySchema,
  type SessionIdentity,
} from './contextContinuity.js';

export const RUN_USAGE_GRACE_MS = 60 * 60 * 1000;

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
    workId: z.string().min(1).optional(),
    attempt: positive.optional(),
    runId: z.string().min(1).optional(),
    streamId: z.string().trim().min(1).max(200).optional(),
    session: sessionIdentitySchema.optional(),
    source: z
      .enum(['executor', 'observer'])
      .default('executor')
      .describe(
        'Executor uses its claim token; observer requires an ended attempt or active/recent run and no token.',
      ),
    token: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe('Required for executor reports; omit for observer reports.'),
    snapshot: usageSnapshotSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const isRunLevel = value.runId !== undefined;
    const isAttemptLevel = value.workId !== undefined;

    if (!isRunLevel && !isAttemptLevel) {
      context.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'Either workId and attempt, or runId must be provided',
      });
      return;
    }

    if (isRunLevel && isAttemptLevel) {
      context.addIssue({
        code: 'custom',
        path: ['runId'],
        message:
          'Provide either workId and attempt for attempt usage, or runId for run usage, not both',
      });
      return;
    }

    if (isAttemptLevel) {
      if (value.attempt === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['attempt'],
          message: 'attempt is required when workId is provided',
        });
      }
      if (value.streamId !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['streamId'],
          message: 'streamId is only supported for run-level observer reports',
        });
      }
      if (value.session !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['session'],
          message: 'session is only supported for run-level observer reports',
        });
      }
      if (value.source === 'executor' && value.token === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['token'],
          message: 'Executor usage requires the claim token',
        });
      }
      if (value.source === 'observer' && value.token !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['token'],
          message: 'Observer usage must omit the claim token',
        });
      }
    } else {
      if (value.attempt !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['attempt'],
          message: 'attempt is not permitted for run-level usage',
        });
      }
      if (value.source !== 'observer') {
        context.addIssue({
          code: 'custom',
          path: ['source'],
          message: 'Run-level usage reporting requires source: "observer"',
        });
      }
      if (value.token !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['token'],
          message: 'Run-level observer usage must omit the claim token',
        });
      }
    }
  });
export const usageQuerySchema = z
  .object({
    runId: z.string().min(1),
    includeDescendants: z.boolean().default(false),
    includeChain: z
      .boolean()
      .default(false)
      .describe(
        'Include all runs in the requested run chain; includeDescendants then includes their children too.',
      ),
    groupBy: z.enum(['run', 'node', 'worker', 'attempt']).default('node'),
    includeReports: z
      .boolean()
      .default(false)
      .describe(
        'With groupBy attempt, include both source reports for inspection. Totals still select observer over executor, without adding them.',
      ),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;
export interface UsageReport {
  snapshot: UsageSnapshot;
  reportedAt: string;
}
export interface RunUsageReport {
  id: string;
  runId: string;
  streamId: string;
  session?: SessionIdentity;
  source: 'observer';
  snapshot: UsageSnapshot;
  reportedAt: string;
}
export type UsageReportInput = z.input<typeof reportUsageSchema>;
export type UsageQuery = z.input<typeof usageQuerySchema>;
export type UsageOutcome =
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'held'
  | 'unknown';
/** Internal persisted receipt. Never return tokenHash through inspection. */
export interface UsageAttempt {
  modelAliasSelection?: import('./modelAliases.js').ModelAliasSelection;
  // null means captured executor default; omission means unknown legacy data.
  requestedTier?: ModelTier | null;
  modelSelection?: ModelSelection;
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
  observerReport?: UsageReport;
}
export interface UsageGroup {
  key: string;
  runId?: string;
  nodeId?: string | null;
  label?: string;
  workerId?: string | null;
  workId?: string | null;
  attempt?: number | null;
  streamId?: string;
  outcome?: UsageOutcome;
  claimedAt?: string | null;
  endedAt?: string | null;
  wallMs?: number | null;
  pausedMs?: number | null;
  activeMs?: number | null;
  source?: 'executor' | 'observer' | null;
  reportedAt?: string | null;
  snapshot?: UsageSnapshot | null;
  reports?: {
    executor: { snapshot: UsageSnapshot; reportedAt: string | null } | null;
    observer: { snapshot: UsageSnapshot; reportedAt: string } | null;
  };
  requestedTier?: ModelTier | null;
  modelSelection?: ModelSelection | null;
  totals: ReturnType<typeof summarizeUsage>;
}
/** Select one complete source snapshot per attempt for both totals and budgets. */
export function selectedUsageReport(attempt: UsageAttempt) {
  if (attempt.observerReport)
    return { source: 'observer' as const, ...attempt.observerReport };
  if (attempt.snapshot)
    return {
      source: 'executor' as const,
      snapshot: attempt.snapshot,
      reportedAt: attempt.reportedAt ?? null,
    };
  return null;
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
export function summarizeUsage(
  attempts: UsageAttempt[],
  runReports: RunUsageReport[] = [],
) {
  const reports = attempts.map(selectedUsageReport);
  const models = [
    ...reports.flatMap((report) => report?.snapshot.models ?? [undefined]),
    ...runReports.flatMap((report) => report.snapshot.models),
  ];
  const final =
    (attempts.length > 0 || runReports.length > 0) &&
    reports.every((report) => report?.snapshot.final) &&
    runReports.every((report) => report.snapshot.final);
  const outcomes: Record<UsageOutcome, number> = {
    claimed: 0,
    held: 0,
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
    reportedAttempts: reports.filter(Boolean).length,
    finalAttempts: reports.filter((report) => report?.snapshot.final).length,
    runStreams: runReports.length,
    finalRunStreams: runReports.filter((report) => report.snapshot.final)
      .length,
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
