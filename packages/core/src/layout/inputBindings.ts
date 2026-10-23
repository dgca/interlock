import type { WorkflowNode } from '../index.js';

export function bindingNodeIds(node: WorkflowNode): string[] {
  return [
    ...new Set(
      Object.values(node.inputBindings ?? {}).flatMap((binding) =>
        binding.source === 'node' ? [binding.nodeId] : [],
      ),
    ),
  ];
}
