import {
  calculateDistribution,
  reportDateBoundMs,
  reportFilterSchema,
  type ReportFilter,
  type Run,
  type WorkflowReport,
} from '@interlock/core';
import type { Engine } from './index.js';
import { generateWorkflowReport, type Elapsed } from './report.js';

const hourMs = 3_600_000;
const dayMs = 24 * hourMs;

/** Report fields a dashboard compares against; omits per-run and per-alias rows. */
type ReportComparison = Pick<
  WorkflowReport,
  'window' | 'summary' | 'stages' | 'nodes' | 'terminalOutcomes'
> & { usage: Pick<WorkflowReport['usage'], 'costs' | 'coverage'> };

type DashboardTrendBucket = {
  start: string;
  end: string;
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  durationMs: WorkflowReport['summary']['durationMs'];
};

type DashboardStageSpend = {
  stage: string | null;
  costMicros: number | null;
  currency?: string;
  attempts: number;
  measuredAttempts: number;
};

type RunCounts = {
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
};

export type ReportDashboard = {
  report: WorkflowReport;
  /** The window of equal length that ends where this one starts. Null for all time. */
  previous: ReportComparison | null;
  /** Runs in the window by creation time; empty for all time. */
  trend: DashboardTrendBucket[];
  spendByStage: DashboardStageSpend[];
  /** Exact run counts per window from indexed metadata, independent of the run limit. */
  counts: { current: RunCounts; previous: RunCounts | null };
  /** True when the run limit cut either window, so its report covers the newest runs only. */
  limited: boolean;
};

function bucketCount(spanMs: number) {
  if (spanMs <= 2 * dayMs) return 12;
  if (spanMs <= 14 * dayMs) return 7;
  return 10;
}

function elapsedDistribution(values: Elapsed[]) {
  return {
    ...calculateDistribution(values.map((value) => value.wallMs)),
    pausedMs: calculateDistribution(values.map((value) => value.pausedMs)),
    activeMs: calculateDistribution(values.map((value) => value.activeMs)),
  };
}

function trend(
  observed: { run: Run; duration: Elapsed }[],
  sinceMs: number,
  untilMs: number,
): DashboardTrendBucket[] {
  const count = bucketCount(untilMs - sinceMs);
  const size = (untilMs - sinceMs) / count;
  const buckets = Array.from({ length: count }, (_, index) => ({
    start: Math.round(sinceMs + index * size),
    end: Math.round(sinceMs + (index + 1) * size),
    runs: [] as { run: Run; duration: Elapsed }[],
  }));
  for (const entry of observed) {
    const index = Math.floor(
      (Date.parse(entry.run.createdAt) - sinceMs) / size,
    );
    buckets[Math.min(count - 1, Math.max(0, index))].runs.push(entry);
  }
  return buckets.map(({ start, end, runs }) => ({
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    runs: runs.length,
    completed: runs.filter(({ run }) => run.status === 'completed').length,
    failed: runs.filter(({ run }) => run.status === 'failed').length,
    cancelled: runs.filter(({ run }) => run.status === 'cancelled').length,
    durationMs: elapsedDistribution(runs.map(({ duration }) => duration)),
  }));
}

/** Groups reported node spend by the stage the report assigns each node. */
function spendByStage(
  report: WorkflowReport,
  measured: Map<string, number>,
): DashboardStageSpend[] {
  const stages = new Map(report.nodes.map((node) => [node.nodeId, node.stage]));
  const groups = new Map<string | null, DashboardStageSpend>();
  for (const node of report.usage.byNode) {
    const stage = stages.get(node.nodeId) ?? null;
    const group = groups.get(stage) ?? {
      stage,
      costMicros: null,
      attempts: 0,
      measuredAttempts: 0,
    };
    group.attempts += node.attempts;
    group.measuredAttempts += measured.get(node.nodeId) ?? 0;
    if (node.currency === 'mixed' || group.currency === 'mixed') {
      group.costMicros = null;
      group.currency = 'mixed';
    } else if (node.costMicros !== null && node.currency) {
      if (group.currency && group.currency !== node.currency) {
        group.costMicros = null;
        group.currency = 'mixed';
      } else {
        group.costMicros = (group.costMicros ?? 0) + node.costMicros;
        group.currency = node.currency;
      }
    }
    groups.set(stage, group);
  }
  return [...groups.values()].sort(
    (a, b) => (b.costMicros ?? -1) - (a.costMicros ?? -1),
  );
}

function comparison(report: WorkflowReport): ReportComparison {
  const { window, summary, stages, nodes, terminalOutcomes, usage } = report;
  return {
    window,
    summary,
    stages,
    nodes,
    terminalOutcomes,
    usage: { costs: usage.costs, coverage: usage.coverage },
  };
}

/**
 * Builds the dashboard from the same report used by `interlock report`, plus the
 * equal-length previous window. Both reads stay bounded by the report limit.
 */
export function generateReportDashboard(
  engine: Engine,
  input: ReportFilter,
): ReportDashboard {
  const filter = reportFilterSchema.parse(input);
  const observed: { run: Run; duration: Elapsed }[] = [];
  const measured = new Map<string, number>();
  const report = generateWorkflowReport(engine.store, engine, filter, {
    run: (run, duration) => observed.push({ run, duration }),
    node: (nodeId, _attempts, count) => measured.set(nodeId, count),
  });
  const current = engine.store.countReportRuns(filter);
  if (filter.since === undefined)
    return {
      report,
      previous: null,
      trend: [],
      spendByStage: spendByStage(report, measured),
      counts: { current, previous: null },
      limited: current.runs > report.summary.totalRuns,
    };
  const sinceMs = reportDateBoundMs(filter.since, true);
  const untilMs =
    filter.until === undefined
      ? Date.parse(report.generatedAt)
      : reportDateBoundMs(filter.until, false);
  const spanMs = Math.max(1, untilMs - sinceMs);
  const previousFilter = {
    ...filter,
    since: new Date(sinceMs - spanMs).toISOString(),
    until: new Date(sinceMs - 1).toISOString(),
  };
  const previous = generateWorkflowReport(engine.store, engine, previousFilter);
  const before = engine.store.countReportRuns(previousFilter);
  return {
    report,
    previous: comparison(previous),
    trend: trend(observed, sinceMs, sinceMs + spanMs),
    spendByStage: spendByStage(report, measured),
    counts: { current, previous: before },
    limited:
      current.runs > report.summary.totalRuns ||
      before.runs > previous.summary.totalRuns,
  };
}
