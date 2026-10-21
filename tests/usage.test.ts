import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  reportUsageSchema,
  type ModelUsage,
  type UsageAttempt,
} from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { workflowCall } from './fixtures/detached';

const open: { engine: Engine; store: Store }[] = [];
const worker = {
  workerId: 'author',
  freshContext: false,
  tools: [],
  skills: [],
};
const model: ModelUsage = {
  provider: 'test',
  model: 'model-a',
  inputTokens: 100,
  outputTokens: 20,
};
function fixture(path = ':memory:') {
  const store = new Store(path),
    engine = new Engine(store, process.cwd());
  open.push({ store, engine });
  const workflow = engine.create('Usage', '', blankDefinition());
  engine.publish(workflow.id);
  const run = engine.start(workflow.id, {}).run;
  const work = engine.claim(engine.available(run.id)[0].id, worker, 10);
  const report = (sequence = 1, models = [model], final = false) =>
    engine.usage.report({
      workId: work.id,
      attempt: work.attempt,
      token: work.token!,
      snapshot: { sequence, final, models },
    });
  return { store, engine, workflow, run, work, report };
}
afterEach(() => {
  for (const { engine, store } of open.splice(0)) {
    engine.stop();
    store.close();
  }
  vi.useRealTimers();
});

it('keeps unknown values distinct from zero and makes cumulative retries idempotent', () => {
  const { engine, work, run, report } = fixture();
  const read = () => engine.usage.read({ runId: run.id }).totals;
  expect(read()).toMatchObject({
    attempts: 1,
    reportedAttempts: 0,
    tokens: { inputTokens: { value: null, coverage: 'unknown' } },
    costCoverage: 'unknown',
  });
  const before = engine.inspect(run.id);
  expect(report()).toMatchObject({ applied: true });
  expect(report()).toMatchObject({ applied: false });
  expect(read()).toMatchObject({
    reportedAttempts: 1,
    tokens: { inputTokens: { value: 100, coverage: 'partial' } },
  });
  expect(() => report(1, [{ ...model, inputTokens: 101 }])).toThrow(
    'different usage',
  );
  expect(report(2, [{ ...model, inputTokens: 150 }])).toMatchObject({
    applied: true,
  });
  expect(read().tokens.inputTokens.value).toBe(150);
  expect(engine.inspect(run.id).run).toEqual(before.run);
  expect(engine.inspect(run.id).work).toEqual(before.work);
  expect(JSON.stringify(engine.usage.read({ runId: run.id }))).not.toContain(
    work.token!,
  );
});

it('rejects stale, decreasing, removed, conflicting, and changed final snapshots', () => {
  const { engine, run, report } = fixture();
  report();
  expect(() => report(2, [{ ...model, outputTokens: 0 }])).toThrow('decrease');
  expect(() => report(2, [{ provider: 'test', model: 'model-a' }])).toThrow(
    'remove',
  );
  expect(() => report(2, [{ ...model, model: 'other' }])).toThrow(
    'remove a model',
  );
  report(2, [{ ...model, inputTokens: 150 }]);
  expect(() => report()).toThrow('stale');
  report(3, [{ ...model, inputTokens: 160, cachedInputTokens: 0 }], true);
  expect(
    report(3, [{ ...model, inputTokens: 160, cachedInputTokens: 0 }], true),
  ).toMatchObject({ applied: false });
  expect(() => report(4, [{ ...model, inputTokens: 170 }], true)).toThrow(
    'Final usage',
  );
  expect(engine.usage.read({ runId: run.id }).totals.tokens).toMatchObject({
    inputTokens: { value: 160, coverage: 'complete' },
    cachedInputTokens: { value: 0, coverage: 'complete' },
    reasoningOutputTokens: { value: null, coverage: 'unknown' },
  });
});

it('separates models, currencies and incomplete cost coverage without adding cache or reasoning twice', () => {
  const { engine, run, report } = fixture();
  const a = {
    ...model,
    cachedInputTokens: 50,
    reasoningOutputTokens: 10,
    cost: { amountMicros: 1250, currency: 'USD', source: 'provider response' },
  };
  const b = {
    provider: 'other',
    model: 'model-b',
    inputTokens: 200,
    cost: { amountMicros: 500, currency: 'EUR', source: 'executor estimate' },
  };
  report(1, [a, b], true);
  const result = engine.usage.read({ runId: run.id, groupBy: 'attempt' });
  expect(result.totals.tokens).toMatchObject({
    inputTokens: { value: 300, coverage: 'complete' },
    outputTokens: { value: 20, coverage: 'partial' },
  });
  expect(result.totals.costCoverage).toBe('complete');
  expect(
    result.totals.costs.map((cost) => [cost.currency, cost.amountMicros.value]),
  ).toEqual([
    ['EUR', 500],
    ['USD', 1250],
  ]);
  expect(JSON.stringify(result)).not.toContain('tokenHash');
  expect(result.groups[0].snapshot?.models).toHaveLength(2);
  expect(
    result.groups[0].snapshot?.models.find((m) => m.provider === 'other')?.cost
      ?.source,
  ).toBe('executor estimate');
});

