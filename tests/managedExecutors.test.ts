import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Engine,
  type HarnessAdapter,
  type HarnessRun,
} from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  executorProfileSchema,
  withNextCall,
  type Json,
  type WorkRequest,
} from '@interlock/core';
import { usageDelta } from '../packages/runtime/src/executors/manager';
import { exportWorkflows } from '../packages/runtime/src/transfer';

const engines: Engine[] = [],
  dirs: string[] = [];
const start = (e: Engine, id: string, input: Json) => e.start(id, input).run;
const save = (e: Engine, input: any) => {
  const { revision: _revision, ...rest } = input;
  return e.executors.saveProfile(rest);
};
const create = (path = ':memory:') => {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
};
afterEach(async () => {
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const profile = (
  e: Engine,
  harness: 'codex' | 'claude-code' = 'codex',
  extra = {},
) =>
  save(e, {
    id: harness,
    harness,
    name: harness,
    enabled: true,
    expectedRevision: 0,
    ...extra,
  });
function workflow(
  e: Engine,
  executor?: string,
  extra: Record<string, unknown> = {},
) {
  const d = blankDefinition();
  d.executor = executor;
  const node = d.nodes.find((n) => n.kind === 'agent')!;
  Object.assign(node, extra);
  const w = e.create('Managed example', '', definitionSchema.parse(d));
  e.publish(w.id);
  return w;
}
function adapter(
  id: 'codex' | 'claude-code' = 'codex',
  run?: HarnessAdapter['run'],
): HarnessAdapter {
  return {
    id,
    detect: async () => ({
      command: '/fake/' + id,
      status: 'detected',
      version: 'test',
    }),
    run:
      run ??
      (async (i) => {
        i.onSession('session-' + i.work.id);
        return { output: i.work.input };
      }),
  };
}
async function settled(e: Engine, id: string) {
  await vi.waitFor(() => expect(e.run(id).status).toBe('completed'));
}
it.each(['claude-code', 'codex'] as const)(
  'automatically executes through %s without another worker process',
  async (harness) => {
    const e = create();
    profile(e, harness);
    const run = vi.fn(adapter(harness).run);
    e.executors.start([adapter(harness, run)]);
    const w = workflow(e, harness),
      r = start(e, w.id, { value: 3 });
    await settled(e, r.id);
    expect(e.run(r.id).output).toEqual({ value: 3 });
    expect(run).toHaveBeenCalledTimes(1);
    const work = e.store.work()[0];
    expect(e.executors.inspect(work.id).items[0]).toMatchObject({
      state: 'completed',
      attempt: 1,
      profile: { harness },
      sessionId: 'session-' + work.id,
    });
    expect(e.store.list<any>('usageAttempts')[0].snapshot).toBeUndefined();
  },
);
it('leaves legacy definitions and explicit connected-agent overrides available to external workers', async () => {
  const e = create();
  profile(e);
  const run = vi.fn(adapter().run);
  e.executors.start([adapter('codex', run)]);
  const old = start(e, workflow(e).id, 1),
    optedOut = start(e, workflow(e, 'codex', { executor: null }).id, 2);
  await new Promise((r) => setTimeout(r, 25));
  expect(run).not.toHaveBeenCalled();
  for (const r of [old, optedOut]) {
    const [w] = e.available(r.id);
    const claim = e.claim(w.id, {
      workerId: 'external',
      freshContext: false,
      tools: [],
      skills: [],
    });
    e.submit(w.id, claim.token!, 3);
    expect(e.run(r.id).output).toBe(3);
  }
});
it('allows a node override, discovers separately started roots, and preserves exclusive claims', async () => {
  const e = create();
  profile(e);
  profile(e, 'claude-code');
  const codex = vi.fn(adapter().run),
    claude = vi.fn(adapter('claude-code').run);
  e.executors.start([adapter('codex', codex), adapter('claude-code', claude)]);
  const r1 = start(e, workflow(e, 'codex', { executor: 'claude-code' }).id, 1);
  const r2 = start(e, workflow(e, 'codex').id, 2);
  await Promise.all([settled(e, r1.id), settled(e, r2.id)]);
  expect(claude).toHaveBeenCalledTimes(1);
  expect(codex).toHaveBeenCalledTimes(1);
  expect(() =>
    e.claim(e.store.work()[0].id, {
      workerId: 'other',
      freshContext: true,
      tools: [],
      skills: [],
    }),
  ).toThrow(/not available/);
});
it('checks capabilities and disabled or missing local profiles before claiming', async () => {
  const e = create();
  const run = vi.fn(adapter().run);
  e.executors.start([adapter('codex', run)]);
  profile(e, 'codex', { enabled: false });
  const r = start(
    e,
    workflow(e, 'codex', {
      context: { tools: ['browser'], skills: ['review'] },
    }).id,
    1,
  );
  await new Promise((r) => setTimeout(r, 20));
  let [work] = e.available(r.id);
  expect(work.attempt).toBe(0);
  expect(work.managedExecution?.state).toBe('blocked');
  save(e, {
    ...executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      enabled: true,
    }),
    expectedRevision: 1,
  });
  await new Promise((r) => setTimeout(r, 20));
  expect(run).not.toHaveBeenCalled();
  save(e, {
    ...executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      enabled: true,
      tools: ['browser'],
      skills: ['review'],
    }),
    expectedRevision: 2,
  });
  await settled(e, r.id);
  expect(run).toHaveBeenCalledTimes(1);
  const missing = start(e, workflow(e, 'not-installed').id, 2);
  expect(e.available(missing.id)[0].managedExecution?.reason).toMatch(
    /Configure/,
  );
});
it('retains an explicit permission request and requires its exact active identity', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      const a = await i.request({
        kind: 'permission',
        title: 'Write a file',
        detail: 'touch example.txt',
      });
      return { output: a.allow ?? false };
    }),
  ]);
  const r = start(e, workflow(e, 'codex').id, 0);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  const work = e.store.work()[0],
    record = e.executors.inspect(work.id).items[0],
    request = record.requests[0];
  const briefing = e.continuation.briefing({ id: r.id, limit: 20 });
  expect(briefing.next).toBe('inspect_executor');
  expect(withNextCall(e.continuation.summary(r.id, 20)).nextCall).toEqual({
    tool: 'manage_executors',
    arguments: { request: { action: 'inspect', workId: work.id } },
  });
  expect(() =>
    e.executors.respond({
      executionId: record.id,
      requestId: 'old',
      answer: { allow: true },
    }),
  ).toThrow(/not found/);
  const q = {
    executionId: record.id,
    requestId: request.id,
    answer: { allow: false },
  };
  expect(e.executors.respond(q)).toEqual({ applied: true });
  expect(e.executors.respond(q)).toEqual({ applied: false });
  await settled(e, r.id);
  expect(e.run(r.id).output).toBe(false);
});
it('surfaces questions and accepts a full explicit answer without granting tool permissions', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      const a = await i.request({
        kind: 'question',
        title: 'Choose',
        detail: '',
        questions: [
          {
            id: 'database',
            text: 'Which database?',
            options: ['SQLite', 'Postgres'],
          },
        ],
      });
      return { output: a.answers!.database[0] };
    }),
  ]);
  const r = start(e, workflow(e, 'codex').id, 0);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  const record = e.executors.inspect(e.store.work()[0].id).items[0],
    requestId = record.requests[0].id;
  expect(() =>
    e.executors.respond({
      executionId: record.id,
      requestId,
      answer: { allow: true },
    }),
  ).toThrow(/every question/);
  await e.executors.manage({
    action: 'respond',
    executionId: record.id,
    requestId,
    answer: { answers: { database: ['SQLite'] } },
  });
  await settled(e, r.id);
  expect(e.run(r.id).output).toBe('SQLite');
});
it('keeps the captured profile stable through retries and applies bounded invalid-result failure', async () => {
  const e = create();
  profile(e, 'codex', { model: 'old' });
  const calls: HarnessRun[] = [];
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  e.executors.start([
    adapter('codex', async (i) => {
      calls.push(i);
      if (calls.length === 1)
        await Promise.race([
          wait,
          new Promise<void>((r) =>
            i.signal.addEventListener('abort', () => r(), { once: true }),
          ),
        ]);
      return { output: 'invalid' };
    }),
  ]);
  const r = start(
    e,
    workflow(e, 'codex', { outputSchema: { type: 'number' }, maxAttempts: 2 })
      .id,
    1,
  );
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  save(e, {
    ...e.executors.profiles().find((p) => p.id === 'codex')!,
    model: 'new',
    expectedRevision: 1,
  });
  release();
  await vi.waitFor(() => expect(e.run(r.id).status).toBe('failed'));
  expect(calls).toHaveLength(2);
  expect(calls.map((c) => c.profile.model)).toEqual(['old', 'old']);
});
it('reuses a managed continuity session while fresh reviewers start independently', async () => {
  const e = create();
  profile(e);
  const received: (string | undefined)[] = [];
  e.executors.start([
    adapter('codex', async (i) => {
      received.push(i.sessionId);
      i.onSession(i.sessionId ?? 'native-session');
      return { output: i.work.input };
    }),
  ]);
  const d = blankDefinition();
  d.executor = 'codex';
  const a = d.nodes.find((n) => n.kind === 'agent')!;
  if (a.kind !== 'agent') throw Error();
  a.context.continuityGroup = 'author';
  const second = { ...structuredClone(a), id: 'second' },
    reviewer = {
      ...structuredClone(a),
      id: 'reviewer',
      context: {
        ...a.context,
        mode: 'fresh' as const,
        continuityGroup: undefined,
      },
    };
  d.nodes.push(second, reviewer);
  const outgoing = d.edges.find((edge) => edge.source === a.id)!;
  const exit = outgoing.target;
  outgoing.target = second.id;
  d.edges.push(
    { id: 'b', source: second.id, target: reviewer.id, port: 'default' },
    { id: 'c', source: reviewer.id, target: exit, port: 'default' },
  );
  const w = e.create('Continuity', '', d);
  e.publish(w.id);
  const r = start(e, w.id, 1);
  await settled(e, r.id);
  expect(received).toEqual([undefined, 'native-session', undefined]);
});
it('limits concurrency and observes cancellation without accepting a late result', async () => {
  const e = create();
  profile(e);
  const inputs: HarnessRun[] = [];
  e.executors.start([
    adapter('codex', async (i) => {
      inputs.push(i);
      return new Promise((resolve) =>
        i.signal.addEventListener('abort', () => resolve({ output: 'late' }), {
          once: true,
        }),
      );
    }),
  ]);
  const w = workflow(e, 'codex');
  const first = start(e, w.id, 1),
    second = start(e, w.id, 2);
  await vi.waitFor(() => expect(inputs).toHaveLength(1));
  e.cancel(first.id);
  await vi.waitFor(() => expect(inputs[0].signal.aborted).toBe(true));
  await vi.waitFor(() => expect(inputs).toHaveLength(2));
  expect(e.run(first.id).status).toBe('cancelled');
  expect(e.run(first.id).output).toBeUndefined();
  e.cancel(second.id);
});
it('recovers interrupted attempts conservatively and requires stop confirmation before another claim', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-managed-'));
  dirs.push(dir);
  const path = join(dir, 'state.db');
  const e = create(path);
  profile(e);
  let entered = false;
  e.executors.start([
    adapter('codex', async (i) => {
      entered = true;
      await new Promise<void>((r) =>
        i.signal.addEventListener('abort', () => r(), { once: true }),
      );
      throw Error('stopped');
    }),
  ]);
  const w = workflow(e, 'codex'),
    r = start(e, w.id, 1);
  await vi.waitFor(() => expect(entered).toBe(true));
  const work = e.store.work()[0];
  await e.executors.stop();
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  const next = create(path),
    execute = vi.fn(adapter().run);
  next.executors.start([adapter('codex', execute)]);
  const record = next.executors.inspect(work.id).items[0];
  expect(record.state).toBe('interrupted');
  expect(next.store.get<WorkRequest>('work', work.id)?.status).toBe('held');
  expect(() => next.executors.confirmStopped(record.id, false as true)).toThrow(
    /confirmation/,
  );
  await new Promise((r) => setTimeout(r, 20));
  expect(execute).not.toHaveBeenCalled();
  next.executors.confirmStopped(record.id, true);
  await settled(next, r.id);
  expect(execute).toHaveBeenCalledTimes(1);
});
it('retains configuration locally and keeps provenance out of portable definitions', async () => {
  const e = create();
  profile(e);
  e.executors.start([adapter()]);
  const w = workflow(e, 'codex'),
    r = start(e, w.id, null);
  await settled(e, r.id);
  const exported = exportWorkflows(e.store, w.id);
  expect(JSON.stringify(exported)).toContain('"executor":"codex"');
  expect(JSON.stringify(exported)).not.toContain('/fake/codex');
  expect(JSON.stringify(exported)).not.toContain('managedExecutions');
  expect(() =>
    save(e, {
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      expectedRevision: 0,
    }),
  ).toThrow(/changed/);
});
it('differences reported cumulative usage and keeps unknown resumed history unknown', () => {
  const values = [
    {
      provider: 'openai',
      model: 'test',
      inputTokens: 150,
      outputTokens: 30,
      cachedInputTokens: 20,
    },
  ];
  expect(
    usageDelta(values, [
      {
        provider: 'openai',
        model: 'test',
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: 10,
      },
    ]),
  ).toEqual([
    {
      provider: 'openai',
      model: 'test',
      inputTokens: 50,
      outputTokens: 20,
      cachedInputTokens: 10,
    },
  ]);
  expect(usageDelta(values, null)).toBeUndefined();
});

