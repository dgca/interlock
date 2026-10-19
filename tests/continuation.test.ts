import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  blankDefinition,
  nodeSchema,
  type WorkflowDefinition,
} from '@interlock/core';
import { batchDefinition, itemAgent, nestedBatches } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';
import { appRouter } from '../packages/server/src/router';

const engines: Engine[] = [];
const stores: Store[] = [];
const worker = { workerId: 'test', freshContext: false, tools: [], skills: [] };
function setup() {
  const store = new Store(':memory:');
  stores.push(store);
  const engine = new Engine(store, process.cwd());
  engines.push(engine);
  return engine;
}
function start(
  engine: Engine,
  definition = blankDefinition(),
  input: any = null,
) {
  const workflow = engine.create('Continuation', '', definition);
  engine.publish(workflow.id);
  return engine.start(workflow.id, input).run;
}
const briefing = (engine: Engine, id: string, limit = 20) =>
  engine.continuation.briefing({ id, limit });
const wait = (
  engine: Engine,
  id: string,
  cursor: string,
  timeoutMs = 1000,
  signal?: AbortSignal,
) => engine.continuation.wait({ id, cursor, timeoutMs, limit: 20 }, signal);
const result = (engine: Engine, id: string, options = {}) =>
  engine.continuation.result({
    id,
    field: 'output',
    path: '',
    maxBytes: 65536,
    ...options,
  });
const flush = () => Promise.resolve();

function publishSummary(
  engine: Engine,
  definition = blankDefinition(),
  input: any = null,
  limit = 20,
) {
  const workflow = engine.create('Compact mutation', '', definition);
  engine.publish(workflow.id);
  return engine.startSummary(workflow.id, input, undefined, limit);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-02T12:00:00Z');
});
afterEach(() => {
  engines.splice(0).forEach((e) => e.stop());
  stores.splice(0).forEach((s) => s.close());
  vi.useRealTimers();
});

it('briefs available, claimed, renewed, completed work without payloads or tokens at equal timestamps', async () => {
  const engine = setup();
  const d = blankDefinition();
  if (d.nodes[1].kind === 'agent') {
    d.nodes[1].context.tools = ['read'];
    d.nodes[1].context.instructions = 'private-instructions';
  }
  const run = start(engine, d, { huge: 'payload-marker'.repeat(20000) });
  const first = briefing(engine, run.id);
  expect(first.available.total).toBe(1);
  expect(first.blockers.items[0].reason).toBe('available_work');
  expect(first.available.items[0].context).toEqual({
    mode: 'current',
    tools: ['read'],
    skills: [],
  });
  expect(JSON.stringify(first)).not.toMatch(
    /payload-marker|private-instructions|Process the input|outputSchema|"token"/,
  );
  const waiting = wait(engine, run.id, first.cursor);
  const claim = engine.claim(first.available.items[0].id, {
    ...worker,
    tools: ['read'],
  });
  const claimed = await waiting;
  expect(claimed).toMatchObject({
    changed: true,
    reset: false,
    timedOut: false,
  });
  expect(claimed.revision).toBeGreaterThan(first.revision);
  expect(claimed.claimed.items[0]).toMatchObject({
    workerId: 'test',
    executionId: claim.executionId,
  });
  expect(JSON.stringify(claimed)).not.toContain(claim.token!);
  const renewing = wait(engine, run.id, claimed.cursor);
  engine.renew(claim.id, claim.token!, 600);
  const renewed = await renewing;
  expect(renewed.revision).toBeGreaterThan(claimed.revision);
  engine.submit(claim.id, claim.token!, null);
  const completed = briefing(engine, run.id);
  expect(completed.run.status).toBe('completed');
  expect(completed.available.total + completed.claimed.total).toBe(0);
  expect(result(engine, run.id).value).toBe(null);
  expect(result(engine, run.id, { executionId: claim.executionId }).value).toBe(
    null,
  );
});

