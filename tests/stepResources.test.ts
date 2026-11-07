import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blankDefinition,
  nodeSchema,
  type Json,
  type Run,
  type WorkflowNode,
  validateDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';

const engines: Engine[] = [],
  dirs: string[] = [];
const worker = { workerId: 'test', freshContext: false, tools: [], skills: [] };
const fixed = (...names: string[]) =>
  names.map((value) => ({ source: 'literal', value }));
function setup(
  options: ConstructorParameters<typeof Engine>[2] = {},
  path = ':memory:',
) {
  const e = new Engine(new Store(path), process.cwd(), options);
  engines.push(e);
  return e;
}
function start(e: Engine, config: Record<string, unknown>, input: Json = {}) {
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Operation',
    resources: fixed('shared'),
    ...config,
  });
  if (config.onFailure === 'route')
    d.edges.push({
      id: 'failed',
      source: 'agent',
      target: 'exit',
      port: 'failed',
    });
  if (config.kind === 'wait')
    d.edges.push({
      id: 'timeout',
      source: 'agent',
      target: 'exit',
      port: 'timeout',
    });
  const w = e.create('Step resources', '', d);
  e.publish(w.id);
  return e.start(w.id, input).run.id;
}
const script = {
  kind: 'script',
  language: 'javascript',
  command: 'return {ok:true}',
  timeoutMs: 100,
};
const fetchNode = {
  kind: 'fetch',
  url: 'https://example.test',
  timeoutMs: 100,
};
const polling = {
  kind: 'wait',
  timing: {
    kind: 'poll',
    everyMs: 1000,
    timeoutMs: 100,
    check: fetchNode,
    path: 'body.ready',
    equals: true,
  },
};
function step(e: Engine, runId: string) {
  return e.run(runId).executions.findLast((x) => x.nodeId === 'agent')!;
}
function inspect(e: Engine, runId: string) {
  const r = e.manageWorkResources({
    action: 'inspect',
    runId,
    executionId: step(e, runId).id,
  });
  if (!('reservations' in r)) throw Error('inspection expected');
  return r.reservations;
}
function release(e: Engine, runId: string, expectedAttempt = 1) {
  return e.manageWorkResources({
    action: 'release',
    runId,
    executionId: step(e, runId).id,
    expectedAttempt,
    actor: 'test',
    confirmStopped: true,
  });
}
async function settled(
  e: Engine,
  runId: string,
  status: Run['status'] = 'completed',
) {
  await vi.waitFor(
    () => {
      e.pump();
      expect(e.run(runId).status, e.run(runId).error).toBe(status);
    },
    { timeout: 3000, interval: 5 },
  );
}
const deferred = () => {
  let resolve!: (v: Json) => void, reject!: (e: Error) => void;
  const promise = new Promise<Json>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
afterEach(async () => {
  for (const e of engines.splice(0)) {
    e.stop();
    await new Promise((r) => setTimeout(r, 5));
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('admits Script and Fetch atomically against Agent claims, projecting exact blockers without spending queue timeout', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  const calls: string[] = [];
  const first = deferred(),
    second = deferred();
  const e = setup({
    substituteOperation: async (node) => {
      calls.push(node.kind);
      return calls.length === 1 ? first.promise : second.promise;
    },
  });
  const agent = start(e, { kind: 'agent', prompt: 'hold shared' });
  const work = e.available(agent)[0];
  const claim = e.claim(work.id, worker);
  const a = start(e, { ...script, resources: fixed('shared', 'other') });
  const b = start(e, { ...fetchNode, resources: fixed('other') });
  expect(calls).toEqual(['fetch']); // blocked multi-name Script did not reserve 'other'
  expect(inspect(e, a)).toEqual([]);
  expect(e.projectRun(a)).toMatchObject({
    actor: 'engine',
    waiting: { kind: 'resource' },
  });
  expect(e.continuation.briefing({ id: a, limit: 1 })).toMatchObject({
    resourceBlocked: {
      total: 1,
      items: [
        {
          executionId: step(e, a).id,
          owners: expect.arrayContaining([
            expect.objectContaining({ workId: work.id }),
          ]),
        },
      ],
    },
    blockers: { items: [{ reason: 'resource_blocked' }] },
  });
  vi.setSystemTime(new Date('2026-11-01T12:01:00Z'));
  e.pump();
  expect(calls).toEqual(['fetch']);
  first.resolve({ status: 200, headers: {}, body: {} });
  await settled(e, b);
  e.submit(work.id, claim.token!, {});
  expect(calls).toEqual(['fetch', 'script']);
  expect(Date.parse(step(e, a).operationStartedAt!)).toBeGreaterThanOrEqual(
    Date.parse('2026-11-01T12:01:00Z'),
  );
  expect(inspect(e, a)).toHaveLength(2);
  second.resolve({ ok: true });
  await settled(e, a);
  expect(inspect(e, a)).toEqual([]);
});
it('runs a real Script with its full timeout after waiting longer than that timeout', async () => {
  const e = setup();
  const agent = start(e, { kind: 'agent', prompt: 'hold' });
  const work = e.available(agent)[0];
  const claim = e.claim(work.id, worker);
  const id = start(e, script);
  await new Promise((r) => setTimeout(r, 150));
  e.pump();
  expect(step(e, id).operationStartedAt).toBeUndefined();
  e.submit(work.id, claim.token!, {});
  await settled(e, id);
  expect(inspect(e, id)).toEqual([]);
});
it('releases Script and Fetch ownership on known failures', async () => {
  const e = setup({
    substituteOperation: async () => {
      throw Error('known failure');
    },
  });
  for (const config of [script, fetchNode]) {
    const id = start(e, config);
    await settled(e, id, 'failed');
    expect(inspect(e, id)).toEqual([]);
  }
});
it('pauses polling deadline while queued and releases resources between probes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  const probe = vi.fn(async () => Response.json({ ready: false }));
  vi.stubGlobal('fetch', probe);
  const e = setup();
  const agent = start(e, { kind: 'agent', prompt: 'hold' });
  const work = e.available(agent)[0];
  const claim = e.claim(work.id, worker);
  const id = start(e, {
    ...polling,
    timing: { ...polling.timing, timeoutMs: 5000 },
  });
  expect(step(e, id).timeoutAt).toBeUndefined();
  expect(probe).not.toHaveBeenCalled();
  vi.setSystemTime(new Date('2026-11-01T12:01:00Z'));
  e.pump();
  expect(e.run(id).status).toBe('waiting');
  e.submit(work.id, claim.token!, {});
  await vi.waitFor(() => expect(step(e, id).check?.count).toBe(1));
  expect(step(e, id).timeoutAt).toBe('2026-11-01T12:01:05.000Z');
  expect(inspect(e, id)).toEqual([]);
  const other = start(e, { kind: 'agent', prompt: 'between checks' });
  expect(e.claim(e.available(other)[0].id, worker).status).toBe('claimed');
  vi.setSystemTime(new Date(step(e, id).nextCheckAt!));
  e.pump();
  expect(step(e, id).resourceBlocked?.owners[0].runId).toBe(other);
  expect(probe).toHaveBeenCalledTimes(1);
});
it('retains cancelled ownership, rejects active release, and ignores stale settlement after replacement', async () => {
  const old = deferred(),
    next = deferred();
  let calls = 0;
  const e = setup({
    substituteOperation: () => (++calls === 1 ? old.promise : next.promise),
  });
  const a = start(e, script);
  expect(() => release(e, a)).toThrow(/active/);
  e.cancel(a);
  expect(inspect(e, a)[0].state).toBe('uncertain');
  const b = start(e, script);
  expect(calls).toBe(1);
  expect(e.projectRun(b).actor).toBe('person');
  expect(release(e, a, 2)).toMatchObject({ released: 0 });
  expect(calls).toBe(1);
  expect(release(e, a)).toMatchObject({ released: 1 });
  expect(calls).toBe(2);
  old.resolve({ old: true });
  await new Promise((r) => setTimeout(r, 10));
  expect(inspect(e, b)).toMatchObject([
    { executionId: step(e, b).id, state: 'claimed' },
  ]);
  expect(release(e, a)).toMatchObject({ released: 0 });
  next.resolve({ ok: true });
  await settled(e, b);
});
it.each(['script', 'fetch', 'wait'])(
  'marks crashed %s ownership uncertain and blocks reuse until exact reconciliation',
  async (kind) => {
    const root = mkdtempSync(join(tmpdir(), 'step-resource-'));
    dirs.push(root);
    const path = join(root, 'db.sqlite');
    const pending = deferred();
    vi.stubGlobal('fetch', () => pending.promise);
    const e = setup({ substituteOperation: () => pending.promise }, path);
    const id = start(
      e,
      kind === 'wait' ? polling : kind === 'fetch' ? fetchNode : script,
    );
    if (kind === 'wait') await new Promise((r) => setTimeout(r, 5));
    const restored = setup(
      { substituteOperation: async () => ({ ok: true }) },
      path,
    );
    expect(inspect(restored, id)).toMatchObject([
      { state: 'uncertain', executionId: step(e, id).id },
    ]);
    if (kind !== 'wait') expect(restored.run(id).status).toBe('failed');
    const other = start(restored, { kind: 'agent', prompt: 'cannot collide' });
    expect(restored.available(other)).toEqual([]);
    expect(release(restored, id)).toMatchObject({ released: 1 });
    if (kind !== 'wait') expect(restored.available(other)).toHaveLength(1);
  },
);
it('does not fail or reserve a queued deterministic step on restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'step-queued-'));
  dirs.push(root);
  const path = join(root, 'db.sqlite');
  const e = setup({}, path);
  const owner = start(e, { kind: 'agent', prompt: 'hold' });
  e.claim(e.available(owner)[0].id, worker);
  const id = start(e, script);
  const restored = setup({}, path);
  expect(restored.run(id).status).toBe('running');
  expect(inspect(restored, id)).toEqual([]);
  expect(step(restored, id).operationStartedAt).toBeUndefined();
});
it('validates deterministic resource names, limits, scopes and polling-only Waits while preserving draft saves', () => {
  const e = setup();
  for (const config of [script, fetchNode, polling]) {
    const d = blankDefinition();
    d.nodes[1] = nodeSchema.parse({
      id: 'agent',
      label: 'Operation',
      ...config,
      resources: fixed(' valid '),
    });
    if (config.kind === 'wait')
      d.edges.push({
        id: 'timeout',
        source: 'agent',
        target: 'exit',
        port: 'timeout',
      });
    expect(() => validateDefinition(d)).not.toThrow();
    for (const resources of [
      fixed('a', 'a'),
      fixed(''),
      [{ source: 'itemInput', path: 'x' }],
      fixed(...Array.from({ length: 9 }, (_, i) => String(i))),
    ]) {
      expect(() => {
        const invalid = {
          ...d,
          nodes: d.nodes.map((n) =>
            n.id === 'agent' ? { ...n, resources } : n,
          ),
        };
        validateDefinition(invalid);
      }).toThrow();
    }
  }
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Wait',
    kind: 'wait',
    timing: { kind: 'duration', ms: 1 },
    resources: fixed('shared'),
  });
  const w = e.create('Draft', '', d);
  expect(() => e.publish(w.id)).toThrow(/polling/);
});

