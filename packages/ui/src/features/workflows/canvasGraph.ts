import { type WorkflowDefinition, type WorkflowNode } from '@interlock/core';
import type { Edge } from '@xyflow/react';
import type { CanvasNode } from './FlowNode';
import { canvasGeometry } from './canvasGeometry';
import { conditionColors } from './conditionColors';

type Options = {
  collapsed?: Set<string>;
  selected?: string | Set<string>;
  selectedEdges?: Set<string>;
  onEdit?: (node: WorkflowNode) => void;
  onAdd?: (batchId: string) => void;
  onToggle?: (batchId: string) => void;
  status?: (nodeId: string) => string | undefined;
};

/** Project explicit Batch membership onto React Flow Sub Flows. Also renders invalid drafts safely. */
export function canvasGraph(
  definition: WorkflowDefinition,
  options: Options = {},
): { nodes: CanvasNode[]; edges: Edge[] } {
  const { index, parents, size } = canvasGeometry(
    definition,
    options.collapsed,
  );
  const hidden = (node: WorkflowNode) => {
    let parent = parents.get(node.id);
    while (parent) {
      if (options.collapsed?.has(parent)) return true;
      parent = parents.get(parent);
    }
    return false;
  };
  const ordered: WorkflowNode[] = [],
    added = new Set<string>();
  const add = (node: WorkflowNode) => {
    if (added.has(node.id)) return;
    const parent = parents.get(node.id);
    if (parent) add(index.get(parent)!);
    added.add(node.id);
    ordered.push(node);
  };
  definition.nodes.forEach(add);
  const nodes: CanvasNode[] = ordered.map((node) => ({
    id: node.id,
    type: 'workflow',
    position: node.position,
    parentId: parents.get(node.id),
    // Add step assigns membership; dragging across a border never changes it.
    extent: parents.get(node.id) ? 'parent' : undefined,
    dragHandle: node.kind === 'batch' ? '.batch-drag' : undefined,
    ...size(node),
    style: size(node),
    hidden: hidden(node),
    deletable: node.kind !== 'entry' && node.kind !== 'exit',
    selected:
      typeof options.selected === 'string'
        ? options.selected === node.id
        : (options.selected?.has(node.id) ?? false),
    data: {
      node,
      boundarySchema:
        node.kind === 'entry'
          ? definition.inputSchema
          : node.kind === 'exit'
            ? definition.outputSchema
            : undefined,
      collapsed: options.collapsed?.has(node.id),
      status: options.status?.(node.id),
      onEdit:
        options.onEdit &&
        (node.kind === 'batch' ||
          !(options.selected instanceof Set && options.selected.size > 1))
          ? () => options.onEdit!(node)
          : undefined,
      onAdd: options.onAdd ? () => options.onAdd!(node.id) : undefined,
      onToggle: options.onToggle ? () => options.onToggle!(node.id) : undefined,
    },
  }));
  const hiddenIds = new Set(nodes.filter((n) => n.hidden).map((n) => n.id));
  return {
    nodes,
    edges: definition.edges.map((edge) => ({
      ...edge,
      selected: options.selectedEdges?.has(edge.id),
      sourceHandle: edge.port,
      targetHandle: edge.targetHandle ?? 'default',
      style:
        index.get(edge.source)?.kind === 'condition' &&
        (edge.port === 'true' || edge.port === 'false')
          ? {
              stroke: conditionColors[edge.port],
              strokeWidth: options.selectedEdges?.has(edge.id) ? 3 : undefined,
            }
          : undefined,
      hidden:
        hiddenIds.has(edge.source) ||
        hiddenIds.has(edge.target) ||
        (edge.port === 'item' &&
          Boolean(options.collapsed?.has(edge.source))) ||
        (edge.targetHandle === 'end' &&
          Boolean(options.collapsed?.has(edge.target))),
    })),
  };
}

export function withoutNodes(
  definition: WorkflowDefinition,
  ids: Set<string>,
): WorkflowDefinition {
  const removed = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of definition.nodes)
      if (node.batchId && removed.has(node.batchId) && !removed.has(node.id)) {
        removed.add(node.id);
        changed = true;
      }
  }
  return {
    ...definition,
    nodes: definition.nodes.filter((n) => !removed.has(n.id)),
    edges: definition.edges.filter(
      (e) => !removed.has(e.source) && !removed.has(e.target),
    ),
  };
}
