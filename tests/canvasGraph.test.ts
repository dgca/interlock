import { expect, it } from 'vitest';
import {
  canvasGraph,
  withoutNodes,
} from '../packages/ui/src/features/workflows/canvasGraph';
import { nestedLists, listDefinition } from './fixtures/list';

it('renders nested groups parent-first with relative positions and explicit End edges', () => {
  const d = nestedLists(2);
  d.nodes.find((n) => n.id === 'work')!.position = { x: 140, y: 160 };
  const graph = canvasGraph(d);
  const ids = graph.nodes.map((n) => n.id);
  expect(ids.indexOf('list')).toBeLessThan(ids.indexOf('list1'));
  expect(ids.indexOf('list1')).toBeLessThan(ids.indexOf('work'));
  expect(graph.nodes.find((n) => n.id === 'work')).toMatchObject({
    parentId: 'list1',
    position: { x: 140, y: 160 },
    extent: 'parent',
  });
  expect(graph.nodes.find((n) => n.id === 'list1')).toMatchObject({
    parentId: 'list',
  });
  expect(graph.nodes.find((n) => n.id === 'list')!.width).toBeGreaterThan(
    graph.nodes.find((n) => n.id === 'list1')!.width!,
  );
});
it('collapses all descendants without hiding the outer continuation or changing the graph', () => {
  const d = nestedLists(2),
    original = structuredClone(d);
  const graph = canvasGraph(d, { collapsed: new Set(['list']) });
  expect(
    graph.nodes
      .filter((n) => n.hidden)
      .map((n) => n.id)
      .sort(),
  ).toEqual(['list1', 'work']);
  expect(graph.edges.filter((e) => !e.hidden).map((e) => e.id)).toEqual([
    'in',
    'complete',
  ]);
  expect(d).toEqual(original);
});
it('deleting a group removes descendants and incident edges but keeps outer nodes', () => {
  const d = withoutNodes(nestedLists(3), new Set(['list']));
  expect(d.nodes.map((n) => n.id)).toEqual(['entry', 'exit']);
  expect(d.edges).toEqual([]);
});
it('renders incomplete and circular drafts safely and labels only conditional edges', () => {
  const d = listDefinition();
  d.nodes.find((n) => n.id === 'list')!.listId = 'list';
  expect(() => canvasGraph(d)).not.toThrow();
  const graph = canvasGraph(listDefinition());
  expect(graph.edges.every((e) => e.label === undefined)).toBe(true);
  expect(graph.edges.find((e) => e.id === 'end')).toMatchObject({
    targetHandle: 'end',
  });
});
