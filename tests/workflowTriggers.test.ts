import { spawn } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  scheduleConfigSchema,
  scheduleTimingSchema,
  nextScheduleSlot,
  scheduleInput,
  type ScheduleConfig,
  type WorkflowDefinition,
  type WorkflowTrigger,
} from '@interlock/core';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { appRouter } from '../packages/server/src/router';
const engines: Engine[] = [];
const dirs: string[] = [];
const base = '2026-11-07T12:00:00.000Z';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(base);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.useRealTimers();
});
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
function workflow(e: Engine, changes: Partial<WorkflowDefinition> = {}) {
  const w = e.create('Heartbeat', '', { ...blankDefinition(), ...changes });
  e.publish(w.id);
  return w;
}
const config = (changes: Partial<ScheduleConfig> = {}) =>
  scheduleConfigSchema.parse({
    name: 'Heartbeat',
    timing: { type: 'interval', intervalMs: 30000 },
    ...changes,
  });
function create(e: Engine, w: string, changes: Partial<ScheduleConfig> = {}) {
  const t = e.triggers.mutate({
    action: 'create',
    workflowId: w,
    config: config(changes),
  }).trigger!;
  return e.triggers.mutate({
    action: 'enable',
    id: t.id,
    expectedRevision: t.revision,
  }).trigger!;
}
function at(e: Engine, ms: number) {
  vi.setSystemTime(Date.parse(base) + ms);
  e.pump();
}
function fires(e: Engine, t: WorkflowTrigger) {
  return e.triggers.inspect(t.id).fires.items;
}
function finish(e: Engine, id: string) {
  const a = e.available(id)[0];
  const claim = e.claim(a.id, {
    workerId: 'schedule-tests',
    tools: [],
    skills: [],
    freshContext: false,
  });
  e.submit(a.id, claim.token!, {});
  e.pump();
}
function protectedState(e: Engine) {
  return JSON.stringify(
    Object.fromEntries(
      [
        'workflowTriggers',
        'scheduleFires',
        'runStarts',
        'runs',
        'work',
        'events',
        'runChains',
        'usageAttempts',
      ].map((c) => [c, e.store.list(c)]),
    ),
  );
}

it('validates five-field cron, IANA zone, minimum interval, bindings and literal templates', () => {
  for (const timing of [
    { type: 'interval', intervalMs: 29999 },
    { type: 'cron', expression: '* * * * * *', timeZone: 'UTC' },
    { type: 'cron', expression: '61 * * * *', timeZone: 'UTC' },
    { type: 'cron', expression: '* * * * *', timeZone: 'Moon/Base' },
    { type: 'cron', expression: '@daily', timeZone: 'UTC' },
    { type: 'cron', expression: '1,H * * * *', timeZone: 'UTC' },
  ])
    expect(scheduleTimingSchema.safeParse(timing).success).toBe(false);
  expect(
    scheduleTimingSchema.parse({
      type: 'cron',
      expression: '0 9 * * 1-5',
      timeZone: 'America/Denver',
    }),
  ).toBeTruthy();
  for (const bindings of [
    { triggerId: '__proto__.value' },
    { triggerId: 'a', firedAt: 'a.b' },
    { triggerId: 'a', firedAt: 'a' },
    { triggerId: '' },
  ])
    expect(scheduleConfigSchema.safeParse(configOf(bindings)).success).toBe(
      false,
    );
  expect(
    scheduleConfigSchema.safeParse({
      ...config(),
      input: [],
      bindings: { triggerId: 'id' },
    }).success,
  ).toBe(false);
  const c = config({
    input: { meta: { id: 'replaced' }, literal: '${scheduledAt}' },
    bindings: { triggerId: 'meta.id', previousRunId: 'previous' },
  });
  expect(
    scheduleInput(c, {
      scheduledAt: base,
      firedAt: base,
      triggerId: 'trigger',
      previousRunId: null,
    }),
  ).toEqual({
    meta: { id: 'trigger' },
    literal: '${scheduledAt}',
    previous: null,
  });
});
function configOf(bindings: unknown) {
  return { ...config(), bindings };
}

it('uses the same cron calculation for preview and runtime, including DST transitions', () => {
  const timing = scheduleTimingSchema.parse({
    type: 'cron',
    expression: '0 9 * * *',
    timeZone: 'America/Denver',
  });
  expect(nextScheduleSlot(timing, '2026-03-07T17:00:00Z')).toBe(
    '2026-03-08T15:00:00.000Z',
  );
  expect(nextScheduleSlot(timing, '2026-10-31T16:00:00Z')).toBe(
    '2026-11-01T16:00:00.000Z',
  );
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id, { timing });
  expect(e.triggers.preview(timing).upcoming[0]).toBe(t.nextFireAt);
  vi.setSystemTime(t.nextFireAt);
  e.pump();
  expect(fires(e, t)[0].scheduledAt).toBe(t.nextFireAt);
});

