import { expect, it } from 'vitest';
import {
  blankDefinition,
  definitionSchema,
  nodeSchema,
  type WorkflowDefinition,
} from '@interlock/core';
import { canvasGraph } from '../packages/ui/src/features/workflows/canvasGraph';
import {
  BATCH_INSET,
  CANVAS_GAP,
} from '../packages/ui/src/features/workflows/canvasGeometry';
import {
  newNodePosition,
  separateNodes,
  tidyWorkflow,
} from '../packages/ui/src/features/workflows/workflowLayout';
import { nestedBatches } from './fixtures/batch';

function assertClear(definition: WorkflowDefinition) {
  const nodes = canvasGraph(definition).nodes;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    expect(Number.isFinite(a.position.x) && Number.isFinite(a.position.y)).toBe(
      true,
    );
    if (a.parentId) {
      const parent = nodes.find((n) => n.id === a.parentId)!;
      expect(a.position.x).toBeGreaterThanOrEqual(BATCH_INSET.left);
      expect(a.position.y).toBeGreaterThanOrEqual(BATCH_INSET.top);
      expect(a.position.x + a.width! + BATCH_INSET.right).toBeLessThanOrEqual(
        parent.width!,
      );
      expect(a.position.y + a.height! + BATCH_INSET.bottom).toBeLessThanOrEqual(
        parent.height!,
      );
    }
    for (const b of nodes.slice(i + 1)) {
      if (a.parentId !== b.parentId) continue;
      const gapX = Math.max(
        b.position.x - a.position.x - a.width!,
        a.position.x - b.position.x - b.width!,
      );
      const gapY = Math.max(
        b.position.y - a.position.y - a.height!,
        a.position.y - b.position.y - b.height!,
      );
      expect(
        Math.max(gapX, gapY),
        `${a.id} overlaps ${b.id}`,
      ).toBeGreaterThanOrEqual(CANVAS_GAP - 0.001);
    }
  }
}
const semantics = (definition: WorkflowDefinition) => ({
  ...definition,
  nodes: definition.nodes.map(({ position, ...node }) => node),
});

function forkDefinition() {
  const ports = ['investigate', 'ticket', 'assets', 'fallback'];
  return definitionSchema.parse({
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      {
        id: 'switch',
        kind: 'switch',
        label: 'Route',
        path: 'route',
        cases: ports.slice(0, 3).map((port) => ({ port, equals: port })),
        default: 'fallback',
      },
      ...ports.map((id) => ({
        id,
        kind: 'script',
        label: id,
        language: 'javascript',
        command: 'return input;',
      })),
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'start', source: 'entry', target: 'switch' },
      ...ports.flatMap((port) => [
        { id: `route-${port}`, source: 'switch', port, target: port },
        { id: `finish-${port}`, source: port, target: 'exit' },
      ]),
    ],
  });
}

it.each([false, true])(
  'orders Switch branches by handles regardless of edge order: reversed=%s',
  (reversed) => {
    const ports = ['investigate', 'ticket', 'assets', 'fallback'];
    const definition = forkDefinition();
    if (reversed) definition.edges.reverse();
    const tidy = tidyWorkflow(definition);
    expect(
      tidy.nodes
        .filter((n) => ports.includes(n.id))
        .sort((a, b) => a.position.y - b.position.y)
        .map((n) => n.id),
    ).toEqual(ports);
    assertClear(tidy);
    expect(semantics(tidy)).toEqual(semantics(definition));
    expect(tidyWorkflow(tidy)).toEqual(tidy);
  },
);