it('preserves background Script ownership across verified supervisor recovery', async () => {
  const root = mkdtempSync(join(tmpdir(), 'step-background-'));
  dirs.push(root);
  const path = join(root, 'db.sqlite');
  const e = setup({}, path);
  const id = start(e, {
    ...script,
    executionMode: 'background',
    timeoutMs: 5000,
    command:
      'await new Promise(resolve => setTimeout(resolve, 350)); return {ok:true}',
  });
  await vi.waitFor(
    () => expect(step(e, id).background?.state).toBe('running'),
    { timeout: 3000 },
  );
  e.stop();
  const restored = setup({}, path);
  expect(inspect(restored, id)).toMatchObject([
    { state: 'claimed', executionId: step(restored, id).id },
  ]);
  const other = start(restored, { kind: 'agent', prompt: 'after background' });
  expect(restored.available(other)).toEqual([]);
  await settled(restored, id);
  expect(inspect(restored, id)).toEqual([]);
  expect(restored.available(other)).toHaveLength(1);
});

it('rolls back every reservation when acquisition writes fail, without launching or disturbing existing owners', async () => {
  const pending = deferred();
  const launch = vi.fn(() => pending.promise);
  const e = setup({ substituteOperation: launch });
  start(e, { ...script, resources: fixed('occupied') });
  const before = e.store.list('workResources');
  const put = e.store.put.bind(e.store);
  let writes = 0;
  const spy = vi
    .spyOn(e.store, 'put')
    .mockImplementation((collection, value) => {
      if (collection === 'workResources' && ++writes === 2)
        throw Error('injected reservation failure');
      return put(collection, value);
    });
  const failed = start(e, { ...script, resources: fixed('a', 'b') });
  expect(e.run(failed).status).toBe('failed');
  expect(e.run(failed).error).toContain('injected');
  expect(e.store.list('workResources')).toEqual(before);
  expect(launch).toHaveBeenCalledTimes(1);
  spy.mockRestore();
  pending.resolve({ ok: true });
});

