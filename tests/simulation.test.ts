import { afterEach, expect, it, vi } from 'vitest';
import { setImmediate as tick } from 'node:timers/promises';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  blankDefinition,
  nodeSchema,
  simulationFixtureSchema,
} from '@interlock/core';
import { appRouter } from '../packages/server/src/router';
import * as scripts from '../packages/runtime/src/scripts';
import * as fetches from '../packages/runtime/src/fetch';

const engines: Engine[] = [],
  dirs: string[] = [];
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
afterEach(async () => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  await tick();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  vi.restoreAllMocks();
});
function scenario(
  e: Engine,
  fixtures: any[] = [{ nodeId: 'agent', kind: 'agent', output: { ok: true } }],
  definition = blankDefinition(),
  assertions: any[] = [],
) {
  const w = e.create('Fixture graph', '', definition);
  e.publish(w.id);
  const suite = e.testbench.createSuite({
    workflowId: w.id,
    content: {
      name: 'Fixtures',
      cases: [{ id: 'case', name: 'Case', input: {}, fixtures, assertions }],
    },
  });
  const request = {
    action: 'run' as const,
    suiteId: suite.id,
    suiteRevision: suite.revision,
    caseId: 'case',
    version: 1,
    requestId: crypto.randomUUID(),
  };
  return { w, suite, request };
}
async function finish(e: Engine, request: any) {
  e.simulations.request(request);
  for (let i = 0; i < 1000; i++) {
    const r = e.simulations.request({
      action: 'get',
      id: request.requestId,
    }) as any;
    if (r.state !== 'running') return r;
    await tick();
  }
  throw new Error('Simulation did not settle');
}
function loop() {
  const d = blankDefinition();
  d.nodes[1].outputSchema = {
    type: 'object',
    required: ['again'],
    properties: { again: { type: 'boolean' } },
  };
  d.nodes.push(
    nodeSchema.parse({
      id: 'condition',
      kind: 'condition',
      label: 'Repeat',
      path: 'again',
      equals: true,
    }),
  );
  d.edges[1].target = 'condition';
  d.edges.push(
    { id: 'back', source: 'condition', target: 'agent', port: 'true' },
    { id: 'done', source: 'condition', target: 'exit', port: 'false' },
  );
  return d;
}
it('uses real contract rejection/correction and repeated-visit routing without live work', async () => {
  const e = setup();
  const { request } = scenario(
    e,
    [
      {
        nodeId: 'agent',
        kind: 'agent',
        output: { again: 'invalid' },
        expectRejection: true,
      },
      { nodeId: 'agent', kind: 'agent', output: { again: true } },
      { nodeId: 'agent', kind: 'agent', output: { again: false } },
    ],
    loop(),
    [
      { kind: 'route', nodeId: 'condition', visit: 1, port: 'true' },
      { kind: 'route', nodeId: 'condition', visit: 2, port: 'false' },
      { kind: 'output', path: 'again', operator: 'equals', expected: false },
    ],
  );
  const report = await finish(e, request);
  expect(report.state).toBe('passed');
  expect(report.substitutions.items.map((r: any) => r.outcome)).toEqual([
    'rejected',
    'accepted',
    'accepted',
  ]);
  expect(report.substitutions.items[0].executionId).toBe(
    report.substitutions.items[1].executionId,
  );
  expect(report.checks.items.map((r: any) => r.status)).toEqual([
    'pass',
    'pass',
    'pass',
  ]);
  expect(e.store.runs()).toEqual([]);
  expect(e.store.list('work')).toEqual([]);
  expect(e.store.list('usage')).toEqual([]);
  expect(
    e.simulations.request({ action: 'capture', id: request.requestId }),
  ).toMatchObject({ mode: 'simulation', result: { again: false } });
});
it('substitutes every Script/Fetch outcome without calling either executor', async () => {
  const e = setup(),
    dir = mkdtempSync(join(tmpdir(), 'simulation-effects-'));
  dirs.push(dir);
  const marker = join(dir, 'marker');
  const script = vi.spyOn(scripts, 'executeScript'),
    fetch = vi.spyOn(fetches, 'executeFetch');
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Danger',
    command: `touch '${marker}'`,
  });
  d.nodes.push(
    nodeSchema.parse({
      id: 'fetch',
      kind: 'fetch',
      label: 'Network',
      url: 'http://127.0.0.1:9/must-not-call',
    }),
  );
  d.edges[1].target = 'fetch';
  d.edges.push({ id: 'out', source: 'fetch', target: 'exit', port: 'default' });
  const { request } = scenario(
    e,
    [
      { nodeId: 'agent', kind: 'script', output: { ok: true } },
      {
        nodeId: 'fetch',
        kind: 'fetch',
        output: { status: 200, headers: {}, body: { ok: true } },
      },
    ],
    d,
  );
  expect((await finish(e, request)).state).toBe('passed');
  expect(existsSync(marker)).toBe(false);
  expect(script).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['execution', 'output', 'http'])(
  'uses real operation failure routing for %s failures',
  async (category) => {
    const e = setup(),
      d = blankDefinition();
    d.nodes[1] = nodeSchema.parse(
      category === 'http'
        ? {
            id: 'agent',
            kind: 'fetch',
            label: 'Fetch',
            url: 'https://example.invalid',
            onFailure: 'route',
          }
        : {
            id: 'agent',
            kind: 'script',
            label: 'Script',
            command: 'exit 99',
            outputSchema: { type: 'number' },
            onFailure: 'route',
          },
    );
    d.edges.push({
      id: 'failed',
      source: 'agent',
      target: 'exit',
      port: 'failed',
    });
    const f =
      category === 'execution'
        ? { error: 'Fixture error' }
        : category === 'output'
          ? { output: 'bad' }
          : { output: { status: 503, headers: {}, body: null } };
    const { request } = scenario(
      e,
      [{ nodeId: 'agent', kind: d.nodes[1].kind, ...f }],
      d,
      [
        { kind: 'route', nodeId: 'agent', visit: 1, port: 'failed' },
        {
          kind: 'output',
          path: 'error.category',
          operator: 'equals',
          expected: category,
        },
      ],
    );
    expect((await finish(e, request)).state).toBe('passed');
  },
);
it.each([
  [[], 'missing'],
  [
    [
      { nodeId: 'agent', kind: 'agent', output: {} },
      { nodeId: 'agent', kind: 'agent', output: {} },
    ],
    'unused',
  ],
  [
    [{ nodeId: 'agent', kind: 'agent', output: {}, expectRejection: true }],
    'expected contract rejection',
  ],
])(
  'fails fixture exhaustion, extras and incorrect rejection expectations',
  async (fixtures, message) => {
    const e = setup(),
      { request } = scenario(e, fixtures as any[]);
    expect(await finish(e, request)).toMatchObject({
      state: 'failed',
      error: expect.stringContaining(message as string),
    });
  },
);
it('records unexpected invalid outputs and fails assertions independently', async () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes[1].outputSchema = { type: 'number' };
  const a = scenario(
    e,
    [{ nodeId: 'agent', kind: 'agent', output: 'wrong' }],
    d,
  );
  expect(await finish(e, a.request)).toMatchObject({
    state: 'failed',
    substitutions: { items: [{ outcome: 'rejected' }] },
  });
  const b = scenario(e, undefined, undefined, [
    { kind: 'output', operator: 'equals', expected: { ok: false } },
  ]);
  expect(await finish(e, b.request)).toMatchObject({
    state: 'failed',
    checks: { items: [{ status: 'fail' }] },
  });
});
it('consumes Agent failure/retry fixtures in order and enforces published step limits', async () => {
  const e = setup(),
    a = scenario(e, [
      { nodeId: 'agent', kind: 'agent', error: 'retry' },
      { nodeId: 'agent', kind: 'agent', output: {} },
    ]);
  expect(await finish(e, a.request)).toMatchObject({
    state: 'passed',
    substitutionCount: 2,
  });
  const d = loop();
  d.maxSteps = 5;
  const b = scenario(
    e,
    Array.from({ length: 10 }, () => ({
      nodeId: 'agent',
      kind: 'agent',
      output: { again: true },
    })),
    d,
  );
  expect(await finish(e, b.request)).toMatchObject({
    state: 'failed',
    runStatus: 'failed',
  });
});
it('rejects unsupported nodes including unreachable nodes before substituting anything', async () => {
  for (const kind of ['workflow', 'batch', 'wait', 'timeout']) {
    const e = setup(),
      { request, w } = scenario(e);
    // Seed an otherwise published record to isolate the simulator gate, including unreachable unsupported nodes.
    const v = e.store.getVersion(w.id, 1)!;
    if (kind === 'timeout')
      (v.definition.nodes[1] as any).unclaimedTimeoutMs = 1;
    else
      v.definition.nodes.push(
        nodeSchema.parse({
          id: 'unsupported',
          kind,
          label: 'Unsupported',
          ...(kind === 'workflow'
            ? { workflowId: w.id, version: 1, mode: 'detached' }
            : {}),
        }),
      );
    e.store.version(v);
    expect(await finish(e, request)).toMatchObject({
      state: 'unsupported',
      substitutionCount: 0,
    });
  }
});
it('rejects wrong-node/kind fixtures up front and mismatched order during execution', async () => {
  const e = setup(),
    a = scenario(e, [{ nodeId: 'agent', kind: 'script', output: {} }]);
  expect(await finish(e, a.request)).toMatchObject({
    state: 'unsupported',
    substitutionCount: 0,
  });
  const d = blankDefinition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'other',
      kind: 'agent',
      label: 'Other',
      prompt: 'Work',
    }),
  );
  // A second reachable node gives a valid fixture identity but the wrong order.
  d.edges[1].target = 'other';
  d.edges.push({ id: 'out', source: 'other', target: 'exit', port: 'default' });
  const b = scenario(e, [{ nodeId: 'other', kind: 'agent', output: {} }], d);
  expect(await finish(e, b.request)).toMatchObject({
    state: 'failed',
    error: expect.stringContaining('expected agent node agent'),
  });
});
it('pins captures and startup retries, pages receipts, and does not add live baseline evidence', async () => {
  const e = setup(),
    { request, suite, w } = scenario(
      e,
      [
        { nodeId: 'agent', kind: 'agent', output: { again: true } },
        { nodeId: 'agent', kind: 'agent', output: { again: false } },
      ],
      loop(),
    );
  const initial = e.simulations.request(request);
  e.testbench.updateSuite({
    id: suite.id,
    revision: suite.revision,
    content: {
      name: 'Edited',
      cases: [{ id: 'case', name: 'Changed', input: { changed: true } }],
    },
  });
  expect(e.simulations.request(request)).toEqual(initial);
  expect(() => e.simulations.request({ ...request, version: 2 })).toThrow(
    'different arguments',
  );
  await finish(e, request);
  const first = e.simulations.request({
    action: 'get',
    id: request.requestId,
    limit: 1,
  }) as any;
  expect(first.substitutions).toMatchObject({ total: 2, nextOffset: 1 });
  const second = e.simulations.request({
    action: 'get',
    id: request.requestId,
    offset: 1,
    limit: 1,
  }) as any;
  expect(second.substitutions.items[0].index).toBe(1);
  expect(JSON.stringify(first)).not.toContain('"capture"');
  expect(
    e.simulations.request({ action: 'capture', id: request.requestId }),
  ).toMatchObject({ capture: { case: { name: 'Case', input: {} } } });
  expect(
    e.simulations.request({ action: 'list', workflowId: w.id }),
  ).toMatchObject({ total: 1 });
  expect(e.store.list('comparisons')).toEqual([]);
  e.deleteWorkflow(w.id);
  expect(e.simulations.request({ action: 'list' })).toMatchObject({ total: 0 });
});
it('cancels and bounds concurrency before creating any execution', async () => {
  const e = setup(),
    s = scenario(e);
  const requests = Array.from({ length: 4 }, () => ({
    ...s.request,
    requestId: crypto.randomUUID(),
  }));
  requests.forEach((r) => e.simulations.request(r));
  expect(() => e.simulations.request(s.request)).toThrow('four simulations');
  expect(() => e.deleteWorkflow(s.w.id)).toThrow('active simulation');
  for (const r of requests)
    expect(
      e.simulations.request({ action: 'cancel', id: r.requestId }),
    ).toMatchObject({ state: 'cancelled', substitutionCount: 0 });
  await tick();
  await tick();
  expect((await finish(e, s.request)).state).toBe('passed');
});
it('preserves reports across restart, marks interrupted work, and never resumes it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'simulation-restart-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite'),
    e = setup(path),
    s = scenario(e);
  await finish(e, s.request);
  const interrupted = { ...s.request, requestId: 'interrupted' };
  e.simulations.request(interrupted);
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  const restarted = setup(path);
  expect(restarted.simulations.request(s.request)).toMatchObject({
    state: 'passed',
  });
  expect(restarted.simulations.request(interrupted)).toMatchObject({
    state: 'interrupted',
    substitutionCount: 0,
  });
  // Also recover a crash that left a running receipt, without a graceful stop.
  const stored = restarted.store.get<any>('workflowSimulations', 'interrupted');
  restarted.store.put('workflowSimulations', {
    ...stored,
    id: 'crashed',
    state: 'running',
  });
  restarted.stop();
  restarted.store.close();
  engines.splice(engines.indexOf(restarted), 1);
  const again = setup(path);
  expect(
    again.simulations.request({ action: 'get', id: 'crashed' }),
  ).toMatchObject({ state: 'interrupted' });
  expect(again.store.runs()).toEqual([]);
});
it('validates fixture envelopes and exposes the same contract through the shared API', async () => {
  expect(
    simulationFixtureSchema.safeParse({
      nodeId: 'f',
      kind: 'fetch',
      output: { status: 200 },
    }).success,
  ).toBe(false);
  expect(
    simulationFixtureSchema.safeParse({
      nodeId: 'a',
      kind: 'agent',
      output: null,
      error: 'both',
    }).success,
  ).toBe(false);
  const e = setup(),
    { request } = scenario(e),
    api = appRouter.createCaller({ engine: e });
  expect(await api.testbench.simulation(request)).toMatchObject({
    mode: 'simulation',
    state: 'running',
  });
  expect((await finish(e, request)).state).toBe('passed');
});

