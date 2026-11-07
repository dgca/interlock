import { HarnessResultError } from '../packages/runtime/src/executors/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  stallPolicySchema,
  type Json,
  type StallPolicy,
} from '@interlock/core';
const engines: Engine[] = [],
  dirs: string[] = [];
const worker = {
  workerId: 'stall-test',
  freshContext: false,
  tools: [],
  skills: [],
};
const epoch = Date.parse('2026-11-07T12:00:00Z');
const at = (ms: number) => vi.setSystemTime(epoch + ms);
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
function start(e: Engine, node = {}, policy: StallPolicy = {}) {
  const d = blankDefinition();
  Object.assign(d, policy);
  Object.assign(
    d.nodes.find((n) => n.kind === 'agent')!,
    node,
  );
  const w = e.create('Stall test', '', definitionSchema.parse(d));
  e.publish(w.id);
  return e.start(w.id, null).run;
}
const stalls = (e: Engine, id: string) => e.stalls.inspect(id).items;
beforeEach(() => {
  vi.useFakeTimers();
  at(0);
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
it('inherits each threshold, honors null, validates bounds and protects settings revisions', () => {
  const e = setup();
  e.stalls.configure({
    expectedRevision: 0,
    policy: { unclaimedStallMs: 100, claimedIdleStallMs: 300 },
  });
  expect(() => e.stalls.configure({ expectedRevision: 0, policy: {} })).toThrow(
    /changed/,
  );
  const a = start(e, { claimedIdleStallMs: null }, { unclaimedStallMs: 200 });
  at(199);
  e.pump();
  expect(stalls(e, a.id)).toEqual([]);
  at(200);
  e.pump();
  expect(stalls(e, a.id)).toMatchObject([
    { kind: 'unclaimedStallMs', thresholdMs: 200 },
  ]);
  const work = e.available(a.id)[0];
  e.claim(work.id, worker);
  at(1000);
  e.pump();
  expect(stalls(e, a.id)).toEqual([]);
  for (const value of [0, -1, 1.5, 2592000001])
    expect(stallPolicySchema.safeParse({ runStallMs: value }).success).toBe(
      false,
    );
  expect(stallPolicySchema.safeParse({ runStallMs: null }).success).toBe(true);
});
it('deduplicates durable stalled events, rolls up attention and resolves after claim/progress', () => {
  const e = setup();
  const r = start(e, {
    unclaimedStallMs: 100,
    claimedIdleStallMs: 100,
    runStallMs: 100,
  });
  const w = e.available(r.id)[0];
  at(100);
  e.pump();
  e.pump();
  expect(stalls(e, r.id)).toHaveLength(2);
  expect(e.runAttention()).toMatchObject([
    { runId: r.id, reasons: ['stalled'] },
  ]);
  expect(e.store.events(r.id).filter((x) => x.type === 'stalled')).toHaveLength(
    2,
  );
  const c = e.claim(w.id, worker);
  e.pump();
  expect(stalls(e, r.id)).toEqual([]);
  at(200);
  e.pump();
  expect(stalls(e, r.id).map((s) => s.kind)).toEqual([
    'claimedIdleStallMs',
    'runStallMs',
  ]);
  e.renew(c.id, c.token!);
  e.pump();
  expect(stalls(e, r.id)).toEqual([]);
  at(300);
  e.pump();
  expect(stalls(e, r.id)).toHaveLength(2);
  e.submit(c.id, c.token!, null);
  expect(stalls(e, r.id)).toEqual([]);
  expect(e.runAttention()).toEqual([]);
});
it('unions historical overlapping named pauses and work holds', () => {
  const e = setup();
  const r = start(e, { unclaimedStallMs: 100 });
  const w = e.available(r.id)[0];
  at(40);
  const a = e.pauses.create({
    target: { scope: 'library' },
    actor: 'test',
    reason: 'A',
  });
  at(60);
  const b = e.pauses.create({
    target: { scope: 'workflow', workflowId: r.workflowId },
    actor: 'test',
    reason: 'B',
  });
  at(80);
  e.manageWorkHold({
    action: 'hold',
    workId: w.id,
    expectedAttempt: 0,
    expectedRevision: 0,
    actor: 'test',
    category: 'other',
    reason: 'hold',
    checkpointRef: 'checkpoint',
  });
  at(100);
  e.pauses.resume(a.id);
  at(120);
  e.pauses.resume(b.id);
  at(150);
  e.manageWorkHold({
    action: 'resume',
    workId: w.id,
    expectedAttempt: 0,
    expectedRevision: 1,
    actor: 'test',
  });
  at(209);
  e.pump();
  expect(stalls(e, r.id)).toEqual([]);
  at(210);
  e.pump();
  expect(stalls(e, r.id)).toMatchObject([{ activeMs: 100 }]);
});
it('monitors unheld input waits without changing actor and excludes input acceptance holds', () => {
  const e = setup();
  const d = blankDefinition();
  const node = d.nodes.find((n) => n.kind === 'agent')!;
  Object.assign(node, {
    kind: 'input',
    humanWaitStallMs: 100,
    runStallMs: null,
  });
  const w = e.create('Input', '', definitionSchema.parse(d));
  e.publish(w.id);
  const r = e.start(w.id, null).run;
  at(40);
  e.externalInputs.mutate({ action: 'hold', runId: r.id, expectedRevision: 0 });
  at(200);
  e.pump();
  expect(stalls(e, r.id)).toEqual([]);
  e.externalInputs.mutate({
    action: 'release',
    runId: r.id,
    expectedRevision: 1,
  });
  at(259);
  e.pump();
  expect(stalls(e, r.id)).toEqual([]);
  at(260);
  e.pump();
  expect(stalls(e, r.id)).toMatchObject([
    { kind: 'humanWaitStallMs', activeMs: 100 },
  ]);
  expect(e.projectRun(r.id).actor).toBe('agent');
});
it('keeps each execution deadline independent of renewable leases and refreshes only for a new claim attempt', () => {
  const e = setup();
  const r = start(e, { maxExecutionMs: 100, maxAttempts: 2 });
  const c = e.claim(e.available(r.id)[0].id, worker);
  at(90);
  e.renew(c.id, c.token!);
  at(99);
  expect(e.preflightResult(c.id, c.token!, null).canSubmit).toBe(true);
  at(100);
  expect(e.preflightResult(c.id, c.token!, null)).toMatchObject({
    code: 'expired',
  });
  expect(() => e.renew(c.id, c.token!)).toThrow();
  expect(e.store.work()[0]).toMatchObject({ status: 'available', attempt: 1 });
  const next = e.claim(c.id, worker);
  at(199);
  expect(e.preflightResult(next.id, next.token!, null).canSubmit).toBe(true);
  at(200);
  expect(() => e.submit(next.id, next.token!, null)).toThrow();
  expect(e.run(r.id).status).toBe('failed');
  expect(
    e.store.events(r.id).filter((x) => x.type === 'work.execution_timed_out'),
  ).toHaveLength(2);
});
it('excludes paused and needs_human intervals from deadlines and idle clocks, without double counting', () => {
  const e = setup();
  const r = start(e, {
    maxExecutionMs: 100,
    claimedIdleStallMs: 100,
    maxAttempts: 1,
  });
  const c = e.claim(e.available(r.id)[0].id, worker);
  at(40);
  e.stalls.hold('managed:fake', r.id, true, c.id);
  at(60);
  const pause = e.pauses.create({
    target: { scope: 'library' },
    actor: 'test',
    reason: 'Overlap',
  });
  at(200);
  e.stalls.hold('managed:fake', r.id, false, c.id);
  at(240);
  e.pauses.resume(pause.id);
  at(299);
  e.pump();
  expect(e.preflightResult(c.id, c.token!, null).canSubmit).toBe(true);
  expect(stalls(e, r.id)).toEqual([]);
  at(300);
  e.pump();
  expect(e.run(r.id).status).toBe('failed');
});
it('retains uncertain resource ownership on execution deadline and rejects late results', () => {
  const e = setup();
  const r = start(e, {
    maxExecutionMs: 100,
    maxAttempts: 2,
    resources: [{ source: 'literal', value: 'test-resource' }],
  });
  const c = e.claim(e.available(r.id)[0].id, worker);
  at(100);
  e.pump();
  expect(e.inspect(r.id).work[0].resourceReservations).toMatchObject([
    { state: 'uncertain', attempt: 1 },
  ]);
  expect(() => e.claim(c.id, worker)).toThrow(/resource/i);
  expect(() => e.submit(c.id, c.token!, null)).toThrow();
});
it('persists stall receipts and attempt start across engine restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-stalls-'));
  dirs.push(dir);
  const e = setup(join(dir, 'db'));
  const r = start(e, {
    unclaimedStallMs: 100,
    maxExecutionMs: 200,
    maxAttempts: 1,
  });
  at(100);
  e.pump();
  expect(stalls(e, r.id)).toHaveLength(1);
  const c = e.claim(e.available(r.id)[0].id, worker);
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  at(250);
  const restart = setup(join(dir, 'db'));
  restart.pump();
  expect(restart.preflightResult(c.id, c.token!, null).canSubmit).toBe(true);
  at(300);
  restart.pump();
  expect(restart.run(r.id).status).toBe('failed');
  expect(
    restart.store.events(r.id).filter((x) => x.type === 'stalled'),
  ).toHaveLength(1);
});
it('does not mistake queued starts or intentional Waits for transition stalls', () => {
  const e = setup();
  e.stalls.configure({ expectedRevision: 0, policy: { runStallMs: 10 } });
  const d = blankDefinition();
  d.maxActiveRuns = 1;
  const w = e.create('Queue', '', d);
  e.publish(w.id);
  e.start(w.id, null);
  const q = e.start(w.id, null).run;
  const wd = blankDefinition();
  Object.assign(
    wd.nodes.find((n) => n.kind === 'agent')!,
    { kind: 'wait', timing: { kind: 'duration', ms: 10000 } },
  );
  const ww = e.create('Wait', '', definitionSchema.parse(wd));
  e.publish(ww.id);
  const wait = e.start(ww.id, null).run;
  at(100);
  e.pump();
  expect(stalls(e, q.id)).toEqual([]);
  expect(stalls(e, wait.id)).toEqual([]);
  expect(e.run(q.id).status).toBe('queued');
});
it('records live managed needs_human exclusion and resumes idle timing after the answer', async () => {
  const e = setup();
  let input: import('@interlock/runtime').HarnessRun | undefined;
  e.executors.saveProfile({
    id: 'codex',
    harness: 'codex',
    name: 'Fake',
    enabled: true,
    expectedRevision: 0,
  });
  e.executors.start([
    {
      id: 'codex',
      detect: async () => ({ status: 'detected', command: '/fake/codex' }),
      run: async (i) => {
        input = i;
        return new Promise(() => {});
      },
    },
  ]);
  const r = start(e, {
    executor: 'codex',
    maxExecutionMs: 10000,
    claimedIdleStallMs: 1000,
  });
  for (let i = 0; i < 100; i++) await Promise.resolve();
  expect(input).toBeDefined();
  at(400);
  const answer = input!.request({
    kind: 'permission',
    title: 'Continue?',
    detail: 'Test',
  });
  for (let i = 0; i < 100; i++) await Promise.resolve();
  at(20000);
  e.pump();
  expect(e.store.work()[0].status).toBe('claimed');
  expect(stalls(e, r.id)).toEqual([]);
  const inspection = e.executors.inspect(e.store.work()[0].id);
  const record = inspection.items[0];
  e.executors.respond({
    executionId: record.id,
    requestId: record.requests[0].id,
    answer: { allow: true },
  });
  await answer;
  at(20599);
  e.pump();
  expect(stalls(e, r.id)).toEqual([]);
  at(20600);
  e.pump();
  expect(stalls(e, r.id)).toMatchObject([{ kind: 'claimedIdleStallMs' }]);
  input!.onProgress('Progress');
  e.pump();
  expect(stalls(e, r.id)).toEqual([]);
});

