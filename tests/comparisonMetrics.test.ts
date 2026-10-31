import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  type WorkflowDefinition,
  type WorkflowComparison,
  type UsageAttempt,
  type WorkRequest,
} from '@interlock/core';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';

const engines: Engine[] = [],
  dirs: string[] = [];
const worker = {
  workerId: 'fixture',
  freshContext: false,
  tools: [],
  skills: [],
};
const epoch = Date.parse('2026-01-01T00:00:00Z');
function time(ms: number) {
  vi.setSystemTime(epoch + ms);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  time(0);
});
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function engine(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
function publish(e: Engine, d = blankDefinition()) {
  const w = e.create('Metrics fixture', '', d);
  e.publish(w.id);
  return w;
}
function launch(
  e: Engine,
  options: {
    definition?: WorkflowDefinition;
    cases?: number;
    input?: any;
    concurrency?: number;
  } = {},
) {
  const w = publish(e, options.definition);
  e.publish(w.id);
  const suite = e.testbench.createSuite({
    workflowId: w.id,
    content: {
      name: 'Metrics',
      cases: Array.from({ length: options.cases ?? 1 }, (_, i) => ({
        id: `case${i}`,
        name: `Case ${i}`,
        input: options.input ?? {},
        assertions: [],
      })),
    },
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: 1,
    candidateVersion: 2,
    concurrency: options.concurrency ?? 2,
  };
  const c = e.testbench.start({
    ...selection,
    confirmation: e.testbench.preview(selection).confirmation,
    requestId: `fixture-${w.id}`,
  });
  e.pump();
  const report = (extra = {}) =>
    e.testbench.report({ id: c.id, metricsDetail: 'full', ...extra });
  const work = (side: 'baseline' | 'candidate') =>
    e.available().find((w) => e.run(w.runId).comparison?.side === side)!;
  return { id: c.id, report, work };
}
function usage(
  e: Engine,
  work: WorkRequest,
  amountMicros: number,
  extra: Record<string, unknown> = {},
) {
  e.usage.report({
    workId: work.id,
    attempt: work.attempt,
    token: work.token!,
    snapshot: {
      sequence: 1,
      final: true,
      models: [
        {
          provider: 'synthetic',
          model: 'fixture',
          inputTokens: 10,
          outputTokens: 5,
          cost: { amountMicros, currency: 'USD', source: 'test fixture' },
        },
      ],
    },
    ...extra,
  } as any);
}
function finishAll(e: Engine, amount = 100) {
  const start = Date.now() - epoch;
  let rounds = 0;
  while (e.available().length && rounds++ < 200) {
    time(start + rounds * 1000);
    const w = e.claim(e.available()[0].id, worker);
    usage(e, w, amount);
    time(start + rounds * 1000 + 500);
    e.submit(w.id, w.token!, { ok: true });
  }
  expect(rounds).toBeLessThan(200);
}

it('separates root/tree, claim, unclaimed and held time and reports paired candidate-minus-baseline measurements', () => {
  const e = engine(),
    c = launch(e);
  time(1000);
  const a = e.claim(c.work('baseline').id, worker);
  usage(e, a, 1000);
  time(2000);
  e.manageWorkHold({
    action: 'hold',
    workId: a.id,
    expectedAttempt: a.attempt,
    expectedRevision: 0,
    token: a.token!,
    category: 'other',
    reason: 'Fixture wait',
    checkpointRef: 'fixture',
    actor: 'fixture',
  });
  time(3000);
  const b = e.claim(c.work('candidate').id, worker);
  usage(e, b, 4000);
  time(5000);
  e.manageWorkHold({
    action: 'resume',
    workId: a.id,
    expectedAttempt: 1,
    expectedRevision: 1,
    actor: 'fixture',
  });
  time(6000);
  const a2 = e.claim(a.id, worker);
  usage(e, a2, 2000);
  time(7000);
  e.submit(a2.id, a2.token!, { ok: true });
  time(9000);
  e.submit(b.id, b.token!, { ok: true });
  const r = c.report();
  expect(r.status).toBe('completed');
  expect(r.metrics.sides.baseline.timing).toMatchObject({
    rootElapsedMs: { median: 7000, count: 1 },
    treeElapsedMs: { median: 7000 },
    claimIntervalMs: { median: 2000 },
    unclaimedAssignmentMs: { median: 2000 },
    declaredHoldMs: { median: 3000 },
  });
  expect(r.metrics.sides.baseline.usage).toMatchObject({
    attempts: 2,
    costs: [
      { currency: 'USD', amountMicros: { value: 3000, coverage: 'complete' } },
    ],
  });
  expect(r.metrics.cases.items[0].paired).toMatchObject({
    timing: {
      rootElapsedMs: { median: 2000 },
      claimIntervalMs: { median: 4000 },
    },
    costs: [{ currency: 'USD', amountMicros: { median: 1000, count: 1 } }],
  });
  expect(r.metrics.availability).toMatchObject({
    state: 'insufficient_evidence',
    reasons: ['quality_unjudged'],
  });
  expect(r.metrics.sides.baseline.quality.unjudgedSamples).toBe(1);
  expect(JSON.stringify(r)).not.toContain(a.token);
  expect(JSON.stringify(r)).not.toContain('tokenHash');
  expect(JSON.stringify(r)).not.toContain('runIds');
});

it('freezes failed-trial membership/timing across retry and restart but selects late receipts for original attempts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'comparison-metrics-'));
  dirs.push(dir);
  const path = join(dir, 'test.db');
  let e = engine(path);
  const d = blankDefinition();
  if (d.nodes[1].kind === 'agent') d.nodes[1].maxAttempts = 1;
  const c = launch(e, { definition: d });
  time(1000);
  const old = e.claim(c.work('baseline').id, worker);
  usage(e, old, 100);
  time(2000);
  e.reportFailure(old.id, old.token!, 'Fixture failure');
  const original = c.report().samples.find((s) => s.side === 'baseline')!;
  time(3000);
  e.retry(old.runId);
  const retry = e.claim(
    e.available().find((w) => w.runId === old.runId)!.id,
    worker,
  );
  usage(e, retry, 9999);
  time(6000);
  e.submit(retry.id, retry.token!, { ok: true });
  e.usage.report({
    source: 'observer',
    workId: old.id,
    attempt: old.attempt,
    snapshot: {
      sequence: 1,
      final: true,
      models: [
        {
          provider: 'synthetic',
          model: 'fixture',
          inputTokens: 20,
          cost: {
            amountMicros: 500,
            currency: 'USD',
            source: 'observer fixture',
          },
        },
      ],
    },
  });
  finishAll(e);
  e.stop();
  e.store.close();
  engines.pop();
  e = engine(path);
  const r = e.testbench.report({ id: c.id, metricsDetail: 'full' }),
    a = r.samples.find((s) => s.side === 'baseline')!;
  expect(a.observation?.status).toBe('failed');
  expect(a.currentStatus).toBe('completed');
  expect(a.metrics.timing).toEqual(original.metrics.timing);
  expect(a.metrics.usage).toMatchObject({
    attempts: 1,
    sources: { observer: 1 },
    costs: [{ currency: 'USD', amountMicros: { value: 500 } }],
  });
});

it('preserves unknown/partial usage and never merges observer metrics or compares different currencies as zero', () => {
  const e = engine(),
    c = launch(e);
  const a = e.claim(c.work('baseline').id, worker);
  usage(e, a, 1000);
  e.submit(a.id, a.token!, {});
  const b = e.claim(c.work('candidate').id, worker);
  usage(e, b, 2000, {
    snapshot: {
      sequence: 1,
      final: true,
      models: [
        {
          provider: 'synthetic',
          model: 'fixture',
          cost: { amountMicros: 2000, currency: 'EUR', source: 'fixture' },
        },
      ],
    },
  });
  e.submit(b.id, b.token!, {});
  e.usage.report({
    source: 'observer',
    workId: a.id,
    attempt: 1,
    snapshot: {
      sequence: 1,
      final: false,
      models: [{ provider: 'synthetic', model: 'fixture', outputTokens: 1 }],
    },
  });
  let r = c.report();
  expect(r.metrics.sides.baseline.usage.tokens.inputTokens).toMatchObject({
    value: null,
    coverage: 'unknown',
  });
  expect(r.metrics.sides.baseline.usage.costCoverage).toBe('unknown');
  e.usage.report({
    source: 'observer',
    workId: a.id,
    attempt: 1,
    snapshot: {
      sequence: 2,
      final: true,
      models: [
        {
          provider: 'synthetic',
          model: 'fixture',
          outputTokens: 1,
          cost: { amountMicros: 500, currency: 'USD', source: 'fixture' },
        },
      ],
    },
  });
  r = c.report();
  expect(
    r.metrics.cases.items[0].paired.costs.map((x) => x.amountMicros),
  ).toEqual([
    { count: 0, unknown: 1, min: null, max: null, median: null },
    { count: 0, unknown: 1, min: null, max: null, median: null },
  ]);
  expect(r.metrics.sides.baseline.usage.costs[0].amountMicros.value).toBe(500);
});

it.each(['wait', 'detached'] as const)(
  'captures nested Batch descendants exactly once for %s calls',
  (mode) => {
    const e = engine(),
      child = publish(e, batchDefinition()),
      c = launch(e, {
        definition: workflowCall(child.id, mode),
        input: [1, 2],
      });
    if (mode === 'detached') {
      expect(
        c.report().samples.every((s) => s.currentStatus === 'completed'),
      ).toBe(true);
      expect(c.report().metrics.availability.state).toBe('pending');
    }
    finishAll(e);
    const r = c.report();
    for (const side of ['baseline', 'candidate'] as const) {
      expect(r.metrics.sides[side].usage).toMatchObject({
        attempts: 2,
        costs: [{ amountMicros: { value: 200, coverage: 'complete' } }],
      });
      const s = r.samples.find((s) => s.side === side)!;
      expect(s.metrics.runCount).toBe(4);
      expect(s.metrics.detachedRuns).toBe(mode === 'detached' ? 1 : 0);
      if (mode === 'detached') expect(s.metrics.timing!.rootElapsedMs).toBe(0);
      expect(s.metrics.timing!.treeElapsedMs).toBeGreaterThan(0);
    }
  },
);

it('keeps legacy observations unknown and captured timing intact when underlying history is lost', () => {
  const e = engine(),
    c = launch(e);
  finishAll(e);
  const stored = e.store.get<WorkflowComparison>('comparisons', c.id)!;
  const a = stored.samples.find((s) => s.side === 'baseline')!;
  delete a.measurement;
  e.store.put('comparisons', stored);
  let r = c.report();
  expect(r.metrics.sides.baseline.usage.unknownCohorts).toBe(1);
  expect(r.samples.find((s) => s.side === 'baseline')!.metrics.state).toBe(
    'legacy',
  );
  const b = stored.samples.find((s) => s.side === 'candidate')!,
    timing = b.measurement!.timing;
  for (const id of b.measurement!.runIds) {
    e.store.remove('runs', id);
    for (const attempt of e.store.forRuns<UsageAttempt>(
      'usageAttempts',
      new Set([id]),
    ))
      e.store.remove('usageAttempts', attempt.id);
  }
  r = c.report();
  const sample = r.samples.find((s) => s.side === 'candidate')!;
  expect(sample.historyAvailable).toBe(false);
  expect(sample.metrics.timing).toEqual(timing);
  expect(sample.metrics.usage).toMatchObject({
    attempts: 1,
    missingReceipts: 1,
    costCoverage: 'unknown',
  });
});

it('reports cancellation and queued samples without inventing execution or quality', () => {
  const e = engine(),
    c = launch(e, { concurrency: 1 });
  time(1000);
  e.testbench.cancel({ id: c.id });
  e.pump();
  const r = c.report();
  expect(r.status).toBe('cancelled');
  expect(r.metrics.sides.baseline.execution.cancelled).toBe(1);
  expect(r.metrics.sides.candidate.execution.not_started).toBe(1);
  expect(r.samples.find((s) => s.side === 'candidate')!.metrics.state).toBe(
    'not_started',
  );
  expect(r.metrics.availability.reasons).toContain('trials_not_started');
});

it('keeps complete side totals independent of all pages and counts judgments without averaging unrelated rubrics', () => {
  const e = engine(),
    c = launch(e, { cases: 6 });
  finishAll(e);
  const first = c.report({ limit: 1, caseLimit: 1, judgmentLimit: 1 });
  for (const s of c.report({ limit: 25 }).samples) {
    for (const rubric of ['Accuracy', 'Style'])
      e.testbench.judge({
        id: c.id,
        sampleId: s.id,
        reviewer: 'Fixture',
        reviewerKind: 'agent',
        rubric,
        score: rubric === 'Accuracy' ? 5 : 1,
      });
  }
  const a = c.report({ limit: 1, caseLimit: 1, judgmentLimit: 1 }),
    b = c.report({
      offset: 5,
      limit: 1,
      caseOffset: 5,
      caseLimit: 1,
      judgmentOffset: 5,
      judgmentLimit: 1,
    });
  expect(a.metrics.sides).toEqual(b.metrics.sides);
  expect(a.metrics.sides.baseline).toMatchObject({
    samples: 6,
    usage: { attempts: 6 },
    quality: {
      judgedSamples: 6,
      unjudgedSamples: 0,
      judgments: 12,
      rubricCount: 2,
      scoreAggregation: 'none',
    },
  });
  expect(a.metrics.cases).toMatchObject({ total: 6, nextOffset: 1 });
  expect(b.metrics.cases.nextOffset).toBeNull();
  expect(a.metrics.availability.state).toBe('descriptive');
  expect(first.metrics.sides.baseline.usage).toEqual(
    a.metrics.sides.baseline.usage,
  );
});

it('keeps default measurement reports compact while preserving whole-side statistics', () => {
  const e = engine(),
    c = launch(e, { cases: 6 });
  finishAll(e);
  const summary = e.testbench.report({ id: c.id }),
    full = c.report();
  expect(summary.metrics.detail).toBe('summary');
  expect(summary.metrics.sides).toEqual(full.metrics.sides);
  expect(summary.metrics.cases.items.map((c) => c.paired)).toEqual(
    full.metrics.cases.items.map((c) => c.paired),
  );
  expect(
    summary.samples.every(
      (s) => s.metrics.timing === undefined && s.metrics.usage === undefined,
    ),
  ).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(
    Buffer.byteLength(JSON.stringify(full)) * 0.65,
  );
});

it('marks invalid claim timestamps and overflowing usage as incomplete', () => {
  const e = engine(),
    c = launch(e, { cases: 2 });
  for (let i = 0; e.available().length && i < 4; i++) {
    const w = e.claim(e.available()[0].id, worker);
    usage(e, w, Number.MAX_SAFE_INTEGER);
    const receipt = e.store.get<UsageAttempt>('usageAttempts', `${w.id}:1`)!;
    receipt.claimedAt = 'not-a-date';
    e.store.put('usageAttempts', receipt);
    e.submit(w.id, w.token!, {});
  }
  const r = c.report();
  expect(r.metrics.sides.baseline.timing.claimIntervalMs).toMatchObject({
    count: 0,
    unknown: 2,
  });
  expect(r.metrics.sides.baseline.usage.costs[0].amountMicros).toMatchObject({
    value: null,
    overflow: true,
    coverage: 'partial',
  });
  expect(r.metrics.sides.baseline.usage.costCoverage).toBe('partial');
  expect(r.metrics.availability.reasons).toContain('timing_incomplete');
});

it('retains whole-comparison metrics and exact offsets when the byte cap shortens pages', () => {
  const e = engine(),
    c = launch(e, { cases: 25 });
  finishAll(e);
  for (const s of c.report({ limit: 25 }).samples)
    e.testbench.judge({
      id: c.id,
      sampleId: s.id,
      reviewer: 'Fixture',
      reviewerKind: 'agent',
      rubric: '条'.repeat(4000),
      score: 3,
      notes: '語'.repeat(4000),
    });
  const r = c.report({ limit: 25, caseLimit: 25, judgmentLimit: 25 });
  expect(r.truncated).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(262144);
  expect(r.metrics.sides.baseline.usage.attempts).toBe(25);
  expect(r.nextOffset).toBe(r.samples.length);
  expect(r.nextJudgmentOffset).toBe(r.judgments.length);
  expect(r.metrics.cases.nextOffset).toBe(
    r.metrics.cases.items.length === 25 ? null : r.metrics.cases.items.length,
  );
  const next = c.report({
    judgmentOffset: r.nextJudgmentOffset,
    judgmentLimit: 1,
    caseLimit: 1,
    limit: 1,
  });
  expect(next.judgments[0].id).not.toBe(r.judgments.at(-1)?.id);
});

it('bounds currency details and allows selecting a currency beyond the first ten', () => {
  const e = engine(),
    c = launch(e);
  while (e.available().length) {
    const w = e.claim(e.available()[0].id, worker);
    usage(e, w, 0, {
      snapshot: {
        sequence: 1,
        final: true,
        models: Array.from({ length: 11 }, (_, i) => ({
          provider: 'synthetic',
          model: `m${i}`,
          cost: {
            amountMicros: 100 + i,
            currency: `AA${String.fromCharCode(65 + i)}`,
            source: 'fixture',
          },
        })),
      },
    });
    e.submit(w.id, w.token!, {});
  }
  const r = c.report(),
    selected = c.report({ currency: 'AAK' });
  expect(r.metrics.sides.baseline.usage).toMatchObject({
    currencyCount: 11,
    currenciesTruncated: true,
  });
  expect(r.metrics.sides.baseline.usage.costs).toHaveLength(10);
  expect(selected.metrics.currency).toBe('AAK');
  expect(selected.metrics.sides.baseline.usage.costs).toMatchObject([
    { currency: 'AAK', amountMicros: { value: 110 } },
  ]);
  expect(selected.metrics.cases.items[0].paired.costs).toHaveLength(1);
  expect(
    selected.metrics.cases.items[0].paired.costs[0].amountMicros.count,
  ).toBe(0);
  expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThan(262144);
});

it('does not mark unmatched quality rubrics as comparable', () => {
  const e = engine(),
    c = launch(e);
  finishAll(e);
  for (const s of c.report().samples)
    e.testbench.judge({
      id: c.id,
      sampleId: s.id,
      reviewer: 'Fixture',
      reviewerKind: 'agent',
      rubric: s.side === 'baseline' ? 'Accuracy' : 'Style',
      score: 5,
    });
  const r = c.report();
  expect(r.metrics.cases.items[0].paired).toMatchObject({
    bothJudged: 1,
    sharedRubricPairs: 0,
  });
  expect(r.metrics.availability.reasons).toContain('quality_rubrics_unmatched');
});

it('includes expired and failed attempts in frozen costs and claim intervals', () => {
  const d = blankDefinition();
  if (d.nodes[1].kind === 'agent') d.nodes[1].maxAttempts = 3;
  const e = engine(),
    c = launch(e, { definition: d });
  time(1000);
  const a = e.claim(c.work('baseline').id, worker, 10);
  usage(e, a, 100);
  time(12000);
  e.pump();
  const a2 = e.claim(a.id, worker);
  usage(e, a2, 200);
  time(13000);
  e.reportFailure(a2.id, a2.token!, 'Fixture transient failure');
  const a3 = e.claim(a.id, worker);
  usage(e, a3, 300);
  time(14000);
  e.submit(a3.id, a3.token!, {});
  finishAll(e);
  expect(c.report().metrics.sides.baseline.usage).toMatchObject({
    attempts: 3,
    outcomes: { expired: 1, failed: 1, completed: 1 },
    costs: [{ amountMicros: { value: 600 } }],
  });
  expect(c.report().metrics.sides.baseline.timing.claimIntervalMs.median).toBe(
    13000,
  );
});
