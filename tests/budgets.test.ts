import { DatabaseSync } from 'node:sqlite';
import previousRelease from './fixtures/testbench-previous-release.json';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  budgetPolicySchema,
  nodeSchema,
  type BudgetPolicy,
  type WorkRequest,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { batchDefinition, itemAgent } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';

const engines: Engine[] = [],
  dirs: string[] = [];
const worker = { workerId: 'test', tools: [], skills: [], freshContext: false };
const policy = (max = 1): BudgetPolicy => ({
  scope: 'lifecycle',
  unknownUsage: 'allow',
  limits: { claims: { max } },
});
function setup(path = ':memory:') {
  const engine = new Engine(new Store(path), process.cwd());
  engines.push(engine);
  return engine;
}
function publish(engine: Engine, definition = blankDefinition()) {
  const w = engine.create('Budget test', '', definition);
  engine.publish(w.id);
  return w.id;
}
function report(
  engine: Engine,
  work: WorkRequest,
  tokens: number,
  final = true,
  sequence = 1,
) {
  return engine.usage.report({
    workId: work.id,
    attempt: work.attempt,
    token: work.token!,
    snapshot: {
      sequence,
      final,
      models: [
        {
          provider: 'test',
          model: 'test',
          inputTokens: tokens,
          outputTokens: tokens,
        },
      ],
    },
  });
}
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  vi.useRealTimers();
});

it('keeps unrestricted behavior and rejects invalid policies atomically at startup', () => {
  const e = setup(),
    id = publish(e);
  const run = e.start(id, {}).run;
  expect(e.budgets.read(run.id)).toEqual({
    runId: run.id,
    revision: 0,
    budget: null,
    governing: [],
  });
  expect(e.available(run.id)).toHaveLength(1);
  for (const bad of [
    {},
    { ...policy(), scope: 'bad' },
    { ...policy(), limits: {} },
    { ...policy(), limits: { claims: { max: 2, warnAt: 3 } } },
    { ...policy(), limits: { claims: { max: -1 } } },
  ]) {
    expect(budgetPolicySchema.safeParse(bad).success).toBe(false);
    expect(() => e.start(id, {}, undefined, bad as BudgetPolicy)).toThrow();
  }
  expect(e.store.runs()).toHaveLength(1);
});

