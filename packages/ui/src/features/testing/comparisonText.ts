import type { UsageMetric } from '@interlock/core';
import type { api } from '../../lib/api';

export type ComparisonReport = Awaited<
  ReturnType<typeof api.testbench.report.query>
>;
export type ComparisonSide = ComparisonReport['metrics']['sides']['baseline'];

export function formatMs(ms: number | null | undefined, signed = false) {
  if (ms === null || ms === undefined) return 'Unknown';
  const sign = signed && ms > 0 ? '+' : ms < 0 ? '−' : '';
  const value = Math.abs(ms);
  if (value < 1000) return `${sign}${Math.round(value)} ms`;
  if (value < 60_000) return `${sign}${(value / 1000).toFixed(1)} s`;
  return `${sign}${(value / 60_000).toFixed(1)} min`;
}

/** Nonzero counts in a fixed order, such as "3 completed, 1 failed". */
export function counts(
  values: Record<string, number>,
  labels: Record<string, string>,
) {
  const parts = Object.entries(labels)
    .filter(([key]) => values[key])
    .map(([key, label]) => `${values[key]} ${label}`);
  return parts.length ? parts.join(', ') : 'None';
}

export const executionLabels = {
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  running: 'running',
  waiting: 'waiting',
  queued: 'queued',
  pending: 'pending',
  not_started: 'not started',
  unavailable: 'unavailable',
};
export const checkLabels = {
  pass: 'passed',
  fail: 'failed',
  unknown: 'unknown',
};

export function costText(usage: ComparisonSide['usage']) {
  if (!usage.costs.length) return 'Not reported';
  const text = usage.costs
    .map((c) => `${microsText(c.amountMicros)} ${c.currency}`)
    .join(', ');
  const more = usage.currenciesTruncated
    ? `, ${usage.currencyCount - usage.costs.length} more currencies`
    : '';
  return usage.costCoverage === 'complete'
    ? text + more
    : `${text}${more} · ${usage.costCoverage}`;
}

function microsText(metric: UsageMetric) {
  if (metric.overflow) return 'Too large to total';
  if (metric.value === null) return 'Unknown';
  return (metric.value / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

const reasons: Record<string, string> = {
  execution_pending: 'samples are still running',
  trials_not_started: 'some samples never started',
  measurement_history_unavailable: 'some run history is unavailable',
  timing_incomplete: 'timing is incomplete',
  reported_cost_incomplete: 'reported cost is incomplete',
  quality_unjudged: 'some samples have no quality judgment',
  quality_unassessed: 'some evaluations had no verdict',
  quality_rubrics_unmatched:
    'paired samples were judged with different rubrics',
  executor_configuration_mismatch: 'an executor differed from the request',
  executor_configuration_unknown: 'executor attribution is unknown',
  environment_unverified: 'environments are declared but not verified',
};

export function availabilityText(
  availability: ComparisonReport['metrics']['availability'],
) {
  if (availability.state === 'descriptive')
    return 'No measurement gaps found. This describes the samples; it does not pick a winner.';
  const list = availability.reasons.map((r) => reasons[r] ?? r).join('; ');
  return availability.state === 'pending'
    ? `Still running: ${list}.`
    : `Incomplete evidence: ${list}.`;
}