it('defaults disabled, enforces published enable, independent revisions and bound starts', () => {
  const e = setup(),
    w = e.create('Draft', '');
  const t = e.triggers.mutate({
    action: 'create',
    workflowId: w.id,
    config: config(),
  }).trigger!;
  expect(t.enabled).toBe(false);
  expect(() =>
    e.triggers.mutate({ action: 'enable', id: t.id, expectedRevision: 1 }),
  ).toThrow(/Publish/);
  e.publish(w.id);
  e.triggers.mutate({
    action: 'update',
    id: t.id,
    expectedRevision: 1,
    config: config({
      bindings: {
        scheduledAt: 'meta.slot',
        firedAt: 'meta.at',
        triggerId: 'meta.id',
        previousRunId: 'previous',
      },
    }),
  });
  expect(() =>
    e.triggers.mutate({ action: 'disable', id: t.id, expectedRevision: 1 }),
  ).toThrow(/revision conflict/);
  e.triggers.mutate({ action: 'enable', id: t.id, expectedRevision: 2 });
  at(e, 30000);
  const run = e.store.runs()[0];
  expect(run.startRequestId).toBe(
    `schedule:${t.id}:${run.schedule!.scheduledAt}`,
  );
  expect(run.input).toEqual({
    meta: {
      slot: '2026-11-07T12:00:30.000Z',
      at: '2026-11-07T12:00:30.000Z',
      id: t.id,
    },
    previous: null,
  });
  expect(e.workflow(w.id).draftRevision).toBe(w.draftRevision);
});

it.each(['skip', 'run_once'] as const)(
  'collapses downtime without a burst under %s',
  (policy) => {
    const e = setup(),
      w = workflow(e),
      t = create(e, w.id, { missedFirePolicy: policy, overlapPolicy: 'allow' });
    at(e, 185000);
    expect(e.store.runs()).toHaveLength(policy === 'skip' ? 0 : 1);
    expect(fires(e, t)).toHaveLength(1);
    expect(fires(e, t)[0].scheduledAt).toBe('2026-11-07T12:03:00.000Z');
    e.pump();
    expect(fires(e, t)).toHaveLength(1);
    expect(e.triggers.inspect(t.id).trigger.nextFireAt).toBe(
      '2026-11-07T12:03:30.000Z',
    );
  },
);

it('honors multiple named holds and makes a single run_once recovery after release', () => {
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id, { missedFirePolicy: 'run_once' });
  const a = e.pauses.create({
      target: { scope: 'library' },
      actor: 'deploy',
      reason: 'Deploy',
    }),
    b = e.pauses.create({
      target: { scope: 'workflow', workflowId: w.id },
      actor: 'operator',
      reason: 'Inspect',
    });
  at(e, 30000);
  at(e, 185000);
  expect(e.store.runs()).toHaveLength(0);
  e.pauses.resume(a.id);
  e.pump();
  expect(e.store.runs()).toHaveLength(0);
  e.pauses.resume(b.id);
  e.pump();
  expect(e.store.runs()).toHaveLength(1);
  expect(fires(e, t)[0].scheduledAt).toBe('2026-11-07T12:03:00.000Z');
});

it.each(['skip', 'queue', 'allow'] as const)(
  'implements overlap %s against active and queued predecessors',
  (overlapPolicy) => {
    const e = setup(),
      w = workflow(e),
      t = create(e, w.id, { overlapPolicy });
    at(e, 30000);
    at(e, 60000);
    at(e, 90000);
    const runs = e.store.runs();
    expect(runs).toHaveLength(
      overlapPolicy === 'skip' ? 1 : overlapPolicy === 'queue' ? 2 : 3,
    );
    if (overlapPolicy === 'queue') {
      expect(runs[1].status).toBe('queued');
      expect(fires(e, t)[0].outcome).toBe('skipped_overlap');
      const first = e.run(runs[0].id);
      first.status = 'failed';
      first.error = 'fixture failure';
      e.store.put('runs', first);
      e.pump();
      expect(e.run(runs[1].id).status).toBe('waiting');
    }
  },
);

