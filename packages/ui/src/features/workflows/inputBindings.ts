import type { WorkflowNode } from '@interlock/core';

export type InputBinding = NonNullable<WorkflowNode['inputBindings']>[string];

export { bindingNodeIds } from '@interlock/core/layout';

export function bindingNodes(node: WorkflowNode, nodes: WorkflowNode[]) {
  return nodes.filter(
    (candidate) =>
      candidate.kind !== 'entry' &&
      candidate.kind !== 'exit' &&
      candidate.batchId === node.batchId,
  );
}
