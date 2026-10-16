import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  validateDefinition,
  diagnoseDraft,
  nodeInputHint,
  FAILURE_ROUTE_SCHEMA,
  assertContract,
  type WorkflowDefinition,
  evaluateAssertions,
  type Json,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { batchDefinition, nestedBatches } from './fixtures/batch';
import { parseRawDefinition } from '../packages/ui/src/features/workflows/rawDefinition';

const engines: Engine[] = [],
  stores: Store[] = [],
  dirs: string[] = [],
  servers: Server[] = [];
afterEach(async () => {
  engines.splice(0).forEach((e) => e.stop());
  stores.splice(0).forEach((s) => s.close());
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
function setup(path = ':memory:') {
  const store = new Store(path),
    engine = new Engine(store, process.cwd());
  stores.push(store);
  engines.push(engine);
  return { store, engine };
}
function script(patch: Record<string, unknown> = {}) {
  return nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Operation',
    language: 'javascript',
    command: 'throw new Error("unavailable");',
    onFailure: 'route',
    ...patch,
  });
}
function definition(operation = script()): WorkflowDefinition {
  const d = blankDefinition();
  d.nodes[1] = operation;
  d.edges.push({
    id: 'recovery',
    source: operation.id,
    target: 'exit',
    port: 'failed',
  });
  return d;
}
function start(engine: Engine, d = definition(), input: Json = {}) {
  const w = engine.create('Recovery', '', d);
  engine.publish(w.id);
  return engine.start(w.id, input).run;
}
async function done(engine: Engine, id: string) {
  await vi.waitFor(() =>
    expect(['completed', 'failed', 'cancelled']).toContain(
      engine.run(id).status,
    ),
  );
  return engine.run(id);
}

it('requires the configured route only at publication and infers the failure envelope', () => {
  const d = definition();
  expect(() => validateDefinition(d)).not.toThrow();
  const exit = d.nodes.find((n) => n.kind === 'exit')!;
  d.edges = d.edges.filter(
    (e) => !(e.source === 'agent' && e.port === 'default'),
  );
  expect(nodeInputHint(d, exit).schema).toEqual(FAILURE_ROUTE_SCHEMA);
  expect(() => validateDefinition(d)).toThrow();
  expect(diagnoseDraft(d).definition).toBeDefined();
  expect(parseRawDefinition(JSON.stringify(d)).definition).toEqual(d);
  d.edges.push({
    id: 'default',
    source: 'agent',
    target: 'exit',
    port: 'default',
  });
  expect(() => validateDefinition(d)).not.toThrow();
  d.nodes[1] = script({ onFailure: undefined });
  expect(() => validateDefinition(d)).toThrow();
  expect(
    nodeSchema.safeParse({ ...d.nodes[1], onFailure: 'retry' }).success,
  ).toBe(false);
});

it.each([
  ['javascript', 'throw new Error("unavailable");'],
  ['bash', 'echo unavailable >&2; exit 7'],
  [undefined, 'echo unavailable >&2; exit 7'],
])(
  'routes %s execution errors and retains failed history',
  async (language, command) => {
    const { engine, store } = setup();
    const r = await done(
      engine,
      start(
        engine,
        definition(
          script({
            language,
            command,
            inputBindings: { value: { source: 'input', path: 'source' } },
          }),
        ),
        { source: 42 },
      ).id,
    );
    expect(r.status).toBe('completed');
    const failed = r.executions[1];
    expect(failed).toMatchObject({
      status: 'failed',
      port: 'failed',
      input: { value: 42 },
      originalInput: { source: 42 },
    });
    expect(failed.error).toContain('unavailable');
    expect(failed.completedAt).toBeTruthy();
    expect(r.output).toMatchObject({
      input: { value: 42 },
      output: null,
      error: {
        nodeId: 'agent',
        executionId: failed.id,
        kind: 'script',
        category: 'execution',
        message: failed.error,
      },
    });
    expect(() =>
      assertContract(FAILURE_ROUTE_SCHEMA, r.output!, 'failure'),
    ).not.toThrow();
    expect(store.runs()[0]).toEqual(r);
    expect(
      engine.inspect(r.id).events.some((e) => e.type === 'node.failure_routed'),
    ).toBe(true);
    expect(() => engine.retry(r.id)).toThrow();
  },
);

