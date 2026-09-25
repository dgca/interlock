import { afterEach, expect, it } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  definitionSchema,
  nodeSchema,
  validateDefinition,
  type Json,
} from '@interlock/core';
import { switchDefinition } from './fixtures/switch';
import { batchDefinition } from './fixtures/batch';
import { parseRawDefinition } from '../packages/ui/src/features/workflows/rawDefinition';

const stores: Store[] = [];
function setup(definition = switchDefinition()) {
  const store = new Store(':memory:');
  stores.push(store);
  const engine = new Engine(store, process.cwd());
  const workflow = engine.create('Switch test', '', definition);
  engine.publish(workflow.id);
  return { engine, workflow };
}
afterEach(() => stores.splice(0).forEach((store) => store.close()));

it.each([
  ['investigate', 'investigate'],
  ['ticket', 'ticket'],
  ['assets-intake', 'assets'],
  ['unknown', 'none'],
])('routes %s through %s and preserves the input', (value, port) => {
  const { engine, workflow } = setup();
  const input = { next: { workflow: value }, payload: [1, 2] };
  const run = engine.start(workflow.id, input).run;
  expect(run.status).toBe('completed');
  expect(run.output).toEqual(input);
  expect(
    run.executions.find((execution) => execution.nodeId === 'route'),
  ).toMatchObject({ port, input, output: input });
});

it.each<Json>([null, false, 0, ['a', { x: 1 }], { a: 1, b: 2 }])(
  'uses structural equality and the first matching case for %j',
  (value) => {
    const definition = switchDefinition();
    const node = definition.nodes[1];
    if (node.kind !== 'switch') throw new Error('Expected Switch');
    node.path = '';
    node.cases[0].equals = value;
    node.cases[1].equals = value;
    const { engine, workflow } = setup(definition);
    const run = engine.start(
      workflow.id,
      value && !Array.isArray(value) && typeof value === 'object'
        ? { b: 2, a: 1 }
        : value,
    ).run;
    expect(run.status).toBe('completed');
    expect(run.executions[1].port).toBe('investigate');
  },
);

it('does not coerce values or turn missing paths into the default route', () => {
  const { engine, workflow } = setup();
  expect(
    engine.start(workflow.id, { next: { workflow: 1 } }).run.executions[1].port,
  ).toBe('none');
  const run = engine.start(workflow.id, {}).run;
  expect(run.status).toBe('failed');
  expect(run.error).toContain('Input has no path');
});

it('can save incomplete Switch drafts, including empty or duplicate ports, but cannot publish them', () => {
  for (const value of ['', 'ticket', 'none']) {
    const definition = switchDefinition();
    const node = definition.nodes[1];
    if (node.kind !== 'switch') throw new Error('Expected Switch');
    node.cases[0].port = value;
    const raw = parseRawDefinition(JSON.stringify(definition));
    expect(raw.error).toBeUndefined();
    expect(raw.publishError).toMatch(/port names/);
  }
  const definition = switchDefinition();
  definition.edges = [];
  expect(definitionSchema.parse(definition)).toEqual(definition);
  expect(() => validateDefinition(definition)).toThrow(
    'expected outgoing routes',
  );
});

it.each(['missing-default', 'missing-case', 'extra', 'duplicate'])(
  'rejects %s routes at publication',
  (problem) => {
    const definition = switchDefinition();
    if (problem === 'missing-default') definition.edges.pop();
    if (problem === 'missing-case') definition.edges.splice(1, 1);
    if (problem === 'extra' || problem === 'duplicate')
      definition.edges.push({
        id: 'extra',
        source: 'route',
        target: 'exit',
        port: problem === 'extra' ? 'unknown' : 'ticket',
      });
    expect(() => validateDefinition(definition)).toThrow(
      'expected outgoing routes',
    );
  },
);

it('still rejects arbitrary ports on ordinary nodes', () => {
  const definition = switchDefinition();
  definition.edges[0].port = 'investigate';
  expect(() => validateDefinition(definition)).toThrow(
    'expected outgoing routes default',
  );
});

