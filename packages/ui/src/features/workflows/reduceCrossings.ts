import type { WorkflowEdge, WorkflowNode } from '@interlock/core';
import { outputPortTop } from './portLayout';

type Size = (node: WorkflowNode) => { width: number; height: number };
type Route = { source: WorkflowNode; target: WorkflowNode; port: string };

/** Refine Dagre's ranks without moving nodes between ranks or changing their gaps.
 * Straight segments approximate the rendered curves. Back-edges are left alone.
 * Each swap must reduce crossings, or keep that count and reduce crossings at a fork.
 */
export function reduceCrossings(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  size: Size,
) {
  const index = new Map(nodes.map((node) => [node.id, node]));
  const columns = new Map<number, WorkflowNode[]>();
  for (const node of nodes) {
    const center =
      Math.round((node.position.x + size(node).width / 2) * 1000) / 1000;
    const column = columns.get(center) ?? [];
    column.push(node);
    columns.set(center, column);
  }
  const ordered = [...columns]
    .sort(([a], [b]) => a - b)
    .map(([, column]) => column.sort((a, b) => a.position.y - b.position.y));
  const routes: Route[] = [];
  for (const edge of edges) {
    const source = index.get(edge.source),
      target = index.get(edge.target);
    if (!source || !target || edge.targetHandle === 'end') continue;
    if (source.position.x + size(source).width >= target.position.x) continue;
    routes.push({ source, target, port: edge.port });
  }
  const segments = () =>
    routes.map(({ source, target, port }) => {
      const top = outputPortTop(source, port);
      return {
        x1: source.position.x + size(source).width,
        y1:
          source.position.y +
          (typeof top === 'number'
            ? top
            : (parseFloat(top) / 100) * size(source).height),
        x2: target.position.x,
        y2:
          target.position.y +
          (target.kind === 'batch' ? 32 : size(target).height / 2),
      };
    });
  // Only edge pairs incident to the swapped nodes can change their crossing count.
  const score = (affected: Set<number>) => {
    const lines = segments();
    let crossings = 0,
      forks = 0;
    for (const i of affected) {
      const a = lines[i];
      for (let j = 0; j < lines.length; j++) {
        if (j === i || (affected.has(j) && j < i)) continue;
        const b = lines[j];
        const left = Math.max(a.x1, b.x1),
          right = Math.min(a.x2, b.x2);
        if (left >= right) continue;
        const y = (line: typeof a, x: number) =>
          line.y1 + ((line.y2 - line.y1) * (x - line.x1)) / (line.x2 - line.x1);
        if (
          (y(a, left) - y(b, left)) * (y(a, right) - y(b, right)) >=
          -0.000001
        )
          continue;
        crossings++;
        if (routes[i].source === routes[j].source) forks++;
      }
    }
    return { crossings, forks };
  };
  // Bound work on large or conflicting graphs. No claim of a crossing-free optimum.
  for (let pass = 0; pass < Math.min(nodes.length, 32); pass++) {
    let changed = false;
    for (const column of ordered) {
      for (let i = 0; i + 1 < column.length; i++) {
        const a = column[i],
          b = column[i + 1];
        const affected = new Set<number>();
        routes.forEach((route, index) => {
          if (
            route.source === a ||
            route.target === a ||
            route.source === b ||
            route.target === b
          )
            affected.add(index);
        });
        if (!affected.size) continue;
        const before = score(affected);
        if (!before.crossings) continue;
        const ay = a.position.y,
          by = b.position.y;
        const gap = by - ay - size(a).height;
        b.position.y = ay;
        a.position.y = ay + size(b).height + gap;
        const after = score(affected);
        if (
          after.crossings < before.crossings ||
          (after.crossings === before.crossings && after.forks < before.forks)
        ) {
          column[i] = b;
          column[i + 1] = a;
          changed = true;
        } else {
          a.position.y = ay;
          b.position.y = by;
        }
      }
    }
    if (!changed) break;
  }
}
