import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  validateDefinition,
  resolveBindingFields,
  type WorkflowNode,
  type Json,
  type WorkflowDefinition,
} from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { batchDefinition, itemScript } from './fixtures/batch';
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});
function setup() {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  cleanups.push(() => {
    engine.stop();
    store.close();
  });
  return { engine, store };
}
function definition(node: WorkflowNode): WorkflowDefinition {
  const d = blankDefinition();
  d.nodes[1] = node;
  const ports = node.routing
    ? [
        ...node.routing.cases.map((c) => c.port),
        ...(node.routing.default === undefined ? [] : [node.routing.default]),
      ]
    : ['default'];
  d.edges = d.edges
    .filter((e) => e.source !== 'agent')
    .concat(
      ports.map((port) => ({
        id: `route-${port}`,
        source: 'agent',
        port,
        target: 'exit',
      })),
    );
  return d;
}
function start(engine: Engine, d: WorkflowDefinition, input: Json = {}) {
  const workflow = engine.create('Node results', '', d);
  engine.publish(workflow.id);
  return engine.start(workflow.id, input).run;
}
const ready = {
  path: 'ready',
  cases: [{ port: 'yes', equals: true }],
  default: 'no',
};
const script = (patch: Record<string, unknown> = {}) =>
  nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Check',
    language: 'javascript',
    command: 'return { ready: true, value: 42 };',
    ...patch,
  });