it.each([undefined, 'fail'])(
  'keeps omitted/explicit %s policy terminal',
  async (onFailure) => {
    const { engine } = setup(),
      d = definition(script({ onFailure }));
    d.edges.pop();
    const r = await done(engine, start(engine, d).id);
    expect(r.status).toBe('failed');
    expect(r.executions[1].port).toBeUndefined();
  },
);

it('passes valid success output normally and routes rejected output without applying the success contract to the error', async () => {
  const { engine } = setup();
  for (const value of [42, 'wrong']) {
    const r = await done(
      engine,
      start(
        engine,
        definition(
          script({
            command: `return ${JSON.stringify(value)};`,
            outputSchema: { type: 'number' },
          }),
        ),
      ).id,
    );
    expect(r.status).toBe('completed');
    if (typeof value === 'number') {
      expect(r.output).toBe(42);
      expect(r.executions[1].port).toBe('default');
    } else {
      expect(r.executions[1]).toMatchObject({
        status: 'failed',
        output: 'wrong',
        port: 'failed',
      });
      expect(r.output).toMatchObject({
        output: 'wrong',
        error: { category: 'output' },
      });
    }
  }
});

it('validates recovery destination contracts and bindings', async () => {
  const { engine } = setup();
  for (const schema of [{ type: 'object' }, { type: 'number' }]) {
    const d = definition();
    d.nodes.splice(
      2,
      0,
      nodeSchema.parse({
        id: 'recover',
        kind: 'script',
        language: 'javascript',
        label: 'Recover',
        command: 'return input;',
        inputSchema: schema,
        inputBindings: { message: { source: 'input', path: 'error.message' } },
      }),
    );
    d.edges.find((e) => e.port === 'failed')!.target = 'recover';
    d.edges.push({
      id: 'recovered',
      source: 'recover',
      target: 'exit',
      port: 'default',
    });
    const r = await done(engine, start(engine, d).id);
    expect(r.status).toBe(schema.type === 'object' ? 'completed' : 'failed');
    if (schema.type === 'object')
      expect(r.output).toMatchObject({
        message: expect.stringContaining('unavailable'),
      });
    else
      expect(r.executions.at(-1)).toMatchObject({
        nodeId: 'recover',
        status: 'failed',
        error: expect.stringContaining('Recover input'),
      });
  }
});

it.each([
  { inputSchema: { type: 'number' } },
  { inputBindings: { missing: { source: 'input', path: 'absent' } } },
])('does not route invalid inputs %j', async (patch) => {
  const { engine } = setup();
  const r = await done(engine, start(engine, definition(script(patch))).id);
  expect(r.status).toBe('failed');
  expect(r.executions).toHaveLength(2);
  expect(r.executions[1].port).toBeUndefined();
});

it('bounds recovery loops by the existing step limit', async () => {
  const { engine } = setup(),
    d = definition();
  d.maxSteps = 3;
  d.edges.find((e) => e.port === 'failed')!.target = 'agent';
  const r = await done(engine, start(engine, d).id);
  expect(r.status).toBe('failed');
  expect(r.error).toContain('step limit');
  expect(r.executions.filter((e) => e.port === 'failed')).toHaveLength(2);
  expect(r.executions.at(-1)!.port).toBeUndefined();
});