it('keeps the event loop responsive while an ordinary script runs beside managed dispatch', () => {
  expect(() =>
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./fixtures/managed-pump.mjs', import.meta.url)),
      ],
      { timeout: 2500, stdio: 'pipe' },
    ),
  ).not.toThrow();
});

it('blocks external reclaim of expired managed work before the old harness is reconciled', async () => {
  const e = create();
  profile(e);
  let entered = false;
  e.executors.start([
    adapter('codex', async (i) => {
      entered = true;
      await new Promise<void>((r) =>
        i.signal.addEventListener('abort', () => r(), { once: true }),
      );
      throw Error('stopped');
    }),
  ]);
  const r = start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() => expect(entered).toBe(true));
  const work = e.store.work()[0];
  e.store.put('work', {
    ...work,
    leaseUntil: new Date(Date.now() - 1).toISOString(),
  });
  e.pump();
  expect(() =>
    e.claim(work.id, {
      workerId: 'external',
      freshContext: true,
      tools: [],
      skills: [],
    }),
  ).toThrow(/managed|uncertain|reconcil/i);
});
it('holds unexpected harness failures instead of repeating unknown external effects', async () => {
  const e = create();
  profile(e);
  const run = vi.fn(async () => {
    throw Error('Harness process ended (signal)');
  });
  e.executors.start([adapter('codex', run)]);
  const r = start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.executors.inspect(e.store.work()[0].id).items[0].state).toBe(
      'interrupted',
    ),
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(e.store.work()[0].status).toBe('held');
  expect(e.run(r.id).status).toBe('waiting');
});
function groupedWorkflow(e: Engine) {
  const d = blankDefinition();
  d.executor = 'codex';
  const a = d.nodes.find((n) => n.kind === 'agent')!;
  if (a.kind !== 'agent') throw Error();
  a.context = { ...a.context, continuityGroup: 'author', tools: ['git'] };
  const second = { ...structuredClone(a), id: 'second' };
  d.nodes.push(second);
  const edge = d.edges.find((edge) => edge.source === a.id)!;
  const exit = edge.target;
  edge.target = second.id;
  d.edges.push({
    id: 'second-exit',
    source: second.id,
    target: exit,
    port: 'default',
  });
  const w = e.create('Pinned continuity', '', d);
  e.publish(w.id);
  return w;
}
it('uses the captured continuity capabilities after local profile edits', async () => {
  const e = create();
  profile(e, 'codex', { tools: ['git'] });
  let calls = 0;
  e.executors.start([
    adapter('codex', async (i) => {
      calls++;
      i.onSession('native');
      if (calls === 1)
        save(e, {
          ...e.executors.profiles().find((p) => p.id === 'codex')!,
          tools: [],
          expectedRevision: 1,
        });
      return { output: i.work.input };
    }),
  ]);
  const r = start(e, groupedWorkflow(e).id, 1);
  await settled(e, r.id);
  expect(calls).toBe(2);
});
it('invalidates a resumed usage baseline after an ungraceful restart', async () => {
  const e = create();
  profile(e, 'codex', { tools: ['git'] });
  let calls = 0;
  e.executors.start([
    adapter('codex', async (i) => {
      calls++;
      i.onSession('native');
      if (calls === 2) {
        await new Promise<void>((r) =>
          i.signal.addEventListener('abort', () => r(), { once: true }),
        );
        throw Error('stopped');
      }
      return {
        output: i.work.input,
        usage: [
          {
            provider: 'openai',
            model: 'test',
            inputTokens: 100,
            outputTokens: 10,
          },
        ],
      };
    }),
  ]);
  const r = start(e, groupedWorkflow(e).id, 1);
  await vi.waitFor(() => expect(calls).toBe(2));
  const work = e.store.work().find((w) => w.nodeId === 'second')!,
    activeRecord = e.executors.inspect(work.id).items[0];
  const session = e.store.list<any>('executorSessions')[0];
  await e.executors.stop();
  // Preserve the exact running records that an abrupt process loss would leave.
  e.store.put('managedExecutions', activeRecord);
  e.store.put('executorSessions', session);
  const next = new Engine(e.store, process.cwd());
  engines.push(next);
  engines.splice(engines.indexOf(e), 1);
  e.stop();
  next.executors.start([
    adapter('codex', async (i) => ({
      output: i.work.input,
      usage: [
        {
          provider: 'openai',
          model: 'test',
          inputTokens: 150,
          outputTokens: 20,
        },
      ],
    })),
  ]);
  next.executors.confirmStopped(activeRecord.id, true);
  await settled(next, r.id);
  expect(
    next.store
      .list<any>('usageAttempts')
      .filter((u) => u.workId === work.id && u.snapshot),
  ).toHaveLength(0);
});