it.each(['continuation', 'transient'])(
  'does not reset maxExecutionMs during H7 %s turns',
  async (kind) => {
    const e = setup();
    let turns = 0;
    e.executors.saveProfile({
      id: 'codex',
      harness: 'codex',
      name: 'Fake',
      enabled: true,
      expectedRevision: 0,
    });
    e.executors.start([
      {
        id: 'codex',
        detect: async () => ({ status: 'detected', command: '/fake/codex' }),
        run: async () => {
          turns++;
          if (turns === 1) {
            at(90);
            if (kind === 'continuation')
              throw new HarnessResultError('Missing result envelope');
            throw new Error('ECONNRESET');
          }
          at(100);
          return { output: null };
        },
      },
    ]);
    const r = start(e, {
      executor: 'codex',
      maxExecutionMs: 100,
      maxAttempts: 1,
      continueOnMissingResult: { maxTurns: 1 },
      transientRetry: { maxRetries: 1, windowMs: 1000, initialBackoffMs: 0 },
    });
    for (let i = 0; i < 300; i++) await Promise.resolve();
    expect(turns).toBe(2);
    expect(e.run(r.id).status).toBe('failed');
    expect(e.store.work()[0].attempt).toBe(1);
    expect(
      e.store.events(r.id).filter((x) => x.type === 'work.execution_timed_out'),
    ).toHaveLength(1);
  },
);