it('serializes admission across competing claims, exposes blockers, and preserves completed work on resume', async () => {
  const e = setup(),
    id = publish(e, batchDefinition()),
    run = e.start(id, [1, 2, 3], undefined, policy()).run;
  const available = e.available(run.id);
  expect(available).toHaveLength(2);
  const results = await Promise.allSettled(
    available.map((w) => Promise.resolve().then(() => e.claim(w.id, worker))),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const claim = (
    results.find(
      (r) => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<WorkRequest>
  ).value;
  expect(e.available(run.id)).toHaveLength(0);
  expect(() =>
    e.claim(available.find((w) => w.id !== claim.id)!.id, worker),
  ).toThrow('No claim was granted');
  const brief = e.continuation.briefing({ id: run.id, limit: 20 });
  expect(brief).toMatchObject({
    next: 'adjust_budget',
    available: { total: 0 },
    budgetBlocked: { total: 1 },
  });
  expect(brief.blockers.items.some((b) => b.reason === 'budget_blocked')).toBe(
    true,
  );
  expect(e.continuation.summary(run.id, 20)).toMatchObject({
    next: 'adjust_budget',
    budgetBlocked: { total: 1 },
  });
  e.renew(claim.id, claim.token!, 30);
  report(e, claim, 5);
  e.submit(claim.id, claim.token!, 10);
  expect(e.budgets.read(run.id).governing[0].attempts).toBe(1);
  const before = e.run(claim.runId);
  e.budgets.set({ runId: run.id, expectedRevision: 1, budget: policy(3) });
  expect(e.run(claim.runId)).toEqual(before);
  expect(e.available(run.id)).toHaveLength(2);
  for (const w of e.available(run.id)) {
    const c = e.claim(w.id, worker);
    e.submit(c.id, c.token!, 20);
  }
  expect(e.run(run.id).status).toBe('completed');
  expect(e.budgets.read(run.id).governing[0].attempts).toBe(3);
});

it('warns at exact thresholds and blocks reported totals while allowing in-flight overshoot', () => {
  const e = setup(),
    p: BudgetPolicy = {
      scope: 'tree',
      unknownUsage: 'allow',
      limits: {
        inputTokens: { max: 100, warnAt: 50 },
        outputTokens: { max: 200 },
      },
    };
  const run = e.start(
    publish(e, batchDefinition()),
    [1, 2, 3],
    undefined,
    p,
  ).run;
  const [a, b] = e.available(run.id).map((w) => e.claim(w.id, worker));
  report(e, a, 50, false);
  expect(e.budgets.read(run.id).governing[0]).toMatchObject({
    state: 'warning',
    inFlight: 2,
    checks: [
      { value: 50, warnings: ['usage_incomplete', 'warning_threshold'] },
      { value: 50 },
    ],
  });
  report(e, a, 100, true, 2);
  e.submit(a.id, a.token!, 1);
  expect(e.available(run.id)).toHaveLength(0);
  report(e, b, 30);
  e.submit(b.id, b.token!, 2);
  expect(e.budgets.read(run.id).governing[0].checks[0]).toMatchObject({
    value: 130,
    reasons: ['limit_reached'],
  });
  expect(e.run(run.id).status).toBe('waiting');
  e.budgets.set({
    runId: run.id,
    expectedRevision: 1,
    budget: { ...p, limits: { inputTokens: { max: 200 } } },
  });
  expect(e.available(run.id)).toHaveLength(1);
});

it('blocks incomplete usage only after a claim, resumes on final reports, and never treats missing cost as zero', () => {
  const e = setup(),
    p: BudgetPolicy = {
      scope: 'tree',
      unknownUsage: 'block',
      limits: { inputTokens: { max: 100 } },
    };
  const run = e.start(publish(e, batchDefinition()), [1, 2], undefined, p).run;
  const c = e.claim(e.available(run.id)[0].id, worker);
  expect(e.available(run.id)).toHaveLength(0);
  report(e, c, 0, false);
  expect(e.available(run.id)).toHaveLength(0);
  const cursor = e.continuation.briefing({ id: run.id, limit: 20 }).cursor;
  report(e, c, 0, true, 2);
  expect(e.available(run.id)).toHaveLength(1);
  expect(e.continuation.briefing({ id: run.id, limit: 20 }).cursor).not.toBe(
    cursor,
  );
  e.budgets.set({
    runId: run.id,
    expectedRevision: 1,
    budget: {
      ...p,
      limits: { cost: { currency: 'USD', threshold: { max: 100 } } },
    },
  });
  expect(e.available(run.id)).toHaveLength(0);
  expect(e.budgets.read(run.id).governing[0].checks[0]).toMatchObject({
    value: null,
    coverage: 'unknown',
    reasons: ['usage_incomplete'],
  });
});

it('uses one cost currency and handles overflow without rounding down', () => {
  const e = setup(),
    p: BudgetPolicy = {
      scope: 'run',
      unknownUsage: 'block',
      limits: { cost: { currency: 'USD', threshold: { max: 100 } } },
    };
  const run = e.start(publish(e), {}, undefined, p).run,
    c = e.claim(e.available(run.id)[0].id, worker);
  e.usage.report({
    workId: c.id,
    attempt: 1,
    token: c.token!,
    snapshot: {
      sequence: 1,
      final: true,
      models: [
        {
          provider: 'a',
          model: 'a',
          cost: { currency: 'EUR', source: 'fixture', amountMicros: 10 },
        },
      ],
    },
  });
  expect(e.budgets.read(run.id).governing[0].checks[0].coverage).toBe(
    'unknown',
  );
  e.budgets.set({
    runId: run.id,
    expectedRevision: 1,
    budget: {
      ...p,
      limits: { cost: { currency: 'EUR', threshold: { max: 10 } } },
    },
  });
  expect(e.budgets.read(run.id).governing[0].checks[0]).toMatchObject({
    value: 10,
    reasons: ['limit_reached'],
  });
  const run2 = e.start(publish(e), {}, undefined, {
    ...policy(),
    limits: { inputTokens: { max: Number.MAX_SAFE_INTEGER } },
  }).run;
  const c2 = e.claim(e.available(run2.id)[0].id, worker);
  e.usage.report({
    workId: c2.id,
    attempt: 1,
    token: c2.token!,
    snapshot: {
      sequence: 1,
      models: [
        { provider: 'a', model: 'a', inputTokens: Number.MAX_SAFE_INTEGER },
        { provider: 'b', model: 'b', inputTokens: 1 },
      ],
    },
  });
  expect(e.budgets.read(run2.id).governing[0].checks[0]).toMatchObject({
    value: null,
    overflow: true,
    reasons: ['limit_reached'],
  });
});

it('counts failed, expired, and explicit retry attempts without resetting history', () => {
  vi.useFakeTimers();
  const e = setup(),
    run = e.start(publish(e), {}, undefined, policy(2)).run;
  const a = e.claim(e.available(run.id)[0].id, worker, 10);
  e.reportFailure(a.id, a.token!, 'failure');
  const b = e.claim(e.available(run.id)[0].id, worker, 10);
  vi.advanceTimersByTime(10001);
  e.pump();
  expect(e.run(run.id).status).toBe('failed');
  e.retry(run.id);
  expect(e.available(run.id)).toHaveLength(0);
  expect(e.budgets.read(run.id).governing[0].attempts).toBe(2);
  report(e, a, 1);
  report(e, b, 2);
  e.budgets.set({ runId: run.id, expectedRevision: 1, budget: policy(3) });
  const c = e.claim(e.available(run.id)[0].id, worker);
  e.submit(c.id, c.token!, {});
  expect(e.budgets.read(run.id).governing[0].attempts).toBe(3);
});

it.each(['run', 'lifecycle', 'tree'] as const)(
  'applies explicit %s scope across detached boundaries and composes nested gates',
  (scope) => {
    const e = setup(),
      leaf = publish(e),
      middle = publish(e, workflowCall(leaf, 'detached', true)),
      root = publish(e, workflowCall(middle));
    const run = e.start(root, {}, undefined, { ...policy(0), scope }).run;
    const middleRun = e.store.runs().find((r) => r.workflowId === middle)!,
      leafRun = e.store.runs().find((r) => r.workflowId === leaf)!;
    expect(e.available(run.id)).toHaveLength(
      scope === 'run' ? 2 : scope === 'lifecycle' ? 1 : 0,
    );
    expect(e.budgets.read(leafRun.id).governing).toHaveLength(
      scope === 'tree' ? 1 : 0,
    );
    e.budgets.set({
      runId: middleRun.id,
      expectedRevision: 0,
      budget: policy(0),
    });
    expect(
      e.available(middleRun.id).filter((w) => w.runId === middleRun.id),
    ).toHaveLength(0);
    e.budgets.set({ runId: run.id, expectedRevision: 1, budget: null });
    expect(
      e.available(middleRun.id).filter((w) => w.runId === middleRun.id),
    ).toHaveLength(0);
    e.cancel(run.id);
    expect(e.run(leafRun.id).status).toBe('waiting');
    e.budgets.set({
      runId: leafRun.id,
      expectedRevision: 0,
      budget: policy(0),
    });
    e.cancel(leafRun.id);
    expect(e.run(leafRun.id).status).toBe('cancelled');
  },
);

it('preserves timeout remaining duration across restart and rejects stale adjustments', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  const dir = mkdtempSync(join(tmpdir(), 'interlock-budget-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  let e = setup(path);
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], unclaimedTimeoutMs: 10000 });
  d.edges.push({
    id: 'timeout',
    source: 'agent',
    target: 'exit',
    port: 'timeout',
  });
  const run = e.start(publish(e, d), {}).run;
  vi.advanceTimersByTime(3000);
  e.budgets.set({ runId: run.id, expectedRevision: 0, budget: policy(0) });
  expect(e.inspect(run.id).work[0]).toMatchObject({
    budgetBlocked: { remainingMs: 7000 },
  });
  const cursor = e.continuation.briefing({ id: run.id, limit: 20 }).cursor;
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  vi.advanceTimersByTime(30000);
  e = setup(path);
  e.pump();
  expect(e.run(run.id).status).toBe('waiting');
  expect(
    e.continuation.briefing({ id: run.id, limit: 20 }).nextDeadline,
  ).toBeNull();
  expect(() =>
    e.budgets.set({ runId: run.id, expectedRevision: 0, budget: null }),
  ).toThrow('revision conflict');
  e.budgets.set({ runId: run.id, expectedRevision: 1, budget: null });
  expect(e.continuation.briefing({ id: run.id, limit: 20 }).cursor).not.toBe(
    cursor,
  );
  vi.advanceTimersByTime(6999);
  e.pump();
  expect(e.run(run.id).status).toBe('waiting');
  vi.advanceTimersByTime(1);
  e.pump();
  expect(e.run(run.id).status).toBe('completed');
  expect(e.budgets.read(run.id).revision).toBe(2);
  e.deleteWorkflow(run.workflowId);
  expect(e.store.list('runBudgets')).toHaveLength(0);
});

