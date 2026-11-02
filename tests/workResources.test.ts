import { runProgress } from '../packages/ui/src/features/runs/runProgress';
import { workflowCall } from './fixtures/detached';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  blankDefinition,
  nodeSchema,
  type WorkRequest,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { exportWorkflows } from '../packages/runtime/src/transfer';
import { Store } from '@interlock/storage';
const engines: Engine[] = [],
  dirs: string[] = [];
const worker = {
  workerId: 'worker',
  freshContext: false,
  tools: [],
  skills: [],
};
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
const fixed = (...names: string[]) =>
  names.map((value) => ({ source: 'literal', value }));
function fixture(
  e: Engine,
  names = ['checkout:shared'],
  config: Record<string, unknown> = {},
  input: any = {},
) {
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    ...d.nodes[1],
    resources: fixed(...names),
    ...config,
  });
  if (config.unclaimedTimeoutMs)
    d.edges.push({
      id: 'timeout',
      source: 'agent',
      target: 'exit',
      port: 'timeout',
    });
  const w = e.create('Resources', '', d);
  e.publish(w.id);
  const run = e.start(w.id, input).run;
  return { w, run, work: e.store.work().find((w) => w.runId === run.id)! };
}
function reservations(e: Engine, workId: string) {
  const result = e.manageWorkResources({ action: 'inspect', workId });
  if (!('reservations' in result)) throw Error('Expected inspection');
  return result.reservations;
}
function release(e: Engine, workId: string, expectedAttempt = 1) {
  return e.manageWorkResources({
    action: 'release',
    workId,
    expectedAttempt,
    actor: 'harness',
    confirmStopped: true,
  });
}
function hold(e: Engine, id: string) {
  const w = e.store.get<WorkRequest>('work', id)!;
  return e.manageWorkHold({
    action: 'hold',
    workId: id,
    expectedAttempt: w.attempt,
    expectedRevision: w.holdRevision ?? 0,
    actor: 'coordinator',
    category: 'other',
    reason: 'Paused',
    checkpointRef: 'checkpoint',
  });
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
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
});
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true });
  vi.useRealTimers();
});
it('blocks across roots without consuming attempts or usage, then wakes after completion', () => {
  const e = setup(),
    a = fixture(e),
    b = fixture(e);
  const first = e.claim(a.work.id, worker);
  expect(e.available(b.run.id)).toEqual([]);
  const before = JSON.stringify(e.store.list('usageAttempts'));
  expect(() => e.claim(b.work.id, worker)).toThrow(/Resource blocked/);
  expect(e.store.get<WorkRequest>('work', b.work.id)?.attempt).toBe(0);
  expect(JSON.stringify(e.store.list('usageAttempts'))).toBe(before);
  const brief = e.continuation.briefing({ id: b.run.id, limit: 1 });
  expect(brief).toMatchObject({
    next: 'wait_for_change',
    resourceBlocked: {
      total: 1,
      items: [
        { owners: [{ workId: a.work.id, attempt: 1, state: 'claimed' }] },
      ],
    },
    available: { total: 0 },
    blockers: { items: [{ reason: 'resource_blocked' }] },
  });
  const visible = e.inspect(b.run.id);
  expect(
    runProgress(
      visible.run,
      visible.definition,
      visible.descendants,
      visible.descendantWork,
    ).title,
  ).toMatch(/Waiting for a resource/);
  e.submit(a.work.id, first.token!, {});
  expect(e.available(b.run.id)).toHaveLength(1);
  expect(e.continuation.briefing({ id: b.run.id, limit: 20 }).cursor).not.toBe(
    brief.cursor,
  );
  expect(e.claim(b.work.id, worker).attempt).toBe(1);
});
it('acquires all resources atomically without partially reserving independent resources', () => {
  const e = setup(),
    a = fixture(e, ['b']),
    multi = fixture(e, ['a', 'b']),
    independent = fixture(e, ['a']);
  e.claim(a.work.id, worker);
  expect(() => e.claim(multi.work.id, worker)).toThrow(/Resource blocked/);
  expect(e.claim(independent.work.id, worker).status).toBe('claimed');
  expect(reservations(e, multi.work.id)).toEqual([]);
});
it('resolves existing input bindings once, normalizes names, and keeps assignment input unchanged', () => {
  const e = setup(),
    a = fixture(
      e,
      [],
      {
        resources: [
          { source: 'runInput', path: 'checkout' },
          { source: 'input', path: 'browser' },
        ],
      },
      { checkout: ' workspace:one ', browser: 'browser:shared', payload: 42 },
    );
  expect(a.work.resources).toEqual(['browser:shared', 'workspace:one']);
  expect(a.work.input).toEqual({
    checkout: ' workspace:one ',
    browser: 'browser:shared',
    payload: 42,
  });
  const b = fixture(e, ['workspace:one']);
  e.claim(a.work.id, worker);
  expect(e.available(b.run.id)).toEqual([]);
});
it.each([[''], ['x', 'x'], [42], ['x\ny']])(
  'rejects invalid literal resource requirements at publication: %j',
  (...names) => {
    const e = setup(),
      d = blankDefinition();
    d.nodes[1] = nodeSchema.parse({
      ...d.nodes[1],
      resources: names.map((value) => ({ source: 'literal', value })),
    });
    const w = e.create('Incomplete draft', '', d);
    expect(() => e.publish(w.id)).toThrow();
    expect(e.store.work()).toEqual([]);
  },
);
it('fails assignment creation for missing/non-string/duplicate dynamic names before making work available', () => {
  for (const input of [{}, { id: 3 }, { id: 'a' }]) {
    const e = setup(),
      { run } = fixture(
        e,
        [],
        {
          resources: [
            { source: 'input', path: 'id' },
            { source: 'literal', value: 'a' },
          ],
        },
        input,
      );
    expect(e.run(run.id).status).toBe('failed');
    expect(e.store.work()).toEqual([]);
    expect(e.store.list('workResources')).toEqual([]);
  }
});
it('rejects resource bindings that cross execution scope while keeping incomplete drafts saveable', () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    ...d.nodes[1],
    resources: [{ source: 'itemInput', path: 'id' }],
  });
  const w = e.create('Invalid scope', '', d);
  expect(() => e.publish(w.id)).toThrow(/Batch membership/);
});
it('keeps independent resources and unconfigured assignments parallel', () => {
  const e = setup(),
    a = fixture(e, ['a']),
    b = fixture(e, ['b']),
    c = fixture(e, []);
  for (const x of [a, b, c])
    expect(e.claim(x.work.id, worker).status).toBe('claimed');
  expect(reservations(e, c.work.id)).toEqual([]);
});
it('rolls resources, continuity, attempts and budget consumption back if claim commit fails', () => {
  const e = setup(),
    a = fixture(e, ['a'], { context: { continuityGroup: 'shared' } });
  e.budgets.set({
    runId: a.run.id,
    expectedRevision: 0,
    budget: {
      scope: 'tree',
      unknownUsage: 'allow',
      limits: { claims: { max: 1 } },
    },
  });
  const fail = vi.spyOn(e.usage, 'claimed').mockImplementationOnce(() => {
    throw Error('injected');
  });
  expect(() =>
    e.claim(a.work.id, {
      ...worker,
      session: { executorId: 'h', sessionId: 'one' },
    }),
  ).toThrow('injected');
  fail.mockRestore();
  expect(e.store.get<WorkRequest>('work', a.work.id)?.attempt).toBe(0);
  expect(e.store.list('workResources')).toEqual([]);
  expect(e.store.list('usageAttempts')).toEqual([]);
  expect(
    e.claim(a.work.id, {
      ...worker,
      session: { executorId: 'h', sessionId: 'two' },
    }).attempt,
  ).toBe(1);
});
it('does not reserve resources for a capability or budget rejection', () => {
  const e = setup(),
    a = fixture(e, ['a'], { context: { tools: ['git'] } });
  expect(() => e.claim(a.work.id, worker)).toThrow(/Missing capabilities/);
  expect(e.store.list('workResources')).toEqual([]);
  const b = fixture(e, ['a']);
  e.budgets.set({
    runId: b.run.id,
    expectedRevision: 0,
    budget: {
      scope: 'tree',
      unknownUsage: 'allow',
      limits: { claims: { max: 1 } },
    },
  });
  const first = e.claim(b.work.id, worker);
  e.reportFailure(b.work.id, first.token!, 'cooperative');
  expect(() => e.claim(b.work.id, worker)).toThrow(/Budget blocked/);
  expect(e.store.list('workResources')).toEqual([]);
});
it('retains ownership during renewal and rejected results, and releases on cooperative failure', () => {
  const e = setup(),
    a = fixture(e, undefined, {
      outputSchema: {
        type: 'object',
        required: ['ok'],
        properties: { ok: { type: 'boolean' } },
      },
    }),
    b = fixture(e),
    c = e.claim(a.work.id, worker, 10);
  vi.advanceTimersByTime(9000);
  e.renew(a.work.id, c.token!, 20);
  vi.advanceTimersByTime(2000);
  e.pump();
  expect(reservations(e, a.work.id)[0].state).toBe('claimed');
  expect(() => e.submit(a.work.id, c.token!, {})).toThrow();
  expect(reservations(e, a.work.id)[0].state).toBe('claimed');
  e.reportFailure(a.work.id, c.token!, 'stopped using resource');
  expect(e.claim(b.work.id, worker).status).toBe('claimed');
});
it('expiry retains uncertain ownership and blocks both replacement and unrelated claims until exact recovery', () => {
  const e = setup(),
    a = fixture(e),
    b = fixture(e),
    old = e.claim(a.work.id, worker, 10);
  vi.advanceTimersByTime(10001);
  e.pump();
  expect(e.available()).toEqual([]);
  expect(e.continuation.summary(a.run.id, 20).next).toBe('inspect_resources');
  expect(reservations(e, a.work.id)[0]).toMatchObject({
    state: 'uncertain',
    attempt: 1,
  });
  expect(() => e.submit(a.work.id, old.token!, {})).toThrow();
  expect(() => e.renew(a.work.id, old.token!)).toThrow(/resource-blocked/);
  expect(release(e, a.work.id)).toMatchObject({ applied: true, released: 1 });
  const replacement = e.claim(a.work.id, worker);
  expect(replacement.attempt).toBe(2);
  expect(release(e, a.work.id, 1)).toMatchObject({
    applied: false,
    released: 0,
  });
  expect(() => e.reportFailure(a.work.id, old.token!, 'stale')).toThrow();
  expect(e.available(b.run.id)).toEqual([]);
});
it('refuses stop confirmation while a claim remains active', () => {
  const e = setup(),
    a = fixture(e);
  e.claim(a.work.id, worker);
  expect(() => release(e, a.work.id)).toThrow(/active claim/);
  expect(reservations(e, a.work.id)[0].state).toBe('claimed');
  expect(() =>
    e.manageWorkResources({
      action: 'release',
      workId: a.work.id,
      expectedAttempt: 1,
      actor: 'h',
      confirmStopped: false,
    } as any),
  ).toThrow();
});
it('cancellation retains inspectable uncertain reservations and prevents deletion until reconciled', () => {
  const e = setup(),
    a = fixture(e),
    b = fixture(e);
  e.claim(a.work.id, worker);
  e.cancel(a.run.id);
  expect(e.continuation.briefing({ id: a.run.id, limit: 20 })).toMatchObject({
    next: 'inspect_resources',
    resourceReservations: {
      total: 1,
      items: [{ workId: a.work.id, state: 'uncertain' }],
    },
  });
  expect(() => e.deleteWorkflow(a.w.id)).toThrow(
    /Resource reservations remain/,
  );
  expect(e.store.get('work', a.work.id)).toBeDefined();
  release(e, a.work.id);
  e.deleteWorkflow(a.w.id);
  expect(e.claim(b.work.id, worker).status).toBe('claimed');
});
it('holding claimed work requires separate reconciliation, while an unclaimed hold reserves nothing', () => {
  const e = setup(),
    a = fixture(e),
    b = fixture(e);
  const c = e.claim(a.work.id, worker);
  hold(e, a.work.id);
  resume(e, a.work.id);
  expect(() => e.claim(a.work.id, worker)).toThrow(/Resource blocked/);
  expect(() => e.submit(a.work.id, c.token!, {})).toThrow();
  release(e, a.work.id);
  hold(e, a.work.id);
  expect(e.claim(b.work.id, worker).status).toBe('claimed');
});
it.each(['budget-first', 'resource-first'])(
  'pauses unclaimed deadlines across overlapping gates and holds: %s',
  (order) => {
    const e = setup(),
      owner = fixture(e),
      target = fixture(e, undefined, { unclaimedTimeoutMs: 10000 });
    const policy = {
      scope: 'tree' as const,
      unknownUsage: 'allow' as const,
      limits: { claims: { max: 1 } },
    };
    // Consume a tree claim in the target's own prior retry without reserving the shared resource permanently.
    const once = e.claim(target.work.id, worker);
    e.reportFailure(target.work.id, once.token!, 'done');
    let c: WorkRequest;
    if (order === 'resource-first') c = e.claim(owner.work.id, worker);
    e.budgets.set({
      runId: target.run.id,
      expectedRevision: 0,
      budget: policy,
    });
    if (order === 'budget-first') c = e.claim(owner.work.id, worker);
    vi.advanceTimersByTime(40000);
    e.pump();
    expect(e.run(target.run.id).status).toBe('waiting');
    hold(e, target.work.id);
    e.budgets.set({ runId: target.run.id, expectedRevision: 1, budget: null });
    resume(e, target.work.id);
    vi.advanceTimersByTime(20000);
    e.pump();
    expect(e.run(target.run.id).status).toBe('waiting');
    e.submit(owner.work.id, c!.token!, {});
    vi.advanceTimersByTime(9999);
    e.pump();
    expect(e.store.get<WorkRequest>('work', target.work.id)?.status).toBe(
      'available',
    );
    vi.advanceTimersByTime(2);
    e.pump();
    expect(e.store.get<WorkRequest>('work', target.work.id)?.status).toBe(
      'timed_out',
    );
  },
);
it('persists active reservations across restart, then recovers expired owners conservatively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-resources-'));
  dirs.push(dir);
  const path = join(dir, 'state.db');
  const e = setup(path),
    a = fixture(e),
    b = fixture(e),
    c = e.claim(a.work.id, worker, 10);
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  const next = setup(path);
  expect(next.available(b.run.id)).toEqual([]);
  next.renew(a.work.id, c.token!);
  vi.advanceTimersByTime(10001);
  next.pump();
  expect(reservations(next, a.work.id)[0].state).toBe('uncertain');
  release(next, a.work.id);
  expect(next.claim(b.work.id, worker).status).toBe('claimed');
});
it('keeps reservation hashes private and excludes runtime ownership from portable export', () => {
  const e = setup(),
    a = fixture(e);
  const c = e.claim(a.work.id, worker);
  for (const data of [
    e.inspect(a.run.id),
    e.continuation.briefing({ id: a.run.id, limit: 20 }),
    e.manageWorkResources({ action: 'inspect', workId: a.work.id }),
  ]) {
    expect(JSON.stringify(data)).not.toContain('tokenHash');
    expect(JSON.stringify(data)).not.toContain(c.token!);
  }
  const bundle = JSON.stringify(exportWorkflows(e.store, a.w.id));
  expect(bundle).toContain('checkout:shared');
  expect(bundle).not.toContain(c.token!);
  expect(bundle).not.toContain('acquiredAt');
});
it('wakes bounded continuation readers when a conflicting reservation is released', async () => {
  const e = setup(),
    a = fixture(e),
    b = fixture(e),
    c = e.claim(a.work.id, worker);
  const brief = e.continuation.briefing({ id: b.run.id, limit: 20 });
  const pending = e.continuation.wait({
    id: b.run.id,
    cursor: brief.cursor,
    timeoutMs: 1000,
    limit: 20,
  });
  e.submit(a.work.id, c.token!, {});
  expect(await pending).toMatchObject({
    changed: true,
    available: { total: 1 },
  });
});
it('leaves a detached worker reservation active when its parent is cancelled', () => {
  const e = setup(),
    child = fixture(e, ['child']),
    p = e.create('Parent', '', workflowCall(child.w.id, 'detached', true));
  e.publish(p.id);
  const root = e.start(p.id, {}).run,
    work = e.available(root.id).find((w) => w.runId !== root.id)!;
  const c = e.claim(work.id, worker);
  e.cancel(root.id);
  expect(reservations(e, work.id)[0].state).toBe('claimed');
  e.submit(work.id, c.token!, {});
  expect(reservations(e, work.id)).toEqual([]);
});
it('retains reservations from ordinary children cancelled with their parent', () => {
  const e = setup(),
    child = fixture(e, ['child']),
    p = e.create('Parent', '', workflowCall(child.w.id));
  e.publish(p.id);
  const root = e.start(p.id, {}).run,
    work = e.available(root.id)[0];
  e.claim(work.id, worker);
  e.cancel(root.id);
  expect(reservations(e, work.id)[0].state).toBe('uncertain');
  expect(
    e.continuation.briefing({ id: root.id, limit: 20 }).resourceReservations
      ?.items[0].workId,
  ).toBe(work.id);
});

it('rejects known object-valued requirements at publication with the affected node name', () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    ...d.nodes[1],
    label: 'Integration',
    resources: [
      {
        source: 'object',
        fields: { key: { source: 'literal', value: 'checkout' } },
      },
    ],
  });
  const w = e.create('Incomplete', '', d);
  expect(() => e.publish(w.id)).toThrow(
    /Integration: resource bindings must resolve to names/,
  );
});