it.each(['condition', 'agent'])('respects %s branch order', (kind) => {
  const definition = forkDefinition();
  const ports =
    kind === 'condition' ? ['true', 'false'] : ['default', 'timeout'];
  definition.nodes[1] = nodeSchema.parse({
    id: 'switch',
    kind,
    label: 'Branch',
    path: '',
    equals: true,
    prompt: 'Choose',
    unclaimedTimeoutMs: 1000,
  });
  definition.nodes = definition.nodes.filter(
    (node) => !['assets', 'fallback'].includes(node.id),
  );
  definition.edges = definition.edges.filter(
    (edge) =>
      !['assets', 'fallback'].includes(edge.source) &&
      !['assets', 'fallback'].includes(edge.target),
  );
  definition.edges
    .filter((edge) => edge.source === 'switch')
    .forEach((edge, index) => {
      edge.port = ports[index];
    });
  const tidy = tidyWorkflow(definition);
  expect(
    tidy.nodes.find((node) => node.id === 'investigate')!.position.y,
  ).toBeLessThan(tidy.nodes.find((node) => node.id === 'ticket')!.position.y);
  assertClear(tidy);
});

it('keeps multi-step branches aligned through their join', () => {
  const definition = forkDefinition();
  const ports = ['investigate', 'ticket', 'assets', 'fallback'];
  for (const port of ports) {
    const next = `${port}-next`;
    definition.nodes.push(
      nodeSchema.parse({
        id: next,
        kind: 'script',
        label: next,
        command: 'return input;',
        language: 'javascript',
      }),
    );
    definition.edges.find((edge) => edge.source === port)!.target = next;
    definition.edges.push({
      id: next,
      source: next,
      target: 'exit',
      port: 'default',
    });
  }
  const tidy = tidyWorkflow(definition);
  for (const ids of [ports, ports.map((port) => `${port}-next`)]) {
    expect(
      tidy.nodes
        .filter((node) => ids.includes(node.id))
        .sort((a, b) => a.position.y - b.position.y)
        .map((node) => node.id),
    ).toEqual(ids);
  }
  assertClear(tidy);
  expect(tidyWorkflow(tidy)).toEqual(tidy);
});

it('orders branches inside a Batch and preserves spacing for unequal heights', () => {
  const definition = forkDefinition();
  const switchNode = definition.nodes.find((node) => node.id === 'switch')!;
  switchNode.inputBindings = {
    data: { source: 'node', nodeId: 'investigate', path: '' },
  };
  const tall = definition.nodes.find((node) => node.id === 'ticket')!;
  tall.inputBindings = {
    a: { source: 'node', nodeId: 'assets', path: '' },
    b: { source: 'node', nodeId: 'fallback', path: '' },
  };
  for (const node of definition.nodes)
    if (node.kind !== 'entry' && node.kind !== 'exit') node.batchId = 'batch';
  definition.nodes.push(
    nodeSchema.parse({ id: 'batch', kind: 'batch', label: 'Batch' }),
  );
  definition.edges[0].target = 'batch';
  definition.edges.push(
    { id: 'item', source: 'batch', port: 'item', target: 'switch' },
    { id: 'complete', source: 'batch', port: 'complete', target: 'exit' },
  );
  for (const edge of definition.edges)
    if (edge.target === 'exit' && edge.source !== 'batch') {
      edge.target = 'batch';
      edge.targetHandle = 'end';
    }
  const tidy = tidyWorkflow(definition);
  expect(
    tidy.nodes
      .filter((node) => node.kind === 'script')
      .sort((a, b) => a.position.y - b.position.y)
      .map((node) => node.id),
  ).toEqual(['investigate', 'ticket', 'assets', 'fallback']);
  assertClear(tidy);
  expect(semantics(tidy)).toEqual(semantics(definition));
  expect(tidyWorkflow(tidy)).toEqual(tidy);
});

it('tidies nested Batches using their expanded bounds and changes only positions', () => {
  const original = nestedBatches(4);
  const before = structuredClone(original);
  const tidy = tidyWorkflow(original);
  assertClear(tidy);
  expect(semantics(tidy)).toEqual(semantics(original));
  expect(original).toEqual(before);
  expect(tidyWorkflow(tidy)).toEqual(tidy);
  const nodes = canvasGraph(tidy).nodes;
  const entry = nodes.find((n) => n.id === 'entry')!;
  const batch = nodes.find((n) => n.id === 'batch')!;
  const exit = nodes.find((n) => n.id === 'exit')!;
  expect(batch.position.x).toBeGreaterThan(entry.position.x + entry.width!);
  expect(exit.position.x).toBeGreaterThan(batch.position.x + batch.width!);
});

