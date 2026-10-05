import {
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
  type Workflow,
} from '@interlock/core';
import type { Edge } from '@xyflow/react';
import type { CanvasNode } from './FlowNode';
import type { LoopEdgeData } from './LoopEdge';
import type { OrthoEdgeData } from './OrthoEdge';
import { CANVAS_GAP, canvasGeometry } from './canvasGeometry';
import { bindingNodeIds, bindingNodes } from './inputBindings';
import { outputPortTop } from './portLayout';
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
  const hovered =
    options.hovered &&
    index.has(options.hovered) &&
    !hiddenIds.has(options.hovered)
      ? options.hovered
      : undefined;
  const focus =
    selectedIds.size > 0
      ? undefined
      : (hovered ??
        (options.selected instanceof Set && options.selected.size === 1
          ? [...options.selected][0]
          : undefined));
  const linkedNodes = new Set<string>(),
    linkedEdges = new Set<string>();
  if (focus !== undefined && index.has(focus) && !hiddenIds.has(focus)) {
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
  const activePorts = new Map<string, Set<string>>();
  const addActivePort = (nodeId: string, port: string) => {
    const ports = activePorts.get(nodeId) ?? new Set<string>();
    ports.add(port);
    activePorts.set(nodeId, ports);
  };
  for (const edge of definition.edges) {
    if (!selectedIds.has(edge.id) && !linkedEdges.has(edge.id)) continue;
    addActivePort(edge.source, `source:${edge.port}`);
    addActivePort(edge.target, `target:${edge.targetHandle ?? 'default'}`);
  }
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
      activePorts: [...(activePorts.get(node.id) ?? [])],
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
  // Route loops around the cards between their endpoints, on whichever side
  // already carries fewer loops over that span (ties go below). Overlapping
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
  const crossed = (edge: WorkflowEdge) => {
    const { left, right } = span(edge);
    return visible.filter((node) => {
      const x = absolute(node).x;
      return x < right && x + size(node).width > left;
    });
  };
  const corridorBottom = (edge: WorkflowEdge) =>
    Math.max(
      ...crossed(edge).map((node) => absolute(node).y + size(node).height),
    );
  const corridorTop = (edge: WorkflowEdge) =>
    Math.min(...crossed(edge).map((node) => absolute(node).y));
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
    // Only cards beside the vertical run, between the card and its lane, matter.
    const top = Math.min(laneY, origin.y),
      bottom = Math.max(laneY, origin.y + size(node).height);
    let gap = Infinity;
    for (const other of visible) {
      if (other.id === node.id) continue;
      const position = absolute(other);
      const otherRight = position.x + size(other).width;
      if (position.y >= bottom || position.y + size(other).height <= top)
        continue;
      if (side === 'right' && otherRight > boundary)
        gap = Math.min(gap, Math.max(0, position.x - boundary));
      if (side === 'left' && position.x < boundary)
        gap = Math.min(gap, Math.max(0, boundary - otherRight));
    }
    return gap;
  };
  const lane = new Map<string, LoopEdgeData>();
  const placed: { left: number; right: number; above: boolean }[] = [];
  loops.forEach((edge, i) => {
    const { left, right } = span(edge);
    const traffic = (above: boolean) =>
      placed.filter(
        (p) => p.above === above && p.left < right && p.right > left,
      ).length;
    const above = traffic(true) < traffic(false);
    const step = above ? -24 : 24;
    let laneY = above ? corridorTop(edge) - 40 : corridorBottom(edge) + 40;
    while (
      [...lane.values()].some((route) => Math.abs(route.laneY - laneY) < 24)
    )
      laneY += step;
    placed.push({ left, right, above });
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
  // Route forward edges orthogonally through the gaps between columns, so a
  // span over several columns never cuts through the cards in between.
  // Columns cluster the top-level cards by overlapping x; member cards sit
  // inside their Batch's column. Only the gaps hold verticals, so a route
  // meets a card only on its horizontal runs.
  const CHANNEL_SPACING = 12;
  const STRAIGHT_TOLERANCE = 4;
  type Box = { left: number; right: number; top: number; bottom: number };
  const box = (node: WorkflowNode): Box => {
    const { x, y } = absolute(node),
      { width, height } = size(node);
    return { left: x, right: x + width, top: y, bottom: y + height };
  };
  const cards = visible.filter((node) => !parents.get(node.id));
  const columns: { left: number; right: number; ids: Set<string> }[] = [];
  for (const node of [...cards].sort((a, b) => box(a).left - box(b).left)) {
    const { left, right } = box(node);
    const last = columns[columns.length - 1];
    if (last && left < last.right) {
      last.right = Math.max(last.right, right);
      last.ids.add(node.id);
    } else columns.push({ left, right, ids: new Set([node.id]) });
  }
  const columnOf = (id: string) => columns.findIndex((c) => c.ids.has(id));
  const handleY = (node: WorkflowNode, port: string) => {
    const top = outputPortTop(node, port);
    return (
      box(node).top +
      (typeof top === 'number'
        ? top
        : (parseFloat(top) / 100) * size(node).height)
    );
  };
  const targetY = (node: WorkflowNode) =>
    box(node).top + (node.kind === 'batch' ? 32 : size(node).height / 2);
  type Point = { x: number; y: number };
  const hits = (points: Point[], skip: Set<string>) => {
    const hit = new Set<WorkflowNode>();
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      const x1 = Math.min(a.x, b.x),
        x2 = Math.max(a.x, b.x),
        y1 = Math.min(a.y, b.y),
        y2 = Math.max(a.y, b.y);
      for (const node of cards) {
        if (skip.has(node.id)) continue;
        const { left, right, top, bottom } = box(node);
        if (left < x2 && right > x1 && top < y2 && bottom > y1) hit.add(node);
      }
    }
    return hit;
  };
  const length = (points: Point[]) =>
    points.reduce(
      (sum, point, i) =>
        i
          ? sum +
            Math.abs(point.x - points[i - 1].x) +
            Math.abs(point.y - points[i - 1].y)
          : 0,
      0,
    );
  // A vertical run claims a channel in its gap; the x is assigned afterwards.
  type Run = { gap: number; from: number; to: number; x: number };
  type Route = { runs: Run[]; corridorY?: number };
  const corners = (route: Route): Point[] =>
    route.runs.flatMap((run) => [
      { x: run.x, y: run.from },
      { x: run.x, y: run.to },
    ]);
  const routes = new Map<string, Route>();
  const center = (gap: number) =>
    (columns[gap].right + columns[gap + 1].left) / 2;
  const corridors: number[] = [];
  for (const edge of definition.edges) {
    const source = index.get(edge.source),
      target = index.get(edge.target);
    if (
      !source ||
      !target ||
      hiddenEdge(edge) ||
      lane.has(edge.id) ||
      edge.targetHandle === 'end' ||
      parents.get(source.id) ||
      parents.get(target.id)
    )
      continue;
    const from = columnOf(source.id),
      to = columnOf(target.id);
    if (to <= from) continue;
    const sy = handleY(source, edge.port),
      ty = targetY(target);
    if (to === from + 1 && Math.abs(sy - ty) <= STRAIGHT_TOLERANCE) continue;
    const sx = box(source).right,
      tx = box(target).left;
    const skip = new Set([source.id, target.id]);
    const points = (route: Route) => [
      { x: sx, y: sy },
      ...corners(route),
      { x: tx, y: ty },
    ];
    const bend = (gap: number): Route => ({
      runs: [{ gap, from: sy, to: ty, x: center(gap) }],
    });
    const candidates = [bend(from)];
    if (to - 1 !== from) candidates.push(bend(to - 1));
    let scored = candidates.map((route) => ({
      route,
      hit: hits(points(route), skip),
    }));
    if (scored.every(({ hit }) => hit.size)) {
      // Both bends cross a card: dip below the lower of the rows they cross,
      // then run across the gap between rows. Stacked corridors spread out.
      let corridorY =
        Math.max(
          ...scored.flatMap(({ hit }) => [...hit].map((n) => box(n).bottom)),
        ) +
        CANVAS_GAP / 2;
      while (
        corridors.some((y) => Math.abs(y - corridorY) < CHANNEL_SPACING) ||
        [...lane.values()].some((l) => Math.abs(l.laneY - corridorY) < 24)
      )
        corridorY += CHANNEL_SPACING;
      const corridor: Route = {
        corridorY,
        runs: [
          { gap: from, from: sy, to: corridorY, x: center(from) },
          { gap: to - 1, from: corridorY, to: ty, x: center(to - 1) },
        ],
      };
      scored.push({ route: corridor, hit: hits(points(corridor), skip) });
    }
    scored = scored.sort(
      (a, b) =>
        a.hit.size - b.hit.size ||
        length(points(a.route)) - length(points(b.route)),
    );
    const best = scored[0].route;
    if (best.corridorY !== undefined) corridors.push(best.corridorY);
    routes.set(edge.id, best);
  }
  // Spread the verticals in each gap. Order so that a fan-out's farther
  // targets turn first (leftmost) and a fan-in's farther sources turn last:
  // upward runs by ascending y-sum, then downward runs by descending y-sum.
  const runsByGap = new Map<number, Run[]>();
  for (const route of routes.values())
    for (const run of route.runs) {
      const runs = runsByGap.get(run.gap) ?? [];
      runs.push(run);
      runsByGap.set(run.gap, runs);
    }
  for (const [gap, runs] of runsByGap) {
    const sum = (run: Run) => run.from + run.to;
    const up = runs
      .filter((run) => run.to < run.from)
      .sort((a, b) => sum(a) - sum(b));
    const down = runs
      .filter((run) => run.to >= run.from)
      .sort((a, b) => sum(b) - sum(a));
    const ordered = [...up, ...down];
    const width = columns[gap + 1].left - columns[gap].right;
    const spacing = Math.min(CHANNEL_SPACING, width / (ordered.length + 1));
    ordered.forEach((run, i) => {
      run.x = center(gap) + (i - (ordered.length - 1) / 2) * spacing;
    });
  }
  const ortho = new Map<string, OrthoEdgeData>();
  for (const [id, route] of routes) ortho.set(id, { points: corners(route) });
  return {
    nodes,
    edges: definition.edges.map((edge) => ({
      ...edge,
      type: lane.has(edge.id)
        ? 'loop'
        : ortho.has(edge.id)
          ? 'ortho'
          : undefined,
      data: lane.get(edge.id) ?? ortho.get(edge.id),
      selected: selectedIds.has(edge.id),
      sourceHandle: edge.port,
      targetHandle: edge.targetHandle ?? 'default',
      className: endpoints
        ? selectedIds.has(edge.id)
          ? undefined
          : 'edge-dimmed'
        : emphasis(edge.id, linkedEdges),
      // Only exception routes carry color; ordinary flow shares --edge.
      style:
        index.get(edge.source)?.kind === 'agent' &&
        edge.port === 'timeout' &&
        !selectedIds.has(edge.id)
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
