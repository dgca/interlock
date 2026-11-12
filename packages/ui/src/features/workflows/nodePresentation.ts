import { nodeKindLabel, type WorkflowNode } from '@interlock/core';

export function nodeTypeLabel(kind: WorkflowNode['kind'], humanInput = false) {
  return kind === 'input' && humanInput ? 'Human input' : nodeKindLabel(kind);
}
