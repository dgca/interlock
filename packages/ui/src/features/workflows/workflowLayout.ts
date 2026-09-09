import { graphlib, layout } from '@dagrejs/dagre';
import type { WorkflowDefinition, WorkflowNode } from '@interlock/core';
import { BATCH_INSET, CANVAS_GAP, canvasGeometry } from './canvasGeometry';

/** Lay out each Batch before its enclosing scope, using expanded bounds. */
export function tidyWorkflow(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const result = structuredClone(definition);
  const { parents } = canvasGeometry(result);
  const arrange = (parentId?: string) => {
    const members = result.nodes.filter((n) => parents.get(n.id) === parentId);
    for (const node of members) if (node.kind === 'batch') arrange(node.id);
    if (!members.length) return;
    const { size } = canvasGeometry(result);
    const graph = new graphlib.Graph({ multigraph: true });
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
        graph.setEdge(edge.source, edge.target, {}, edge.id);
    }
    layout(graph);
    const left = parentId ? BATCH_INSET.left : 60;
    const top = parentId ? BATCH_INSET.top : 160;
    for (const node of members) {
      const placed = graph.node(node.id);
      node.position = {
        x: placed.x - placed.width / 2 + left,
        y: placed.y - placed.height / 2 + top,
      };
    }
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
  const siblings = definition.nodes.filter(
    (n) => geometry.parents.get(n.id) === parentId,
  );
  const position = parentId
    ? { x: BATCH_INSET.left, y: BATCH_INSET.top }
    : { x: 150, y: 360 };
  const dimensions = geometry.size(node);
  let collision: WorkflowNode | undefined;
  do {
    collision = siblings.find((other) => {
      const bounds = geometry.size(other);
      return (
        position.x < other.position.x + bounds.width + CANVAS_GAP &&
        position.x + dimensions.width + CANVAS_GAP > other.position.x &&
        position.y < other.position.y + bounds.height + CANVAS_GAP &&
        position.y + dimensions.height + CANVAS_GAP > other.position.y
      );
    });
    if (collision)
      position.x =
        collision.position.x + geometry.size(collision).width + CANVAS_GAP;
  } while (collision);
  return position;
}

/** Make room for growth after adding a Batch child; preserve rows and graph semantics. */
export function separateNodes(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const result = structuredClone(definition);
  const { parents } = canvasGeometry(result);
  const separate = (parentId?: string) => {
    const members = result.nodes.filter((n) => parents.get(n.id) === parentId);
    for (const node of members) if (node.kind === 'batch') separate(node.id);
    const { size } = canvasGeometry(result);
    members.sort(
      (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
    );
    const placed: WorkflowNode[] = [];
    for (const node of members) {
      let collision: WorkflowNode | undefined;
      do {
        collision = placed.find((other) => {
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