it('includes pre-budget legacy attempts and retains usage on disable/re-enable', () => {
  const e = setup(),
    run = e.start(publish(e), {}).run,
    c = e.claim(e.available(run.id)[0].id, worker);
  e.store.remove('usageAttempts', `${c.id}:${c.attempt}`);
  e.reportFailure(c.id, c.token!, 'legacy');
  e.budgets.set({ runId: run.id, expectedRevision: 0, budget: policy() });
  expect(e.available(run.id)).toHaveLength(0);
  e.budgets.set({ runId: run.id, expectedRevision: 1, budget: null });
  expect(e.available(run.id)).toHaveLength(1);
  e.budgets.set({ runId: run.id, expectedRevision: 2, budget: policy() });
  expect(e.available(run.id)).toHaveLength(0);
  expect(e.budgets.read(run.id).governing[0].attempts).toBe(1);
});

it('wakes continuation waits for policy-only changes without resetting consumption', async () => {
  const e = setup(),
    run = e.start(publish(e), {}).run;
  const before = e.continuation.briefing({ id: run.id, limit: 20 });
  const wait = e.continuation.wait({
    id: run.id,
    limit: 20,
    cursor: before.cursor,
    timeoutMs: 1000,
  });
  e.budgets.set({ runId: run.id, expectedRevision: 0, budget: policy(5) });
  const changed = await wait;
  expect(changed).toMatchObject({
    changed: true,
    timedOut: false,
    run: { budgetRevision: 1 },
    next: 'claim_work',
  });
  const c = e.claim(e.available(run.id)[0].id, worker);
  e.submit(c.id, c.token!, {});
  e.budgets.set({ runId: run.id, expectedRevision: 1, budget: policy(10) });
  expect(e.budgets.read(run.id).governing[0].attempts).toBe(1);
});

