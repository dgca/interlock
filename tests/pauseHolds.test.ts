import { batchDefinition } from './fixtures/batch';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blankDefinition,
  nodeSchema,
  elapsedExcludingPausesMs,
  type WorkflowDefinition,
} from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
const engines: Engine[] = [],
  dirs: string[] = [];
const open = (
  path = ':memory:',
  options?: ConstructorParameters<typeof Engine>[2],
) => {
  const e = new Engine(new Store(path), process.cwd(), options);
  engines.push(e);
  return e;
};
afterEach(() => {
  vi.useRealTimers();
  for (const e of engines.splice(0)) {
    e.stop();
    try {
      e.store.close();
    } catch {}
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const worker = {
  workerId: 'worker',
  tools: [],
  skills: [],
  freshContext: false,
};
const publish = (e: Engine, d = blankDefinition()) => {
  const w = e.create('Pause test', '', d);
  e.publish(w.id);
  return w.id;
};
const hold = (e: Engine, workflowId?: string, actor = 'deploy') =>
  e.pauses.create({
    target: workflowId
      ? { scope: 'workflow', workflowId }
      : { scope: 'library' },
    actor,
    reason: `${actor} maintenance`,
  });
const resume = (e: Engine, id: string) => {
  const r = e.pauses.resume(id);
  e.pump();
  return r;
};
function step(kind: Record<string, unknown>): WorkflowDefinition {
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({ id: 'agent', label: 'Step', ...kind });
  return d;
}

it('combines independent scopes, releases exact IDs idempotently, and gates all claim discovery', () => {
  const e = open(),
    a = publish(e),
    b = publish(e),
    ra = e.start(a, null).run,
    rb = e.start(b, null).run;
  const work = e.available(ra.id)[0];
  const local = hold(e, a),
    one = hold(e),
    two = hold(e, undefined, 'incident');
  expect(e.pauses.list({ workflowId: a, limit: 1 })).toMatchObject({
    total: 3,
    nextOffset: 1,
  });
  expect(e.pauses.list({ workflowId: b }).total).toBe(2);
  expect(e.available()).toEqual([]);
  expect(
    e.continuation.briefing({ id: ra.id, limit: 20 }).available.total,
  ).toBe(0);
  expect(e.continuation.briefing({ id: ra.id, limit: 20 }).run).toMatchObject({
    waiting: { kind: 'pause', detail: { pauseCount: 3 } },
    actor: 'person',
  });
  expect(() => e.claim(work.id, worker)).toThrow(/paused/);
  expect(e.store.get<any>('work', work.id).attempt).toBe(0);
  resume(e, one.id);
  expect(resume(e, one.id).applied).toBe(false);
  expect(e.pauses.list({ workflowId: a }).total).toBe(2);
  resume(e, two.id);
  expect(e.available(rb.id)).toHaveLength(1);
  expect(e.available(ra.id)).toEqual([]);
  expect(() => resume(e, 'missing')).toThrow(/not found/);
  expect(e.pauses.list({ workflowId: a }).total).toBe(1);
  resume(e, local.id);
  expect(e.available(ra.id)).toHaveLength(1);
});
it('allows in-flight Agent completion and renewal but prevents downstream script and manual-start progress', async () => {
  const e = open(),
    d = blankDefinition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'script',
      kind: 'script',
      label: 'Next script',
      language: 'javascript',
      command: 'return 7',
    }),
  );
  d.edges[1].target = 'script';
  d.edges.push({
    id: 'last',
    source: 'script',
    port: 'default',
    target: 'exit',
  });
  const w = publish(e, d),
    r = e.start(w, null).run,
    work = e.available(r.id)[0],
    c = e.claim(work.id, worker),
    h = hold(e);
  expect(
    e.continuation.briefing({ id: r.id, limit: 20 }).run.waiting,
  ).toBeNull();
  e.renew(work.id, c.token!);
  e.submit(work.id, c.token!, {});
  expect(e.run(r.id).cursor).toBe('script');
  expect(e.run(r.id).executions.some((x) => x.kind === 'script')).toBe(false);
  const queued = e.start(w, null).run;
  expect(queued.executions).toHaveLength(0);
  resume(e, h.id);
  await vi.waitFor(() => expect(e.run(r.id).status).toBe('completed'));
  expect(e.available(queued.id)).toHaveLength(1);
});
it.each(['script', 'fetch'] as const)(
  'lets an in-flight %s finish without launching the next step',
  async (kind) => {
    let finish!: (value: any) => void;
    let starts = 0;
    const e = open(':memory:', {
      substituteOperation: () => {
        starts++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    const d = step(
      kind === 'script'
        ? { kind, language: 'javascript', command: 'return 1' }
        : { kind, url: 'https://example.test', method: 'GET' },
    );
    const w = publish(e, d),
      r = e.start(w, null).run;
    expect(starts).toBe(1);
    const h = hold(e);
    finish(kind === 'script' ? 1 : { status: 200, headers: {}, body: {} });
    await vi.waitFor(() =>
      expect(e.run(r.id).executions.at(-1)?.status).toBe('completed'),
    );
    expect(e.run(r.id).status).toBe('running');
    expect(e.run(r.id).cursor).toBe('exit');
    expect(starts).toBe(1);
    resume(e, h.id);
    expect(e.run(r.id).status).toBe('completed');
  },
);
it('preserves pending input revisions and inhibits acceptance until every hold clears', () => {
  const e = open(),
    w = publish(e, step({ kind: 'input' })),
    r = e.start(w, null).run,
    executionId = e.run(r.id).executions.at(-1)!.id;
  const a = hold(e),
    b = hold(e, w),
    target = { runId: r.id, executionId };
  e.externalInputs.mutate({
    action: 'submit',
    ...target,
    requestId: 'one',
    expectedRevision: 0,
    value: 1,
  });
  e.externalInputs.mutate({
    action: 'submit',
    ...target,
    requestId: 'two',
    expectedRevision: 1,
    value: 2,
  });
  expect(() =>
    e.externalInputs.mutate({
      action: 'accept',
      ...target,
      expectedRevision: 2,
    }),
  ).toThrow(/paused/);
  expect(
    e.externalInputs.status({
      action: 'status',
      ...target,
      includeValue: true,
    }),
  ).toMatchObject({ revision: 2, value: 2, pauses: expect.any(Array) });
  resume(e, a.id);
  expect(() =>
    e.externalInputs.mutate({
      action: 'accept',
      ...target,
      expectedRevision: 2,
    }),
  ).toThrow(/paused/);
  resume(e, b.id);
  expect(e.run(r.id).status).toBe('waiting');
  e.externalInputs.mutate({ action: 'accept', ...target, expectedRevision: 2 });
  expect(e.run(r.id).output).toBe(2);
  hold(e);
  expect(
    e.externalInputs.mutate({
      action: 'accept',
      ...target,
      expectedRevision: 2,
    }),
  ).toHaveProperty('acceptedAt');
});
it('survives restart and retains wall-clock Wait deadlines while unclaimed Agent clocks suspend', () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-11-01T00:00:00Z');
  const dir = mkdtempSync(join(tmpdir(), 'interlock-pauses-'));
  dirs.push(dir);
  const path = join(dir, 'test.db');
  let e = open(path);
  const w = publish(
      e,
      step({ kind: 'wait', timing: { kind: 'duration', ms: 1000 } }),
    ),
    r = e.start(w, null).run,
    h = hold(e, w);
  const ad = step({ kind: 'agent', prompt: 'Go', unclaimedTimeoutMs: 1000 });
  ad.edges.push({
    id: 'timeout',
    source: 'agent',
    port: 'timeout',
    target: 'exit',
  });
  const aw = publish(e, ad),
    ar = e.start(aw, null).run,
    ah = hold(e, aw);
  vi.advanceTimersByTime(5000);
  e.pump();
  expect(e.run(r.id).status).toBe('waiting');
  expect(e.run(ar.id).status).toBe('waiting');
  e.stop();
  e.store.close();
  engines.pop();
  e = open(path);
  expect(e.available()).toEqual([]);
  expect(e.pauses.list({ workflowId: w }).items[0].id).toBe(h.id);
  resume(e, h.id);
  expect(e.run(r.id).status).toBe('completed');
  resume(e, ah.id);
  expect(e.available(ar.id)).toHaveLength(1);
  vi.advanceTimersByTime(999);
  e.pump();
  expect(e.run(ar.id).status).toBe('waiting');
  vi.advanceTimersByTime(1);
  e.pump();
  expect(e.run(ar.id).status).toBe('completed');
});
it('unions overlapping persisted intervals and reports active attempt time', () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-11-01T00:00:00Z');
  const e = open(),
    w = publish(e),
    r = e.start(w, null).run,
    work = e.available(r.id)[0],
    c = e.claim(work.id, worker);
  vi.advanceTimersByTime(100);
  const a = hold(e);
  vi.advanceTimersByTime(100);
  const b = hold(e, w);
  vi.advanceTimersByTime(100);
  resume(e, a.id);
  vi.advanceTimersByTime(100);
  resume(e, b.id);
  vi.advanceTimersByTime(100);
  e.submit(work.id, c.token!, {});
  expect(e.pauses.elapsed(r, c.createdAt)).toMatchObject({
    wallMs: 500,
    pausedMs: 300,
    activeMs: 200,
  });
  expect(
    e.usage.read({ runId: r.id, groupBy: 'attempt' }).groups[0],
  ).toMatchObject({ wallMs: 500, pausedMs: 300, activeMs: 200 });
  expect(
    elapsedExcludingPausesMs(150, 350, [
      {
        id: 'a',
        scope: 'library',
        actor: 'a',
        reason: 'a',
        createdAt: new Date(100).toISOString(),
        releasedAt: new Date(300).toISOString(),
      },
      {
        id: 'b',
        scope: 'library',
        actor: 'b',
        reason: 'b',
        createdAt: new Date(200).toISOString(),
        releasedAt: new Date(400).toISOString(),
      },
    ]),
  ).toEqual({ wallMs: 200, pausedMs: 200, activeMs: 0 });
});
it('retains timeout allowance across overlapping pause and budget gates in either release order', () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-11-01T00:00:00Z');
  for (const pauseFirst of [true, false]) {
    const e = open(),
      d = step({ kind: 'agent', prompt: 'Go', unclaimedTimeoutMs: 1000 });
    d.edges.push({
      id: 'timeout',
      source: 'agent',
      port: 'timeout',
      target: 'exit',
    });
    const w = publish(e, d),
      r = e.start(w, null).run;
    const first = e.available(r.id)[0],
      claim = e.claim(first.id, worker);
    e.reportFailure(first.id, claim.token!, 'Retryable failure');
    vi.advanceTimersByTime(200);
    const h = hold(e, w);
    e.budgets.set({
      runId: r.id,
      expectedRevision: 0,
      budget: {
        scope: 'run',
        unknownUsage: 'block',
        limits: { inputTokens: { max: 1 } },
      },
    });
    expect(e.store.work('available', r.id)[0].budgetBlocked).toBeDefined();
    vi.advanceTimersByTime(3000);
    if (pauseFirst) resume(e, h.id);
    e.budgets.set({ runId: r.id, expectedRevision: 1, budget: null });
    if (!pauseFirst) resume(e, h.id);
    vi.advanceTimersByTime(799);
    e.pump();
    expect(e.run(r.id).status).toBe('waiting');
    vi.advanceTimersByTime(1);
    e.pump();
    expect(e.run(r.id).status).toBe('completed');
  }
});
it('does not dispatch managed work while paused and launches after the final applicable release', async () => {
  const e = open();
  let starts = 0;
  e.executors.start([
    {
      id: 'codex',
      detect: async () => ({
        command: '/fake/codex',
        status: 'detected',
        version: 'test',
      }),
      run: async (i) => {
        starts++;
        return { output: i.work.input };
      },
    },
  ]);
  e.executors.saveProfile({
    id: 'codex',
    harness: 'codex',
    name: 'Codex',
    enabled: true,
    expectedRevision: 0,
  });
  const d = blankDefinition();
  d.executor = 'codex';
  const w = publish(e, d),
    h = hold(e, w),
    r = e.start(w, null).run;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(starts).toBe(0);
  resume(e, h.id);
  await vi.waitFor(() => expect(e.run(r.id).status).toBe('completed'));
  expect(starts).toBe(1);
});
it('holds polling checks at the next check boundary and keeps cancellation available', async () => {
  const e = open(),
    d = step({
      kind: 'wait',
      timing: {
        kind: 'poll',
        everyMs: 1000,
        check: {
          kind: 'script',
          language: 'javascript',
          command: 'return {ready:false}',
          timeoutMs: 5000,
        },
        path: 'ready',
        equals: true,
      },
    }),
    w = publish(e, d),
    r = e.start(w, null).run;
  await vi.waitFor(() =>
    expect(e.run(r.id).executions.at(-1)?.check?.count).toBe(1),
  );
  const h = hold(e, w);
  const before = e.run(r.id).executions.at(-1)!.check;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  e.pump();
  expect(e.run(r.id).executions.at(-1)!.check).toEqual(before);
  e.cancel(r.id);
  expect(e.run(r.id).status).toBe('cancelled');
  resume(e, h.id);
  expect(e.run(r.id).status).toBe('cancelled');
});
it('finishes a real in-flight Script once while holding the downstream boundary and emits pause snapshots', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-pause-process-'));
  dirs.push(dir);
  const ready = join(dir, 'ready'),
    release = join(dir, 'release');
  const command = `const fs=await import('node:fs'); fs.writeFileSync(${JSON.stringify(ready)},'ready'); while(!fs.existsSync(${JSON.stringify(release)})) await new Promise(r=>setTimeout(r,10)); return {done:true};`;
  const e = open(),
    w = publish(
      e,
      step({
        kind: 'script',
        language: 'javascript',
        command,
        timeoutMs: 5000,
      }),
    ),
    r = e.start(w, null).run;
  await vi.waitFor(() => expect(existsSync(ready)).toBe(true));
  const h = hold(e, w);
  expect(e.inspect(r.id).events.at(-1)).toMatchObject({
    type: 'execution.paused',
    actor: 'engine',
    waiting: null,
  });
  writeFileSync(release, 'release');
  await vi.waitFor(() =>
    expect(e.run(r.id).executions.at(-1)!.status).toBe('completed'),
  );
  expect(e.run(r.id).cursor).toBe('exit');
  expect(
    e.run(r.id).executions.filter((x) => x.kind === 'script'),
  ).toHaveLength(1);
  expect(
    e.continuation.briefing({ id: r.id, limit: 20 }).run.waiting?.kind,
  ).toBe('pause');
  resume(e, h.id);
  expect(e.run(r.id).output).toEqual({ done: true });
  expect(
    e.inspect(r.id).events.some((x) => x.type === 'execution.pause_released'),
  ).toBe(true);
});