it('cancels after a substitution and retains captured prompt/version content', async () => {
  const e = setup(),
    prompt = e.prompts.create({
      name: 'Guidance',
      description: '',
      content: 'Original guidance',
    }),
    d = loop();
  if (d.nodes[1].kind === 'agent') d.nodes[1].promptIds = [prompt.id];
  const { request, w } = scenario(
    e,
    Array.from({ length: 30 }, () => ({
      nodeId: 'agent',
      kind: 'agent',
      output: { again: true },
    })),
    d,
  );
  e.simulations.request(request);
  e.prompts.update(prompt.id, prompt.revision, {
    name: 'Guidance',
    description: '',
    content: 'Changed guidance',
  });
  e.store.remove('versions', `${w.id}:1`);
  await tick();
  const partial = e.simulations.request({
    action: 'get',
    id: request.requestId,
  }) as any;
  expect(partial.substitutionCount).toBeGreaterThan(0);
  expect(
    e.simulations.request({ action: 'cancel', id: request.requestId }),
  ).toMatchObject({ state: 'cancelled' });
  await tick();
  await tick();
  expect(
    e.simulations.request({ action: 'get', id: request.requestId }),
  ).toMatchObject({
    state: 'cancelled',
    substitutionCount: partial.substitutionCount,
  });
  expect(
    e.simulations.request({ action: 'capture', id: request.requestId }),
  ).toMatchObject({
    capture: {
      prompts: [{ content: 'Original guidance', revision: 1 }],
      definition: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'agent' }),
        ]),
      },
    },
  });
});
it('evaluates Switch routes and input bindings using the pinned engine semantics', async () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'switch',
      kind: 'switch',
      label: 'Select',
      path: 'selected',
      cases: [{ port: 'yes', equals: 42 }],
      default: 'no',
      inputBindings: {
        selected: { source: 'node', nodeId: 'agent', path: 'answer' },
      },
    }),
  );
  d.edges[1].target = 'switch';
  d.edges.push(
    { id: 'yes', source: 'switch', target: 'exit', port: 'yes' },
    { id: 'no', source: 'switch', target: 'exit', port: 'no' },
  );
  const { request } = scenario(
    e,
    [{ nodeId: 'agent', kind: 'agent', output: { answer: 42 } }],
    d,
    [
      { kind: 'route', nodeId: 'switch', visit: 1, port: 'yes' },
      { kind: 'output', path: 'selected', operator: 'equals', expected: 42 },
    ],
  );
  expect(await finish(e, request)).toMatchObject({ state: 'passed' });
});
