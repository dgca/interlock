export * from './runCancellation.js';
export * from './stalls.js';
export {
  scriptOperationSchema,
  type ScriptOperation,
  type BackgroundScript,
} from './backgroundScripts.js';
export type { RunAttention, RunAttentionReason } from './runAttention.js';
export * from './workResources.js';
export * from './executors.js';
export * from './transcripts.js';
import { resourceNamesSchema } from './workResources.js';
export { matchRouting } from './resultRouting.js';
export * from './simulation.js';
export * from './runChains.js';
export * from './runStarts.js';
export * from './runTags.js';
export * from './runPages.js';
export * from './memory.js';
export * from './runVersions.js';
import { InterlockError } from './errors.js';
import { ajv, compileOwnPropertyContract } from './contracts.js';
export * from './usage.js';
export * from './pricing.js';
export { DEFAULT_PRICE_TABLE } from './priceTable.js';
export * from './executionProvenance.js';
export * from './budgets.js';
export * from './resultValidation.js';
export * from './resultRules.js';
export * from './workHolds.js';
export * from './externalInput.js';
export * from './workflowBoards.js';
export * from './humanInput.js';
export * from './scriptApprovals.js';
export * from './requests.js';
import { resultRuleProblems } from './resultRules.js';
export * from './assignmentSize.js';
export * from './contextContinuity.js';
export * from './modelTiers.js';
export * from './providers.js';
export * from './trialEnvironments.js';
export * from './workspaces.js';
export * from './authoringLayout.js';
import { bindingLeaves } from './valueBindings.js';
import { validateVariableReferences } from './variables.js';
export * from './variables.js';
export * from './modelAliases.js';
export {
  bindingLeaves,
  resolveBindingFields,
  resolveValueBinding,
  type PathBinding,
} from './valueBindings.js';
import { validateFetch } from './fetch.js';
export * from './fetch.js';
import { validateBatchScopes } from './batchScopes.js';
import {
  parallelBranchPort,
  sameExecutionScope,
  validateParallelScopes,
} from './parallel.js';
export * from './parallelJoin.js';
import { isStartedRunSchema } from './workflowMode.js';
export { STARTED_RUN_SCHEMA, isStartedRunSchema } from './workflowMode.js';
export {
  FAILURE_ROUTE_SCHEMA,
  WORKFLOW_FAILURE_ROUTE_SCHEMA,
  failureRouteContract,
  type FailureCategory,
} from './failureRoute.js';
export { validateBatchScopes } from './batchScopes.js';
export { blankDefinition } from './blankDefinition.js';
export * from './toolEdges.js';
import { toolEdgeProblems, toolTargetIds } from './toolEdges.js';
export {
  parallelBranchPort,
  parallelConnectionError,
  sameExecutionScope,
  validateParallelScopes,
} from './parallel.js';

export * from './json.js';
export * from './workflowDefinition.js';
import {
  definitionSchema,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from './workflowDefinition.js';
export * from './records.js';
import type { Workflow } from './records.js';
export {
  workflowCatalogQuerySchema,
  workflowCatalogEntry,
  promptCatalogEntry,
  type WorkflowCatalogQuery,
  type WorkflowCatalogEntry,
  type PromptCatalogEntry,
} from './catalogs.js';
export * from './runQueries.js';
export * from './errors.js';
export { readPath } from './dataPath.js';
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

export {
  fieldTypes,
  fieldType,
  newContract,
  propertiesOf,
  requiredOf,
  visualIssues,
  renameField,
  inferContract,
  contractExample,
  contractSchema,
  validateContractSchema,
  assertContract,
  assertOwnPropertyContract,
  type Contract,
  type FieldType,
} from './contracts.js';
export {
  contractAtPath,
  contractPaths,
  nodeInputHint,
  nodeOutputContract,
  type InputHint,
} from './inputHints.js';

export function nodeKindLabel(kind: WorkflowNode['kind']): string {
  if (kind === 'input') return 'External input';
  if (kind === 'parallel') return 'Parallel';
  return kind === 'switch' || kind === 'condition'
    ? 'Branch'
    : kind === 'batch'
      ? 'Batch'
      : kind;
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

export {
  workflowEditSchema,
  workflowEditsSchema,
  applyWorkflowEdits,
  draftChanges,
  type DraftChanges,
} from './workflowEdits.js';

export { diagnoseDraft, type DraftDiagnostic } from './draftDiagnostics.js';
export {
  versionReferenceSchema,
  versionSelectionSchema,
  versionDeletionSchema,
  deletedVersionSchema,
  type VersionReference,
  type DeletedWorkflowVersion,
} from './versionCleanup.js';
export {
  ownershipPreviewSchema,
  ownershipChangeSchema,
  type OwnershipPreviewInput,
  type OwnershipChangeInput,
} from './ownership.js';
export {
  briefingQuerySchema,
  waitQuerySchema,
  resultQuerySchema,
  continuationLimitSchema,
  mutationDetailSchema,
  mutationSummarySchema,
  submissionSummarySchema,
} from './continuation.js';
export {
  promptContentSchema,
  promptCreateSchema,
  promptRevisionConflict,
  savedPromptSchema,
  promptReadSchema,
  promptIds,
  snapshotPrompt,
  samePromptContent,
  composePrompt,
  type SavedPrompt,
  type PromptSnapshot,
  type PromptContent,
  type PromptUsage,
} from './prompts.js';

export {
  testAssertionSchema,
  testCaseSchema,
  suiteContentSchema,
  createSuiteSchema,
  updateSuiteSchema,
  comparisonPreviewSchema,
  comparisonSideSchema,
  comparisonExecutorSchema,
  type ComparisonSideSelection,
  type ComparisonConfiguration,
  comparisonStartSchema,
  testbenchListSchema,
  comparisonReportSchema,
  comparisonCaseSchema,
  comparisonCancelSchema,
  qualityJudgmentSchema,
  testSuiteReadSchema,
  testSuiteSaveSchema,
  comparisonReadSchema,
  comparisonUpdateSchema,
  assertionProblems,
  evaluateAssertions,
  type TestAssertion,
  type SuiteContent,
  type CapturedCase,
  type TestSuite,
  type ComparisonRunContext,
  type CheckResult,
  type ComparisonSample,
  type ComparisonMeasurement,
  type ComparisonPin,
  type QualityJudgment,
  type WorkflowComparison,
} from './testbench.js';

export * from './authoring.js';
export * from './runHistory.js';
export * from './evaluation.js';

export { nextCallSchema, withNextCall } from './continuation.js';
export * from './runProjection.js';
export * from './pauseHolds.js';
export * from './workflowTriggers.js';

export * from './workflowDiff.js';
export * from './workflowLayout.js';
export * from './eventTriggers.js';
export * from './doctor.js';
export * from './report.js';
export { VERSION } from './version.js';
