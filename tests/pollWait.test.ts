import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  definitionSchema,
  outgoingPorts,
  validateDefinition,
  type WorkflowDefinition,
} from '@interlock/core';

const stores: Store[] = [];
const engines: Engine[] = [];
let dir: string;
function setup(path = ':memory:') {
  const store = new Store(path);
  stores.push(store);
  const engine = new Engine(store, process.cwd());
  engines.push(engine);
  return engine;
}
/** A Bash check that reports ready once the flag file exists. */
function flagCheck(flag: string) {
  return {
    kind: 'script',
    language: 'bash',
    command: `if [ -f '${flag}' ]; then echo '{"ready":true,"detail":"up"}'; else echo '{"ready":false}'; fi`,
    timeoutMs: 5000,
  };
}
function definition(
  timing: Record<string, unknown>,
  timeout = false,
): WorkflowDefinition {
  return definitionSchema.parse({
    maxSteps: 3,
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      { id: 'poll', kind: 'wait', label: 'Lab up?', timing },
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'in', source: 'entry', target: 'poll' },
      { id: 'out', source: 'poll', target: 'exit' },
      ...(timeout
        ? [{ id: 'late', source: 'poll', port: 'timeout', target: 'exit' }]
        : []),
    ],
  });
}
function poll(flag: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'poll',
    everyMs: 1000,
    check: flagCheck(flag),
    path: 'ready',
    equals: true,
    ...extra,
  };
}
function start(
  engine: Engine,
  d: WorkflowDefinition,
  input: any = { lab: 'bot-v1' },
) {
  const workflow = engine.create('Poll', '', d);
  engine.publish(workflow.id);
  return engine.start(workflow.id, input).run;
}
const settled = (engine: Engine, id: string) =>
  vi.waitFor(
    () =>
      expect(['completed', 'failed', 'cancelled']).toContain(
        engine.run(id).status,
      ),
    { timeout: 8000, interval: 50 },
  );
const checked = (engine: Engine, id: string, count: number) =>
  vi.waitFor(
    () =>
      expect(
        engine.run(id).executions.at(-1)?.check?.count ?? 0,
      ).toBeGreaterThanOrEqual(count),
    { timeout: 8000, interval: 50 },
  );

// The server pumps the engine on a one-second tick; tests tick faster.
let tick: ReturnType<typeof setInterval>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'interlock-poll-'));
  tick = setInterval(() => engines.forEach((e) => e.pump()), 100);
});
afterEach(() => {
  clearInterval(tick);
  engines.splice(0).forEach((e) => e.stop());
  stores.splice(0).forEach((s) => s.close());
  rmSync(dir, { recursive: true, force: true });
});

it('checks until the result matches, then merges the check output into its input in one step', async () => {
  const engine = setup();
  const flag = join(dir, 'ready');
  const run = start(engine, definition(poll(flag)));
  expect(run.status).toBe('waiting');
  expect(run.executions.at(-1)).toMatchObject({
    kind: 'wait',
    status: 'waiting',
    nextCheckAt: expect.any(String),
    resumeAt: run.executions.at(-1)!.nextCheckAt,
  });
  await checked(engine, run.id, 1);
  const first = engine.run(run.id).executions.at(-1)!;
  expect(first.check).toMatchObject({ count: 1, output: { ready: false } });
  expect(Date.parse(first.nextCheckAt!) - Date.parse(first.check!.at)).toBe(
    1000,
  );
  expect(engine.run(run.id).status).toBe('waiting');
  writeFileSync(flag, '');
  await settled(engine, run.id);
  expect(engine.run(run.id)).toMatchObject({
    status: 'completed',
    output: { lab: 'bot-v1', ready: true, detail: 'up' },
  });
  expect(engine.run(run.id).executions).toHaveLength(3);
  expect(engine.run(run.id).executions[1].check!.count).toBeGreaterThanOrEqual(
    2,
  );
});

it('routes through timeout with the original input when no check passes in time', async () => {
  const engine = setup();
  const run = start(
    engine,
    definition(poll(join(dir, 'never'), { timeoutMs: 1500 }), true),
  );
  expect(
    outgoingPorts(definition(poll('x', { timeoutMs: 1 }), true).nodes[1]),
  ).toEqual(['default', 'timeout']);
  expect(run.executions.at(-1)!.timeoutAt).toBeDefined();
  await settled(engine, run.id);
  expect(engine.run(run.id)).toMatchObject({
    status: 'completed',
    output: run.input,
  });
  expect(engine.run(run.id).executions[1].port).toBe('timeout');
  expect(
    engine.inspect(run.id).events.some((e) => e.type === 'node.timed_out'),
  ).toBe(true);
});

