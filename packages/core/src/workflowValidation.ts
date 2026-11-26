import { InterlockError } from './errors.js';
import { ajv, compileOwnPropertyContract } from './contracts.js';
import { resourceNamesSchema } from './workResources.js';
import { resultRuleProblems } from './resultRules.js';
import { bindingLeaves } from './valueBindings.js';
import { validateVariableReferences } from './variables.js';
import { validateFetch } from './fetch.js';
import { validateBatchScopes } from './batchScopes.js';
import {
  parallelBranchPort,
  sameExecutionScope,
  validateParallelScopes,
} from './parallel.js';
import { isStartedRunSchema } from './workflowMode.js';
import { toolEdgeProblems, toolTargetIds } from './toolEdges.js';
import {
  definitionSchema,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from './workflowDefinition.js';
import type { Workflow } from './records.js';
export function supportsResultRouting(node: WorkflowNode): boolean {
  return (
    ['agent', 'script', 'fetch'].includes(node.kind) ||
    (node.kind === 'workflow' && node.mode !== 'detached')
  );
}
export function outgoingPorts(node: WorkflowNode): WorkflowEdge['port'][] {
  if (node.kind === 'exit') return [];
  if (node.kind === 'condition') return ['true', 'false'];
  if (node.kind === 'batch') return ['item', 'complete'];
  if (node.kind === 'parallel')
    return [
      ...node.branches.map(({ id }) => parallelBranchPort(id)),
      'complete',
    ];
  const routes = node.kind === 'switch' ? node : node.routing;
  const ports = routes
    ? [
        ...routes.cases.map((c) => c.port),
        ...(routes.default === undefined ? [] : [routes.default]),
      ]
    : ['default'];
  return [
    ...ports,
    ...(hasFailureRoute(node) ? ['failed'] : []),
    ...(hasTimeoutRoute(node) ? ['timeout'] : []),
  ];
}
export function hasFailureRoute(node: WorkflowNode): boolean {
  return (
    (node.kind === 'script' ||
      node.kind === 'fetch' ||
      (node.kind === 'workflow' && node.mode !== 'detached')) &&
    node.onFailure === 'route'
  );
}
export type PollWaitNode = Extract<WorkflowNode, { kind: 'wait' }> & {
  timing: Extract<
    Extract<WorkflowNode, { kind: 'wait' }>['timing'],
    { kind: 'poll' }
  >;
};
/** A Wait that re-runs a check until its result matches, instead of waiting for a clock. */
export function isPollWait(node: WorkflowNode): node is PollWaitNode {
  return node.kind === 'wait' && node.timing.kind === 'poll';
}
/** Whether a node's `timeout` route carries its original input instead of a result. */
export function hasTimeoutRoute(node: WorkflowNode): boolean {
  return (
    (node.kind === 'agent' && node.unclaimedTimeoutMs !== undefined) ||
    (isPollWait(node) && node.timing.timeoutMs !== undefined)
  );
}

export function validateDefinition(input: unknown): WorkflowDefinition {
  const d = definitionSchema.parse(input);
  validateVariableReferences(d);
  if (d.agentModelMode && !d.agentModel)
    throw new InterlockError(
      'Select an Agent model or preset before setting agentModelMode',
    );

  for (const node of d.nodes)
    if (
      node.kind === 'agent' &&
      node.context.mode === 'fresh' &&
      node.context.continuityGroup
    )
      throw new InterlockError(
        `${node.label}: fresh context cannot use a continuity group`,
      );
  for (const node of d.nodes)
    if (
      node.kind === 'script' &&
      node.executionMode === 'background' &&
      (node.transientRetry?.maxRetries ?? 0) > 0
    )
      throw new InterlockError(
        `${node.label}: transient retry requires foreground execution; reconcile an uncertain background outcome before retrying`,
      );
  for (const node of d.nodes)
    if (
      node.kind === 'agent' &&
      new Set(node.promptIds).size !== (node.promptIds?.length ?? 0)
    )
      throw new InterlockError(
        `${node.label}: saved prompt IDs must be unique`,
      );
  for (const node of d.nodes) {
    if (node.kind === 'exit' && node.continueAsNew && node.batchId)
      throw new InterlockError('Continue as new is unavailable inside a Batch');
    if (node.kind !== 'agent') continue;
    if (node.executorMode === 'harness' && !node.executor)
      throw new InterlockError(
        `${node.label}: select an executor for harness mode`,
      );
    if (
      node.executorMode === 'preset' &&
      (!node.model || node.executor !== undefined)
    )
      throw new InterlockError(
        `${node.label}: preset mode requires a model alias and no executor override`,
      );
    const problems = resultRuleProblems(
      node.resultRules,
      node.inputSchema,
      node.outputSchema,
    );
    if (problems.length)
      throw new InterlockError(`${node.label}: ${problems.join('; ')}`);
  }
  const ids = new Set(d.nodes.map((n) => n.id)),
    tools = toolTargetIds(d);
  const chainLimits = new Set(
    d.nodes.flatMap((n) =>
      n.kind === 'exit' && n.continueAsNew ? [n.continueAsNew.maxRuns] : [],
    ),
  );
  if (chainLimits.size > 1)
    throw new InterlockError('Continuing Exits must use the same maxRuns');
  if (ids.size !== d.nodes.length)
    throw new InterlockError('Node IDs must be unique');
  if (new Set(d.edges.map((e) => e.id)).size !== d.edges.length)
    throw new InterlockError('Edge IDs must be unique');
  const entries = d.nodes.filter((n) => n.kind === 'entry');
  if (entries.length !== 1)
    throw new InterlockError('A workflow needs exactly one entry');
  if (!d.nodes.some((n) => n.kind === 'exit'))
    throw new InterlockError('A workflow needs an exit');
  ajv.compile(d.inputSchema);
  ajv.compile(d.outputSchema);
  for (const node of d.nodes) {
    if (node.kind === 'parallel') compileOwnPropertyContract(node.inputSchema);
    else ajv.compile(node.inputSchema);
    if (
      node.kind === 'input' &&
      node.humanInput &&
      Object.keys(node.outputSchema).length
    )
      throw new InterlockError(
        `${node.label}: Human input uses its answer contract as the output contract`,
      );
    if (node.kind === 'input' || node.kind === 'parallel')
      compileOwnPropertyContract(node.outputSchema);
    else ajv.compile(node.outputSchema);
  }
  for (const edge of d.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      throw new InterlockError('Edge references a missing node');
    if (edge.target === entries[0].id)
      throw new InterlockError('Edges cannot target the entry');
  }
  const toolProblem = toolEdgeProblems(d)[0];
  if (toolProblem) throw new InterlockError(toolProblem.message);
  for (const node of d.nodes) {
    const resourceBindings =
      'resources' in node
        ? Object.fromEntries(
            (node.resources ?? []).map((b, i) => [String(i), b]),
          )
        : {};
    if ('resources' in node && node.resources?.length) {
      if (node.kind === 'wait' && !isPollWait(node))
        throw new InterlockError(
          `${node.label}: only polling Waits support resources`,
        );
      if (node.resources.some((b) => b.source === 'object'))
        throw new InterlockError(
          `${node.label}: resource bindings must resolve to names, not objects`,
        );
      const literals = node.resources.filter((b) => b.source === 'literal');
      if (literals.length) {
        const checked = resourceNamesSchema.safeParse(
          literals.map((b) => b.value),
        );
        if (!checked.success)
          throw new InterlockError(
            `${node.label}: invalid resource names: ${checked.error.issues[0].message}`,
          );
      }
    }
    if (node.inputBindings && (node.kind === 'entry' || node.kind === 'exit'))
      throw new InterlockError(
        'Entry and Exit cannot replace their input with bindings',
      );
    if (
      !node.batchId &&
      [
        ...bindingLeaves(node.inputBindings ?? {}),
        ...bindingLeaves(node.outputBindings ?? {}),
        ...bindingLeaves(resourceBindings),
      ].some((binding) => binding.source === 'itemInput')
    )
      throw new InterlockError('itemInput bindings require Batch membership');
    for (const binding of [
      ...bindingLeaves(node.inputBindings ?? {}),
      ...bindingLeaves(node.outputBindings ?? {}),
      ...bindingLeaves(resourceBindings),
    ]) {
      if (binding.source !== 'node' && binding.source !== 'execution') continue;
      const target = d.nodes.find(
        (candidate) => candidate.id === binding.nodeId,
      );
      if (!target || target.kind === 'entry' || target.kind === 'exit')
        throw new InterlockError(
          `${node.label}: ${binding.source === 'execution' ? 'execution' : 'node'} binding must reference an existing non-Entry/Exit node`,
        );
      if (!sameExecutionScope(target, node))
        throw new InterlockError(
          `${node.label}: ${binding.source === 'execution' ? 'execution' : 'node'} binding must reference a node in the same execution scope`,
        );
    }
    if (
      node.kind === 'workflow' &&
      node.mode === 'detached' &&
      node.onFailure === 'route'
    )
      throw new InterlockError(
        `${node.label}: detached Workflow calls cannot route child failures`,
      );
    if (node.kind === 'workflow' && node.version === null)
      throw new InterlockError(
        `${node.label}: publish the referenced workflow and select a version first`,
      );
    if (
      node.kind === 'workflow' &&
      node.mode === 'detached' &&
      !isStartedRunSchema(node.outputSchema)
    )
      throw new InterlockError(
        `${node.label}: Start and continue uses the fixed Started run output contract. Omit outputSchema or use the runId, workflowId, and version contract.`,
      );
    if (node.kind === 'fetch') validateFetch(node);
    if (isPollWait(node) && node.timing.check.kind === 'fetch')
      validateFetch(node.timing.check);
    if (
      node.kind === 'batch' &&
      !node.itemsPath &&
      node.inputSchema.type &&
      !(Array.isArray(node.inputSchema.type)
        ? node.inputSchema.type.includes('array')
        : node.inputSchema.type === 'array')
    )
      throw new InterlockError(
        `${node.label}: blank Items path requires an array input contract`,
      );
    const outgoing = d.edges.filter(
      (e) => e.source === node.id && e.kind !== 'tool',
    );
    const expected = tools.has(node.id) ? [] : outgoingPorts(node);
    if (node.routing && !supportsResultRouting(node))
      throw new InterlockError(
        `${node.label}: result routing requires an Agent, Script, Fetch or waited Workflow`,
      );
    if (node.outputBindings && !supportsResultRouting(node))
      throw new InterlockError(
        `${node.label}: output bindings require an Agent, Script, Fetch or waited Workflow`,
      );
    if (node.kind === 'switch' || node.routing) {
      if (expected.some((port) => !port.trim()))
        throw new InterlockError(
          `${node.label}: Switch port names must not be blank`,
        );
      if (new Set(expected).size !== expected.length)
        throw new InterlockError(
          `${node.label}: Switch case and default port names must be unique`,
        );
    }
    if (
      outgoing.length !== expected.length ||
      expected.some((p) => outgoing.filter((e) => e.port === p).length !== 1)
    )
      throw new InterlockError(
        node.kind === 'parallel'
          ? `${node.label}: connect every branch start and Out exactly once`
          : `${node.label}: expected outgoing routes ${expected.join(', ') || 'none'}`,
      );
  }
  validateBatchScopes(d);
  validateParallelScopes(d);
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    d.edges.filter((e) => e.source === id).forEach((e) => visit(e.target));
  };
  visit(entries[0].id);
  if (reachable.size !== ids.size)
    throw new InterlockError('Every node must be reachable from entry');
  return d;
}

/** Ownership restricts authoring references, independently of execution ancestry. */
export function validateWorkflowReferences(
  workflowId: string,
  definition: WorkflowDefinition,
  workflows: Workflow[],
) {
  for (const node of definition.nodes) {
    if (node.kind !== 'workflow') continue;
    const target = workflows.find((w) => w.id === node.workflowId);
    if (target?.ownerWorkflowId && target.ownerWorkflowId !== workflowId)
      throw new InterlockError(
        `${node.label}: only the owning workflow may reference "${target.name}"`,
      );
  }
}
