import type { WorkflowDefinition, WorkflowNode } from '@interlock/core';
import { bindingNodeIds } from './inputBindings';

export const NODE_SIZE = { width: 220, height: 116 };
export const BATCH_SIZE = { width: 520, height: 340 };
export const BATCH_INSET = { left: 130, top: 160, right: 120, bottom: 60 };
export const CANVAS_GAP = 80;

/** Shared rendered bounds, including nested Batch contents and incomplete drafts. */
export function canvasGeometry(
  definition: WorkflowDefinition,
  collapsed?: Set<string>,
) {
  const index = new Map(definition.nodes.map((node) => [node.id, node]));
  const parentOf = (node: WorkflowNode) => {
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
  const sizes = new Map<string, { width: number; height: number }>();
  const size = (node: WorkflowNode): { width: number; height: number } => {
    if (sizes.has(node.id)) return sizes.get(node.id)!;
    const bindingsHeight = bindingNodeIds(node).length * 22;
    const result =
      node.kind !== 'batch'
        ? { ...NODE_SIZE }
        : collapsed?.has(node.id)
          ? { width: 320, height: 116 }
          : { ...BATCH_SIZE };
    result.height += bindingsHeight;
    if (node.kind === 'workflow' && node.mode === 'detached')
      result.height += 18;
    if (node.kind === 'switch')
      result.height = Math.max(
        result.height,
        32 * (node.cases.length + 1) + 24,
      );
    if (node.kind === 'batch' && !collapsed?.has(node.id)) {
      for (const child of definition.nodes.filter(
        (n) => parents.get(n.id) === node.id,
      )) {
        const childSize = size(child);
        result.width = Math.max(
          result.width,
          child.position.x + childSize.width + BATCH_INSET.right,
        );
        result.height = Math.max(
          result.height,
          child.position.y +
            childSize.height +
            BATCH_INSET.bottom +
            bindingsHeight,
        );
      }
    }
    sizes.set(node.id, result);
    return result;
  };
  return { index, parents, size };
}