it('treats capacity queues as overlap and allows only one schedule pending run', () => {
  const e = setup(),
    w = workflow(e, { maxActiveRuns: 1 }),
    t = create(e, w.id, { overlapPolicy: 'queue' });
  const manual = e.start(w.id, {}).run;
  at(e, 30000);
  at(e, 60000);
  expect(e.store.runs()).toHaveLength(2);
  expect(e.store.runs()[1].status).toBe('queued');
  expect(fires(e, t)[0].outcome).toBe('skipped_overlap');
  finish(e, manual.id);
  expect(e.store.runs()[1].status).toBe('waiting');
});

it('atomically persists input, receipt, run, fire and next slot or rolls all protected state back', () => {
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id);
  const before = protectedState(e),
    original = e.store.put.bind(e.store);
  const spy = vi
    .spyOn(e.store, 'put')
    .mockImplementation((collection, value) => {
      if (collection === 'workflowTriggers')
        throw new Error('injected trigger write failure');
      return original(collection, value);
    });
  vi.setSystemTime(Date.parse(base) + 30000);
  expect(() => e.pump()).toThrow(/injected/);
  expect(protectedState(e)).toBe(before);
  spy.mockRestore();
  e.pump();
  expect(e.store.runs()).toHaveLength(1);
  expect(e.store.list('runStarts')).toHaveLength(1);
  expect(fires(e, t)).toHaveLength(1);
});

it('deduplicates across competing stores and restart, preserving deterministic slot receipts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-schedules-'));
  dirs.push(dir);
  const path = join(dir, 'state.db'),
    e = setup(path),
    w = workflow(e),
    t = create(e, w.id),
    other = setup(path);
  vi.setSystemTime(Date.parse(base) + 30000);
  e.pump();
  other.pump();
  const run = e.store.runs()[0];
  expect(e.store.runs()).toHaveLength(1);
  const reopened = setup(path);
  reopened.pump();
  expect(reopened.store.runs()).toHaveLength(1);
  expect(reopened.store.list('runStarts')).toHaveLength(1);
  expect(fires(reopened, t)[0].runId).toBe(run.id);
  at(reopened, 60000);
  expect(reopened.store.runs()).toHaveLength(1);
  expect(fires(reopened, t)[0].outcome).toBe('skipped_overlap');
});

it('counts terminal failures once, auto-pauses visibly and re-enables without releasing holds', () => {
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id, { pauseAfterConsecutiveFailures: 1 });
  at(e, 30000);
  const run = e.store.runs()[0];
  run.status = 'failed';
  run.error = 'unit failed';
  e.store.put('runs', run);
  e.pump();
  e.pump();
  expect(e.triggers.inspect(t.id).trigger).toMatchObject({
    enabled: true,
    consecutiveFailures: 1,
    autoPaused: { reason: expect.stringContaining('unit failed') },
  });
  expect(e.triggers.attention().total).toBe(1);
  const h = e.pauses.create({
    target: { scope: 'library' },
    actor: 'deploy',
    reason: 'Deploy',
  });
  e.triggers.mutate({
    action: 'enable',
    id: t.id,
    expectedRevision: t.revision,
  });
  expect(e.triggers.inspect(t.id).trigger.autoPaused).toBeUndefined();
  expect(e.store.pauseHolds()).toHaveLength(1);
  expect(e.store.pauseHolds()[0].id).toBe(h.id);
});

it('does not pause by default, resets on completed runs and treats cancellation as neutral', () => {
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id);
  at(e, 30000);
  let run = e.store.runs()[0];
  run.status = 'failed';
  e.store.put('runs', run);
  e.pump();
  expect(e.triggers.inspect(t.id).trigger.autoPaused).toBeUndefined();
  at(e, 60000);
  run = e.store.runs()[1];
  e.cancel(run.id);
  e.pump();
  expect(e.triggers.inspect(t.id).trigger.consecutiveFailures).toBe(1);
  at(e, 90000);
  finish(e, e.store.runs()[2].id);
  expect(e.triggers.inspect(t.id).trigger.consecutiveFailures).toBe(0);
});

it('shows admission failures without run rows and late admission lag without disabling', () => {
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id, {
      input: { bad: true },
      pauseAfterConsecutiveFailures: 1,
    });
  const version = e.store.getVersion(w.id, 1)!;
  version.definition.inputSchema = { type: 'object', required: ['missing'] };
  e.store.version(version);
  at(e, 30000);
  expect(e.store.runs()).toHaveLength(0);
  expect(fires(e, t)[0].outcome).toBe('failed');
  expect(e.triggers.attention().total).toBe(1);
  const other = workflow(e, { maxActiveRuns: 1 }),
    late = create(e, other.id, { overlapPolicy: 'queue' });
  e.start(other.id, {});
  at(e, 60000);
  at(e, 180000);
  expect(
    e.triggers.attention().items.some((i) => i.triggerId === late.id),
  ).toBe(true);
  expect(e.triggers.inspect(late.id).trigger.enabled).toBe(true);
});