it('keeps paused input discovery actionable and bounds status hold details', () => {
  const e = open(),
    w = publish(e, step({ kind: 'input' })),
    r = e.start(w, null).run;
  for (let n = 0; n < 21; n++) hold(e, w, 'actor-' + n);
  const b = e.continuation.briefing({ id: r.id, limit: 20 }).blockers.items[0];
  expect(b).toMatchObject({ reason: 'pause', externalInput: { revision: 0 } });
  const status = e.externalInputs.status({ action: 'status', runId: r.id });
  expect(status.pauses).toHaveLength(20);
  expect(status.pauseCount).toBe(21);
});
it('reconnects an already running background Script during pause without replay after restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-pause-background-'));
  dirs.push(dir);
  const path = join(dir, 'test.db'),
    ready = join(dir, 'ready'),
    release = join(dir, 'release');
  const command = `const fs=await import('node:fs'); fs.appendFileSync(${JSON.stringify(ready)},'x'); while(!fs.existsSync(${JSON.stringify(release)})) await new Promise(r=>setTimeout(r,10)); return 17;`;
  let e = open(path);
  const w = publish(
      e,
      step({
        kind: 'script',
        language: 'javascript',
        executionMode: 'background',
        command,
        timeoutMs: 5000,
      }),
    ),
    r = e.start(w, null).run;
  await vi.waitFor(() => expect(existsSync(ready)).toBe(true));
  const h = hold(e, w);
  e.stop();
  e.store.close();
  engines.pop();
  e = open(path);
  e.pump();
  writeFileSync(release, 'release');
  await vi.waitFor(
    () => expect(e.run(r.id).executions.at(-1)?.status).toBe('completed'),
    { timeout: 3000 },
  );
  expect(e.run(r.id).cursor).toBe('exit');
  expect(
    e.continuation.briefing({ id: r.id, limit: 20 }).run.waiting?.kind,
  ).toBe('pause');
  resume(e, h.id);
  expect(e.run(r.id).output).toBe(17);
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(ready, 'utf8')).toBe('x');
});
it.each([true, false])(
  'preserves unclaimed time across resource/pause overlap, pause released first: %s',
  (pauseFirst) => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-11-01T00:00:00Z');
    const e = open(),
      d = step({
        kind: 'agent',
        prompt: 'Go',
        resources: [{ source: 'literal', value: 'shared' }],
        unclaimedTimeoutMs: 1000,
      });
    d.edges.push({
      id: 'timeout',
      source: 'agent',
      port: 'timeout',
      target: 'exit',
    });
    const w = publish(e, d),
      owner = e.start(w, null).run,
      ow = e.available(owner.id)[0],
      c = e.claim(ow.id, worker),
      r = e.start(w, null).run;
    expect(e.store.work('available', r.id)[0].resourceBlocked).toBeDefined();
    const h = hold(e, w);
    vi.advanceTimersByTime(3000);
    if (pauseFirst) resume(e, h.id);
    e.submit(ow.id, c.token!, {});
    if (!pauseFirst) resume(e, h.id);
    vi.advanceTimersByTime(999);
    e.pump();
    expect(e.run(r.id).status).toBe('waiting');
    vi.advanceTimersByTime(1);
    e.pump();
    expect(e.run(r.id).status).toBe('completed');
  },
);