it.each(['all', 'collect'])(
  'recovers inside nested Batches with %s policy, including direct End',
  async (failurePolicy) => {
    const { engine } = setup();
    for (const nested of [false, true]) {
      const item = script({ id: 'work' }),
        d = nested
          ? nestedBatches(2, item, { failurePolicy })
          : batchDefinition(item, { failurePolicy });
      if (!nested)
        (d.nodes.find((n) => n.id === 'batch') as any).failurePolicy =
          failurePolicy;
      const end = d.edges.find((e) => e.source === 'work')!;
      d.edges.push({ ...end, id: 'failure-end', port: 'failed' });
      expect(() => validateDefinition(d)).not.toThrow();
      const r = await done(
        engine,
        start(engine, d, nested ? [[1, 2]] : [1, 2]).id,
      );
      expect(r.status).toBe('completed');
      const items = engine
        .inspect(r.id)
        .descendants.filter((c) =>
          c.executions.some((e) => e.nodeId === 'work'),
        );
      expect(items).toHaveLength(2);
      for (const c of items) {
        expect(c.status).toBe('completed');
        expect(c.executions.at(-1)).toMatchObject({
          status: 'failed',
          port: 'failed',
        });
      }
    }
  },
);

it('rejects cross-scope recovery with a valid in-scope control', () => {
  const d = batchDefinition(script({ id: 'work' }));
  d.edges.push({ id: 'bad', source: 'work', target: 'exit', port: 'failed' });
  expect(() => validateDefinition(d)).toThrow();
  Object.assign(d.edges.at(-1)!, { target: 'batch', targetHandle: 'end' });
  expect(() => validateDefinition(d)).not.toThrow();
});

it('does not recover after cancellation or replay an interrupted operation after restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-recovery-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite'),
    { engine, store } = setup(path);
  const d = definition(
    script({
      command:
        'await new Promise(r=>setTimeout(r,1000)); throw new Error("late");',
    }),
  );
  const cancelled = start(engine, d);
  engine.cancel(cancelled.id);
  const interrupted = start(engine, d);
  engine.stop();
  const restarted = setup(path).engine;
  expect(restarted.run(interrupted.id)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('Service interrupted'),
  });
  expect(restarted.run(interrupted.id).executions[1].port).toBeUndefined();
  await new Promise((r) => setTimeout(r, 100));
  expect(store.runs().find((r) => r.id === cancelled.id)!.status).toBe(
    'cancelled',
  );
  expect(restarted.run(cancelled.id).executions[1].port).toBeUndefined();
});

async function http() {
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests++;
    if (req.url === '/slow') await new Promise((r) => setTimeout(r, 200));
    if (res.destroyed) return;
    if (req.url === '/network') {
      res.destroy();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res
      .writeHead(req.url === '/failure' ? 503 : 200)
      .end(req.url === '/invalid' ? '{' : '{"ok":true}');
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, requests: () => requests };
}
it.each([
  ['/failure', 'http'],
  ['/invalid', 'execution'],
  ['/network', 'execution'],
  ['/slow', 'execution'],
])('routes Fetch %s once without replay', async (path, category) => {
  const { engine } = setup(),
    service = await http();
  const d = definition(
    nodeSchema.parse({
      id: 'agent',
      kind: 'fetch',
      label: 'Request',
      url: service.url + path,
      onFailure: 'route',
      timeoutMs: 100,
    }),
  );
  const r = await done(engine, start(engine, d, { id: 1 }).id);
  expect(r.status).toBe('completed');
  expect(r.output).toMatchObject({
    input: { id: 1 },
    error: { kind: 'fetch', category },
  });
  expect(service.requests()).toBe(1);
  if (category === 'http') {
    expect(r.output).toMatchObject({
      output: { status: 503, body: { ok: true } },
    });
    expect(r.executions[1].output).toMatchObject({ status: 503 });
  }
});
it('keeps accepted Fetch HTTP errors successful and request-resolution errors terminal', async () => {
  const { engine } = setup(),
    service = await http();
  const n = nodeSchema.parse({
    id: 'agent',
    kind: 'fetch',
    label: 'Request',
    url: service.url + '/failure',
    onFailure: 'route',
    failOnHttpError: false,
  });
  const r = await done(engine, start(engine, definition(n)).id);
  expect(r.status).toBe('completed');
  expect(r.executions[1].port).toBe('default');
  const invalid = nodeSchema.parse({
    ...n,
    url: service.url + '/{{input.missing}}',
  });
  const f = await done(engine, start(engine, definition(invalid)).id);
  expect(f.status).toBe('failed');
  expect(f.executions[1].port).toBeUndefined();
  expect(service.requests()).toBe(1);
});