it('isolates unrelated writes, handles simultaneous waiters, and times out without writes', async () => {
  const engine = setup(),
    run = start(engine),
    other = start(engine);
  const initial = briefing(engine, run.id);
  const revision = initial.revision;
  let woke = false;
  const one = wait(engine, run.id, initial.cursor).then((value) => {
    woke = true;
    return value;
  });
  const two = wait(engine, run.id, initial.cursor);
  engine.cancel(other.id);
  engine.update(run.workflowId, { name: 'Renamed' });
  await flush();
  expect(woke).toBe(false);
  engine.cancel(run.id);
  expect((await one).run.status).toBe('cancelled');
  expect((await two).changed).toBe(true);
  const final = briefing(engine, run.id);
  const timeout = wait(engine, run.id, final.cursor, 25);
  await vi.advanceTimersByTimeAsync(25);
  expect(await timeout).toMatchObject({
    changed: false,
    timedOut: true,
    reset: false,
    cursor: final.cursor,
  });
  expect(final.revision).toBeGreaterThan(revision);
  expect(briefing(engine, run.id).revision).toBe(final.revision);
  expect(await wait(engine, run.id, final.cursor, 0)).toMatchObject({
    changed: false,
    timedOut: true,
  });
});

it('subscribes before taking the snapshot and observes a change during subscription', async () => {
  const engine = setup(),
    run = start(engine);
  const initial = briefing(engine, run.id);
  const subscribe = engine.store.subscribe.bind(engine.store);
  vi.spyOn(engine.store, 'subscribe').mockImplementation((listener) => {
    const unsubscribe = subscribe(listener);
    engine.cancel(run.id);
    return unsubscribe;
  });
  expect(await wait(engine, run.id, initial.cursor)).toMatchObject({
    changed: true,
    run: { status: 'cancelled' },
  });
});