async function done(engine: Engine, id: string) {
  await vi.waitFor(() =>
    expect(['completed', 'failed']).toContain(engine.run(id).status),
  );
  return engine.run(id);
}
it('validates and routes the raw Script result before shaping downstream data', async () => {
  const { engine, store } = setup();
  const node = script({
    routing: ready,
    outputSchema: { type: 'object', required: ['ready', 'value'] },
    outputBindings: {
      answer: { source: 'input', path: 'value' },
      original: { source: 'runInput', path: '' },
    },
  });
  const run = await done(
    engine,
    start(engine, definition(node), { ticket: 7 }).id,
  );
  expect(run.status).toBe('completed');
  expect(run.output).toEqual({ answer: 42, original: { ticket: 7 } });
  const step = run.executions.find((e) => e.nodeId === 'agent')!;
  expect(step).toMatchObject({
    port: 'yes',
    result: { ready: true, value: 42 },
    output: run.output,
  });
  expect(
    engine.continuation.result({
      id: run.id,
      executionId: step.id,
      field: 'result',
    }).value,
  ).toEqual({ ready: true, value: 42 });
  expect(
    engine.continuation.result({ id: run.id, executionId: step.id }).value,
  ).toEqual(run.output);
  expect(() =>
    engine.continuation.result({ id: run.id, field: 'result' }),
  ).toThrow('requires executionId');
  const metadata = store
    .continuation(run.id)
    .executions.find((e) => e.id === step.id)!;
  expect(metadata).not.toHaveProperty('result');
  expect(metadata).not.toHaveProperty('output');
});
it('preserves literal dotted keys, builds nested fields and defaults only missing paths', async () => {
  const { engine } = setup();
  const node = script({
    command: 'return input;',
    inputBindings: {
      'literal.name': { source: 'runInput', path: 'zero', default: 9 },
      project: {
        source: 'object',
        fields: {
          enabled: { source: 'input', path: 'absent', default: false },
          optional: { source: 'input', path: 'absent', default: null },
          empty: { source: 'input', path: 'text', default: 'wrong' },
          settings: {
            source: 'literal',
            value: { tier: 'fast', tags: [1, true] },
          },
        },
      },
    },
  });
  const run = await done(
    engine,
    start(engine, definition(node), { zero: 0, text: '' }).id,
  );
  expect(run.output).toEqual({
    'literal.name': 0,
    project: {
      enabled: false,
      optional: null,
      empty: '',
      settings: { tier: 'fast', tags: [1, true] },
    },
  });
  expect(run.input).toEqual({ zero: 0, text: '' });
});
it('never defaults missing source history or invalid paths', () => {
  expect(() =>
    resolveBindingFields(
      { x: { source: 'node', nodeId: 'missing', path: 'x', default: null } },
      () => {
        throw new Error('Missing source');
      },
    ),
  ).toThrow('Missing source');
  expect(() =>
    resolveBindingFields(
      { x: { source: 'input', path: 'constructor', default: null } },
      () => ({}),
    ),
  ).toThrow('Invalid data path');
  expect(
    resolveBindingFields(
      { x: { source: 'input', path: 'x', default: 'fallback' } },
      () => ({ x: null }),
    ),
  ).toEqual({ x: null });
});
it('keeps raw null distinct from an absent raw result', async () => {
  const { engine } = setup();
  const run = await done(
    engine,
    start(
      engine,
      definition(script({ command: 'return null;', outputBindings: {} })),
    ).id,
  );
  expect(run.output).toEqual({});
  const step = run.executions.find((e) => e.nodeId === 'agent')!;
  expect(step.result).toBeNull();
  expect(
    engine.continuation.result({
      id: run.id,
      executionId: step.id,
      field: 'result',
    }).value,
  ).toBeNull();
  const legacy = await done(
    engine,
    start(engine, definition(script({ command: 'return null;' }))).id,
  );
  expect(
    engine.continuation.result({
      id: legacy.id,
      executionId: legacy.executions[1].id,
      field: 'result',
    }).value,
  ).toBeNull();
});
it('preflights result routes without consuming an Agent claim and keeps submission idempotent', () => {
  const { engine, store } = setup();
  const d = definition(
    nodeSchema.parse({
      id: 'agent',
      kind: 'agent',
      label: 'Review',
      prompt: 'Return readiness',
      routing: ready,
      outputSchema: { type: 'object' },
      outputBindings: {
        original: { source: 'runInput', path: 'request' },
        value: { source: 'input', path: 'value' },
      },
    }),
  );
  const run = start(engine, d, { request: 'task' }),
    work = engine.available(run.id)[0],
    claim = engine.claim(work.id, {
      workerId: 'test',
      freshContext: false,
      tools: [],
      skills: [],
    });
  const token = claim.token!;
  expect(engine.preflightResult(work.id, token, {})).toMatchObject({
    code: 'invalid_result',
    claimUsable: true,
  });
  expect(() => engine.submit(work.id, token, {})).toThrow();
  expect(store.get('work', work.id)).toMatchObject({ status: 'claimed' });
  const output = { ready: true, value: 17 };
  expect(engine.preflightResult(work.id, token, output).code).toBe('ready');
  engine.submit(work.id, token, output);
  expect(engine.run(run.id).output).toEqual({ original: 'task', value: 17 });
  engine.submit(work.id, token, output);
  expect(
    engine.run(run.id).executions.filter((e) => e.nodeId === 'exit'),
  ).toHaveLength(1);
  expect(engine.preflightResult(work.id, token, output).code).toBe(
    'already_accepted',
  );
  expect(store.get('work', work.id)).toMatchObject({ output });
});
it('does not turn result-processing errors into operation failure routes', async () => {
  const { engine } = setup();
  const node = script({
    command: 'return {};',
    routing: ready,
    onFailure: 'route',
  });
  const d = definition(node);
  d.edges.push({
    id: 'failure',
    source: 'agent',
    port: 'failed',
    target: 'exit',
  });
  const run = await done(engine, start(engine, d).id);
  expect(run.status).toBe('failed');
  expect(run.error).toContain('no path');
  const step = run.executions.find((e) => e.nodeId === 'agent')!;
  expect(step.port).toBeUndefined();
  expect(step.result).toEqual({});
  expect(run.executions.some((e) => e.nodeId === 'exit')).toBe(false);
});
it('keeps operation failures separate from success routing and mapping', async () => {
  const { engine } = setup();
  const node = script({
    command: 'throw new Error("broken");',
    routing: ready,
    onFailure: 'route',
    outputBindings: { x: { source: 'input', path: 'unavailable' } },
  });
  const d = definition(node);
  d.edges.push({
    id: 'failure',
    source: 'agent',
    port: 'failed',
    target: 'exit',
  });
  const run = await done(engine, start(engine, d, { request: 1 }).id);
  expect(run.status).toBe('completed');
  expect(run.executions[1].port).toBe('failed');
  expect(run.output).toMatchObject({
    input: { request: 1 },
    error: { message: expect.stringContaining('broken') },
  });
});
it('preserves Batch item and workflow inputs in nested output mappings', async () => {
  const { engine } = setup();
  const item = itemScript('return {ready:true};');
  item.routing = ready;
  item.outputBindings = {
    project: {
      source: 'object',
      fields: {
        original: { source: 'itemInput', path: '' },
        policy: { source: 'runInput', path: 'policy' },
      },
    },
    result: { source: 'input', path: '' },
  };
  const d = batchDefinition(item, { itemsPath: 'items' });
  d.edges = d.edges
    .filter((e) => e.source !== item.id)
    .concat(
      ['yes', 'no'].map((port) => ({
        id: `item-${port}`,
        source: item.id,
        port,
        target: 'batch',
        targetHandle: 'end' as const,
      })),
    );
  const run = await done(
    engine,
    start(engine, d, { policy: 'strict', items: [7, 8] }).id,
  );
  expect(run.status).toBe('completed');
  expect(run.output).toEqual(
    [7, 8].map((original) => ({
      project: { original, policy: 'strict' },
      result: { ready: true },
    })),
  );
});
it('routes and maps the result of a waited Workflow', async () => {
  const { engine } = setup();
  const child = engine.create('Child', '', definition(script()));
  engine.publish(child.id);
  const node = nodeSchema.parse({
    id: 'agent',
    kind: 'workflow',
    label: 'Child',
    workflowId: child.id,
    version: 1,
    mode: 'wait',
    routing: ready,
    outputBindings: { answer: { source: 'input', path: 'value' } },
  });
  const run = await done(engine, start(engine, definition(node)).id);
  expect(run.status).toBe('completed');
  expect(run.output).toEqual({ answer: 42 });
  expect(run.executions[1].port).toBe('yes');
});
it('rejects unsupported routing, lifecycle port collisions and excessive nesting', () => {
  const bad = script({
    routing: {
      path: '',
      cases: [{ port: 'failed', equals: true }],
      default: 'no',
    },
    onFailure: 'route',
  });
  expect(() => validateDefinition(definition(bad))).toThrow('unique');
  const detached = nodeSchema.parse({
    id: 'agent',
    kind: 'workflow',
    label: 'Detached',
    workflowId: 'child',
    version: 1,
    mode: 'detached',
    routing: ready,
  });
  expect(() => validateDefinition(definition(detached))).toThrow(
    'waited Workflow',
  );
  let fields: any = { leaf: { source: 'literal', value: 1 } };
  for (let i = 0; i < 12; i++)
    fields = { nested: { source: 'object', fields } };
  expect(() => script({ inputBindings: fields })).toThrow('10 nested');
});