it('adds policies to a published legacy database and preserves consumption across reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-budget-legacy-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  const db = new DatabaseSync(path);
  db.exec(previousRelease.schema.join(';\n'));
  db.exec(
    'INSERT INTO migrations VALUES (1),(2),(3); INSERT INTO continuation_sequence VALUES (1,0);',
  );
  for (const [collection, records] of Object.entries(previousRelease.documents))
    for (const record of records)
      db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(
        collection,
        record.id,
        JSON.stringify(record),
      );
  db.close();
  let e = setup(path);
  expect(e.store.migration).toEqual({ from: 3, to: 3 });
  for (const [collection, records] of Object.entries(previousRelease.documents))
    expect(e.store.list(collection)).toEqual(records);
  const c = e.store.work().find((w) => w.status === 'claimed')!;
  e.budgets.set({ runId: c.runId, expectedRevision: 0, budget: policy(0) });
  e.submit(c.id, 'testbench-fixture-token', { resumed: true });
  report(e, { ...c, token: 'testbench-fixture-token' }, 42);
  const budget = e.budgets.read(c.runId);
  expect(budget.governing[0]).toMatchObject({
    state: 'blocked',
    attempts: c.attempt,
  });
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  e = setup(path);
  expect(e.budgets.read(c.runId)).toEqual(budget);
  expect(e.usage.read({ runId: c.runId }).totals.tokens.inputTokens.value).toBe(
    42,
  );
  expect(e.run(c.runId).status).toBe('completed');
});