it('retains failed and expired attempts and accepts late telemetry without restoring claim privileges', () => {
  vi.useFakeTimers();
  const { engine, work, run, report } = fixture();
  report();
  engine.reportFailure(work.id, work.token!, 'Implementation failed');
  const second = engine.claim(work.id, { ...worker, workerId: 'reviewer' }, 10);
  vi.advanceTimersByTime(10_001);
  engine.pump();
  report(2, [{ ...model, inputTokens: 120 }], true);
  engine.usage.report({
    workId: second.id,
    attempt: second.attempt,
    token: second.token!,
    snapshot: { sequence: 1, final: false, models: [model] },
  });
  const result = engine.usage.read({
    runId: run.id,
    groupBy: 'worker',
    limit: 1,
  });
  expect(result.totals).toMatchObject({
    attempts: 2,
    reportedAttempts: 2,
    outcomes: { failed: 1, expired: 1 },
    tokens: { inputTokens: { value: 220, coverage: 'partial' } },
  });
  expect(result).toMatchObject({ totalGroups: 2, nextOffset: 1 });
  expect(
    engine.usage.read({ runId: run.id, groupBy: 'worker', offset: 1 }).groups,
  ).toHaveLength(1);
  expect(() => engine.submit(work.id, work.token!, {})).toThrow();
  expect(() =>
    engine.usage.report({
      workId: work.id,
      attempt: 2,
      token: work.token!,
      snapshot: { sequence: 2, models: [model] },
    }),
  ).toThrow('does not match');
  expect(engine.run(run.id).status).toBe('failed');
});

it.each(['completed', 'cancelled'] as const)(
  'allows delayed reports after %s without changing the run',
  (outcome) => {
    const { engine, work, run, report } = fixture();
    if (outcome === 'completed') engine.submit(work.id, work.token!, {});
    else engine.cancel(run.id);
    const before = engine.run(run.id);
    report(1, [model], true);
    expect(engine.run(run.id)).toEqual(before);
    expect(engine.usage.read({ runId: run.id }).totals.outcomes[outcome]).toBe(
      1,
    );
  },
);

