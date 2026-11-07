import { z } from 'zod';

export const reportFilterSchema = z
  .object({
    workflowId: z.string().trim().min(1).max(256).optional(),
    since: z.string().datetime({ offset: true }).optional(),
    until: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(5000).default(500),
  })
  .strict();

export type ReportFilter = z.input<typeof reportFilterSchema>;
export type ResolvedReportFilter = z.infer<typeof reportFilterSchema>;

export const distributionMetricSchema = z
  .object({
    count: z.number().int().min(0),
    min: z.number().nullable(),
    median: z.number().nullable(),
    p90: z.number().nullable(),
    max: z.number().nullable(),
  })
  .strict();

export type DistributionMetric = z.infer<typeof distributionMetricSchema>;

export const stageDurationMetricSchema = z
  .object({
    stage: z.string(),
    durationMs: distributionMetricSchema,
    runCount: z.number().int().min(0),
  })
  .strict();

export type StageDurationMetric = z.infer<typeof stageDurationMetricSchema>;

export const nodeDurationMetricSchema = z
  .object({
    nodeId: z.string(),
    label: z.string(),
    kind: z.string(),
    stage: z.string().nullable().optional(),
    durationMs: distributionMetricSchema,
    executionCount: z.number().int().min(0),
  })
  .strict();

export type NodeDurationMetric = z.infer<typeof nodeDurationMetricSchema>;

export const claimWaitReportSchema = z
  .object({
    newSession: distributionMetricSchema,
    continuingSession: distributionMetricSchema,
    totalAttempts: z.number().int().min(0),
    leaseExpiries: z.number().int().min(0),
    failures: z.number().int().min(0),
    h7Recoveries: z.number().int().min(0),
    h12Stalls: z.number().int().min(0),
  })
  .strict();

export type ClaimWaitReport = z.infer<typeof claimWaitReportSchema>;

export const tokenSummarySchema = z
  .object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    cachedInputTokens: z.number().int().min(0),
    reasoningOutputTokens: z.number().int().min(0),
  })
  .strict();

export type TokenSummary = z.infer<typeof tokenSummarySchema>;

export const costAmountSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountMicros: z.number().int().min(0),
    formatted: z.string(),
  })
  .strict();

export type CostAmount = z.infer<typeof costAmountSchema>;

export const usageCoverageReportSchema = z
  .object({
    measuredPercentage: z.number().min(0).max(100),
    unknownPercentage: z.number().min(0).max(100),
    measuredAttempts: z.number().int().min(0),
    unknownAttempts: z.number().int().min(0),
    totalAttempts: z.number().int().min(0),
  })
  .strict();

export type UsageCoverageReport = z.infer<typeof usageCoverageReportSchema>;

export const usageByRunSchema = z
  .object({
    runId: z.string(),
    workflowId: z.string(),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    costMicros: z.number().int().nullable(),
    currency: z.string().optional(),
    measured: z.boolean(),
  })
  .strict();

export type UsageByRun = z.infer<typeof usageByRunSchema>;

export const usageByNodeSchema = z
  .object({
    nodeId: z.string(),
    label: z.string(),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    costMicros: z.number().int().nullable(),
    currency: z.string().optional(),
    measuredPercentage: z.number().min(0).max(100),
    attempts: z.number().int().min(0),
  })
  .strict();

export type UsageByNode = z.infer<typeof usageByNodeSchema>;

export const usageByModelSchema = z
  .object({
    model: z.string(),
    provider: z.string(),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    costMicros: z.number().int().nullable(),
    currency: z.string().optional(),
    count: z.number().int().min(0),
  })
  .strict();

export type UsageByModel = z.infer<typeof usageByModelSchema>;

export const usageByProviderSchema = z
  .object({
    provider: z.string(),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    costMicros: z.number().int().nullable(),
    currency: z.string().optional(),
    count: z.number().int().min(0),
  })
  .strict();

export type UsageByProvider = z.infer<typeof usageByProviderSchema>;

export const usageCostReportSchema = z
  .object({
    tokens: tokenSummarySchema,
    costs: z.array(costAmountSchema),
    coverage: usageCoverageReportSchema,
    byRun: z.array(usageByRunSchema),
    byNode: z.array(usageByNodeSchema),
    byModel: z.array(usageByModelSchema),
    byProvider: z.array(usageByProviderSchema),
  })
  .strict();

export type UsageCostReport = z.infer<typeof usageCostReportSchema>;

export const exitNodeOutcomeSchema = z
  .object({
    nodeId: z.string(),
    label: z.string(),
    count: z.number().int().min(0),
    percentage: z.number().min(0).max(100),
  })
  .strict();

export type ExitNodeOutcome = z.infer<typeof exitNodeOutcomeSchema>;

export const terminalOutcomesReportSchema = z
  .object({
    totalRuns: z.number().int().min(0),
    completedRuns: z.number().int().min(0),
    failedRuns: z.number().int().min(0),
    cancelledRuns: z.number().int().min(0),
    activeRuns: z.number().int().min(0),
    exitNodes: z.array(exitNodeOutcomeSchema),
    unattendedCompletionRate: z.number().min(0).max(100),
    humanEscalationRate: z.number().min(0).max(100),
  })
  .strict();

export type TerminalOutcomesReport = z.infer<
  typeof terminalOutcomesReportSchema
>;

export const workflowReportSummarySchema = z
  .object({
    totalRuns: z.number().int().min(0),
    durationMs: distributionMetricSchema,
    admissionQueueWaitMs: distributionMetricSchema,
    humanWaitMs: distributionMetricSchema,
  })
  .strict();

export type WorkflowReportSummary = z.infer<typeof workflowReportSummarySchema>;

export const workflowReportSchema = z
  .object({
    filter: reportFilterSchema,
    generatedAt: z.string(),
    window: z
      .object({
        since: z.string().nullable(),
        until: z.string().nullable(),
      })
      .strict(),
    summary: workflowReportSummarySchema,
    stages: z.array(stageDurationMetricSchema),
    nodes: z.array(nodeDurationMetricSchema),
    claims: claimWaitReportSchema,
    usage: usageCostReportSchema,
    terminalOutcomes: terminalOutcomesReportSchema,
  })
  .strict();

export type WorkflowReport = z.infer<typeof workflowReportSchema>;

/** Helper to calculate percentiles on numeric values */
export function calculateDistribution(
  values: (number | null | undefined)[],
): DistributionMetric {
  const sorted = values
    .filter(
      (n): n is number =>
        n !== null && n !== undefined && Number.isFinite(n) && n >= 0,
    )
    .sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) {
    return { count: 0, min: null, median: null, p90: null, max: null };
  }
  const min = sorted[0];
  const max = sorted[n - 1];

  function percentile(p: number): number {
    if (n === 1) return sorted[0];
    const index = (n - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  const median = Math.round(percentile(0.5) * 100) / 100;
  const p90 = Math.round(percentile(0.9) * 100) / 100;

  return {
    count: n,
    min,
    median,
    p90,
    max,
  };
}

/** Formats integer millionths of a currency to standard decimal string */
export function formatCurrencyAmount(
  amountMicros: number,
  currency: string,
): string {
  const dollars = (amountMicros / 1_000_000).toFixed(4);
  return `${dollars} ${currency}`;
}
