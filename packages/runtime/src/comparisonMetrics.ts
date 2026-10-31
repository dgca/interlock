import {
  summarizeUsage,
  summarizeUsageMetric,
  selectedUsageReport,
  type ComparisonMeasurement,
  type ComparisonSample,
  type WorkflowComparison,
  type Run,
  type WorkRequest,
  type WorkHoldInterval,
  type UsageAttempt,
  type UsageMetric,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Usage } from './usage.js';

type Timing = ComparisonMeasurement['timing'];
const timingNames = [
  'rootElapsedMs',
  'treeElapsedMs',
  'claimIntervalMs',
  'unclaimedAssignmentMs',
  'declaredHoldMs',
] as const;
const unknown = (): UsageMetric => ({
  value: null,
  coverage: 'unknown',
  overflow: false,
});
function interval(start?: string | null, end?: string | null) {
  if (!start || !end) return undefined;
  const n = Date.parse(end) - Date.parse(start);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}
function sum(values: (number | undefined)[]): UsageMetric {
  return values.length
    ? summarizeUsageMetric(values, true)
    : { value: 0, coverage: 'complete', overflow: false };
}
function group<T>(items: T[], key: (item: T) => string) {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item),
      list = result.get(id) ?? [];
    list.push(item);
    result.set(id, list);
  }
  return result;
}
function distribution(values: (number | null | undefined)[]) {
  const known = values
    .filter(
      (n): n is number => n !== null && n !== undefined && Number.isFinite(n),
    )
    .sort((a, b) => a - b);
  const n = known.length,
    middle = Math.floor(n / 2);
  return {
    count: n,
    unknown: values.length - n,
    min: n ? known[0] : null,
    max: n ? known[n - 1] : null,
    median: n
      ? n % 2
        ? known[middle]
        : known[middle - 1] + (known[middle] - known[middle - 1]) / 2
      : null,
  };
}
function measured(value: UsageMetric | number | null | undefined) {
  return typeof value === 'number'
    ? value
    : value && value.coverage === 'complete'
      ? value.value
      : null;
}
function difference(
  candidate: number | null | undefined,
  baseline: number | null | undefined,
) {
  if (candidate == null || baseline == null) return null;
  const delta = candidate - baseline;
  return Number.isSafeInteger(delta) ? delta : null;
}
function countChecks(samples: ComparisonSample[]) {
  const checks = samples.flatMap((s) => s.observation?.checks ?? []);
  return {
    pass: checks.filter((c) => c.status === 'pass').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    unknown: checks.filter((c) => c.status === 'unknown').length,
  };
}

/** Frozen trial membership and timing, with live receipts for those exact attempts. */
export class ComparisonMetrics {
  constructor(
    private store: Store,
    private usage: Usage,
  ) {}

  captureSource(scope: Set<string>) {
    return {
      attempts: group(this.usage.attemptsForRuns(scope), (a) => a.runId),
      work: group(
        this.store.forRuns<WorkRequest>('work', scope),
        (w) => w.runId,
      ),
      holds: group(
        this.store.forRuns<WorkHoldInterval>('workHolds', scope),
        (h) => h.workId,
      ),
      events: group(this.store.eventTimesForRuns(scope), (e) => e.runId),
    };
  }