it('supports a default-only Switch', () => {
  const definition = switchDefinition();
  const node = definition.nodes[1];
  if (node.kind !== 'switch') throw new Error('Expected Switch');
  node.cases = [];
  definition.edges = definition.edges.filter(
    (edge) => edge.source !== 'route' || edge.port === 'none',
  );
  const { engine, workflow } = setup(definition);
  expect(
    engine.start(workflow.id, { next: { workflow: 'anything' } }).run
      .executions[1].port,
  ).toBe('none');
});

it('routes on bound earlier-node output and passes the resolved input through', () => {
  const definition = switchDefinition();
  definition.nodes.splice(
    1,
    0,
    nodeSchema.parse({
      id: 'manager',
      kind: 'agent',
      label: 'Manager',
      prompt: 'Pick a specialist',
    }),
  );
  definition.edges[0].target = 'manager';
  definition.edges.push({
    id: 'manager-route',
    source: 'manager',
    target: 'route',
    port: 'default',
  });
  const node = definition.nodes[2];
  if (node.kind !== 'switch') throw new Error('Expected Switch');
  node.path = 'selected';
  node.inputBindings = {
    selected: { source: 'node', nodeId: 'manager', path: 'next.workflow' },
    original: { source: 'runInput', path: '' },
  };
  const { engine, workflow } = setup(definition);
  const run = engine.start(workflow.id, { request: 'help' }).run;
  const work = engine.available(run.id)[0];
  const claim = engine.claim(work.id, {
    workerId: 'test',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.submit(work.id, claim.token!, { next: { workflow: 'ticket' } });
  const finished = engine.inspect(run.id).run;
  expect(finished.output).toEqual({
    selected: 'ticket',
    original: { request: 'help' },
  });
  expect(
    finished.executions.find((execution) => execution.nodeId === 'route')?.port,
  ).toBe('ticket');
});

it.each(['item', 'timeout', 'complete', 'default', 'true', 'end'])(
  'handles a Switch case named %s inside a Batch',
  (port) => {
    const node = nodeSchema.parse({
      id: 'route',
      kind: 'switch',
      label: 'Route item',
      path: '',
      cases: [{ port, equals: 1 }],
      default: 'fallback',
    });
    const definition = batchDefinition(node);
    definition.edges.find((edge) => edge.source === 'route')!.port = port;
    definition.edges.push({
      id: 'fallback',
      source: 'route',
      port: 'fallback',
      target: 'batch',
      targetHandle: 'end',
    });
    const { engine, workflow } = setup(definition);
    const run = engine.start(workflow.id, [1, 2]).run;
    expect(run.status).toBe('completed');
    expect(run.output).toEqual([1, 2]);
    expect(
      engine.inspect(run.id).children.map((child) => child.executions[0].port),
    ).toEqual([port, 'fallback']);
    definition.edges.find((edge) => edge.source === 'route')!.target = 'route';
    delete definition.edges.find((edge) => edge.source === 'route')!
      .targetHandle;
    expect(() => validateDefinition(definition)).toThrow('Item path cycles');
  },
);

it('validates the Switch output contract even when the case is named timeout', () => {
  const definition = switchDefinition();
  const node = definition.nodes[1];
  if (node.kind !== 'switch') throw new Error('Expected Switch');
  node.cases[0].port = 'timeout';
  node.outputSchema = { type: 'string' };
  definition.edges[1].port = 'timeout';
  const { engine, workflow } = setup(definition);
  expect(
    engine.start(workflow.id, { next: { workflow: 'investigate' } }).run.status,
  ).toBe('failed');
});

it('bounds workflow-level Switch loops with maxSteps', () => {
  const definition = switchDefinition();
  definition.maxSteps = 4;
  definition.edges[1].target = 'route';
  const { engine, workflow } = setup(definition);
  const run = engine.start(workflow.id, {
    next: { workflow: 'investigate' },
  }).run;
  expect(run.status).toBe('failed');
  expect(run.error).toMatch(/step.*limit|step.*budget/i);
});
