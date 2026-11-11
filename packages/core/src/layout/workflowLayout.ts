import { graphlib, layout } from '@dagrejs/dagre';
import type { WorkflowDefinition, WorkflowNode } from '../index.js';
import {
  BATCH_INSET,
  PARALLEL_INSET,
  PARALLEL_LANE_TOP,
  PARALLEL_LANE_HEADER,
  PARALLEL_LANE_MIN_HEIGHT,
  PARALLEL_LANE_PADDING,
  bindingsHeight,
  placeParallelMembers,
  CANVAS_GAP,
  canvasGeometry,
} from './canvasGeometry.js';
import { reduceCrossings } from './reduceCrossings.js';

/** Lay out each Batch before its enclosing scope, using expanded bounds. */
export function tidyWorkflow(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const result = structuredClone(definition);
  const { parents } = canvasGeometry(result);
  const arrange = (
    parentId?: string,
    branchId?: string,
    branchTop?: number,
  ) => {
    const members = result.nodes.filter(
      (n) =>
        parents.get(n.id) === parentId &&
        (branchId === undefined || n.parallelBranchId === branchId),
    );
    for (const node of members) {
      if (node.kind === 'batch') arrange(node.id);
      if (node.kind === 'parallel') {
        let top =
          PARALLEL_LANE_TOP + PARALLEL_LANE_HEADER + bindingsHeight(node);
        for (const branch of node.branches)
          top = Math.max(
            top + PARALLEL_LANE_MIN_HEIGHT,
            arrange(node.id, branch.id, top) +
              PARALLEL_LANE_PADDING +
              PARALLEL_LANE_HEADER,
          );
      }
    }
    if (!members.length) return branchTop ?? 0;
    const { size } = canvasGeometry(result);
    // Dagre only supplies node positions. A single edge per directed pair avoids
    // its parallel-edge intersection failures; original routes remain untouched.
    const graph = new graphlib.Graph();
    graph.setGraph({
      rankdir: 'LR',
      ranksep: CANVAS_GAP,
      nodesep: CANVAS_GAP,
      marginx: 0,
      marginy: 0,
    });
    graph.setDefaultEdgeLabel(() => ({}));
    const ids = new Set(members.map((n) => n.id));
    for (const node of members) graph.setNode(node.id, size(node));
    for (const edge of result.edges) {
      if (
        ids.has(edge.source) &&
        ids.has(edge.target) &&
        edge.source !== edge.target
      )
        graph.setEdge(edge.source, edge.target, {});
    }
    layout(graph);
    const left = branchId
      ? PARALLEL_INSET.left
      : parentId
        ? BATCH_INSET.left
        : 60;
    const top = branchTop ?? (parentId ? BATCH_INSET.top : 160);
    for (const node of members) {
      const placed = graph.node(node.id);
      node.position = {
        x: placed.x - placed.width / 2 + left,
        y: placed.y - placed.height / 2 + top,
      };
    }
    reduceCrossings(members, result.edges, size);
    return Math.max(
      ...members.map((node) => node.position.y + size(node).height),
    );
  };
  arrange();
  return result;
}

/** Place a new node in free space, without assuming all cards have the same width. */
export function newNodePosition(
  definition: WorkflowDefinition,
  node: WorkflowNode,
) {
  const geometry = canvasGeometry({
    ...definition,
    nodes: [...definition.nodes, node],
  });
  const parentId = geometry.parents.get(node.id);
  const owner = parentId ? geometry.index.get(parentId) : undefined;
  const current = canvasGeometry(definition);
  const siblings = definition.nodes.filter(
    (n) =>
      geometry.parents.get(n.id) === parentId &&
      (owner?.kind !== 'parallel' ||
        n.parallelBranchId === node.parallelBranchId),
  );
  const position =
    owner?.kind === 'parallel'
      ? {
          x: PARALLEL_INSET.left,
          y:
            current.lanes(owner).find(({ id }) => id === node.parallelBranchId)
              ?.contentTop ?? PARALLEL_INSET.top,
        }
      : parentId
        ? { x: BATCH_INSET.left, y: BATCH_INSET.top }
        : { x: 150, y: 360 };
  const dimensions = geometry.size(node);
  let collision: WorkflowNode | undefined;
  do {
    collision = siblings.find((other) => {
      const bounds = geometry.size(other);
      const placed = current.position(other);
      return (
        position.x < placed.x + bounds.width + CANVAS_GAP &&
        position.x + dimensions.width + CANVAS_GAP > placed.x &&
        position.y < placed.y + bounds.height + CANVAS_GAP &&
        position.y + dimensions.height + CANVAS_GAP > placed.y
      );
    });
    if (collision)
      position.x =
        current.position(collision).x +
        geometry.size(collision).width +
        CANVAS_GAP;
  } while (collision);
  return position;
}

/** Make room for growth after adding a Batch child; preserve rows and graph semantics. */
export function separateNodes(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const result = placeParallelMembers(structuredClone(definition));
  const { parents } = canvasGeometry(result);
  const separate = (parentId?: string) => {
    const members = result.nodes.filter((n) => parents.get(n.id) === parentId);
    for (const node of members)
      if (node.kind === 'batch' || node.kind === 'parallel') separate(node.id);
    const { size, laneFor } = canvasGeometry(result);
    members.sort(
      (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
    );
    const placed: WorkflowNode[] = [];
    for (const node of members) {
      let collision: WorkflowNode | undefined;
      do {
        collision = placed.find((other) => {
          const lane = laneFor(node);
          const otherLane = laneFor(other);
          if (lane && otherLane && lane.id !== otherLane.id) return false;
          const a = size(node),
            b = size(other);
          return (
            node.position.x < other.position.x + b.width + CANVAS_GAP &&
            node.position.x + a.width + CANVAS_GAP > other.position.x &&
            node.position.y < other.position.y + b.height + CANVAS_GAP &&
            node.position.y + a.height + CANVAS_GAP > other.position.y
          );
        });
        if (collision)
          node.position.x =
            collision.position.x + size(collision).width + CANVAS_GAP;
      } while (collision);
      placed.push(node);
    }
  };
  separate();
  return result;
}