it('cleans up listeners and timers on timeout, abort, already-aborted signals, shutdown, and missing run', async () => {
  const engine = setup(),
    run = start(engine);
  const initial = briefing(engine, run.id);
  const subscribe = engine.store.subscribe.bind(engine.store);
  const cleanups: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(engine.store, 'subscribe').mockImplementation((listener) => {
    const stop = vi.fn(subscribe(listener));
    cleanups.push(stop);
    return stop;
  });
  const controller = new AbortController();
  const pending = wait(
    engine,
    run.id,
    initial.cursor,
    60000,
    controller.signal,
  );
  const rejection = expect(pending).rejects.toThrow('cancelled');
  controller.abort(new Error('cancelled'));
  await rejection;
  expect(cleanups[0]).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  await expect(
    wait(engine, run.id, initial.cursor, 60000, controller.signal),
  ).rejects.toThrow('cancelled');
  const stopped = wait(engine, run.id, initial.cursor, 60000);
  const stoppedCheck = expect(stopped).rejects.toThrow('Engine stopped');
  engine.stop();
  await stoppedCheck;
  expect(cleanups.every((fn) => fn.mock.calls.length === 1)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await expect(wait(setup(), 'missing', '', 1)).rejects.toThrow(
    'Run not found',
  );
});

it('recovers invalid, foreign, future, and restart cursors without confusing completion', async () => {
  const engine = setup(),
    run = start(engine),
    other = start(engine);
  const snapshot = briefing(engine, run.id);
  const future = JSON.parse(
    Buffer.from(snapshot.cursor, 'base64url').toString(),
  );
  future.revision += 10000;
  for (const cursor of [
    'invalid',
    briefing(engine, other.id).cursor,
    Buffer.from(JSON.stringify(future)).toString('base64url'),
  ])
    expect(await wait(engine, run.id, cursor)).toMatchObject({
      changed: true,
      reset: true,
      timedOut: false,
      run: { status: 'waiting' },
    });
  const restarted = new Engine(engine.store, process.cwd());
  engines.push(restarted);
  expect(await wait(restarted, run.id, snapshot.cursor)).toMatchObject({
    reset: true,
    run: { status: 'waiting' },
    revision: snapshot.revision,
  });
});

it('summarizes queued and nested Batch progress with bounded lists and exact totals', () => {
  const engine = setup(),
    run = start(
      engine,
      batchDefinition(itemAgent(), {
        concurrency: 2,
        itemsPath: 'list.0.values',
      }),
      { list: [{ values: [1, 2, 3, 4] }] },
    );
  const first = briefing(engine, run.id, 1);
  expect(first.batches.items[0]).toMatchObject({
    total: 4,
    dispatched: 2,
    queued: 2,
    progress: { waiting: 2 },
  });
  expect(first.available).toMatchObject({ total: 2, truncated: true });
  expect(first.available.items).toHaveLength(1);
  const [a, b] = engine.available(run.id);
  const claim = engine.claim(a.id, worker);
  engine.submit(a.id, claim.token!, 11);
  const second = briefing(engine, run.id);
  expect(second.batches.items[0]).toMatchObject({
    dispatched: 3,
    queued: 1,
    progress: { completed: 1, waiting: 2 },
  });
  expect(second.progress.requested).toMatchObject({ waiting: 3, completed: 1 });
  engine.claim(b.id, worker);
  expect(briefing(engine, run.id).claimed.total).toBe(1);
  const nested = start(engine, nestedBatches(2), [
    [1, 2],
    [3, 4],
  ]);
  expect(briefing(engine, nested.id).batches.total).toBe(3);
});

it('keeps ordinary and nested detached lifecycle counts distinct after parent completion and wakes for detached changes', async () => {
  const engine = setup(),
    target = start(engine);
  const ordinary = start(engine, workflowCall(target.workflowId));
  const ordinaryBrief = briefing(engine, ordinary.id);
  expect(ordinaryBrief.progress.requested.waiting).toBe(2);
  expect(ordinaryBrief.detached.total).toBe(0);
  const intermediate = engine.create(
    'Detached middle',
    '',
    workflowCall(target.workflowId, 'detached'),
  );
  engine.publish(intermediate.id);
  const parent = start(engine, workflowCall(intermediate.id, 'detached'));
  const snapshot = briefing(engine, parent.id);
  expect(snapshot.run.status).toBe('completed');
  expect(snapshot.progress.requested.completed).toBe(1);
  expect(snapshot.detached.total).toBe(2);
  expect(snapshot.progress.independent).toMatchObject({
    completed: 1,
    waiting: 1,
  });
  const work = snapshot.available.items[0];
  expect(work.lifecycleRunId).toBe(work.runId);
  const pending = wait(engine, parent.id, snapshot.cursor);
  engine.cancel(work.runId);
  expect((await pending).progress.independent.cancelled).toBe(1);
  expect(briefing(engine, parent.id).run.status).toBe('completed');
});

it('reports Wait and unclaimed deadlines without pumping overdue timers, then observes timer advancement', async () => {
  const engine = setup();
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Pause',
    kind: 'wait',
    timing: { kind: 'duration', ms: 10 },
  });
  const run = start(engine, d);
  const initial = briefing(engine, run.id);
  expect(initial.blockers.items[0].reason).toBe('wait');
  expect(initial.nextDeadline?.kind).toBe('wait');
  vi.setSystemTime(Date.now() + 20);
  expect(briefing(engine, run.id).run.status).toBe('waiting');
  const pending = wait(engine, run.id, initial.cursor);
  engine.pump();
  expect((await pending).run.status).toBe('completed');
  expect(briefing(engine, run.id).nextDeadline).toBeNull();
  const agent = blankDefinition();
  if (agent.nodes[1].kind === 'agent') agent.nodes[1].unclaimedTimeoutMs = 100;
  agent.edges.push({
    id: 'timeout',
    source: 'agent',
    target: 'exit',
    port: 'timeout',
  });
  expect(briefing(engine, start(engine, agent).id).nextDeadline?.kind).toBe(
    'unclaimed',
  );
});

it('reports failures and targeted paths, enforces response bounds, and rejects unavailable or foreign results', () => {
  const engine = setup(),
    run = start(engine, blankDefinition(), { list: [null, { text: 'é' }] });
  expect(result(engine, run.id, { field: 'input', path: 'list.0' }).value).toBe(
    null,
  );
  expect(
    result(engine, run.id, { field: 'input', path: 'list.1.text' }).bytes,
  ).toBe(4);
  for (const options of [
    {},
    { field: 'input', path: 'missing' },
    { field: 'input', path: '__proto__' },
    { executionId: 'foreign' },
    { field: 'input', maxBytes: 1 },
  ])
    expect(() => result(engine, run.id, options)).toThrow();
  const broken = start(engine, batchDefinition(), 'wrong input');
  expect(briefing(engine, broken.id).failures.total).toBe(1);
  expect(briefing(engine, broken.id).blockers.items[0]).toMatchObject({
    reason: 'failure',
  });
  expect(() => briefing(engine, run.id, 101)).toThrow();
  expect(() => wait(engine, run.id, '', 60001)).toThrow();
});

