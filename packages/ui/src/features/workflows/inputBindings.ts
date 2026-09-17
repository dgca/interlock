import type { WorkflowNode } from '@interlock/core';

export type InputBinding = NonNullable<WorkflowNode['inputBindings']>[string];

export function bindingNodeIds(node: WorkflowNode): string[] {
  return [
    ...new Set(
      Object.values(node.inputBindings ?? {}).flatMap((binding) =>
        binding.source === 'node' ? [binding.nodeId] : [],
      ),
    ),
  ];
}

export function bindingNodes(node: WorkflowNode, nodes: WorkflowNode[]) {
  return nodes.filter(
    (candidate) =>
      candidate.kind !== 'entry' &&
      candidate.kind !== 'exit' &&
      candidate.batchId === node.batchId,
  );
}
