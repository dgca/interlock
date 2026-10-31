import type { WorkflowNode } from '../index.js';
import { bindingLeaves } from '../valueBindings.js';
export function bindingNodeIds(node: WorkflowNode): string[] {
  return [
    ...new Set(
      [
        ...bindingLeaves(node.inputBindings ?? {}),
        ...bindingLeaves(node.outputBindings ?? {}),
      ].flatMap((b) => (b.source === 'node' ? [b.nodeId] : [])),
    ),
  ];
}
