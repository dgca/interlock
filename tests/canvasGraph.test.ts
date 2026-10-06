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
  const hovered = canvasGraph(d, {
    collapsed: new Set(['batch']),
    hovered: 'batch',
  });
  expect(hovered.edges.find((edge) => edge.id === 'item')?.className).toBe(
    'dimmed',
  );
  expect(
    hovered.nodes.find((node) => node.id === 'batch')?.data.activePorts,
  ).not.toContain('source:item');
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
  expect(collapsed.nodes.every((node) => !node.data.activePorts?.length)).toBe(
    true,
  );
});
it('traces a hovered or singly selected node through its visible edges and ports', () => {
  const definition = definitionSchema.parse({
    nodes: [
      placedNode('a', 0, 0),
      placedNode('b', 300, 0),
      placedNode('c', 600, 0),
      placedNode('d', 900, 0),
    ],
    edges: [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'bc', source: 'b', target: 'c' },
      { id: 'cd', source: 'c', target: 'd' },
    ],
  });
  const hovered = canvasGraph(definition, { hovered: 'b' });
  expect(hovered.edges.map((edge) => edge.className)).toEqual([
    'highlighted',
    'highlighted',
    'dimmed',
  ]);
  const node = (id: string) => hovered.nodes.find((item) => item.id === id)!;
  expect(node('a').className).toBe(node('b').className);
  expect(node('c').className).toBe(node('b').className);
  expect(node('d').className).not.toBe(node('b').className);
  expect(node('a').data.activePorts).toEqual(['source:default']);
  expect(node('b').data.activePorts).toEqual([
    'target:default',
    'source:default',
  ]);
  expect(node('c').data.activePorts).toEqual(['target:default']);
  expect(node('d').data.activePorts).toEqual([]);

  const selected = canvasGraph(definition, { selected: new Set(['b']) });
  expect(selected.edges.map((edge) => edge.className)).toEqual(
    hovered.edges.map((edge) => edge.className),
  );
  const multiple = canvasGraph(definition, { selected: new Set(['b', 'c']) });
  expect(multiple.edges.every((edge) => edge.className === undefined)).toBe(
    true,
  );
  const inspecting = canvasGraph(definition, { selected: 'b' });
  expect(inspecting.edges.every((edge) => edge.className === undefined)).toBe(
    true,
  );
});
it('keeps selected-edge emphasis ahead of hover and ignores stale hover IDs', () => {
  const definition = definitionSchema.parse({
    nodes: [
      placedNode('a', 0, 0),
      placedNode('b', 300, 0),
      placedNode('c', 600, 0),
    ],
    edges: [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'bc', source: 'b', target: 'c' },
    ],
  });
  const graph = canvasGraph(definition, {
    selectedEdges: new Set(['ab']),
    hovered: 'c',
  });
  expect(graph.edges.find((edge) => edge.id === 'ab')).toMatchObject({
    selected: true,
    className: undefined,
  });
  expect(graph.edges.find((edge) => edge.id === 'bc')?.className).toBe(
    'edge-dimmed',
  );
  expect(graph.nodes.find((node) => node.id === 'c')?.data.activePorts).toEqual(
    [],
  );
  expect(graph.nodes.find((node) => node.id === 'b')?.data.activePorts).toEqual(
    ['target:default'],
  );
  const stale = canvasGraph(definition, {
    selected: new Set(['b']),
    hovered: 'removed',
  });
  expect(stale.edges.find((edge) => edge.id === 'ab')?.className).toBe(
    'highlighted',
  );
});
it('colors only exception edges until they are selected', () => {
  const definition = definitionSchema.parse({
    nodes: [
      nodeSchema.parse({
        id: 'condition',
        kind: 'condition',
        label: 'Condition',
        path: 'ok',
        equals: true,
      }),
      nodeSchema.parse({
        id: 'agent',
        kind: 'agent',
        label: 'Agent',
        prompt: 'Do work',
      }),
      placedNode('target-a', 600, 0),
      placedNode('target-b', 900, 0),
    ],
    edges: [
      { id: 'true', source: 'condition', port: 'true', target: 'target-a' },
      { id: 'false', source: 'condition', port: 'false', target: 'target-b' },
      { id: 'timeout', source: 'agent', port: 'timeout', target: 'target-a' },
    ],
  });
  const graph = canvasGraph(definition);
  expect(graph.edges.find((edge) => edge.id === 'true')?.style).toBeUndefined();
  expect(
    graph.edges.find((edge) => edge.id === 'false')?.style,
  ).toBeUndefined();
  expect(graph.edges.find((edge) => edge.id === 'timeout')?.style).toEqual({
    stroke: 'var(--edge-exception)',
  });
  const selected = canvasGraph(definition, {
    selectedEdges: new Set(['timeout']),
  });
  expect(
    selected.edges.find((edge) => edge.id === 'timeout')?.style,
  ).toBeUndefined();
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
  expect(forward.type).not.toBe('loop');
  expect(a.selected).toBe(true);
  expect(b.className).toBe('edge-dimmed');
  const aY = (a.data as { laneY: number }).laneY;
  const bY = (b.data as { laneY: number }).laneY;
  expect(Math.abs(aY - bY)).toBeGreaterThanOrEqual(24);
});
it('sends an overlapping loop to the emptier side and a lone loop below', () => {
  const definition = definitionSchema.parse({
    nodes: [
      placedNode('a', 0, 0),
      placedNode('b', 300, 0),
      placedNode('c', 600, 0),
      placedNode('d', 900, 0),
    ],
    edges: [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'bc', source: 'b', target: 'c' },
      { id: 'cd', source: 'c', target: 'd' },
      { id: 'outer', source: 'd', target: 'a' },
      { id: 'inner', source: 'c', target: 'b' },
    ],
  });
  const laneY = (graph: ReturnType<typeof canvasGraph>, id: string) =>
    (graph.edges.find((edge) => edge.id === id)!.data as { laneY: number })
      .laneY;
  const graph = canvasGraph(definition);
  expect(laneY(graph, 'outer')).toBeGreaterThan(116);
  expect(laneY(graph, 'inner')).toBeLessThan(0);
  const lone = canvasGraph({
    ...definition,
    edges: definition.edges.filter((edge) => edge.id !== 'outer'),
  });
  expect(laneY(lone, 'inner')).toBeGreaterThan(116);
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
type Point = { x: number; y: number };
const route = (graph: ReturnType<typeof canvasGraph>, id: string) => {
  const edge = graph.edges.find((item) => item.id === id)!;
  const data = edge.data as { points: Point[] } | undefined;
  return { type: edge.type, points: data?.points ?? [] };
};
const expectClearRoute = (
  graph: ReturnType<typeof canvasGraph>,
  id: string,
) => {
  const edge = graph.edges.find((item) => item.id === id)!;
  const source = graph.nodes.find((node) => node.id === edge.source)!;
  const target = graph.nodes.find((node) => node.id === edge.target)!;
  const routed = route(graph, id);
  expect(routed.type).toBe('ortho');
  const points = [
    {
      x: source.position.x + source.width!,
      y: source.position.y + source.height! / 2,
    },
    ...routed.points,
    { x: target.position.x, y: target.position.y + target.height! / 2 },
  ];
  expect(
    points
      .slice(1)
      .every((point, i) => point.x === points[i].x || point.y === points[i].y),
  ).toBe(true);
  const crossed = graph.nodes.filter(
    (node) =>
      !node.hidden &&
      !node.parentId &&
      node.id !== edge.source &&
      node.id !== edge.target &&
      points.slice(1).some((point, i) => {
        const previous = points[i];
        return (
          node.position.x < Math.max(previous.x, point.x) &&
          node.position.x + node.width! > Math.min(previous.x, point.x) &&
          node.position.y < Math.max(previous.y, point.y) &&
          node.position.y + node.height! > Math.min(previous.y, point.y)
        );
      }),
  );
  expect(crossed.map((node) => node.id)).toEqual([]);
};
it('finds a clear corridor when additional rows block the first detour', () => {
  const graph = canvasGraph(
    definitionSchema.parse({
      nodes: [
        placedNode('source', 0, 0),
        placedNode('blocker', 300, 0),
        placedNode('lower', 300, 120),
        placedNode('lowest', 300, 240),
        placedNode('target', 600, 0),
      ],
      edges: [{ id: 'edge', source: 'source', target: 'target' }],
    }),
  );
  expectClearRoute(graph, 'edge');
});
it.each([500, 120])(
  'routes past cards when a wide Batch at y=%i overlaps their x ranges',
  (batchY) => {
    const graph = canvasGraph(
      definitionSchema.parse({
        nodes: [
          placedNode('source', 0, 0),
          placedNode('blocker', 300, 0),
          placedNode('target', 600, 0),
          nodeSchema.parse({
            id: 'batch',
            kind: 'batch',
            label: 'batch',
            position: { x: 150, y: batchY },
            concurrency: 1,
          }),
        ],
        edges: [{ id: 'edge', source: 'source', target: 'target' }],
      }),
    );
    expectClearRoute(graph, 'edge');
    if (batchY === 120) {
      expect(route(graph, 'edge').points[1].y).toBeLessThan(0);
    }
  },
);
it('routes a spanning forward edge below the row it would cross and keeps same-row neighbors straight', () => {
  const definition = definitionSchema.parse({
    nodes: [
      placedNode('a', 0, 0),
      placedNode('b', 300, 0),
      placedNode('c', 600, 0),
    ],
    edges: [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'bc', source: 'b', target: 'c' },
      { id: 'ac', source: 'a', target: 'c' },
    ],
  });
  const graph = canvasGraph(definition);
  expect(route(graph, 'ab').type).toBeUndefined();
  expect(route(graph, 'bc').type).toBeUndefined();
  const skip = route(graph, 'ac');
  expect(skip.type).toBe('ortho');
  expect(skip.points.map((point) => point.x)).toEqual([260, 260, 560, 560]);
  expect(skip.points[1].y).toBe(skip.points[2].y);
  expect(skip.points[1].y).toBeGreaterThan(116);
});
it('bends in whichever gap keeps the horizontal run clear of cards', () => {
  const definition = (blockerY: number) =>
    definitionSchema.parse({
      nodes: [
        placedNode('source', 0, 0),
        placedNode('blocker', 300, blockerY),
        placedNode('target', 600, 200),
      ],
      edges: [{ id: 'edge', source: 'source', target: 'target' }],
    });
  const early = route(canvasGraph(definition(200)), 'edge');
  expect(early.type).toBe('ortho');
  expect(early.points.map((point) => point.x)).toEqual([560, 560]);
  const late = route(canvasGraph(definition(0)), 'edge');
  expect(late.points.map((point) => point.x)).toEqual([260, 260]);
  expect(late.points.map((point) => point.y)).toEqual([58, 258]);
});
it('spreads a fan-out across channels in its gap without crossing', () => {
  const definition = definitionSchema.parse({
    nodes: [
      placedNode('source', 0, 300),
      placedNode('top', 300, 0),
      placedNode('high', 300, 150),
      placedNode('low', 300, 450),
      placedNode('bottom', 300, 600),
    ],
    edges: ['top', 'high', 'low', 'bottom'].map((target) => ({
      id: target,
      source: 'source',
      target,
    })),
  });
  const graph = canvasGraph(definition);
  const x = (id: string) => route(graph, id).points[0].x;
  const xs = ['top', 'high', 'bottom', 'low'].map(x);
  expect(xs).toEqual([242, 254, 266, 278]);
  expect(xs.every((value) => value > 220 && value < 300)).toBe(true);
  expect(graph.edges.every((edge) => edge.type === 'ortho')).toBe(true);
});
it('leaves Batch-internal edges on the default type', () => {
  const graph = canvasGraph(batchDefinition());
  expect(graph.edges.find((edge) => edge.id === 'item')?.type).toBeUndefined();
  expect(graph.edges.find((edge) => edge.id === 'end')?.type).toBeUndefined();
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

it('separates successful and timeout handles for polling Waits', async () => {
  const { outputPortTop } =
    await import('../packages/ui/src/features/workflows/portLayout');
  const { nodeSchema } = await import('@interlock/core');
  const node = nodeSchema.parse({
    id: 'poll',
    kind: 'wait',
    label: 'Check',
    timing: {
      kind: 'poll',
      timeoutMs: 1000,
      check: { kind: 'script', command: 'echo true' },
      path: '',
      equals: true,
    },
  });
  expect(outputPortTop(node, 'default')).toBe('35%');
  expect(outputPortTop(node, 'timeout')).toBe('75%');
  if (node.kind === 'wait' && node.timing.kind === 'poll')
    delete node.timing.timeoutMs;
  expect(outputPortTop(node, 'default')).toBe('50%');
});
