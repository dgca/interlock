import {
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
  type Workflow,
} from '@interlock/core';
import type { Edge } from '@xyflow/react';
import type { CanvasNode } from './FlowNode';
import type { LoopEdgeData } from './LoopEdge';
import { canvasGeometry } from './canvasGeometry';
import { bindingNodeIds, bindingNodes } from './inputBindings';
import styles from './WorkflowEditor.module.css';

type Options = {
  workflows?: Workflow[];
  onOpenWorkflow?: (id: string) => void;
  collapsed?: Set<string>;
  selected?: string | Set<string>;
  selectedEdges?: Set<string>;
  hovered?: string;
  onEdit?: (node: WorkflowNode) => void;
  onAdd?: (batchId: string) => void;
  onToggle?: (batchId: string) => void;
  onFocusNode?: (nodeId: string) => void;
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
  const hiddenIds = new Set(ordered.filter(hidden).map((node) => node.id));
  const hiddenEdge = (edge: WorkflowDefinition['edges'][number]) =>
    hiddenIds.has(edge.source) ||
    hiddenIds.has(edge.target) ||
    (index.get(edge.source)?.kind === 'batch' &&
      edge.port === 'item' &&
      Boolean(options.collapsed?.has(edge.source))) ||
    (edge.targetHandle === 'end' &&
      Boolean(options.collapsed?.has(edge.target)));
  const selectedVisibleEdges = definition.edges.filter(
    (edge) =>
      options.selectedEdges?.has(edge.id) &&
      index.has(edge.source) &&
      index.has(edge.target) &&
      !hiddenEdge(edge),
  );
  const selectedIds = new Set(selectedVisibleEdges.map((edge) => edge.id));
  const endpoints = selectedVisibleEdges.length
    ? new Set(
        selectedVisibleEdges.flatMap((edge) => [edge.source, edge.target]),
      )
    : undefined;
  // Emphasize the hovered node's routes, else the single selected node's.
  // Only canvas selection (the Set form) counts: the run inspector passes the
  // inspected node as a string and should not dim the rest of the run.
  const focus =
    selectedIds.size > 0
      ? undefined
      : (options.hovered ??
        (options.selected instanceof Set && options.selected.size === 1
          ? [...options.selected][0]
          : undefined));
  const linkedNodes = new Set<string>(),
    linkedEdges = new Set<string>();
  if (focus !== undefined && !hiddenIds.has(focus)) {
    linkedNodes.add(focus);
    for (const edge of definition.edges)
      if (
        !hiddenEdge(edge) &&
        (edge.source === focus || edge.target === focus)
      ) {
        linkedEdges.add(edge.id);
        linkedNodes.add(edge.source);
        linkedNodes.add(edge.target);
      }
  }
  const emphasis = (id: string, linked: Set<string>) =>
    linkedNodes.size === 0
      ? undefined
      : linked.has(id)
        ? 'highlighted'
        : 'dimmed';
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
    hidden: hiddenIds.has(node.id),
    className: endpoints
      ? endpoints.has(node.id)
        ? styles.edgeEndpoint
        : styles.edgeDimmed
      : linkedNodes.size
        ? linkedNodes.has(node.id)
          ? styles.edgeEndpoint
          : styles.edgeDimmed
        : undefined,
    deletable: node.kind !== 'entry' && node.kind !== 'exit',
    selected:
      typeof options.selected === 'string'
        ? options.selected === node.id
        : (options.selected?.has(node.id) ?? false),
    data: {
      node,
      bindingSources: bindingNodeIds(node).map((id) => {
        const source = bindingNodes(node, definition.nodes).find(
          (candidate) => candidate.id === id,
        );
        return {
          id,
          label: source?.label ?? id,
          missing: !source,
          onFocus:
            source && options.onFocusNode
              ? () => options.onFocusNode!(id)
              : undefined,
        };
      }),
      ownedTarget:
        node.kind === 'workflow' &&
        Boolean(
          options.workflows?.find((w) => w.id === node.workflowId)
            ?.ownerWorkflowId,
        ),
      targetName:
        node.kind === 'workflow'
          ? options.workflows?.find((w) => w.id === node.workflowId)?.name
          : undefined,
      onOpen:
        node.kind === 'workflow' && options.onOpenWorkflow
          ? () => options.onOpenWorkflow!(node.workflowId)
          : undefined,
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
  // Batch members store positions relative to their group.
  const absolute = (node: WorkflowNode): { x: number; y: number } => {
    const parent = parents.get(node.id);
    const origin = parent ? absolute(index.get(parent)!) : { x: 0, y: 0 };
    return { x: origin.x + node.position.x, y: origin.y + node.position.y };
  };
  // Route loops below the cards between their endpoints. Overlapping
  // neighboring cards keep the default curve.
  const LOOP_MARGIN = 8;
  const visible = ordered.filter((node) => !hiddenIds.has(node.id));
  const span = (edge: WorkflowEdge) => {
    const source = index.get(edge.source)!,
      target = index.get(edge.target)!;
    return {
      left: absolute(target).x,
      right: absolute(source).x + size(source).width,
    };
  };
  const backward = (edge: WorkflowEdge) => {
    const source = index.get(edge.source),
      target = index.get(edge.target);
    return Boolean(
      source &&
      target &&
      absolute(target).x + size(target).width + LOOP_MARGIN <
        absolute(source).x,
    );
  };
  const corridorBottom = (edge: WorkflowEdge) => {
    const { left, right } = span(edge);
    return Math.max(
      ...visible
        .filter((node) => {
          const x = absolute(node).x;
          return x < right && x + size(node).width > left;
        })
        .map((node) => absolute(node).y + size(node).height),
    );
  };
  const loops = definition.edges
    .filter((edge) => !hiddenEdge(edge) && backward(edge))
    .sort(
      (a, b) =>
        absolute(index.get(b.source)!).x - absolute(index.get(a.source)!).x,
    );
  const sideGap = (
    node: WorkflowNode,
    side: 'left' | 'right',
    laneY: number,
  ) => {
    const origin = absolute(node);
    const boundary = side === 'right' ? origin.x + size(node).width : origin.x;
    let gap = Infinity;
    for (const other of visible) {
      if (other.id === node.id) continue;
      const position = absolute(other);
      const otherRight = position.x + size(other).width;
      if (position.y >= laneY || position.y + size(other).height <= origin.y)
        continue;
      if (side === 'right' && otherRight > boundary)
        gap = Math.min(gap, Math.max(0, position.x - boundary));
      if (side === 'left' && position.x < boundary)
        gap = Math.min(gap, Math.max(0, boundary - otherRight));
    }
    return gap;
  };
  const lane = new Map<string, LoopEdgeData>();
  loops.forEach((edge, i) => {
    let laneY = corridorBottom(edge) + 40;
    while (
      [...lane.values()].some((route) => Math.abs(route.laneY - laneY) < 24)
    )
      laneY += 24;
    const desiredOffset = 24 + i * 12;
    const offset = (gap: number) =>
      Number.isFinite(gap)
        ? Math.min(
            desiredOffset,
            (Math.max(0, gap - 4) * (i + 1)) / (loops.length + 1),
          )
        : desiredOffset;
    lane.set(edge.id, {
      laneY,
      outOffset: offset(sideGap(index.get(edge.source)!, 'right', laneY)),
      inOffset: offset(sideGap(index.get(edge.target)!, 'left', laneY)),
    });
  });
  return {
    nodes,
    edges: definition.edges.map((edge) => ({
      ...edge,
      type: lane.has(edge.id) ? 'loop' : undefined,
      data: lane.get(edge.id),
      selected: selectedIds.has(edge.id),
      sourceHandle: edge.port,
      targetHandle: edge.targetHandle ?? 'default',
      className:
        endpoints
          ? selectedIds.has(edge.id)
            ? undefined
            : 'edge-dimmed'
          : emphasis(edge.id, linkedEdges),
      // Only exception routes carry color; ordinary flow shares --edge.
      style:
        index.get(edge.source)?.kind === 'agent' && edge.port === 'timeout'
          ? { stroke: 'var(--edge-exception)' }
          : undefined,
      hidden: hiddenEdge(edge),
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