  capture(
    rootId: string,
    tree: Run[],
    source: ReturnType<ComparisonMetrics['captureSource']>,
  ): ComparisonMeasurement | undefined {
    const root = tree.find((r) => r.id === rootId);
    if (!root) return undefined;
    const attempts = tree.flatMap((r) => source.attempts.get(r.id) ?? []);
    const work = tree.flatMap((r) => source.work.get(r.id) ?? []);
    const byWork = group(attempts, (a) => a.workId);
    const runIndex = new Map(tree.map((r) => [r.id, r]));
    const terminalAt = (r: Run) => {
      const type =
        r.status === 'completed'
          ? 'run.completed'
          : r.status === 'failed'
            ? 'node.failed'
            : r.status === 'cancelled'
              ? 'run.cancelled'
              : undefined;
      return source.events.get(r.id)?.findLast((e) => e.type === type)?.at;
    };
    const endTimes = tree.map((r) => Date.parse(terminalAt(r) ?? ''));
    const unclaimed: (number | undefined)[] = [],
      held: (number | undefined)[] = [];
    for (const w of work) {
      const run = runIndex.get(w.runId)!;
      const end =
        w.endedAt ??
        run.executions.find((e) => e.id === w.executionId)?.completedAt;
      const elapsed = interval(w.createdAt, end);
      const claimed = sum(
        (byWork.get(w.id) ?? []).map((a) => interval(a.claimedAt, a.endedAt)),
      );
      const intervals = (source.holds.get(w.id) ?? []).map((h) =>
        interval(h.heldAt, h.endedAt),
      );
      if (intervals.length < Math.ceil((w.holdRevision ?? 0) / 2))
        intervals.push(undefined);
      const holds = sum(intervals);
      held.push(...intervals);
      const remaining =
        elapsed !== undefined &&
        claimed.coverage === 'complete' &&
        holds.coverage === 'complete' &&
        claimed.value !== null &&
        holds.value !== null
          ? elapsed - claimed.value - holds.value
          : undefined;
      unclaimed.push(
        remaining !== undefined &&
          Number.isSafeInteger(remaining) &&
          remaining >= 0
          ? remaining
          : undefined,
      );
    }
    return {
      runIds: tree.map((r) => r.id),
      detachedRuns: tree.filter((r) => r.parentMode === 'detached').length,
      attempts: attempts.map(({ id, workId, runId, attempt, outcome }) => ({
        id,
        workId,
        runId,
        attempt,
        outcome,
      })),
      timing: {
        rootElapsedMs: interval(root.createdAt, terminalAt(root)) ?? null,
        treeElapsedMs: endTimes.every(Number.isFinite)
          ? (interval(
              root.createdAt,
              new Date(
                endTimes.reduce((a, b) => Math.max(a, b), -Infinity),
              ).toISOString(),
            ) ?? null)
          : null,
        claimIntervalMs: sum(
          attempts.map((a) => interval(a.claimedAt, a.endedAt)),
        ),
        unclaimedAssignmentMs: sum(unclaimed),
        declaredHoldMs: sum(held),
      },
    };
  }

