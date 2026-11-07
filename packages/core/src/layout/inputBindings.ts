import type { ValueBinding, WorkflowNode } from '../index.js';
import { bindingLeaves } from '../valueBindings.js';
export function bindingNodeIds(node: WorkflowNode): string[] {
  const cwdBindings: Record<string, ValueBinding> =
    'cwd' in node && typeof node.cwd === 'object' && node.cwd !== null
      ? { cwd: node.cwd }
      : {};
  return [
    ...new Set(
      [
        ...bindingLeaves(node.inputBindings ?? {}),
        ...bindingLeaves(node.outputBindings ?? {}),
        ...bindingLeaves(cwdBindings),
      ].flatMap((b) =>
        b.source === 'node' || b.source === 'execution' ? [b.nodeId] : [],
      ),
    ),
  ];
}