it('rejects a permission answer after the claim expires even before the observer ticks', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      await i.request({
        kind: 'permission',
        title: 'Expired approval',
        detail: 'test command',
      });
      return { output: true };
    }),
  ]);
  start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  const work = e.store.work()[0],
    record = e.executors.inspect(work.id).items[0];
  e.store.put('work', {
    ...work,
    leaseUntil: new Date(Date.now() - 1).toISOString(),
  });
  expect(() =>
    e.executors.respond({
      executionId: record.id,
      requestId: record.requests[0].id,
      answer: { allow: true },
    }),
  ).toThrow(/no longer active|claim changed/);
});
it('pins the resolved executable and default directory across restart and retry', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    {
      ...adapter(),
      detect: async (override) => ({
        status: 'detected',
        command: override ?? '/fake/original',
      }),
      run: async (i) => {
        i.onSession('native');
        await new Promise<void>((resolve) =>
          i.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        throw Error('stopped');
      },
    },
  ]);
  const r = start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('running'),
  );
  const work = e.store.work()[0];
  await e.executors.stop();
  e.stop();
  const next = new Engine(e.store, '/different/server-directory');
  engines.splice(engines.indexOf(e), 1);
  engines.push(next);
  const run = vi.fn(async (i: HarnessRun) => ({ output: i.work.input }));
  next.executors.start([
    {
      ...adapter(),
      detect: async (override) => ({
        status: 'detected',
        command: override ?? '/fake/replacement',
      }),
      run,
    },
  ]);
  next.executors.confirmStopped(
    next.executors.inspect(work.id).items[0].id,
    true,
  );
  await settled(next, r.id);
  expect(run.mock.calls[0][0]).toMatchObject({
    command: '/fake/original',
    cwd: process.cwd(),
  });
});
it('renews a managed claim while a native question is pending', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      await i.request({
        kind: 'permission',
        title: 'Waiting',
        detail: 'test command',
      });
      return { output: true };
    }),
  ]);
  start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  const work = e.store.work()[0];
  e.store.put('work', {
    ...work,
    leaseUntil: new Date(Date.now() + 30000).toISOString(),
  });
  await vi.waitFor(
    () =>
      expect(
        Date.parse(e.store.work()[0].leaseUntil!) - Date.now(),
      ).toBeGreaterThan(240000),
    { timeout: 2000 },
  );
  expect(e.executors.inspect(work.id).items[0].state).toBe('needs_human');
});
it('stops active work when its local profile is disabled', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      await i.request({
        kind: 'permission',
        title: 'Waiting',
        detail: 'test command',
      });
      return { output: true };
    }),
  ]);
  start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  save(e, {
    ...e.executors.profiles().find((p) => p.id === 'codex')!,
    enabled: false,
    expectedRevision: 1,
  });
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('interrupted'),
  );
});

