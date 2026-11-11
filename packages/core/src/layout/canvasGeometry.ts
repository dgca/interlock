import {
  outgoingPorts,
  type WorkflowDefinition,
  type WorkflowNode,
} from '../index.js';
import { bindingNodeIds } from './inputBindings.js';

export const NODE_SIZE = { width: 220, height: 116 };
export const BATCH_SIZE = { width: 520, height: 340 };
export const BATCH_INSET = { left: 130, top: 160, right: 120, bottom: 60 };
export const PARALLEL_INSET = { ...BATCH_INSET, left: 110, right: 110 };
export const PARALLEL_LANE_TOP = 92;
export const PARALLEL_LANE_HEADER = 42;
export const PARALLEL_LANE_MIN_HEIGHT = 196;
export const PARALLEL_LANE_PADDING = 16;
export const parallelSize = (count: number) => ({
  width: 560,
  height: Math.max(
    PARALLEL_LANE_TOP,
    PARALLEL_LANE_TOP + count * PARALLEL_LANE_MIN_HEIGHT,
  ),
});
export const CANVAS_GAP = 80;
export const bindingsHeight = (node: WorkflowNode) =>
  bindingNodeIds(node).length * 22;

/** Shared rendered bounds, including nested Batch contents and incomplete drafts. */
export function canvasGeometry(
  definition: WorkflowDefinition,
  collapsed?: Set<string>,
) {
  const index = new Map(definition.nodes.map((node) => [node.id, node]));
  const parentOf = (node: WorkflowNode) => {
    if (node.parallelId) {
      const owner = index.get(node.parallelId);
      return owner?.kind === 'parallel' && !owner.parallelId && !owner.batchId
        ? owner.id
        : undefined;
    }
    const seen = new Set([node.id]);
    let parent = node.batchId;
    while (parent) {
      if (seen.has(parent) || index.get(parent)?.kind !== 'batch')
        return undefined;
      seen.add(parent);
      parent = index.get(parent)!.batchId;
    }
    return node.batchId;
  };
  const parents = new Map(definition.nodes.map((n) => [n.id, parentOf(n)]));
  const members = new Map<string, WorkflowNode[]>();
  for (const node of definition.nodes) {
    const parent = parents.get(node.id);
    if (parent === undefined) continue;
    const siblings = members.get(parent) ?? [];
    siblings.push(node);
    members.set(parent, siblings);
  }
  const sizes = new Map<string, { width: number; height: number }>();
  const lanesByGroup = new Map<string, ParallelLane[]>();
  const lanes = (group: WorkflowNode): ParallelLane[] => {
    if (group.kind !== 'parallel') return [];
    const cached = lanesByGroup.get(group.id);
    if (cached) return cached;
    let top = PARALLEL_LANE_TOP + bindingsHeight(group);
    const children = members.get(group.id) ?? [];
    const result = group.branches.map(({ id }) => {
      const nodes = children.filter((node) => node.parallelBranchId === id);
      const contentTop = top + PARALLEL_LANE_HEADER;
      const offset = Math.max(
        0,
        ...nodes.map((node) => contentTop - node.position.y),
      );
      const bottom = Math.max(
        top + PARALLEL_LANE_MIN_HEIGHT,
        ...nodes.map(
          (node) =>
            node.position.y +
            offset +
            size(node).height +
            PARALLEL_LANE_PADDING,
        ),
      );
      const lane = { id, top, contentTop, bottom, offset };
      top = bottom;
      return lane;
    });
    lanesByGroup.set(group.id, result);
    return result;
  };
  const laneFor = (node: WorkflowNode) => {
    const parent = parents.get(node.id);
    const group = parent === undefined ? undefined : index.get(parent);
    return (
      group && lanes(group).find((lane) => lane.id === node.parallelBranchId)
    );
  };
  const position = (node: WorkflowNode) => {
    const lane = laneFor(node);
    return lane
      ? {
          x: Math.max(PARALLEL_INSET.left, node.position.x),
          y: node.position.y + lane.offset,
        }
      : node.position;
  };
  const size = (node: WorkflowNode): { width: number; height: number } => {
    if (sizes.has(node.id)) return sizes.get(node.id)!;
    const bindings = bindingsHeight(node);
    const result =
      node.kind !== 'batch' && node.kind !== 'parallel'
        ? { ...NODE_SIZE }
        : collapsed?.has(node.id)
          ? { width: 320, height: 116 }
          : node.kind === 'parallel'
            ? parallelSize(node.branches.length)
            : { ...BATCH_SIZE };
    result.height += bindings;
    if (node.kind === 'workflow' && node.mode === 'detached')
      result.height += 18;
    if (node.kind === 'switch')
      result.height = Math.max(
        result.height,
        32 * (node.cases.length + 1) + 24,
      );
    if (node.routing)
      result.height = Math.max(
        result.height,
        32 * outgoingPorts(node).length + 24,
      );
    if (
      (node.kind === 'batch' || node.kind === 'parallel') &&
      !collapsed?.has(node.id)
    ) {
      if (node.kind === 'parallel')
        result.height = Math.max(
          result.height,
          lanes(node).at(-1)?.bottom ?? 0,
        );
      for (const child of members.get(node.id) ?? []) {
        const childSize = size(child);
        const placed = position(child);
        result.width = Math.max(
          result.width,
          placed.x +
            childSize.width +
            (node.kind === 'parallel'
              ? PARALLEL_INSET.right
              : BATCH_INSET.right),
        );
        if (node.kind === 'batch' || !laneFor(child))
          result.height = Math.max(
            result.height,
            placed.y + childSize.height + BATCH_INSET.bottom + bindings,
          );
      }
    }
    sizes.set(node.id, result);
    return result;
  };
  return { index, parents, size, lanes, laneFor, position };
}

export type ParallelLane = {
  id: string;
  top: number;
  contentTop: number;
  bottom: number;
  offset: number;
};

/** Persist the same positions that the canvas projects for legacy layouts. */
export function placeParallelMembers(definition: WorkflowDefinition) {
  const { position } = canvasGeometry(definition);
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const placed = position(node);
      return placed.x === node.position.x && placed.y === node.position.y
        ? node
        : { ...node, position: placed };
    }),
  };
}