it('rolls back revisions with state, ignores timestamp-only writes, and allows mutations while waiting', async () => {
  const engine = setup(),
    run = start(engine);
  const initial = briefing(engine, run.id);
  expect(() =>
    engine.store.transaction(() => {
      engine.store.put('runs', { ...engine.run(run.id), status: 'cancelled' });
      throw new Error('rollback');
    }),
  ).toThrow('rollback');
  engine.store.put('runs', { ...engine.run(run.id), updatedAt: 'later' });
  expect(briefing(engine, run.id).cursor).toBe(initial.cursor);
  const caller = appRouter.createCaller({ engine });
  const pending = caller.runs.wait({
    id: run.id,
    cursor: initial.cursor,
    timeoutMs: 1000,
  });
  await caller.runs.cancel({ id: run.id });
  expect((await pending).changed).toBe(true);
});

it('bounds large Batch responses and reports collect-policy item failure separately from parent failure', () => {
  const engine = setup(),
    run = start(
      engine,
      batchDefinition(itemAgent(), {
        concurrency: 50,
        maxItems: 200,
        failurePolicy: 'collect',
      }),
      Array.from({ length: 150 }, (_, i) => ({ i, payload: 'bulk-payload' })),
    );
  const first = briefing(engine, run.id, 3);
  expect(first.descendants).toMatchObject({ total: 50, truncated: true });
  expect(first.available).toMatchObject({ total: 50, truncated: true });
  expect(first.batches.items[0]).toMatchObject({
    total: 150,
    dispatched: 50,
    queued: 100,
  });
  expect(JSON.stringify(first)).not.toContain('bulk-payload');
  const work = engine.available(run.id)[0],
    claim = engine.claim(work.id, worker);
  engine.reportFailure(work.id, claim.token!, 'item failed');
  const after = briefing(engine, run.id, 3);
  expect(after.run.status).toBe('waiting');
  expect(after.failures.total).toBe(1);
  expect(after.batches.items[0].progress.failed).toBe(1);
});

it('errors when a requested run is deleted during a wait', async () => {
  const engine = setup(),
    run = start(engine);
  engine.cancel(run.id);
  const snapshot = briefing(engine, run.id);
  const pending = wait(engine, run.id, snapshot.cursor);
  const rejected = expect(pending).rejects.toThrow('Run not found');
  engine.deleteWorkflow(run.workflowId);
  await rejected;
});

it('identifies running local execution separately from agent and timer waits', () => {
  const engine = setup(),
    definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Local script',
    kind: 'script',
    language: 'javascript',
    command: 'return input;',
  });
  const run = start(engine, definition);
  expect(briefing(engine, run.id)).toMatchObject({
    run: { status: 'running' },
    available: { total: 0 },
    claimed: { total: 0 },
    blockers: { items: [{ reason: 'executing' }] },
  });
});

it('returns compact mutations without constructing inspection and preserves full API types', async () => {
  const engine = setup();
  const inspect = vi.spyOn(engine, 'inspect');
  const summary = publishSummary(engine);
  expect(inspect).not.toHaveBeenCalled();
  const claim = engine.claim(summary.nextWork.items[0].id, worker);
  const completed = engine.submitSummary(claim.id, claim.token!, {
    answer: 42,
  });
  expect(inspect).not.toHaveBeenCalled();
  expect(completed).toMatchObject({
    ok: true,
    workId: claim.id,
    workRunId: summary.runId,
    runId: summary.runId,
    runStatus: 'completed',
    nextWork: { items: [], total: 0, truncated: false },
    next: 'inspect_result',
    nextDeadline: null,
  });
  expect(
    await wait(engine, completed.runId, completed.cursor, 0),
  ).toMatchObject({
    reset: false,
    changed: false,
    timedOut: true,
  });
  const caller = appRouter.createCaller({ engine });
  const full = await caller.work.submit({
    workId: claim.id,
    token: claim.token!,
    output: { answer: 42 },
  });
  expect(full.run.id).toBe(summary.runId);
  expect(full.definition).not.toBeNull();
  expect(full.run.output).toEqual({ answer: 42 });
});