it('enforces the global four-session limit even for a more permissive local profile', async () => {
  const e = create();
  profile(e, 'codex', { concurrency: 8 });
  const inputs: HarnessRun[] = [];
  e.executors.start([
    adapter('codex', async (i) => {
      inputs.push(i);
      await new Promise<void>((resolve) =>
        i.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return { output: i.work.input };
    }),
  ]);
  const w = workflow(e, 'codex'),
    runs = Array.from({ length: 6 }, (_, i) => start(e, w.id, i));
  await vi.waitFor(() => expect(inputs).toHaveLength(4));
  expect(e.store.work().filter((w) => w.status === 'available')).toHaveLength(
    2,
  );
  for (const run of runs) e.cancel(run.id);
});
it('rejects unsupported or empty native question answers without consuming the pending request', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      await i.request({
        kind: 'question',
        title: 'Choose',
        detail: '',
        questions: [{ id: 'choice', text: 'Which?', options: ['A', 'B'] }],
      });
      return { output: true };
    }),
  ]);
  start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  const record = e.executors.inspect(e.store.work()[0].id).items[0];
  for (const answer of ['C', ' '])
    expect(() =>
      e.executors.respond({
        executionId: record.id,
        requestId: record.requests[0].id,
        answer: { answers: { choice: [answer] } },
      }),
    ).toThrow(/supplied choices/);
  expect(e.executors.inspect(record.workId).items[0].requests[0].state).toBe(
    'pending',
  );
});

