import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  blankDefinition,
  nodeSchema,
  type WorkRequest,
  type WorkHoldRequest,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { batchDefinition } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';
import { runProgress } from '../packages/ui/src/features/runs/runProgress';
const opened: Engine[] = [],
  dirs: string[] = [];
const worker = {
  workerId: 'worker',
  freshContext: false,
  tools: [],
  skills: [],
};
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  opened.push(e);
  return e;
}
function fixture(e: Engine, config: Record<string, unknown> = {}) {
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], ...config });
  if (config.unclaimedTimeoutMs)
    d.edges.push({
      id: 'timeout',
      source: 'agent',
      target: 'exit',
      port: 'timeout',
    });
  const w = e.create('Holds', '', d);
  e.publish(w.id);
  const run = e.start(w.id, { candidate: 'revision' }).run;
  return { w, run, work: e.available(run.id)[0] };
}
function holdRequest(
  e: Engine,
  id: string,
  extra: Record<string, unknown> = {},
) {
  const w = e.store.get<WorkRequest>('work', id)!;
  return {
    action: 'hold',
    workId: id,
    expectedAttempt: w.attempt,
    expectedRevision: w.holdRevision ?? 0,
    actor: 'coordinator',
    category: 'provider_limit',
    reason: 'Provider unavailable',
    checkpointRef: 'artifact://checkpoint',
    ...extra,
  } as Extract<WorkHoldRequest, { action: 'hold' }>;
}
function hold(e: Engine, id: string, extra: Record<string, unknown> = {}) {
  return e.manageWorkHold(holdRequest(e, id, extra));
}
function resume(e: Engine, id: string) {
  const w = e.store.get<WorkRequest>('work', id)!;
  return e.manageWorkHold({
    action: 'resume',
    workId: id,
    expectedAttempt: w.attempt,
    expectedRevision: w.holdRevision!,
    actor: 'coordinator',
  });
}
function snapshot(e: Engine) {
  return [
    'runs',
    'work',
    'events',
    'usageAttempts',
    'workHolds',
    'runBudgets',
  ].map((c) => e.store.list(c));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
});
afterEach(() => {
  for (const e of opened.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true });
  vi.useRealTimers();
});
it('invalidates the old claim, preserves captured checks, and resumes only through a new claim', () => {
  const e = setup(),
    { run, work } = fixture(e, {
      maxAttempts: 1,
      resultRules: [
        {
          id: 'candidate',
          kind: 'equalsInput',
          outputPath: 'candidate',
          inputPath: 'candidate',
        },
      ],
    });
  const claim = e.claim(work.id, worker, 10);
  hold(e, work.id, { token: claim.token });
  expect(e.available(run.id)).toEqual([]);
  vi.advanceTimersByTime(60000);
  e.pump();
  expect(e.run(run.id).status).toBe('waiting');
  expect(e.preflightResult(work.id, claim.token!, {}).code).toBe('held');
  expect(() => e.renew(work.id, claim.token!)).toThrow();
  expect(() => e.reportFailure(work.id, claim.token!, 'stale')).toThrow();
  expect(() =>
    e.submit(work.id, claim.token!, { candidate: 'revision' }),
  ).toThrow();
  expect(() => e.claim(work.id, worker)).toThrow(/not available/);
  const brief = e.continuation.briefing({ id: run.id, limit: 20 });
  expect(brief).toMatchObject({
    next: 'inspect_hold',
    held: { total: 1 },
    blockers: { items: [{ reason: 'external_hold' }] },
  });
  const summary = e.continuation.summary(run.id, 20);
  expect(summary.heldWork?.total).toBe(1);
  const visible = e.inspect(run.id);
  expect(visible.work[0]).not.toHaveProperty('holdReceipt');
  expect(JSON.stringify(brief)).not.toContain('artifact://checkpoint');
  expect(JSON.stringify(visible)).not.toContain(claim.token!);
  resume(e, work.id);
  expect(() => e.submit(work.id, claim.token!, {})).toThrow();
  const next = e.claim(work.id, worker);
  expect(next.attempt).toBe(2);
  expect(next.token).not.toBe(claim.token);
  expect(
    e.preflightResult(next.id, next.token!, { candidate: 'wrong' }).code,
  ).toBe('invalid_result');
  e.submit(next.id, next.token!, { candidate: 'revision' });
  expect(e.run(run.id).status).toBe('completed');
  expect(e.usage.read({ runId: run.id }).totals.outcomes).toMatchObject({
    held: 1,
    completed: 1,
    expired: 0,
    failed: 0,
  });
});
it.each([undefined, 1])(
  'does not spend the %s recovery allowance but retains monotonic claim attempts',
  (maxLeaseExpiries) => {
    const e = setup(),
      { work, run } = fixture(e, {
        maxAttempts: 1,
        ...(maxLeaseExpiries ? { maxLeaseExpiries } : {}),
      });
    for (let i = 0; i < 3; i++) {
      e.claim(work.id, worker, 10);
      hold(e, work.id);
      resume(e, work.id);
    }
    const last = e.claim(work.id, worker, 10);
    expect(last.attempt).toBe(4);
    expect(last.heldClaimCount).toBe(3);
    e.reportFailure(last.id, last.token!, 'actual failure');
    expect(e.run(run.id).status).toBe('failed');
    expect(e.store.get<WorkRequest>('work', work.id)?.failureCount).toBe(
      maxLeaseExpiries ? 1 : undefined,
    );
  },
);
it('preserves previous failures and lease-expiry accounting across holds', () => {
  const e = setup(),
    { work, run } = fixture(e, { maxAttempts: 2, maxLeaseExpiries: 1 });
  let claim = e.claim(work.id, worker, 10);
  e.reportFailure(work.id, claim.token!, 'first failure');
  claim = e.claim(work.id, worker, 10);
  hold(e, work.id);
  resume(e, work.id);
  const next = e.claim(work.id, worker, 10);
  vi.advanceTimersByTime(10000);
  e.pump();
  expect(e.run(run.id).status).toBe('failed');
  expect(e.store.get<WorkRequest>('work', next.id)).toMatchObject({
    failureCount: 1,
    leaseExpiryCount: 1,
    heldClaimCount: 1,
  });
});
it('suspends the remaining available deadline and ends wall-time accounting at completion', () => {
  const e = setup(),
    { run, work } = fixture(e, { unclaimedTimeoutMs: 10000 });
  vi.advanceTimersByTime(3000);
  hold(e, work.id);
  vi.advanceTimersByTime(60000);
  e.pump();
  resume(e, work.id);
  expect(Date.parse(e.available(run.id)[0].availableUntil!) - Date.now()).toBe(
    7000,
  );
  vi.advanceTimersByTime(6999);
  e.pump();
  expect(e.run(run.id).status).toBe('waiting');
  vi.advanceTimersByTime(1);
  e.pump();
  expect(e.run(run.id).status).toBe('completed');
  const report = e.holds.history(work.id);
  expect(report).toMatchObject({
    wallMs: 70000,
    declaredHeldMs: 60000,
    elapsedExcludingHoldsMs: 10000,
  });
  vi.advanceTimersByTime(50000);
  expect(e.holds.history(work.id)).toEqual(report);
});
it('gives resumed claimed work a full unclaimed interval and retains budget gates', () => {
  const e = setup(),
    { work, run } = fixture(e, { unclaimedTimeoutMs: 10000 });
  e.budgets.set({
    runId: run.id,
    expectedRevision: 0,
    budget: {
      scope: 'run',
      unknownUsage: 'allow',
      limits: { claims: { max: 1 } },
    },
  });
  const claim = e.claim(work.id, worker);
  vi.advanceTimersByTime(2000);
  hold(e, work.id);
  resume(e, work.id);
  expect(e.store.get<WorkRequest>('work', work.id)).toMatchObject({
    status: 'available',
    budgetBlocked: { remainingMs: 10000 },
  });
  expect(() => e.claim(work.id, worker)).toThrow(/Budget blocked/);
  e.usage.report({
    workId: work.id,
    attempt: claim.attempt,
    token: claim.token!,
    snapshot: {
      sequence: 1,
      final: true,
      models: [{ provider: 'fixture', model: 'fixture', inputTokens: 0 }],
    },
  });
  e.budgets.set({ runId: run.id, expectedRevision: 1, budget: null });
  expect(Date.parse(e.available(run.id)[0].availableUntil!) - Date.now()).toBe(
    10000,
  );
});
it('preserves budget-blocked remaining time through a hold and a budget adjustment', () => {
  const e = setup(),
    { work, run } = fixture(e, { unclaimedTimeoutMs: 10000 });
  vi.advanceTimersByTime(2000);
  e.budgets.set({
    runId: run.id,
    expectedRevision: 0,
    budget: {
      scope: 'run',
      unknownUsage: 'allow',
      limits: { claims: { max: 0 } },
    },
  });
  hold(e, work.id);
  vi.advanceTimersByTime(20000);
  e.budgets.set({ runId: run.id, expectedRevision: 1, budget: null });
  expect(e.continuation.briefing({ id: run.id, limit: 20 }).next).toBe(
    'inspect_hold',
  );
  resume(e, work.id);
  expect(Date.parse(e.available(run.id)[0].availableUntil!) - Date.now()).toBe(
    8000,
  );
});
it('repeats the latest exact operation without writes and rejects stale attempts or revisions', () => {
  const e = setup(),
    { work } = fixture(e);
  const old = holdRequest(e, work.id);
  e.claim(work.id, worker);
  expect(() => e.manageWorkHold(old)).toThrow(/changed/);
  const q = holdRequest(e, work.id);
  e.manageWorkHold(q);
  const before = snapshot(e);
  expect(e.manageWorkHold(q)).toMatchObject({ applied: false });
  expect(snapshot(e)).toEqual(before);
  expect(() => e.manageWorkHold({ ...q, reason: 'different' })).toThrow(
    /changed/,
  );
  expect(snapshot(e)).toEqual(before);
  const w = e.store.get<WorkRequest>('work', work.id)!;
  const r = {
    action: 'resume' as const,
    workId: work.id,
    expectedAttempt: w.attempt,
    expectedRevision: w.holdRevision!,
    actor: 'coordinator',
  };
  e.manageWorkHold(r);
  const resumed = snapshot(e);
  expect(e.manageWorkHold(r)).toMatchObject({ applied: false });
  expect(snapshot(e)).toEqual(resumed);
  expect(() => e.manageWorkHold(q)).toThrow(/changed/);
});
it('persists holds, intervals, usage and duplicate receipts across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-holds-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  const e = setup(path),
    { work, run } = fixture(e);
  e.claim(work.id, worker);
  const q = holdRequest(e, work.id);
  e.manageWorkHold(q);
  e.stop();
  e.store.close();
  opened.splice(opened.indexOf(e), 1);
  vi.advanceTimersByTime(5000);
  const next = setup(path);
  expect(next.manageWorkHold(q)).toMatchObject({
    applied: false,
    status: 'held',
  });
  expect(next.holds.history(work.id)).toMatchObject({
    total: 1,
    declaredHeldMs: 5000,
  });
  resume(next, work.id);
  const claim = next.claim(work.id, worker);
  next.submit(claim.id, claim.token!, {});
  expect(next.run(run.id).status).toBe('completed');
});
it.each(['unclaimed', 'claimed'])(
  'lets an elapsed %s deadline win, including a crossing after the pump',
  (mode) => {
    const e = setup(),
      { work, run } = fixture(e, { maxAttempts: 1, unclaimedTimeoutMs: 10000 });
    if (mode === 'claimed') e.claim(work.id, worker, 10);
    const q = holdRequest(e, work.id),
      pump = e.pump.bind(e);
    vi.spyOn(e, 'pump').mockImplementationOnce(() => {
      pump();
      vi.advanceTimersByTime(10000);
    });
    expect(() => e.manageWorkHold(q)).toThrow(/deadline elapsed/);
    expect(e.holds.history(work.id).total).toBe(0);
    expect(e.run(run.id).status).toBe(
      mode === 'claimed' ? 'failed' : 'completed',
    );
  },
);
it('rolls back intervals, usage and events if persistence fails', () => {
  const e = setup(),
    { work } = fixture(e);
  e.claim(work.id, worker);
  const before = snapshot(e),
    put = e.store.put.bind(e.store);
  vi.spyOn(e.store, 'put').mockImplementation((collection, value) => {
    if (collection === 'work') throw new Error('disk failure');
    put(collection, value);
  });
  expect(() => hold(e, work.id)).toThrow('disk failure');
  expect(snapshot(e)).toEqual(before);
});
it('holds only the affected Batch item and closes its interval on parent cancellation', () => {
  const e = setup(),
    w = e.create('Batch', '', batchDefinition());
  e.publish(w.id);
  const run = e.start(w.id, [1, 2]).run;
  const [a, b] = e.available(run.id);
  hold(e, a.id);
  const claim = e.claim(b.id, worker);
  e.submit(b.id, claim.token!, 2);
  expect(e.run(run.id).status).toBe('waiting');
  vi.advanceTimersByTime(1000);
  e.cancel(run.id);
  expect(e.store.get<WorkRequest>('work', a.id)?.status).toBe('cancelled');
  expect(e.holds.history(a.id).items[0].endReason).toBe('cancelled');
  expect(() => resume(e, a.id)).toThrow(/no longer active/);
  const timing = e.holds.history(a.id);
  vi.advanceTimersByTime(1000);
  expect(e.holds.history(a.id)).toEqual(timing);
});
it('keeps detached holds independent of parent cancellation', () => {
  const e = setup(),
    child = e.create('Child', '', blankDefinition());
  e.publish(child.id);
  const parent = e.create(
    'Parent',
    '',
    workflowCall(child.id, 'detached', true),
  );
  e.publish(parent.id);
  const run = e.start(parent.id, {}).run,
    work = e.available(run.id).find((w) => w.runId !== run.id)!;
  hold(e, work.id);
  e.cancel(run.id);
  expect(e.store.get<WorkRequest>('work', work.id)?.status).toBe('held');
  resume(e, work.id);
  const claim = e.claim(work.id, worker);
  e.submit(work.id, claim.token!, {});
  expect(e.run(work.runId).status).toBe('completed');
});
it('keeps session continuity requirements after resuming', () => {
  const e = setup(),
    { work } = fixture(e, {
      context: { mode: 'current', continuityGroup: 'author' },
    });
  const session = { executorId: 'test', sessionId: 'original' };
  e.claim(work.id, { ...worker, session });
  hold(e, work.id);
  resume(e, work.id);
  expect(() =>
    e.claim(work.id, {
      ...worker,
      session: { ...session, sessionId: 'other' },
    }),
  ).toThrow();
  expect(e.claim(work.id, { ...worker, session }).continuity?.session).toEqual(
    session,
  );
});
it('bounds history, reports held progress, reads without mutation and cleans up on deletion', () => {
  const e = setup(),
    { work, run, w } = fixture(e);
  for (let i = 0; i < 25; i++) {
    hold(e, work.id);
    vi.advanceTimersByTime(10);
    resume(e, work.id);
  }
  hold(e, work.id);
  const before = snapshot(e);
  const history = e.manageWorkHold({
    action: 'history',
    workId: work.id,
    limit: 2,
  }) as any;
  expect(history).toMatchObject({ total: 26, nextOffset: 2 });
  expect(history.items).toHaveLength(2);
  expect(snapshot(e)).toEqual(before);
  expect(e.inspect(run.id).work[0].holdHistory).toMatchObject({
    total: 26,
    nextOffset: 20,
  });
  const inspected = e.inspect(run.id);
  expect(
    runProgress(
      inspected.run,
      inspected.definition,
      inspected.descendants,
      inspected.descendantWork,
    ).title,
  ).toContain('Held for external blocker');
  e.cancel(run.id);
  e.deleteWorkflow(w.id);
  expect(e.store.list('workHolds')).toEqual([]);
});

it('history reads do not process overdue deadlines, while hold/resume wake continuation', async () => {
  const e = setup(),
    { work, run } = fixture(e, { unclaimedTimeoutMs: 10000 });
  vi.advanceTimersByTime(10000);
  const before = snapshot(e);
  e.manageWorkHold({ action: 'history', workId: work.id });
  expect(snapshot(e)).toEqual(before);
  e.pump();
  expect(e.run(run.id).status).toBe('completed');
  const second = fixture(e);
  const cursor = e.continuation.briefing({
    id: second.run.id,
    limit: 20,
  }).cursor;
  const wait = e.continuation.wait({
    id: second.run.id,
    cursor,
    timeoutMs: 1000,
    limit: 20,
  });
  hold(e, second.work.id);
  await vi.advanceTimersByTimeAsync(0);
  expect(await wait).toMatchObject({ changed: true, next: 'inspect_hold' });
});
