import {
  hasFailureRoute,
  hasTimeoutRoute,
  outgoingPorts,
  type WorkflowDefinition,
} from '@interlock/core';

/** In the visual editor, a lane's open success ports return to its group. */
export function withParallelReturns(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const groups = new Map(
    definition.nodes.flatMap((node) =>
      node.kind === 'parallel' ? [[node.id, node] as const] : [],
    ),
  );
  if (!groups.size) return definition;
  const connected = new Map<string, Set<string>>();
  for (const edge of definition.edges) {
    const ports = connected.get(edge.source) ?? new Set();
    ports.add(edge.port);
    connected.set(edge.source, ports);
  }
  const returns = definition.nodes.flatMap((node) => {
    const group = node.parallelId ? groups.get(node.parallelId) : undefined;
    if (!group?.branches.some((branch) => branch.id === node.parallelBranchId))
      return [];
    return [...new Set(outgoingPorts(node))]
      .filter(
        (port) =>
          port.trim() &&
          !connected.get(node.id)?.has(port) &&
          !(port === 'failed' && hasFailureRoute(node)) &&
          !(port === 'timeout' && hasTimeoutRoute(node)),
      )
      .map((port) => ({
        id: crypto.randomUUID(),
        source: node.id,
        port,
        target: group.id,
        targetHandle: 'join' as const,
      }));
  });
  return returns.length
    ? { ...definition, edges: [...definition.edges, ...returns] }
    : definition;
}

/** Append only when the lane has one ordinary, unambiguous return. */
export function parallelTail(
  definition: WorkflowDefinition,
  groupId: string,
  branchId: string,
) {
  const members = new Map(
    definition.nodes
      .filter(
        (node) =>
          node.parallelId === groupId && node.parallelBranchId === branchId,
      )
      .map((node) => [node.id, node]),
  );
  const returns = definition.edges.filter(
    (edge) =>
      edge.target === groupId &&
      edge.targetHandle === 'join' &&
      members.has(edge.source),
  );
  const edge = returns[0];
  if (returns.length !== 1 || edge.port !== 'default') return;
  const ports = outgoingPorts(members.get(edge.source)!);
  return ports.length === 1 && ports[0] === 'default' ? edge : undefined;
}