it('records a failing check and tries again instead of failing the step', async () => {
  const engine = setup();
  const counter = join(dir, 'count');
  const run = start(
    engine,
    definition({
      kind: 'poll',
      everyMs: 1000,
      check: {
        kind: 'script',
        language: 'bash',
        command: `n=$(cat '${counter}' 2>/dev/null || echo 0); echo $((n + 1)) > '${counter}'; if [ "$n" -ge 1 ]; then echo '{"ready":true}'; else echo "not yet" >&2; exit 3; fi`,
        timeoutMs: 5000,
      },
      path: 'ready',
      equals: true,
    }),
  );
  await checked(engine, run.id, 1);
  expect(engine.run(run.id).executions.at(-1)!.check).toMatchObject({
    count: 1,
    error: expect.stringContaining('not yet'),
  });
  expect(engine.run(run.id).status).toBe('waiting');
  await settled(engine, run.id);
  expect(engine.run(run.id).status).toBe('completed');
  expect(engine.run(run.id).executions[1].check).toMatchObject({
    count: 2,
    output: { ready: true },
  });
  expect(engine.run(run.id).executions[1].check!.error).toBeUndefined();
});

it('fails the step when a passing check has no value at the path', async () => {
  const engine = setup();
  const run = start(
    engine,
    definition({
      kind: 'poll',
      everyMs: 1000,
      check: {
        kind: 'script',
        language: 'javascript',
        command: 'return { phase: "creating" };',
      },
      path: 'ready',
      equals: true,
    }),
  );
  await settled(engine, run.id);
  expect(engine.run(run.id).status).toBe('failed');
  expect(engine.run(run.id).error).toMatch(/check output has no path "ready"/);
});

it('polls an HTTP endpoint with a Fetch check and reads the response body', async () => {
  let calls = 0;
  const server: Server = createServer((req, res) => {
    calls++;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({ state: calls >= 2 ? 'done' : 'running', seen: req.url }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    const engine = setup();
    const run = start(
      engine,
      definition({
        kind: 'poll',
        everyMs: 1000,
        check: {
          kind: 'fetch',
          url: `http://127.0.0.1:${port}/jobs/{{input.job}}`,
        },
        path: 'body.state',
        equals: 'done',
      }),
      { job: 42 },
    );
    await settled(engine, run.id);
    expect(engine.run(run.id)).toMatchObject({
      status: 'completed',
      output: expect.objectContaining({
        job: 42,
        status: 200,
        body: { state: 'done', seen: '/jobs/42' },
      }),
    });
    expect(calls).toBe(2);
  } finally {
    server.close();
  }
});

it('re-runs an overdue check after reopening the database', async () => {
  const flag = join(dir, 'ready');
  const engine = setup(join(dir, 'db'));
  const run = start(engine, definition(poll(flag)));
  await checked(engine, run.id, 1);
  engine.stop();
  stores.splice(stores.indexOf(engine.store), 1);
  engine.store.close();
  writeFileSync(flag, '');
  const restarted = setup(join(dir, 'db'));
  expect(restarted.run(run.id).status).toBe('waiting');
  await vi.waitFor(
    () => expect(restarted.run(run.id).status).toBe('completed'),
    {
      timeout: 8000,
      interval: 50,
    },
  );
  expect(restarted.run(run.id).executions).toHaveLength(3);
});

it('cancels a polling wait, aborting a check in flight', async () => {
  const engine = setup();
  const marker = join(dir, 'ran');
  const run = start(
    engine,
    definition({
      kind: 'poll',
      everyMs: 1000,
      check: {
        kind: 'script',
        language: 'bash',
        command: `sleep 3; echo ok > '${marker}'; echo '{"ready":true}'`,
        timeoutMs: 10000,
      },
      path: 'ready',
      equals: true,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  engine.cancel(run.id);
  expect(engine.run(run.id).status).toBe('cancelled');
  await new Promise((resolve) => setTimeout(resolve, 3500));
  expect(engine.run(run.id).status).toBe('cancelled');
  expect(existsSync(marker)).toBe(false);
});

it('requires the timeout route only when a deadline is set, and validates Fetch checks', () => {
  const timed = definition(poll('x', { timeoutMs: 1000 }), true);
  expect(() => validateDefinition(timed)).not.toThrow();
  timed.edges = timed.edges.filter((e) => e.port !== 'timeout');
  expect(() => validateDefinition(timed)).toThrow(/timeout/);
  const untimed = definition(poll('x'), true);
  expect(() => validateDefinition(untimed)).toThrow(
    /expected outgoing routes default/,
  );
  expect(() =>
    validateDefinition(
      definition({
        kind: 'poll',
        everyMs: 1000,
        check: { kind: 'fetch', url: 'ftp://example.test/x' },
        path: 'ready',
        equals: true,
      }),
    ),
  ).toThrow(/http or https/);
  expect(() =>
    definitionSchema.parse(definition(poll('x', { everyMs: 10 }))),
  ).toThrow();
});
