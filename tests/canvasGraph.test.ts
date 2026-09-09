import { expect, it } from 'vitest';
import {
  canvasGraph,
  withoutNodes,
} from '../packages/ui/src/features/workflows/canvasGraph';
import { nestedBatches, batchDefinition } from './fixtures/batch';

it('renders nested groups parent-first with relative positions and explicit End edges', () => {
  const d = nestedBatches(2);
  d.nodes.find((n) => n.id === 'work')!.position = { x: 140, y: 160 };
  const graph = canvasGraph(d);
  const ids = graph.nodes.map((n) => n.id);
  expect(ids.indexOf('batch')).toBeLessThan(ids.indexOf('batch1'));
  expect(ids.indexOf('batch1')).toBeLessThan(ids.indexOf('work'));
  expect(graph.nodes.find((n) => n.id === 'work')).toMatchObject({
    parentId: 'batch1',
    position: { x: 140, y: 160 },
    extent: 'parent',
  });
  expect(graph.nodes.find((n) => n.id === 'batch1')).toMatchObject({
    parentId: 'batch',
  });
  expect(graph.nodes.find((n) => n.id === 'batch')!.width).toBeGreaterThan(
    graph.nodes.find((n) => n.id === 'batch1')!.width!,
  );
});
it('collapses all descendants without hiding the outer continuation or changing the graph', () => {
  const d = nestedBatches(2),
    original = structuredClone(d);
  const graph = canvasGraph(d, { collapsed: new Set(['batch']) });
  expect(
    graph.nodes
      .filter((n) => n.hidden)
      .map((n) => n.id)
      .sort(),
  ).toEqual(['batch1', 'work']);
  expect(graph.edges.filter((e) => !e.hidden).map((e) => e.id)).toEqual([
    'in',
    'complete',
  ]);
  expect(d).toEqual(original);
});
it('deleting a group removes descendants and incident edges but keeps outer nodes', () => {
  const d = withoutNodes(nestedBatches(3), new Set(['batch']));
  expect(d.nodes.map((n) => n.id)).toEqual(['entry', 'exit']);
  expect(d.edges).toEqual([]);
});
it('renders incomplete and circular drafts safely without redundant edge labels', () => {
  const d = batchDefinition();
  d.nodes.find((n) => n.id === 'batch')!.batchId = 'batch';
  expect(() => canvasGraph(d)).not.toThrow();
  const graph = canvasGraph(batchDefinition());
  expect(graph.edges.every((e) => e.label === undefined)).toBe(true);
  expect(graph.edges.find((e) => e.id === 'end')).toMatchObject({
    targetHandle: 'end',
  });
});

it('supplies shared workflow contracts to Entry and Exit cards', () => {
  const definition = batchDefinition();
  definition.inputSchema = { type: 'array' };
  definition.outputSchema = { type: 'string' };
  const graph = canvasGraph(definition);
  expect(
    graph.nodes.find((n) => n.id === 'entry')?.data.boundarySchema,
  ).toEqual({ type: 'array' });
  expect(graph.nodes.find((n) => n.id === 'exit')?.data.boundarySchema).toEqual(
    { type: 'string' },
  );
});