it('continues a waited child at its parent and exposes the newly unlocked parent assignment', () => {
  const engine = setup();
  const child = engine.create('Child', '', blankDefinition());
  engine.publish(child.id);
  const started = publishSummary(engine, workflowCall(child.id, 'wait', true));
  const work = started.nextWork.items[0];
  expect(work.runId).not.toBe(started.runId);
  const claim = engine.claim(work.id, worker);
  const continued = engine.submitSummary(work.id, claim.token!, null);
  expect(continued).toMatchObject({
    runId: started.runId,
    workRunId: work.runId,
    runStatus: 'waiting',
  });
  expect(continued.nextWork.items).toMatchObject([
    { runId: started.runId, nodeId: 'after' },
  ]);
});

it('caps Batch discovery with exact totals and includes work dispatched after an item completes', async () => {
  const engine = setup();
  const started = publishSummary(
    engine,
    batchDefinition(itemAgent(), { concurrency: 3 }),
    [1, 2, 3, 4],
    1,
  );
  expect(started.nextWork).toMatchObject({ total: 3, truncated: true });
  expect(started.nextWork.items).toHaveLength(1);
  const [first, second] = engine.available(started.runId);
  const claim = engine.claim(first.id, worker);
  const continued = engine.submitSummary(first.id, claim.token!, 10, 1);
  expect(continued.runId).toBe(started.runId);
  expect(continued.workRunId).toBe(first.runId);
  expect(continued.nextWork).toMatchObject({
    total: 3,
    truncated: true,
    items: [{ id: second.id }],
  });
  const now = briefing(engine, continued.runId, 1);
  expect(continued.nextWork).toEqual(now.available);
  expect(continued.cursor).toBe(now.cursor);
  expect(
    await wait(engine, continued.runId, continued.cursor, 0),
  ).toMatchObject({ reset: false, changed: false });
});

it('keeps detached work discoverable after parent completion and stops submission scope at the detached boundary', () => {
  const engine = setup();
  const child = engine.create('Detached batch', '', batchDefinition());
  engine.publish(child.id);
  const started = publishSummary(
    engine,
    workflowCall(child.id, 'detached'),
    [1, 2, 3],
  );
  expect(started.runStatus).toBe('completed');
  const work = started.nextWork.items[0];
  expect(work.rootRunId).toBe(started.runId);
  expect(work.lifecycleRunId).not.toBe(started.runId);
  expect(work.lifecycleRunId).not.toBe(work.runId);
  const claim = engine.claim(work.id, worker);
  const continued = engine.submitSummary(work.id, claim.token!, 10);
  expect(continued).toMatchObject({
    runId: work.lifecycleRunId,
    workRunId: work.runId,
    runStatus: 'waiting',
  });
  expect(
    continued.nextWork.items.every(
      (w) => w.lifecycleRunId === work.lifecycleRunId,
    ),
  ).toBe(true);
  expect(
    continued.nextWork.items.every((w) => w.rootRunId === started.runId),
  ).toBe(true);
});

it('reports timer waits and downstream failure as accepted submissions without available work', () => {
  const engine = setup();
  for (const kind of ['wait', 'switch'] as const) {
    const definition = blankDefinition();
    definition.nodes.splice(
      2,
      0,
      nodeSchema.parse(
        kind === 'wait'
          ? {
              id: 'after',
              label: 'Pause',
              kind,
              timing: { kind: 'duration', ms: 1000 },
            }
          : {
              id: 'after',
              label: 'No match',
              kind,
              path: 'route',
              cases: [{ port: 'known', equals: 'known' }],
            },
      ),
    );
    definition.edges[1].target = 'after';
    definition.edges.push({
      id: 'out',
      source: 'after',
      target: 'exit',
      port: kind === 'wait' ? 'default' : 'known',
    });
    const started = publishSummary(engine, definition);
    const claim = engine.claim(started.nextWork.items[0].id, worker);
    const continued = engine.submitSummary(claim.id, claim.token!, {
      route: 'missing',
    });
    expect(continued.ok).toBe(true);
    expect(continued.nextWork.items).toEqual([]);
    expect(continued.runStatus).toBe(kind === 'wait' ? 'waiting' : 'failed');
    expect(continued.next).toBe(
      kind === 'wait' ? 'wait_for_change' : 'inspect_failure',
    );
    if (kind === 'wait') expect(continued.nextDeadline?.kind).toBe('wait');
  }
});