it.each([
  ['read-only', 'full-access', 'full-access', 'workflow'],
  ['full-access', 'standard', 'standard', 'workflow'],
  ['full-access', undefined, 'full-access', 'harness'],
] as const)(
  'resolves harness default %s and workflow override %s',
  async (defaultMode, override, effective, source) => {
    const e = create();
    profile(e, 'codex', { permissions: defaultMode });
    const calls: HarnessRun[] = [];
    e.executors.start([
      adapter('codex', async (input) => {
        calls.push(input);
        return { output: input.work.input };
      }),
    ]);
    const d = blankDefinition();
    d.executor = 'codex';
    d.agentPermissions = override;
    const w = e.create('Permissions', '', d);
    e.publish(w.id);
    const r = start(e, w.id, 1);
    await settled(e, r.id);
    expect(calls[0].profile.permissions).toBe(effective);
    expect(e.store.work()[0].executorPermissions).toBe(override);
    expect(e.executors.inspect(e.store.work()[0].id).items[0]).toMatchObject({
      profile: { permissions: effective },
      permissionSource: source,
    });
  },
);
it('normalizes existing ask defaults without changing their saved revision', () => {
  const e = create();
  e.store.put('executorProfiles', {
    ...executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
    }),
    permissions: 'ask',
    revision: 3,
  });
  expect(e.executors.profiles().find((p) => p.id === 'codex')).toMatchObject({
    permissions: 'standard',
    revision: 3,
  });
});
it('captures workflow permission overrides in the published assignment', async () => {
  const e = create();
  profile(e);
  const calls: HarnessRun[] = [];
  const d = blankDefinition();
  d.executor = 'codex';
  d.agentPermissions = 'read-only';
  const w = e.create('Captured permissions', '', d);
  e.publish(w.id);
  e.executors.start([
    adapter('codex', async (input) => {
      calls.push(input);
      return { output: input.work.input };
    }),
  ]);
  const first = start(e, w.id, 1);
  const current = e.workflow(w.id);
  e.update(w.id, {
    draft: { ...current.draft, agentPermissions: 'full-access' },
    draftRevision: current.draftRevision,
  });
  e.publish(w.id);
  await settled(e, first.id);
  const second = start(e, w.id, 2);
  await settled(e, second.id);
  expect(calls.map((c) => c.profile.permissions)).toEqual([
    'read-only',
    'full-access',
  ]);
});