  report(
    c: WorkflowComparison,
    caseOffset: number,
    caseLimit: number,
    currency?: string,
    detail: 'summary' | 'full' = 'summary',
  ) {
    const scope = new Set(
      c.samples.flatMap((s) => s.measurement?.runIds ?? []),
    );
    // One scoped read for the entire comparison, not one archive scan per sample.
    const receipts = new Map(
      this.store
        .forRuns<UsageAttempt>('usageAttempts', scope)
        .map((a) => [a.id, a]),
    );
    const judgments = group(c.judgments, (j) => j.sampleId);
    const attempts = new Map(
      c.samples.map((s) => [
        s.id,
        (s.measurement?.attempts ?? []).map((ref) => {
          const current = receipts.get(ref.id);
          if (
            current &&
            current.runId === ref.runId &&
            current.workId === ref.workId &&
            current.attempt === ref.attempt
          )
            return { ...current, outcome: ref.outcome };
          return {
            ...ref,
            nodeId: '',
            label: '',
            workerId: null,
            claimedAt: null,
          } satisfies UsageAttempt;
        }),
      ]),
    );
    const sampleUsage = new Map(
      c.samples.map((s) => [s.id, summarizeUsage(attempts.get(s.id) ?? [])]),
    );
    const state = (s: ComparisonSample) =>
      !s.observation
        ? 'pending'
        : s.observation.status === 'not_started'
          ? 'not_started'
          : s.measurement
            ? 'captured'
            : s.observation.status === 'unavailable'
              ? 'unavailable'
              : 'legacy';
    const usageFor = (samples: ComparisonSample[]) => {
      const records = samples.flatMap((s) => attempts.get(s.id) ?? []);
      const totals = summarizeUsage(records);
      const unknownCohorts = samples.filter((s) =>
        ['legacy', 'unavailable'].includes(state(s)),
      ).length;
      if (unknownCohorts) {
        for (const metric of [
          ...Object.values(totals.tokens),
          ...totals.costs.map((c) => c.amountMicros),
        ])
          if (metric.coverage === 'complete') metric.coverage = 'partial';
        if (totals.costCoverage === 'complete') totals.costCoverage = 'partial';
      }
      const sources = records.map(selectedUsageReport);
      return {
        ...totals,
        costs: currency
          ? totals.costs.filter((c) => c.currency === currency)
          : totals.costs.slice(0, 10),
        currencyCount: totals.costs.length,
        currenciesTruncated: !currency && totals.costs.length > 10,
        unknownCohorts,
        missingReceipts: samples
          .flatMap((s) => s.measurement?.attempts ?? [])
          .filter((a) => !receipts.has(a.id)).length,
        sources: {
          executor: sources.filter((s) => s?.source === 'executor').length,
          observer: sources.filter((s) => s?.source === 'observer').length,
          unknown: sources.filter((s) => !s).length,
        },
      };
    };
    const summarize = (samples: ComparisonSample[]) => {
      const observed = samples.filter(
        (s) => s.observation && s.observation.status !== 'not_started',
      );
      const counts = {
        running: 0,
        waiting: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        unavailable: 0,
        not_started: 0,
        pending: 0,
      };
      for (const s of samples) counts[s.observation?.status ?? 'pending']++;
      return {
        samples: samples.length,
        execution: counts,
        checks: countChecks(samples),
        timing: Object.fromEntries(
          timingNames.map((name) => [
            name,
            distribution(
              observed.map((s) => measured(s.measurement?.timing[name])),
            ),
          ]),
        ) as Record<keyof Timing, ReturnType<typeof distribution>>,
        usage: usageFor(samples),
        quality: {
          judgedSamples: observed.filter((s) => judgments.has(s.id)).length,
          unjudgedSamples: observed.filter((s) => !judgments.has(s.id)).length,
          judgments: samples.reduce(
            (n, s) => n + (judgments.get(s.id)?.length ?? 0),
            0,
          ),
          rubricCount: new Set(
            samples.flatMap((s) =>
              (judgments.get(s.id) ?? []).map((j) => j.rubric),
            ),
          ).size,
          scoreAggregation: 'none' as const,
        },
      };
    };
    const sample = (s: ComparisonSample) => ({
      state: state(s),
      runCount: s.measurement?.runIds.length ?? null,
      detachedRuns: s.measurement?.detachedRuns ?? null,
      timing:
        detail === 'full'
          ? (s.measurement?.timing ?? {
              rootElapsedMs: null,
              treeElapsedMs: null,
              claimIntervalMs: unknown(),
              unclaimedAssignmentMs: unknown(),
              declaredHoldMs: unknown(),
            })
          : undefined,
      usage: detail === 'full' ? usageFor([s]) : undefined,
      quality:
        detail === 'full'
          ? { judgments: judgments.get(s.id)?.length ?? 0 }
          : undefined,
    });
    const sides = {
      baseline: summarize(c.samples.filter((s) => s.side === 'baseline')),
      candidate: summarize(c.samples.filter((s) => s.side === 'candidate')),
    };
    const cases = c.suite.cases
      .slice(caseOffset, caseOffset + caseLimit)
      .map((test) => {
        const samples = c.samples.filter((s) => s.caseId === test.id);
        const pairs = Array.from({ length: c.repetitions }, (_, i) => ({
          baseline: samples.find(
            (s) => s.side === 'baseline' && s.repetition === i + 1,
          ),
          candidate: samples.find(
            (s) => s.side === 'candidate' && s.repetition === i + 1,
          ),
        }));
        const currencies = [
          ...new Set(
            samples.flatMap((s) =>
              sampleUsage.get(s.id)!.costs.map((x) => x.currency),
            ),
          ),
        ].sort();
        const cost = (s: ComparisonSample | undefined, currency: string) => {
          if (!s?.measurement) return null;
          const u = sampleUsage.get(s.id)!;
          // Different-currency trials are not comparable by treating an absent currency as zero.
          if (
            u.costCoverage !== 'complete' ||
            u.costs.length !== 1 ||
            u.costs[0].currency !== currency
          )
            return null;
          return measured(u.costs[0].amountMicros);
        };
        const baseline = summarize(
          samples.filter((s) => s.side === 'baseline'),
        );
        const candidate = summarize(
          samples.filter((s) => s.side === 'candidate'),
        );
        const compact = (s: ReturnType<typeof summarize>) => ({
          execution: s.execution,
          checks: s.checks,
          quality: s.quality,
        });
        return {
          caseId: test.id,
          name: test.name,
          repetitions: c.repetitions,
          baseline: detail === 'full' ? baseline : compact(baseline),
          candidate: detail === 'full' ? candidate : compact(candidate),
          paired: {
            deltaDirection: 'candidate_minus_baseline' as const,
            timing: Object.fromEntries(
              timingNames.map((name) => [
                name,
                distribution(
                  pairs.map((p) =>
                    difference(
                      measured(p.candidate?.measurement?.timing[name]),
                      measured(p.baseline?.measurement?.timing[name]),
                    ),
                  ),
                ),
              ]),
            ) as Record<keyof Timing, ReturnType<typeof distribution>>,
            costs: (currency
              ? currencies.filter((c) => c === currency)
              : currencies.slice(0, 10)
            ).map((currency) => ({
              currency,
              amountMicros: distribution(
                pairs.map((p) =>
                  difference(
                    cost(p.candidate, currency),
                    cost(p.baseline, currency),
                  ),
                ),
              ),
            })),
            currencyCount: currencies.length,
            currenciesTruncated: !currency && currencies.length > 10,
            bothJudged: pairs.filter(
              (p) =>
                p.baseline &&
                p.candidate &&
                judgments.has(p.baseline.id) &&
                judgments.has(p.candidate.id),
            ).length,
            sharedRubricPairs: pairs.filter(
              (p) =>
                p.baseline &&
                p.candidate &&
                (judgments.get(p.baseline.id) ?? []).some((a) =>
                  (judgments.get(p.candidate!.id) ?? []).some(
                    (b) => a.rubric === b.rubric,
                  ),
                ),
            ).length,
          },
        };
      });
    const pending = c.samples.filter((s) => state(s) === 'pending').length;
    const reasons: string[] = [];
    if (pending) reasons.push('execution_pending');
    if (c.samples.some((s) => state(s) === 'not_started'))
      reasons.push('trials_not_started');
    if (c.samples.some((s) => ['legacy', 'unavailable'].includes(state(s))))
      reasons.push('measurement_history_unavailable');
    if (
      Object.values(sides).some((s) =>
        Object.values(s.timing).some((t) => t.unknown > 0),
      )
    )
      reasons.push('timing_incomplete');
    if (Object.values(sides).some((s) => s.usage.costCoverage !== 'complete'))
      reasons.push('reported_cost_incomplete');
    if (Object.values(sides).some((s) => s.quality.unjudgedSamples))
      reasons.push('quality_unjudged');
    if (
      c.samples.some((a) => {
        if (a.side !== 'baseline' || !judgments.has(a.id)) return false;
        const b = c.samples.find(
          (b) =>
            b.side === 'candidate' &&
            b.caseId === a.caseId &&
            b.repetition === a.repetition,
        );
        return (
          b &&
          judgments.has(b.id) &&
          !(judgments.get(a.id) ?? []).some((x) =>
            (judgments.get(b.id) ?? []).some((y) => x.rubric === y.rubric),
          )
        );
      })
    )
      reasons.push('quality_rubrics_unmatched');
    return {
      sample,
      summary: {
        asOf: new Date().toISOString(),
        currency: currency ?? null,
        detail,
        availability: {
          state: pending
            ? ('pending' as const)
            : reasons.length
              ? ('insufficient_evidence' as const)
              : ('descriptive' as const),
          reasons,
        },
        sides,
        cases: {
          total: c.suite.cases.length,
          offset: caseOffset,
          items: cases,
          nextOffset:
            caseOffset + cases.length < c.suite.cases.length
              ? caseOffset + cases.length
              : (null as number | null),
        },
      },
    };
  }
}