it('pauses Batch item claims and stops further item dispatch until resume', () => {
  const e = open(),
    w = publish(
      e,
      batchDefinition(
        nodeSchema.parse({
          id: 'item',
          kind: 'agent',
          label: 'Item',
          prompt: 'Go',
        }),
        { concurrency: 1 },
      ),
    ),
    r = e.start(w, [1, 2, 3]).run;
  const work = e.available(r.id)[0],
    c = e.claim(work.id, worker),
    h = hold(e, w);
  e.submit(work.id, c.token!, {});
  expect(e.available(r.id)).toEqual([]);
  expect(e.run(r.id).executions.at(-1)?.childRunIds).toHaveLength(1);
  resume(e, h.id);
  expect(e.available(r.id)).toHaveLength(1);
  expect(e.run(r.id).executions.at(-1)?.childRunIds).toHaveLength(2);
});
it('keeps lease-expired and explicitly resumed assignments out of discovery during pause', () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-11-01T00:00:00Z');
  const e = open(),
    d = step({
      kind: 'agent',
      prompt: 'Go',
      unclaimedTimeoutMs: 1000,
      maxLeaseExpiries: 2,
    });
  d.edges.push({
    id: 'timeout',
    source: 'agent',
    port: 'timeout',
    target: 'exit',
  });
  const w = publish(e, d),
    r = e.start(w, null).run,
    work = e.available(r.id)[0];
  e.claim(work.id, worker, 10);
  const h = hold(e, w);
  vi.advanceTimersByTime(10_000);
  expect(e.available(r.id)).toEqual([]);
  expect(e.store.work('available', r.id)[0].pauseBlocked).toBeDefined();
  expect(e.continuation.briefing({ id: r.id, limit: 20 }).available.total).toBe(
    0,
  );
  const current = e.store.work('available', r.id)[0];
  e.manageWorkHold({
    action: 'hold',
    workId: current.id,
    expectedAttempt: 1,
    expectedRevision: 0,
    actor: 'test',
    category: 'other',
    reason: 'External blocker',
    checkpointRef: 'test',
  });
  // Change the applicable scope hold while the assignment is held.
  resume(e, h.id);
  const next = hold(e, w);
  e.manageWorkHold({
    action: 'resume',
    workId: current.id,
    expectedAttempt: 1,
    expectedRevision: 1,
    actor: 'test',
  });
  expect(e.available(r.id, { advance: false })).toEqual([]);
  expect(e.continuation.briefing({ id: r.id, limit: 20 }).available.total).toBe(
    0,
  );
  resume(e, next.id);
  expect(e.available(r.id)).toHaveLength(1);
});