it('keeps timeout routes on the original input without applying result settings', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const { engine } = setup();
    const node = nodeSchema.parse({
      id: 'agent',
      kind: 'agent',
      label: 'Optional reply',
      prompt: 'Reply',
      unclaimedTimeoutMs: 1,
      routing: ready,
      outputSchema: { type: 'object', required: ['ready'] },
      outputBindings: { x: { source: 'input', path: 'not-there' } },
    });
    const d = definition(node);
    d.edges.push({
      id: 'timeout',
      source: 'agent',
      port: 'timeout',
      target: 'exit',
    });
    const run = start(engine, d, { original: true });
    vi.setSystemTime(Date.now() + 2);
    engine.pump();
    const completed = engine.run(run.id);
    expect(completed.status).toBe('completed');
    expect(completed.output).toEqual({ original: true });
    expect(completed.executions[1]).toMatchObject({ port: 'timeout' });
    expect(completed.executions[1]).not.toHaveProperty('result');
  } finally {
    vi.useRealTimers();
  }
});
it('routes a Fetch response and forwards selected body fields', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ready: true, value: 7 }), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  const { engine } = setup();
  const node = nodeSchema.parse({
    id: 'agent',
    kind: 'fetch',
    label: 'Fetch',
    url: 'https://example.invalid',
    routing: { ...ready, path: 'body.ready' },
    outputBindings: { answer: { source: 'input', path: 'body.value' } },
  });
  const run = await done(engine, start(engine, definition(node)).id);
  expect(run.status).toBe('completed');
  expect(run.output).toEqual({ answer: 7 });
  expect(run.executions[1]).toMatchObject({
    port: 'yes',
    result: { body: { ready: true, value: 7 } },
  });
});

