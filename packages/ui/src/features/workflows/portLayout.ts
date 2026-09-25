import { outgoingPorts, type WorkflowNode } from '@interlock/core';

/** Share source handle positions between rendering and crossing reduction. */
export function outputPortTop(
  node: WorkflowNode,
  port: string,
): number | string {
  if (node.kind === 'batch') return port === 'item' ? 218 : 32;
  if (node.kind === 'switch') {
    const ports = [...new Set(outgoingPorts(node))].filter((name) =>
      name.trim(),
    );
    const index = ports.indexOf(port);
    return index < 0 ? '50%' : `${((index + 1) / (ports.length + 1)) * 100}%`;
  }
  if (node.kind === 'condition') return port === 'true' ? '35%' : '75%';
  if (node.kind === 'agent' && node.unclaimedTimeoutMs !== undefined)
    return port === 'default' ? '35%' : '75%';
  return '50%';
}
