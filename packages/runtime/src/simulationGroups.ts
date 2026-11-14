import {
  parallelBranchPort,
  STARTED_RUN_SCHEMA,
  type NodeExecution,
  type Run,
  type RouteCoverage,
  type WorkflowDefinition,
} from '@interlock/core';

export type Trace = {
  executionId: string;
  nodeId: string;
  kind: string;
  status: string;
  port?: string;
  item?: number;
  branch?: string;
  truncated?: boolean;
};
type Step = { execution: NodeExecution; run: Run };

// Batch items, Parallel branches and Agent tool calls are child runs of the
// same graph. Visit them depth first, right after the step that started them.
function steps(run: Run, read: (id: string) => Run): Step[] {
  return run.executions.flatMap((execution) => [
    { execution, run },
    ...(execution.kind === 'batch' || execution.kind === 'parallel'
      ? execution.childRunIds.flatMap((id) => steps(read(id), read))
      : execution.kind === 'agent'
        ? execution.childRunIds.flatMap((id) => {
            const call = read(id);
            return call.toolCall ? steps(call, read) : [];
          })
        : []),
  ]);
}

export function trace(run: Run, read: (id: string) => Run): Trace[] {
  return steps(run, read).map(({ execution: e, run: owner }) => ({
    executionId: e.id,
    nodeId: e.nodeId.slice(0, 256),
    kind: e.kind,
    status: e.status,
    ...(e.port ? { port: e.port.slice(0, 256) } : {}),
    ...(owner.batchItemIndex !== undefined
      ? { item: owner.batchItemIndex }
      : {}),
    ...(owner.parallelBranch
      ? { branch: owner.parallelBranch.key.slice(0, 256) }
      : {}),
    ...(e.nodeId.length > 256 || (e.port?.length ?? 0) > 256
      ? { truncated: true }
      : {}),
  }));
}

export function computeCoverage(
  definition: WorkflowDefinition,
  run: Run,
  read: (id: string) => Run,
): RouteCoverage {
  // A group step's own port is its completion route; started children cover
  // the Batch item route and each Parallel branch route.
  const taken = new Set<string>();
  for (const { execution } of steps(run, read)) {
    taken.add(`${execution.nodeId}\0${execution.port ?? 'default'}`);
    for (const id of execution.childRunIds) {
      if (execution.kind === 'batch') taken.add(`${execution.nodeId}\0item`);
      if (execution.kind !== 'parallel') continue;
      const branch = read(id).parallelBranch;
      if (branch)
        taken.add(`${execution.nodeId}\0${parallelBranchPort(branch.id)}`);
    }
  }
  const covered = (e: WorkflowDefinition['edges'][number]) =>
    taken.has(`${e.source}\0${e.port ?? 'default'}`);
  // Tool edges are never routes, so route coverage leaves them out.
  const routes = definition.edges.filter((e) => e.kind !== 'tool');
  const totalEdges = routes.length;
  const coveredEdges = routes.filter(covered).length;
  const tools = definition.edges.filter((e) => e.kind === 'tool');
  const called = new Set(
    steps(run, read).flatMap(({ run: owner }) => owner.toolCall?.edgeId ?? []),
  );
  return {
    ...(tools.length
      ? {
          tools: {
            total: tools.length,
            called: tools.filter((e) => called.has(e.id)).length,
            uncalled: tools.filter((e) => !called.has(e.id)).map((e) => e.id),
          },
        }
      : {}),
    totalEdges,
    coveredEdges,
    percentage:
      totalEdges > 0
        ? Math.round((coveredEdges / totalEdges) * 1000) / 10
        : 100,
    untested: routes
      .filter((e) => !covered(e))
      .map((e) => ({
        edgeId: e.id,
        source: e.source,
        target: e.target,
        ...(e.port ? { port: e.port } : {}),
      })),
  };
}

// Simulation runs one Batch item or Parallel branch at a time, in input and
// branch order. A detached call with a workflow fixture takes the waited path,
// where the fixture supplies the run reference, checked against the Started
// run contract, and no child starts.
export const forSimulation = <V extends { definition: WorkflowDefinition }>(
  version: V,
  substituted: Set<string>,
): V => ({
  ...version,
  definition: {
    ...version.definition,
    nodes: version.definition.nodes.map((node) =>
      node.kind === 'batch' || node.kind === 'parallel'
        ? { ...node, concurrency: 1 }
        : node.kind === 'workflow' &&
            node.mode === 'detached' &&
            substituted.has(node.id)
          ? { ...node, mode: 'wait' as const, outputSchema: STARTED_RUN_SCHEMA }
          : node,
    ),
  },
});
