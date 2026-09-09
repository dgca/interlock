import { expect, it } from 'vitest';
import {
  blankDefinition,
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
