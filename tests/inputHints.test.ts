import { expect, it } from 'vitest';
import {
  contractAtPath,
  contractPaths,
  definitionSchema,
  nodeInputHint,
} from '@interlock/core';

const person = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    active: { type: 'boolean' },
    orders: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
        },
      },
    },
  },
};

function graph() {
  return definitionSchema.parse({
    inputSchema: person,
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Start' },
      {
        id: 'script',
        kind: 'script',
        label: 'Prepare',
        command: 'return input;',
        outputSchema: person,
      },
      {
        id: 'switch',
        kind: 'switch',
        label: 'Route',
        path: 'active',
        cases: [{ port: 'yes', equals: true }],
      },
      { id: 'exit', kind: 'exit', label: 'End' },
    ],
    edges: [
      { id: 'one', source: 'entry', target: 'script' },
      { id: 'two', source: 'script', target: 'switch' },
      { id: 'three', source: 'switch', port: 'yes', target: 'exit' },
    ],
  });
}

it('suggests nested paths and derives a node input without storing a contract', () => {
  const definition = graph();
  const node = definition.nodes[2];
  expect(nodeInputHint(definition, node)).toEqual({
    schema: person,
    source: 'Prepare output',
    inferred: true,
  });
  expect(node.inputSchema).toEqual({});
  expect(nodeInputHint(definition, definition.nodes[3]).schema).toEqual(person);
  expect(contractPaths(person)).toContain('orders.0.id');
  expect(contractAtPath(person, 'orders.0.id')).toEqual({ type: 'integer' });
  expect(
    contractPaths({ type: 'object', properties: { draft: null } }),
  ).toEqual(['draft']);
});

it('uses explicit input contracts and projects selected input fields', () => {
  const definition = graph();
  const node = definition.nodes[2];
  expect(
    nodeInputHint(definition, { ...node, inputSchema: { type: 'boolean' } })
      .schema,
  ).toEqual({ type: 'boolean' });
  expect(
    nodeInputHint(definition, {
      ...node,
      inputBindings: {
        customer: { source: 'input', path: 'name' },
        original: { source: 'runInput', path: 'active' },
      },
    }).schema,
  ).toEqual({
    type: 'object',
    properties: { customer: { type: 'string' }, original: { type: 'boolean' } },
    required: ['customer', 'original'],
    additionalProperties: false,
  });
});

it('does not choose one shape for conflicting incoming routes', () => {
  const definition = graph();
  definition.edges.push({
    id: 'other',
    source: 'entry',
    target: 'switch',
    port: 'default',
  });
  definition.inputSchema = { type: 'string' };
  expect(nodeInputHint(definition, definition.nodes[2]).schema).toEqual({});
});

it('uses original input on an Agent timeout route', () => {
  const definition = graph();
  const agent = definitionSchema.parse({
    ...definition,
    nodes: [
      definition.nodes[0],
      {
        id: 'agent',
        kind: 'agent',
        label: 'Ask',
        prompt: '',
        unclaimedTimeoutMs: 1000,
        outputSchema: { type: 'number' },
      },
      definition.nodes[2],
      definition.nodes[3],
    ],
    edges: [
      { id: 'one', source: 'entry', target: 'agent' },
      { id: 'two', source: 'agent', port: 'timeout', target: 'switch' },
    ],
  });
  expect(nodeInputHint(agent, agent.nodes[2]).schema).toEqual(person);
});

it('uses the selected item shape at a Batch Start port', () => {
  const definition = definitionSchema.parse({
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Start' },
      {
        id: 'batch',
        kind: 'batch',
        label: 'Items',
        itemsPath: 'orders',
        inputSchema: person,
      },
      {
        id: 'work',
        kind: 'script',
        batchId: 'batch',
        label: 'Work',
        command: 'return input;',
      },
      { id: 'exit', kind: 'exit', label: 'End' },
    ],
    edges: [
      { id: 'one', source: 'entry', target: 'batch' },
      { id: 'two', source: 'batch', port: 'item', target: 'work' },
    ],
  });
  expect(nodeInputHint(definition, definition.nodes[2]).schema).toEqual({
    type: 'object',
    properties: { id: { type: 'integer' } },
  });
});
