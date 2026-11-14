import {
  InterlockError,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from './index.js';
import { bindingLeaves } from './valueBindings.js';
import { parallelJoinError, partialJoinShapeError } from './parallelJoin.js';

export const parallelBranchPort = (id: string) => `branch:${id}`;

export function sameExecutionScope(a: WorkflowNode, b: WorkflowNode) {
  return (
    a.batchId === b.batchId &&
    a.parallelId === b.parallelId &&
    a.parallelBranchId === b.parallelBranchId
  );
}

export function isParallelEdge(
  source: WorkflowNode,
  target: WorkflowNode,
  port: string,
  handle?: WorkflowEdge['targetHandle'],
) {
  return (
    source.parallelId !== undefined ||
    target.parallelId !== undefined ||
    (source.kind === 'parallel' && port !== 'complete') ||
    handle === 'join'
  );
}

/** Also used while connecting an incomplete draft in the editor. */
export function parallelConnectionError(
  source: WorkflowNode,
  target: WorkflowNode,
  port: string,
  handle?: WorkflowEdge['targetHandle'],
): string | undefined {
  if (!isParallelEdge(source, target, port, handle)) return;
  if (source.kind === 'parallel' && port !== 'complete') {
    if (
      (!handle || handle === 'default') &&
      target.parallelId === source.id &&
      source.branches.some(
        ({ id }) =>
          port === parallelBranchPort(id) && id === target.parallelBranchId,
      )
    )
      return;
    return `${source.label}: connect each branch start to a step in that branch`;
  }
  if (handle === 'join') {
    if (target.kind === 'parallel' && source.parallelId === target.id) return;
    return `${source.label}: Join must belong to this step's Parallel group`;
  }
  if (handle === 'end' || !sameExecutionScope(source, target))
    return `${source.label}: connections cannot cross Parallel branches; return to Join`;
}

export function validateParallelScopes(definition: WorkflowDefinition) {
  const groups = definition.nodes.filter((node) => node.kind === 'parallel');
  if (
    groups.length === 0 &&
    !definition.nodes.some(
      (node) => node.parallelId || node.parallelBranchId,
    ) &&
    !definition.edges.some((edge) => edge.targetHandle === 'join')
  )
    return;
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const group of groups) {
    if (group.batchId || group.parallelId)
      throw new InterlockError(
        `${group.label}: Parallel groups cannot be nested`,
      );
    if (group.branches.length < 2)
      throw new InterlockError(
        `${group.label}: at least two branches are required`,
      );
    if (
      new Set(group.branches.map(({ id }) => id)).size !== group.branches.length
    )
      throw new InterlockError(`${group.label}: branch IDs must be unique`);
    if (
      group.branches.some(({ key }) => !key.trim()) ||
      new Set(group.branches.map(({ key }) => key)).size !==
        group.branches.length
    )
      throw new InterlockError(
        `${group.label}: branch result keys must be nonblank and unique`,
      );
    const join = parallelJoinError(group);
    if (join) throw new InterlockError(join);
  }
  for (const node of definition.nodes) {
    if (node.parallelId === undefined && node.parallelBranchId === undefined)
      continue;
    const owner = node.parallelId ? nodes.get(node.parallelId) : undefined;
    if (
      owner?.kind !== 'parallel' ||
      !owner.branches.some(({ id }) => id === node.parallelBranchId)
    )
      throw new InterlockError(
        `${node.label}: Parallel group or branch does not exist`,
      );
    if (
      node.batchId ||
      ['batch', 'parallel', 'entry', 'exit'].includes(node.kind)
    )
      throw new InterlockError(
        `${node.label}: ${node.kind} cannot belong to a Parallel branch`,
      );
  }
  for (const node of definition.nodes) {
    const cwd =
      node.kind === 'agent' || node.kind === 'script'
        ? (node.cwd ?? definition.cwd)
        : node.kind === 'wait' &&
            node.timing.kind === 'poll' &&
            node.timing.check.kind === 'script'
          ? (node.timing.check.cwd ?? definition.cwd)
          : undefined;
    if (!cwd || typeof cwd === 'string') continue;
    for (const binding of bindingLeaves({ cwd })) {
      if (binding.source === 'itemInput' && node.parallelId)
        throw new InterlockError(
          `${node.label}: Parallel branches have no Batch item input`,
        );
      if (binding.source !== 'node' && binding.source !== 'execution') continue;
      const source = nodes.get(binding.nodeId);
      if (
        (node.parallelId || source?.parallelId) &&
        (!source || !sameExecutionScope(node, source))
      )
        throw new InterlockError(
          `${node.label}: working directory bindings must remain in the same execution scope`,
        );
    }
  }
  for (const edge of definition.edges) {
    const source = nodes.get(edge.source),
      target = nodes.get(edge.target);
    if (!source || !target) continue; // Ordinary graph validation reports missing endpoints.
    const problem = parallelConnectionError(
      source,
      target,
      edge.port,
      edge.targetHandle,
    );
    if (problem) throw new InterlockError(problem);
    const edges = outgoing.get(edge.source);
    if (edges) edges.push(edge);
    else outgoing.set(edge.source, [edge]);
  }
  const shape = partialJoinShapeError(definition);
  if (shape) throw new InterlockError(shape);
  for (const group of groups) {
    const visited = new Set<string>(),
      active = new Set<string>();
    const visit = (id: string) => {
      if (active.has(id))
        throw new InterlockError(
          `${group.label}: Parallel branch paths cannot contain cycles`,
        );
      if (visited.has(id)) return;
      visited.add(id);
      active.add(id);
      const edges = outgoing.get(id);
      if (!edges?.length)
        throw new InterlockError(
          `${nodes.get(id)?.label}: connect every branch path to Join`,
        );
      for (const edge of edges)
        if (edge.targetHandle !== 'join') visit(edge.target);
      active.delete(id);
    };
    for (const branch of group.branches) {
      const start = outgoing
        .get(group.id)
        ?.find((e) => e.port === parallelBranchPort(branch.id));
      if (!start)
        throw new InterlockError(
          `${group.label}: connect the start of branch "${branch.key}"`,
        );
      visit(start.target);
    }
    for (const node of definition.nodes)
      if (node.parallelId === group.id && !visited.has(node.id))
        throw new InterlockError(
          `${node.label}: step is unreachable from its Parallel branch start`,
        );
  }
}