it('retains records across restart and deletes them with run history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'interlock-usage-'));
  const path = join(directory, 'test.db');
  const { engine, store, workflow, work, run, report } = fixture(path);
  report();
  engine.reportFailure(work.id, work.token!, 'retry');
  engine.stop();
  store.close();
  open.pop();
  const reopened = new Store(path),
    resumed = new Engine(reopened, process.cwd());
  try {
    expect(
      resumed.usage.read({ runId: run.id }).totals.tokens.inputTokens.value,
    ).toBe(100);
    expect(
      resumed.usage.report({
        workId: work.id,
        attempt: 1,
        token: work.token!,
        snapshot: { sequence: 1, models: [model] },
      }),
    ).toMatchObject({ applied: false });
    resumed.cancel(run.id);
    resumed.deleteWorkflow(workflow.id);
    expect(reopened.list('usageAttempts')).toEqual([]);
  } finally {
    resumed.stop();
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each(['wait', 'detached'] as const)(
  'includes %s descendants only when requested and never double-counts them',
  (mode) => {
    const { engine, workflow, run, report } = fixture();
    report(1, [model], true);
    const parent = engine.create('Parent', '', workflowCall(workflow.id, mode));
    engine.publish(parent.id);
    const root = engine.start(parent.id, {}).run;
    const child = engine.inspect(root.id).descendants[0];
    const work = engine.claim(engine.available(child.id)[0].id, worker);
    engine.usage.report({
      workId: work.id,
      attempt: work.attempt,
      token: work.token!,
      snapshot: { sequence: 1, final: true, models: [model] },
    });
    expect(engine.usage.read({ runId: root.id }).totals.attempts).toBe(0);
    expect(
      engine.usage.read({ runId: root.id, includeDescendants: true }),
    ).toMatchObject({
      includedRuns: 2,
      includedDetachedRuns: mode === 'detached' ? 1 : 0,
      totals: { attempts: 1, tokens: { inputTokens: { value: 100 } } },
    });
    expect(
      engine.usage.read({ runId: run.id, includeDescendants: true }).totals
        .attempts,
    ).toBe(1);
  },
);

it('leaves legacy attempt history unknown and lazily accepts the retained current claim', () => {
  const { engine, store, work, run } = fixture();
  engine.reportFailure(work.id, work.token!, 'retry');
  const latest = engine.claim(work.id, { ...worker, workerId: 'new-worker' });
  for (const record of store.list<UsageAttempt>('usageAttempts'))
    store.remove('usageAttempts', record.id);
  const before = store.work();
  expect(
    engine.usage
      .read({ runId: run.id, groupBy: 'attempt' })
      .groups.map((g) => g.workerId),
  ).toEqual([null, 'new-worker']);
  expect(store.work()).toEqual(before);
  expect(store.list('usageAttempts')).toEqual([]);
  engine.usage.report({
    workId: work.id,
    attempt: 2,
    token: latest.token!,
    snapshot: { sequence: 1, final: true, models: [model] },
  });
  expect(engine.usage.read({ runId: run.id }).totals).toMatchObject({
    attempts: 2,
    reportedAttempts: 1,
    tokens: { inputTokens: { value: 100, coverage: 'partial' } },
  });
});

it('rejects invalid counts, subset counts, duplicate models and unprovenanced costs', () => {
  for (const models of [
    [{ ...model, inputTokens: -1 }],
    [{ ...model, outputTokens: 1.5 }],
    [{ ...model, inputTokens: Infinity }],
    [{ ...model, cachedInputTokens: 101 }],
    [{ ...model, reasoningOutputTokens: 21 }],
    [model, model],
    [{ ...model, cost: { amountMicros: 3, currency: 'USD' } }],
  ])
    expect(
      reportUsageSchema.safeParse({
        workId: 'work',
        attempt: 1,
        token: 'token',
        snapshot: { sequence: 1, models },
      }).success,
    ).toBe(false);
});

it('marks aggregate overflow explicitly rather than returning an imprecise total', () => {
  const { engine, run, report } = fixture();
  report(
    1,
    [
      { ...model, inputTokens: Number.MAX_SAFE_INTEGER },
      { ...model, model: 'b', inputTokens: 1 },
    ],
    true,
  );
  expect(
    engine.usage.read({ runId: run.id }).totals.tokens.inputTokens,
  ).toEqual({ value: null, coverage: 'partial', overflow: true });
});

it('preserves prior usage when an explicit retry creates a new assignment', () => {
  const { engine, work, run, report } = fixture();
  report(1, [model], true);
  engine.reportFailure(work.id, work.token!, 'first');
  const second = engine.claim(work.id, worker);
  engine.reportFailure(second.id, second.token!, 'second');
  engine.retry(run.id);
  const third = engine.claim(engine.available(run.id)[0].id, worker);
  expect(third.id).not.toBe(work.id);
  engine.usage.report({
    workId: third.id,
    attempt: third.attempt,
    token: third.token!,
    snapshot: { sequence: 1, final: true, models: [model] },
  });
  engine.submit(third.id, third.token!, {});
  expect(engine.usage.read({ runId: run.id }).totals).toMatchObject({
    attempts: 3,
    reportedAttempts: 2,
    outcomes: { failed: 2, completed: 1 },
    tokens: { inputTokens: { value: 200, coverage: 'partial' } },
  });
});

it('canonicalizes model order and retains cost provenance across updates', () => {
  const { engine, run, report } = fixture();
  const a = {
    ...model,
    cost: { amountMicros: 100, currency: 'USD', source: 'provider' },
  };
  const b = { ...model, model: 'other' };
  report(1, [a, b]);
  expect(report(1, [b, a])).toMatchObject({ applied: false });
  for (const cost of [
    undefined,
    { ...a.cost, amountMicros: 99 },
    { ...a.cost, currency: 'EUR' },
    { ...a.cost, source: 'estimate' },
  ])
    expect(() => report(2, [{ ...a, cost }, b])).toThrow('cost');
  expect(engine.usage.read({ runId: run.id }).totals).toMatchObject({
    costs: [
      { currency: 'USD', amountMicros: { value: 100, coverage: 'partial' } },
    ],
    costCoverage: 'partial',
  });
});