it('restores the polling wall-clock deadline when contention ends during a named pause', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  const e = setup();
  const owner = start(e, { kind: 'agent', prompt: 'hold' });
  const w = e.available(owner)[0];
  const c = e.claim(w.id, worker);
  const id = start(e, {
    ...polling,
    timing: { ...polling.timing, timeoutMs: 5000 },
  });
  const hold = e.pauses.create({
    target: { scope: 'workflow', workflowId: e.run(id).workflowId },
    actor: 'test',
    reason: 'paused',
  });
  vi.setSystemTime(new Date('2026-11-01T12:01:00Z'));
  e.submit(w.id, c.token!, {});
  expect(step(e, id).resourceBlocked).toBeUndefined();
  expect(step(e, id).timeoutAt).toBe('2026-11-01T12:01:05.000Z');
  expect(step(e, id).resourceActive).not.toBe(true);
  vi.setSystemTime(new Date('2026-11-01T12:02:00Z'));
  e.pauses.resume(hold.id);
  e.pump();
  expect(e.run(id).status).toBe('completed');
  expect(step(e, id).port).toBe('timeout');
});

it.each([
  ['fetch', 'timeout'],
  ['poll', 'timeout'],
  ['fetch', 'disconnect'],
  ['poll', 'disconnect'],
] as const)(
  'retains uncertain resources after a dispatched %s request has a %s while remote work continues',
  async (kind, failure) => {
    const { createServer } = await import('node:http');
    let active = 0,
      requests = 0;
    const remoteStopped = deferred();
    const server = createServer(async (_request, response) => {
      active++;
      requests++;
      if (failure === 'disconnect') response.destroy();
      await remoteStopped.promise;
      active--;
      response.end('{}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No listener');
    const e = setup();
    const fetch = {
      ...fetchNode,
      onFailure: 'route',
      method: 'POST',
      url: `http://127.0.0.1:${address.port}`,
      timeoutMs: 100,
    };
    try {
      const id = start(
        e,
        kind === 'fetch'
          ? fetch
          : {
              ...polling,
              timing: { ...polling.timing, check: fetch, timeoutMs: 10000 },
            },
      );
      await vi.waitFor(() => {
        e.pump();
        expect(
          kind === 'fetch' ? e.run(id).status : step(e, id).check?.error,
        ).toMatch(kind === 'fetch' ? 'failed' : /exceeded|fetch failed/);
      });
      expect(active).toBe(1);
      expect(requests).toBe(1);
      expect(inspect(e, id)).toMatchObject([
        { state: 'uncertain', attempt: 1 },
      ]);
      if (kind === 'poll') {
        expect(e.projectRun(id)).toMatchObject({
          actor: 'person',
          waiting: { kind: 'resource' },
        });
        expect(step(e, id).timeoutAt).toBeUndefined();
        expect(e.continuation.briefing({ id, limit: 20 }).next).toBe(
          'inspect_resources',
        );
      }
      const other = start(e, { ...script });
      await new Promise((r) => setTimeout(r, 1100));
      e.pump();
      expect(requests).toBe(1);
      expect(step(e, other).resourceBlocked).toBeDefined();
      expect(step(e, id).resourceAttempt).toBe(1);
      // Only the remote operator can establish that the timed-out work has stopped.
      remoteStopped.resolve(null);
      await vi.waitFor(() => expect(active).toBe(0));
      if (kind === 'poll') e.cancel(id);
      release(e, id);
      await settled(e, other);
    } finally {
      remoteStopped.resolve(null);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it.each(['fetch', 'poll'] as const)(
  'releases %s resources for a fully observed HTTP failure and invalid JSON, and rejects missing bindings before dispatch',
  async (kind) => {
    const { createServer } = await import('node:http');
    let requests = 0;
    const server = createServer((req, res) => {
      requests++;
      res.writeHead(req.url === '/http-error' ? 500 : 200, {
        'content-type': 'application/json',
      });
      res.end(req.url === '/http-error' ? '{}' : '{invalid json');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No listener');
    const e = setup();
    try {
      for (const path of ['/http-error', '/json-error']) {
        const fetch = {
          ...fetchNode,
          onFailure: 'route',
          url: `http://127.0.0.1:${address.port}${path}`,
        };
        const id = start(
          e,
          kind === 'fetch'
            ? fetch
            : {
                ...polling,
                timing: { ...polling.timing, check: fetch, timeoutMs: 10000 },
              },
        );
        if (kind === 'fetch') {
          await settled(e, id);
          expect(step(e, id).port).toBe('failed');
        } else
          await vi.waitFor(() =>
            expect(step(e, id).check?.error).toBeDefined(),
          );
        expect(inspect(e, id)).toEqual([]);
        const other = start(e, {
          kind: 'agent',
          prompt: 'known response released',
        });
        const work = e.available(other)[0];
        expect(work).toBeDefined();
        const claim = e.claim(work.id, worker);
        e.submit(work.id, claim.token!, {});
        if (kind === 'poll') e.cancel(id);
      }
      expect(requests).toBe(2);
      const invalid = {
        ...fetchNode,
        url: `http://127.0.0.1:${address.port}/never`,
        headers: [
          { name: 'X-Required', value: { kind: 'input', path: 'missing' } },
        ],
      };
      const id = start(
        e,
        kind === 'fetch'
          ? invalid
          : {
              ...polling,
              timing: { ...polling.timing, check: invalid, timeoutMs: 10000 },
            },
      );
      if (kind === 'fetch') await settled(e, id, 'failed');
      else
        await vi.waitFor(() =>
          expect(step(e, id).check?.error).toContain('missing'),
        );
      expect(inspect(e, id)).toEqual([]);
      expect(requests).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it('resumes an uncertain polling Fetch only after exact remote-stop reconciliation', async () => {
  const { createServer } = await import('node:http');
  let requests = 0,
    firstActive = true,
    overlap = false;
  const remoteStopped = deferred();
  const server = createServer(async (_req, res) => {
    requests++;
    if (requests === 1) {
      res.destroy();
      await remoteStopped.promise;
      firstActive = false;
    } else {
      overlap ||= firstActive;
      res.setHeader('content-type', 'application/json');
      res.end('{"ready":true}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No listener');
  const e = setup();
  try {
    const id = start(e, {
      ...polling,
      timing: {
        ...polling.timing,
        check: {
          ...fetchNode,
          method: 'POST',
          url: `http://127.0.0.1:${address.port}`,
        },
        timeoutMs: 10000,
      },
    });
    await vi.waitFor(() => expect(step(e, id).resourceBlocked).toBeDefined());
    expect(requests).toBe(1);
    expect(inspect(e, id)[0].state).toBe('uncertain');
    expect(release(e, id, 2)).toMatchObject({ released: 0 });
    expect(requests).toBe(1);
    remoteStopped.resolve(null);
    await vi.waitFor(() => expect(firstActive).toBe(false));
    expect(release(e, id)).toMatchObject({ released: 1 });
    await settled(e, id);
    expect(requests).toBe(2);
    expect(overlap).toBe(false);
    expect(step(e, id).resourceAttempt).toBe(2);
    expect(inspect(e, id)).toEqual([]);
  } finally {
    remoteStopped.resolve(null);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
