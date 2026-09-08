import { type WorkflowDefinition, type WorkflowNode } from '@interlock/core';
import type { Edge } from '@xyflow/react';
import type { CanvasNode } from './FlowNode';

type Options = {
  collapsed?: Set<string>;
  selected?: string;
  selectedEdges?: Set<string>;
  onEdit?: (node: WorkflowNode) => void;
  onAdd?: (listId: string) => void;
  onToggle?: (listId: string) => void;
  status?: (nodeId: string) => string | undefined;
};

/** Project explicit List membership onto React Flow Sub Flows. Also renders invalid drafts safely. */
export function canvasGraph(
  definition: WorkflowDefinition,
  options: Options = {},
): { nodes: CanvasNode[]; edges: Edge[] } {
  const index = new Map(definition.nodes.map((node) => [node.id, node]));
  const parentOf = (node: WorkflowNode) => {
    const seen = new Set([node.id]);
    let parent = node.listId;
    while (parent) {
      if (seen.has(parent) || index.get(parent)?.kind !== 'list')
        return undefined;
      seen.add(parent);
      parent = index.get(parent)!.listId;
    }
    return node.listId;
  };
  const parents = new Map(definition.nodes.map((n) => [n.id, parentOf(n)]));
  const hidden = (node: WorkflowNode) => {
    let parent = parents.get(node.id);
    while (parent) {
      if (options.collapsed?.has(parent)) return true;
      parent = parents.get(parent);
    }
    return false;
  };
  const sizes = new Map<string, { width: number; height: number }>();
  const size = (node: WorkflowNode): { width: number; height: number } => {
    if (sizes.has(node.id)) return sizes.get(node.id)!;
    const result =
      node.kind !== 'list'
        ? { width: 220, height: 116 }
        : options.collapsed?.has(node.id)
          ? { width: 320, height: 116 }
          : { width: 520, height: 340 };
    if (node.kind === 'list' && !options.collapsed?.has(node.id)) {
      for (const child of definition.nodes.filter(
        (n) => parents.get(n.id) === node.id,
      )) {
        const childSize = size(child);
        result.width = Math.max(
          result.width,
          child.position.x + childSize.width + 120,
        );
        result.height = Math.max(
          result.height,
          child.position.y + childSize.height + 60,
        );
      }
    }
    sizes.set(node.id, result);
    return result;
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
    // Membership changes through the settings form, never by dragging across a border.
    extent: parents.get(node.id) ? 'parent' : undefined,
    dragHandle: node.kind === 'list' ? '.list-drag' : undefined,
    ...size(node),
    style: size(node),
    hidden: hidden(node),
    deletable: node.kind !== 'entry' && node.kind !== 'exit',
    selected: options.selected === node.id,
    data: {
      node,
      collapsed: options.collapsed?.has(node.id),
      status: options.status?.(node.id),
      onEdit: options.onEdit ? () => options.onEdit!(node) : undefined,
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
      label: ['true', 'false'].includes(edge.port) ? edge.port : undefined,
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
      if (node.listId && removed.has(node.listId) && !removed.has(node.id)) {
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