it('separates forks, joins, disconnected nodes, loops, and incomplete routes', () => {
  const definition = blankDefinition();
  definition.nodes.push(
    ...['left', 'right', 'join', 'unconnected'].map((id) =>
      nodeSchema.parse({
        id,
        kind: 'condition',
        label: id,
        path: 'ok',
        equals: true,
      }),
    ),
  );
  definition.edges = [
    { id: 'start', source: 'entry', target: 'agent', port: 'default' },
    { id: 'left', source: 'agent', target: 'left', port: 'true' },
    { id: 'right', source: 'agent', target: 'right', port: 'false' },
    { id: 'joinLeft', source: 'left', target: 'join', port: 'default' },
    { id: 'joinRight', source: 'right', target: 'join', port: 'default' },
    { id: 'loop', source: 'join', target: 'agent', port: 'true' },
    { id: 'finish', source: 'join', target: 'exit', port: 'false' },
    { id: 'missing', source: 'left', target: 'missing', port: 'false' },
  ];
  const tidy = tidyWorkflow(definition);
  assertClear(tidy);
  expect(semantics(tidy)).toEqual(semantics(definition));
  expect(tidyWorkflow(tidy)).toEqual(tidy);
});

it('makes room among outer siblings when an added child widens a Batch', () => {
  const original = tidyWorkflow(nestedBatches(2));
  const added = nodeSchema.parse({
    id: 'newBatch',
    kind: 'batch',
    label: 'New batch',
    batchId: 'batch1',
  });
  added.position = newNodePosition(original, added);
  const withNode = { ...original, nodes: [...original.nodes, added] };
  const repaired = separateNodes(withNode);
  assertClear(repaired);
  expect(semantics(repaired)).toEqual(semantics(withNode));
  expect(
    repaired.nodes.find((n) => n.id === 'exit')!.position.x,
  ).toBeGreaterThan(original.nodes.find((n) => n.id === 'exit')!.position.x);
});

it('handles circular and missing Batch ownership without changing membership', () => {
  const definition = nestedBatches(2);
  definition.nodes.find((n) => n.id === 'batch')!.batchId = 'batch1';
  definition.nodes.find((n) => n.id === 'work')!.batchId = 'missing';
  const tidy = tidyWorkflow(definition);
  assertClear(tidy);
  expect(semantics(tidy)).toEqual(semantics(definition));
});

it('leaves generous gaps for deterministic varied graph shapes', () => {
  let seed = 37;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let sample = 0; sample < 30; sample++) {
    const definition = nestedBatches(1 + (sample % 3));
    for (let i = 0; i < 12; i++) {
      const batches = definition.nodes.filter((n) => n.kind === 'batch');
      definition.nodes.push(
        nodeSchema.parse({
          id: `n${i}`,
          kind: i % 4 === 0 ? 'batch' : 'script',
          label: `n${i}`,
          command: 'return input;',
          batchId:
            random() < 0.6
              ? batches[Math.floor(random() * batches.length)].id
              : undefined,
        }),
      );
    }
    for (let i = 0; i < 20; i++) {
      const source =
        definition.nodes[Math.floor(random() * definition.nodes.length)];
      const target =
        definition.nodes[Math.floor(random() * definition.nodes.length)];
      definition.edges.push({
        id: `e${i}`,
        source: source.id,
        target: target.id,
        port: 'default',
      });
    }
    const tidy = tidyWorkflow(definition);
    assertClear(tidy);
    expect(semantics(tidy)).toEqual(semantics(definition));
  }
});