it('preserves disabled schedules on portable transfer, guards identity and keeps old bundles valid', () => {
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id),
    bundle = exportWorkflows(e.store, w.id);
  expect(bundle.formatVersion).toBe(5);
  expect(bundle.workflows[0].schedules![0].enabled).toBe(false);
  const other = setup();
  bundle.workflows[0].schedules![0].enabled = true;
  importWorkflows(other.store, bundle);
  expect(other.triggers.inspect(t.id).trigger.enabled).toBe(false);
  expect(other.store.runs()).toHaveLength(0);
  expect(other.triggers.inspect(t.id).fires.total).toBe(0);
  const plain = exportWorkflows(e.store, workflow(e).id);
  expect(plain.formatVersion).toBe(1);
  importWorkflows(other.store, plain);
  const conflict = structuredClone(bundle);
  conflict.workflows[0].schedules![0].id = t.id;
  conflict.workflows[0].id = plain.rootId;
  conflict.rootId = plain.rootId;
  expect(() => importWorkflows(other.store, conflict, { force: true })).toThrow(
    /another workflow/,
  );
});

it('deletes only schedule/fire data and retains existing run and receipts', () => {
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id);
  at(e, 30000);
  e.triggers.mutate({
    action: 'delete',
    id: t.id,
    expectedRevision: t.revision,
  });
  expect(e.store.runs()).toHaveLength(1);
  expect(e.store.list('runStarts')).toHaveLength(1);
  expect(e.store.list('scheduleFires')).toHaveLength(0);
  expect(() => e.triggers.inspect(t.id)).toThrow(/not found/);
});

it('serves shared CRUD/read/preview/attention with bounded schemas', async () => {
  const e = setup(),
    w = workflow(e),
    caller = appRouter.createCaller({ engine: e });
  const t = (
    await caller.triggers.manage({
      action: 'create',
      workflowId: w.id,
      config: config(),
    })
  ).trigger!;
  expect((await caller.triggers.list({ workflowId: w.id })).total).toBe(1);
  expect((await caller.triggers.inspect({ id: t.id })).trigger.enabled).toBe(
    false,
  );
  expect(
    (await caller.triggers.preview({ timing: t.timing })).upcoming,
  ).toHaveLength(3);
  await expect(
    caller.triggers.inspect({ id: t.id, limit: 101 }),
  ).rejects.toThrow();
});

it('tracks continue-as-new schedule chains until their final terminal outcome', () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes[d.nodes.length - 1] = {
    ...d.nodes.at(-1)!,
    kind: 'exit',
    continueAsNew: { maxRuns: 3 },
  } as (typeof d.nodes)[number];
  const w = workflow(e, d),
    t = create(e, w.id, { pauseAfterConsecutiveFailures: 1 });
  at(e, 30000);
  const first = e.store.runs()[0];
  finish(e, first.id);
  const second = e.run(e.run(first.id).chain!.nextRunId!);
  expect(second.schedule?.triggerId).toBe(t.id);
  at(e, 60000);
  expect(e.store.runs()).toHaveLength(2);
  expect(fires(e, t)[0].outcome).toBe('skipped_overlap');
  const failed = e.run(second.id);
  failed.status = 'failed';
  failed.error = 'chain failed';
  e.store.put('runs', failed);
  e.pump();
  expect(e.triggers.inspect(t.id).trigger.autoPaused?.reason).toContain(
    'chain failed',
  );
});

it('pages and trims settled fires, keeps unresolved rows and handles missing run history', () => {
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id);
  for (let i = 0; i < 205; i++)
    e.store.put('scheduleFires', {
      id: `old-${i}`,
      triggerId: t.id,
      workflowId: w.id,
      scheduledAt: new Date(Date.parse(base) - i * 30000).toISOString(),
      firedAt: base,
      outcome: 'skipped_overlap',
      settled: true,
    });
  e.store.trimScheduleFires(t.id);
  expect(e.triggers.inspect(t.id).fires.total).toBe(200);
  expect(e.triggers.inspect(t.id, 100, 100).fires.items).toHaveLength(100);
  at(e, 30000);
  const run = e.store.runs()[0];
  e.store.remove('runs', run.id);
  e.pump();
  expect(fires(e, t)[0]).toMatchObject({
    runId: run.id,
    runAvailable: false,
    settled: true,
  });
  expect(e.triggers.list().items[0]).not.toHaveProperty('input');
});