it('reports output-mapping diagnostics without consuming the claim', () => {
  const { engine, store } = setup();
  const node = nodeSchema.parse({
    id: 'agent',
    kind: 'agent',
    label: 'Review',
    prompt: 'Return a result',
    outputBindings: { config: { source: 'runInput', path: 'missing' } },
  });
  const run = start(engine, definition(node)),
    work = engine.available(run.id)[0],
    claim = engine.claim(work.id, {
      workerId: 'test',
      freshContext: false,
      tools: [],
      skills: [],
    });
  expect(engine.preflightResult(work.id, claim.token!, {})).toMatchObject({
    code: 'invalid_result',
    claimUsable: true,
    nextAction: 'inspect_work',
    diagnostics: { items: [{ schemaPath: '#/outputBindings' }] },
  });
  expect(store.get('work', work.id)).toMatchObject({ status: 'claimed' });
});
it('validates input and output scopes independently when their target names overlap', () => {
  const node = script({
    inputBindings: {
      same: {
        source: 'object',
        fields: { item: { source: 'itemInput', path: '' } },
      },
    },
    outputBindings: { same: { source: 'literal', value: 1 } },
  });
  expect(() => validateDefinition(definition(node))).toThrow(
    'Batch membership',
  );
  expect(() =>
    resolveBindingFields(
      { value: { source: 'input', path: 'absent', default: undefined } },
      () => ({}),
    ),
  ).toThrow('no path');
});

it('retains pending mapped Agent work and raw results across an engine restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'interlock-node-results-')),
    path = join(directory, 'test.db');
  let store = new Store(path),
    engine = new Engine(store, process.cwd());
  try {
    const node = nodeSchema.parse({
      id: 'agent',
      kind: 'agent',
      label: 'Review',
      prompt: 'Return readiness',
      routing: ready,
      outputBindings: {
        context: {
          source: 'object',
          fields: { request: { source: 'runInput', path: 'request' } },
        },
        value: { source: 'input', path: 'value', default: null },
      },
    });
    const run = start(engine, definition(node), { request: 'retained' }),
      work = engine.available(run.id)[0],
      claim = engine.claim(work.id, {
        workerId: 'test',
        freshContext: false,
        tools: [],
        skills: [],
      });
    engine.stop();
    store.close();
    store = new Store(path);
    engine = new Engine(store, process.cwd());
    engine.submit(work.id, claim.token!, { ready: true, value: 0 });
    const completed = engine.run(run.id);
    expect(completed.output).toEqual({
      context: { request: 'retained' },
      value: 0,
    });
    expect(completed.executions[1]).toMatchObject({
      port: 'yes',
      result: { ready: true, value: 0 },
    });
    engine.stop();
    store.close();
    store = new Store(path);
    engine = new Engine(store, process.cwd());
    expect(
      engine.continuation.result({
        id: run.id,
        executionId: completed.executions[1].id,
        field: 'result',
      }).value,
    ).toEqual({ ready: true, value: 0 });
  } finally {
    engine.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