it('keeps long assignments alive and renews claims without the retired runtime cutoff', async () => {
  vi.useFakeTimers();
  const e = create();
  e.store.put('executorProfiles', {
    ...executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      enabled: true,
    }),
    timeoutMs: 1000,
  });
  const run = vi.fn(async (input: HarnessRun) => {
    const answer = await input.request({
      kind: 'permission',
      title: 'Long assignment',
      detail: 'test command',
    });
    return { output: answer.allow ?? false };
  });
  e.executors.start([adapter('codex', run)]);
  const r = start(e, workflow(e, 'codex').id, 1);
  await vi.advanceTimersByTimeAsync(0);
  expect(e.store.work()[0].managedExecution?.state).toBe('needs_human');
  await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
  const work = e.store.work()[0],
    record = e.executors.inspect(work.id).items[0];
  expect(record.state).toBe('needs_human');
  expect(work.status).toBe('claimed');
  expect(Date.parse(work.leaseUntil!)).toBeGreaterThan(Date.now());
  expect(run).toHaveBeenCalledTimes(1);
  expect(record.profile).not.toHaveProperty('timeoutMs');
  e.executors.respond({
    executionId: record.id,
    requestId: record.requests[0].id,
    answer: { allow: false },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(e.run(r.id).status).toBe('completed');
}, 10000);
it('accepts older continuity snapshots while omitting retired timeout settings', async () => {
  const e = create();
  profile(e, 'codex', { tools: ['git'] });
  const calls: HarnessRun[] = [];
  e.executors.start([
    adapter('codex', async (input) => {
      calls.push(input);
      input.onSession('native');
      if (calls.length === 1) {
        const session = e.store.list<any>('executorSessions')[0];
        e.store.put('executorSessions', {
          ...session,
          profile: { ...session.profile, timeoutMs: 1000 },
        });
      }
      return { output: input.work.input };
    }),
  ]);
  const r = start(e, groupedWorkflow(e).id, 1);
  await settled(e, r.id);
  expect(calls).toHaveLength(2);
  for (const call of calls)
    expect(call.profile).not.toHaveProperty('timeoutMs');
  expect(calls[1].sessionId).toBe('native');
  expect(executorProfileSchema.shape).not.toHaveProperty('timeoutMs');
  expect(definitionSchema.shape).not.toHaveProperty('agentTimeoutMs');
});