it('reenables with explicit missed policy and reanchors timing edits', () => {
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id, { missedFirePolicy: 'run_once' });
  const disabled = e.triggers.mutate({
    action: 'disable',
    id: t.id,
    expectedRevision: t.revision,
  }).trigger!;
  at(e, 180000);
  expect(e.store.runs()).toHaveLength(0);
  const enabled = e.triggers.mutate({
    action: 'enable',
    id: t.id,
    expectedRevision: disabled.revision,
  }).trigger!;
  e.pump();
  expect(e.store.runs()).toHaveLength(1);
  const updated = e.triggers.mutate({
    action: 'update',
    id: t.id,
    expectedRevision: enabled.revision,
    config: config({ timing: { type: 'interval', intervalMs: 60000 } }),
  }).trigger!;
  expect(updated.anchorAt).toBe(
    new Date(Date.parse(base) + 180000).toISOString(),
  );
  expect(updated.nextFireAt).toBe(
    new Date(Date.parse(base) + 240000).toISOString(),
  );
});

it('serializes genuinely concurrent scheduler processes on the same SQLite slot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-schedule-race-'));
  dirs.push(dir);
  const path = join(dir, 'state.db'),
    e = setup(path),
    w = workflow(e),
    t = create(e, w.id);
  vi.useRealTimers();
  const script = `import {Engine} from '@interlock/runtime';import {Store} from '@interlock/storage';
    const OriginalDate=Date;const at=${JSON.stringify(Date.parse(base) + 30000)};
    globalThis.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};
    const store=new Store(${JSON.stringify(path)}),engine=new Engine(store,process.cwd());
    process.on('message',()=>{try{engine.pump();}catch(error){console.error(error);process.exitCode=1;}finally{engine.stop();store.close();process.disconnect();}});
    process.send({ready:true});`;
  const workers = [0, 1].map(() =>
    spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    ),
  );
  try {
    await Promise.all(
      workers.map(
        (child) =>
          new Promise<void>((resolve, reject) => {
            child.once('message', () => resolve());
            child.once('error', reject);
            child.once('exit', (code) => {
              if (code)
                reject(new Error(`Scheduler exited before ready: ${code}`));
            });
          }),
      ),
    );
    const exits = workers.map(
      (child) =>
        new Promise<void>((resolve, reject) => {
          let stderr = '';
          child.stderr?.on('data', (data) => {
            stderr += data;
          });
          child.once('exit', (code) =>
            code === 0
              ? resolve()
              : reject(new Error(stderr || `Scheduler exit ${code}`)),
          );
        }),
    );
    workers.forEach((child) => child.send({ tick: true }));
    await Promise.all(exits);
    expect(e.store.runs()).toHaveLength(1);
    expect(e.store.list('runStarts')).toHaveLength(1);
    expect(fires(e, t)).toHaveLength(1);
  } finally {
    workers.forEach((child) => {
      if (child.exitCode === null) child.kill('SIGTERM');
    });
  }
});

it.each(['skip', 'run_once'] as const)(
  'applies %s to a hold covering the slot between scheduler ticks',
  (policy) => {
    const e = setup(),
      w = workflow(e),
      t = create(e, w.id, { missedFirePolicy: policy });
    vi.setSystemTime(Date.parse(base) + 29500);
    const h = e.pauses.create({
      target: { scope: 'workflow', workflowId: w.id },
      actor: 'short',
      reason: 'Short hold',
    });
    vi.setSystemTime(Date.parse(base) + 31500);
    e.pauses.resume(h.id);
    at(e, 32000);
    expect(e.store.runs()).toHaveLength(policy === 'skip' ? 0 : 1);
    expect(fires(e, t)[0].outcome).toBe(
      policy === 'skip' ? 'skipped_missed' : 'started',
    );
  },
);
it('does not miss a slot merely because a hold ended before that slot', () => {
  const e = setup(),
    w = workflow(e),
    t = create(e, w.id);
  vi.setSystemTime(Date.parse(base) + 10000);
  const h = e.pauses.create({
    target: { scope: 'library' },
    actor: 'early',
    reason: 'Earlier hold',
  });
  e.pump();
  vi.setSystemTime(Date.parse(base) + 20000);
  e.pauses.resume(h.id);
  at(e, 30000);
  expect(e.store.runs()).toHaveLength(1);
  expect(fires(e, t)[0].outcome).toBe('started');
});
