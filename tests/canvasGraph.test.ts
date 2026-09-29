import { expect, it } from 'vitest';
import { definitionSchema, nodeSchema } from '@interlock/core';
import {
  canvasGraph,
  withoutNodes,
} from '../packages/ui/src/features/workflows/canvasGraph';
import { nestedBatches, batchDefinition } from './fixtures/batch';

function placedNode(id: string, x: number, y: number) {
  return nodeSchema.parse({
    id,
    kind: 'script',
    label: id,
    language: 'javascript',
    command: 'return input;',
    position: { x, y },
  });
}

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
it('emphasizes only edges that still exist and remain visible', () => {
  const definition = batchDefinition();
  const selectedEdges = new Set(['in']);
  const selected = canvasGraph(definition, { selectedEdges });
  const entryClass = selected.nodes.find(
    (node) => node.id === 'entry',
  )?.className;
  expect(entryClass).toBeTruthy();
  expect(selected.nodes.find((node) => node.id === 'batch')?.className).toBe(
    entryClass,
  );
  expect(selected.nodes.find((node) => node.id === 'exit')?.className).not.toBe(
    entryClass,
  );
  expect(
    selected.edges.find((edge) => edge.id === 'in')?.className,
  ).toBeUndefined();
  expect(
    selected.edges.find((edge) => edge.id === 'complete')?.className,
  ).toBeTruthy();

  const removed = canvasGraph(
    {
      ...definition,
      edges: definition.edges.filter((edge) => edge.id !== 'in'),
    },
    { selectedEdges },
  );
  expect(removed.nodes.every((node) => node.className === undefined)).toBe(
    true,
  );
  expect(removed.edges.every((edge) => edge.className === undefined)).toBe(
    true,
  );

  const collapsed = canvasGraph(definition, {
    selectedEdges: new Set(['item']),
    collapsed: new Set(['batch']),
  });
  expect(collapsed.nodes.every((node) => node.className === undefined)).toBe(
    true,
  );
  expect(collapsed.edges.every((edge) => edge.className === undefined)).toBe(
    true,
  );
});
it('keeps overlapping backward edges on separate lanes', () => {
  const definition = definitionSchema.parse({
    nodes: [
      placedNode('target-a', 0, 24),
      placedNode('source-a', 1400, 24),
      placedNode('target-b', 400, 0),
      placedNode('source-b', 900, 0),
    ],
    edges: [
      { id: 'a', source: 'source-a', target: 'target-a' },
      { id: 'b', source: 'source-b', target: 'target-b' },
      { id: 'forward', source: 'target-a', target: 'source-a' },
    ],
  });
  const graph = canvasGraph(definition, { selectedEdges: new Set(['a']) });
  const a = graph.edges.find((edge) => edge.id === 'a')!;
  const b = graph.edges.find((edge) => edge.id === 'b')!;
  const forward = graph.edges.find((edge) => edge.id === 'forward')!;
  expect(a.type).toBe('loop');
  expect(b.type).toBe('loop');
  expect(forward.type).toBeUndefined();
  expect(a.selected).toBe(true);
  expect(b.className).toBe('edge-dimmed');
  const aY = (a.data as { laneY: number }).laneY;
  const bY = (b.data as { laneY: number }).laneY;
  expect(Math.abs(aY - bY)).toBeGreaterThanOrEqual(24);
});
it('keeps loop verticals in the free gaps beside their endpoints', () => {
  const definition = definitionSchema.parse({
    nodes: [
      placedNode('target', 0, 0),
      placedNode('source', 500, 0),
      placedNode('right-neighbor', 730, 100),
      placedNode('left-neighbor', -230, 100),
    ],
    edges: [{ id: 'loop', source: 'source', target: 'target' }],
  });
  const graph = canvasGraph(definition);
  const edge = graph.edges.find((item) => item.id === 'loop')!;
  const offsets = edge.data as { outOffset: number; inOffset: number };
  const source = graph.nodes.find((node) => node.id === 'source')!;
  const target = graph.nodes.find((node) => node.id === 'target')!;
  const right = graph.nodes.find((node) => node.id === 'right-neighbor')!;
  const left = graph.nodes.find((node) => node.id === 'left-neighbor')!;
  expect(edge.type).toBe('loop');
  expect(offsets.outOffset).toBeGreaterThan(0);
  expect(offsets.inOffset).toBeGreaterThan(0);
  expect(source.position.x + source.width! + offsets.outOffset).toBeLessThan(
    right.position.x,
  );
  expect(target.position.x - offsets.inOffset).toBeGreaterThan(
    left.position.x + left.width!,
  );
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

it('shows each binding source once, retains missing references, and sizes nodes for labels', () => {
  const definition = batchDefinition();
  const batch = definition.nodes.find((n) => n.id === 'batch')!;
  batch.inputBindings = {
    one: { source: 'node', nodeId: 'batch', path: '' },
    two: { source: 'node', nodeId: 'batch', path: 'two' },
    gone: { source: 'node', nodeId: 'missing', path: '' },
  };
  const focused: string[] = [];
  const graph = canvasGraph(definition, {
    onFocusNode: (id) => focused.push(id),
    collapsed: new Set(['batch']),
  });
  const canvas = graph.nodes.find((n) => n.id === 'batch')!;
  expect(canvas.data.bindingSources).toHaveLength(2);
  expect(canvas.data.bindingSources![1]).toMatchObject({
    id: 'missing',
    missing: true,
    onFocus: undefined,
  });
  canvas.data.bindingSources![0].onFocus!();
  expect(focused).toEqual(['batch']);
  expect(canvas.height).toBe(116 + 44);
});