it('replays accepted work with current lifecycle state and rejects conflicting output', async () => {
  const engine = setup();
  const started = publishSummary(engine, batchDefinition(), [1, 2]);
  const [first, second] = started.nextWork.items.map((w) =>
    engine.claim(w.id, worker),
  );
  const waiting = engine.submitSummary(first.id, first.token!, 1);
  expect(waiting.next).toBe('wait_for_worker');
  engine.submitSummary(second.id, second.token!, 2);
  const before = engine.inspect(started.runId);
  const replay = engine.submitSummary(first.id, first.token!, 1);
  expect(replay.runStatus).toBe('completed');
  expect(replay.cursor).not.toBe(waiting.cursor);
  expect(engine.inspect(started.runId)).toEqual(before);
  expect(() => engine.submitSummary(first.id, first.token!, 3)).toThrow(
    'different result',
  );
  const restarted = new Engine(engine.store, process.cwd());
  engines.push(restarted);
  const recovered = restarted.submitSummary(first.id, first.token!, 1);
  expect(recovered.cursor).not.toBe(replay.cursor);
  expect(await wait(restarted, replay.runId, replay.cursor, 0)).toMatchObject({
    reset: true,
  });
});

it('rejects bad compact limits before any mutation with valid controls', async () => {
  const engine = setup();
  const workflow = engine.create('Options', '', blankDefinition());
  engine.publish(workflow.id);
  const caller = appRouter.createCaller({ engine });
  const before = engine.store.runs();
  await expect(
    caller.runs.startSummary({
      workflowId: workflow.id,
      input: null,
      limit: 0,
    }),
  ).rejects.toThrow();
  expect(() =>
    engine.startSummary(workflow.id, null, undefined, 101),
  ).toThrow();
  expect(engine.store.runs()).toEqual(before);
  const started = await caller.runs.startSummary({
    workflowId: workflow.id,
    input: null,
    limit: 1,
  });
  const claim = engine.claim(started.nextWork.items[0].id, worker);
  const protectedState = engine.inspect(started.runId);
  await expect(
    caller.work.submitSummary({
      workId: claim.id,
      token: claim.token!,
      output: null,
      limit: -1,
    }),
  ).rejects.toThrow();
  expect(() =>
    engine.submitSummary(claim.id, claim.token!, null, 1.5),
  ).toThrow();
  expect(engine.inspect(started.runId)).toEqual(protectedState);
  const completed = await caller.work.submitSummary({
    workId: claim.id,
    token: claim.token!,
    output: null,
  });
  expect(completed.runStatus).toBe('completed');
});

it('retains fresh-context requirements while omitting arbitrarily large instruction and result bodies', () => {
  const engine = setup();
  const definition = blankDefinition();
  const agent = definition.nodes[1];
  if (agent.kind !== 'agent') throw new Error('Expected agent');
  agent.context = {
    mode: 'fresh',
    tools: ['read'],
    skills: ['review'],
    instructions: 'secret-body'.repeat(10000),
  };
  const started = publishSummary(engine, definition, {
    body: 'secret-body'.repeat(10000),
  });
  expect(started.nextWork.items[0].context).toEqual({
    mode: 'fresh',
    tools: ['read'],
    skills: ['review'],
  });
  expect(JSON.stringify(started)).not.toContain('secret-body');
  expect(() => engine.claim(started.nextWork.items[0].id, worker)).toThrow(
    'fresh context',
  );
  const claim = engine.claim(started.nextWork.items[0].id, {
    ...worker,
    freshContext: true,
    tools: ['read'],
    skills: ['review'],
  });
  expect(claim.context.instructions).toContain('secret-body');
  expect(engine.submitSummary(claim.id, claim.token!, null).runStatus).toBe(
    'completed',
  );
});