it('compares an unchanged failing baseline with a recovered candidate in the testbench', async () => {
  const { engine } = setup(),
    baseline = definition(script({ onFailure: undefined }));
  baseline.edges.pop();
  const workflow = engine.create('Failure comparison', '', baseline);
  engine.publish(workflow.id);
  engine.update(workflow.id, {
    draft: definition(),
    draftRevision: workflow.draftRevision,
  });
  engine.publish(workflow.id);
  const suite = engine.testbench.createSuite({
    workflowId: workflow.id,
    content: {
      name: 'Recovery',
      cases: [
        {
          id: 'failure',
          name: 'Unavailable operation',
          input: { id: 42 },
          assertions: [
            {
              kind: 'output',
              path: 'error.category',
              operator: 'equals',
              expected: 'execution',
            },
          ],
        },
      ],
    },
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: suite.revision,
    baselineVersion: 1,
    candidateVersion: 2,
  };
  const preview = engine.testbench.preview(selection);
  const comparison = engine.testbench.start({
    ...selection,
    confirmation: preview.confirmation,
    requestId: 'recovery-proof',
  });
  engine.pump();
  await vi.waitFor(() =>
    expect(engine.testbench.report({ id: comparison.id }).status).toBe(
      'completed',
    ),
  );
  const report = engine.testbench.report({ id: comparison.id });
  expect(report.samples.map((s) => s.observation?.status).sort()).toEqual([
    'completed',
    'failed',
  ]);
  const candidate = report.samples.find((s) => s.side === 'candidate')!;
  expect(candidate.observation!.checks[0].status).toBe('pass');
  const recovered = engine.run(candidate.runId!);
  expect(
    evaluateAssertions(
      [{ kind: 'route', nodeId: 'agent', visit: 1, port: 'failed' }],
      recovered,
    )[0].status,
  ).toBe('pass');
  expect(engine.store.getVersion(workflow.id, 1)!.definition).toEqual(baseline);
});

it('keeps persistence errors terminal after rolling back completion, rather than treating them as operation errors', async () => {
  const { engine, store } = setup();
  const put = store.put.bind(store);
  let injected = false;
  vi.spyOn(store, 'put').mockImplementation((collection, value: any) => {
    if (
      !injected &&
      collection === 'runs' &&
      value.executions?.some(
        (e: any) => e.nodeId === 'agent' && e.status === 'completed',
      )
    ) {
      injected = true;
      throw new Error('Injected persistence failure');
    }
    return put(collection, value);
  });
  const run = await done(
    engine,
    start(engine, definition(script({ command: 'return 42;' }))).id,
  );
  expect(injected).toBe(true);
  expect(run.status).toBe('failed');
  expect(run.error).toBe('Injected persistence failure');
  expect(run.executions[1].port).toBeUndefined();
  expect(run.executions[1].output).toBeUndefined();
  expect(
    engine.inspect(run.id).events.some((e) => e.type === 'node.failure_routed'),
  ).toBe(false);
});

it('ignores late Fetch failure after cancellation without following Failed', async () => {
  const { engine } = setup(),
    service = await http();
  const d = definition(
    nodeSchema.parse({
      id: 'agent',
      kind: 'fetch',
      label: 'Request',
      url: service.url + '/slow',
      onFailure: 'route',
      timeoutMs: 100,
    }),
  );
  const run = start(engine, d);
  await vi.waitFor(() => expect(service.requests()).toBe(1));
  engine.cancel(run.id);
  await new Promise((r) => setTimeout(r, 150));
  expect(engine.run(run.id).status).toBe('cancelled');
  expect(engine.run(run.id).executions[1].port).toBeUndefined();
  expect(
    engine.inspect(run.id).events.some((e) => e.type === 'node.failure_routed'),
  ).toBe(false);
});
