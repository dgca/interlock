import { expect, it } from 'vitest';
import { blankDefinition, type WorkflowDefinition } from '@interlock/core';
import { compareWorkflow } from '../packages/ui/src/features/workflows/workflowDiff';

const clone = (value: WorkflowDefinition): WorkflowDefinition =>
  structuredClone(value);

it('shows additions, removals, node fields, routes, and workflow contracts', () => {
  const published = blankDefinition();
  const draft = clone(published);
  const agent = draft.nodes.find((node) => node.kind === 'agent')!;
  const oldAgent = published.nodes.find((node) => node.kind === 'agent')!;
  agent.prompt = 'New instructions';
  agent.context.instructions = 'Use the supplied input';
  agent.outputSchema = {
    type: 'object',
    properties: { result: { type: 'string' } },
  };
  draft.inputSchema = { type: 'object', required: ['name'] };
  draft.outputSchema = { type: 'string' };
  draft.maxSteps = 42;
  draft.nodes.push({ ...oldAgent, id: 'added', label: 'Added agent' });
  draft.nodes = draft.nodes.filter((node) => node.kind !== 'exit');
  draft.edges = draft.edges.filter((edge) => edge.target !== 'exit');
  draft.edges[0].target = 'added';
  draft.edges.push({
    id: 'added-edge',
    source: 'added',
    target: agent.id,
    port: 'default',
  });

  const diff = compareWorkflow(draft, published);
  expect(diff.nodes.map((item) => [item.kind, item.title])).toEqual(
    expect.arrayContaining([
      ['changed', agent.label],
      ['added', 'Added agent'],
      ['removed', 'Return result'],
    ]),
  );
  expect(
    diff.nodes
      .find((item) => item.id === agent.id)
      ?.details.map((detail) => detail.path),
  ).toEqual(
    expect.arrayContaining([
      'prompt',
      'context.instructions',
      'outputSchema.properties',
    ]),
  );
  expect(diff.routes.map((item) => item.kind)).toEqual(
    expect.arrayContaining(['changed', 'removed', 'added']),
  );
  expect(diff.workflow.map((item) => item.title)).toEqual([
    'Input contract',
    'Output contract',
    'Maximum steps',
  ]);
});

it('ignores edge IDs and object key order but reports layout separately', () => {
  const published = blankDefinition();
  published.inputSchema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' } },
  };
  const draft = clone(published);
  draft.inputSchema = {
    properties: { b: { type: 'number' }, a: { type: 'string' } },
    type: 'object',
  };
  draft.edges[0].id = 'different-storage-id';
  draft.edges[0].targetHandle = 'default';
  draft.nodes[1].position.x += 50;

  const diff = compareWorkflow(draft, published);
  expect(diff.nodes).toEqual([]);
  expect(diff.routes).toEqual([]);
  expect(diff.workflow).toEqual([]);
  expect(diff.layout).toHaveLength(1);
  expect(diff.layout[0].details).toEqual([
    expect.objectContaining({ path: 'Position.x' }),
  ]);
});

it('shows first publication and an unchanged published draft', () => {
  const definition = blankDefinition();
  const first = compareWorkflow(definition);
  expect(first.firstPublication).toBe(true);
  expect(first.nodes).toHaveLength(definition.nodes.length);
  expect(first.routes).toHaveLength(definition.edges.length);
  expect(first.workflow).toHaveLength(3);

  const unchanged = compareWorkflow(clone(definition), definition);
  expect(unchanged).toEqual({
    firstPublication: false,
    nodes: [],
    routes: [],
    layout: [],
    workflow: [],
  });
});

it('treats ordered Switch cases as a setting change', () => {
  const published = blankDefinition();
  published.nodes[1] = {
    ...published.nodes[1],
    kind: 'switch',
    path: 'type',
    cases: [
      { port: 'one', equals: 1 },
      { port: 'two', equals: 2 },
    ],
  };
  const draft = clone(published);
  const node = draft.nodes[1];
  if (node.kind !== 'switch') throw new Error('Expected Switch');
  node.cases.reverse();
  expect(compareWorkflow(draft, published).nodes[0].details[0].path).toBe(
    'cases',
  );
});
