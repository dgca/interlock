import {
  assertContract,
  assertOwnPropertyContract,
  type ComparisonRunContext,
  hasFailureRoute,
  hasTimeoutRoute,
  InterlockError,
  matchRouting,
  readPath,
  resolveBindingFields,
  resolveProvider,
  STARTED_RUN_SCHEMA,
  type FailureCategory,
  type Json,
  type ModelUsage,
  type NodeExecution,
  type PathBinding,
  type Run,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { message, now, terminal } from './engineHelpers.js';
import { ResultProcessingError } from './engineTypes.js';
import type { ExecutorManager } from './executors/manager.js';
import { buildExecutionProvenance, calculateVisitCount } from './nodeData.js';
import type { RunChains } from './runChains.js';
import type { WorkResources } from './workResources.js';

/**
 * Ends a run's current step: validates, routes and shapes a result, records
 * its provenance, and fails a step or follows its Failed route.
 */
export class StepCompletion {
  constructor(
    private readonly store: Store,
    private readonly run: (id: string) => Run,
    private readonly save: (run: Run) => void,
    private readonly event: (run: Run, type: string, text: string) => void,
    private readonly definition: (
      run: Pick<Run, 'workflowId' | 'version'>,
    ) => WorkflowDefinition,
    private readonly cancelTree: (id: string) => void,
    private readonly newRun: (
      workflowId: string,
      version: number,
      input: Json,
      parentRunId?: string,
      batchNodeId?: string,
      comparison?: ComparisonRunContext,
      continuedFrom?: Run,
    ) => Run,
    private readonly chains: RunChains,
    private readonly executors: ExecutorManager,
    private readonly resources: WorkResources,
  ) {}
  fail(run: Run, execution: NodeExecution, error: string) {
    if (execution.resourceActive)
      this.resources.endExecution(run.id, execution, true);
    for (const id of execution.childRunIds)
      if (
        this.run(id).parentMode !== 'detached' &&
        !terminal(this.run(id).status)
      )
        this.cancelTree(id);
    execution.status = 'failed';
    execution.error = error;
    execution.completedAt = now();
    run.status = 'failed';
    run.error = error;
    this.save(run);
    this.event(run, 'node.failed', `${execution.label}: ${error}`);
  }
  failOperation(
    run: Run,
    execution: NodeExecution,
    node: WorkflowNode,
    error: string,
    category: FailureCategory,
    child?: Run,
  ) {
    if (!hasFailureRoute(node)) return this.fail(run, execution, error);
    const edge = this.definition(run).edges.find(
      (e) => e.source === node.id && e.port === 'failed',
    );
    if (
      !edge ||
      (edge.targetHandle === 'end' && edge.target !== run.batchNodeId) ||
      (edge.targetHandle === 'join' &&
        edge.target !== run.parallelBranch?.nodeId)
    )
      return this.fail(run, execution, `${error}; invalid Failed route`);
    const value: Json = {
      input: execution.input,
      error: {
        nodeId: node.id,
        executionId: execution.id,
        kind: node.kind,
        category,
        message: error,
        ...(child
          ? {
              child: {
                runId: child.id,
                workflowId: child.workflowId,
                version: child.version,
                executionId: child.executions.at(-1)?.id ?? null,
              },
            }
          : {}),
      },
      output: execution.output ?? null,
    };
    execution.status = 'failed';
    execution.error = error;
    execution.port = 'failed';
    execution.completedAt = now();
    run.value = value;
    if (edge.targetHandle === 'end' || edge.targetHandle === 'join') {
      run.status = 'completed';
      run.output = value;
      this.event(
        run,
        'run.completed',
        run.parallelBranch ? 'Branch result returned' : 'Item result returned',
      );
    } else {
      run.cursor = edge.target;
      run.status = 'running';
    }
    this.save(run);
    this.event(run, 'node.failed', `${execution.label}: ${error}`);
    this.event(
      run,
      'node.failure_routed',
      `${execution.label}: followed Failed`,
    );
  }
  failWorkflow(
    run: Run,
    node: Extract<WorkflowNode, { kind: 'workflow' }>,
    child: Run,
    error: string,
    category: 'child' | 'output',
  ) {
    // A failed write must not leave a routed port or value in the terminal
    // failure path. The child and caller history remain independently inspectable.
    this.store.transaction(() => {
      const routed = structuredClone(run),
        execution = routed.executions.at(-1)!;
      if (category === 'output') execution.output = child.output;
      this.failOperation(routed, execution, node, error, category, child);
    });
  }
  bindingSource(run: Run, input: Json): (b: PathBinding) => Json | undefined {
    if (run.toolCall)
      return this.bindingSource(this.run(run.parentRunId!), input);
    let workflowRun = run;
    while (
      (workflowRun.batchNodeId || workflowRun.parallelBranch) &&
      workflowRun.parentRunId
    )
      workflowRun = this.run(workflowRun.parentRunId);
    let root = workflowRun;
    while (root.parentRunId) root = this.run(root.parentRunId);
    const sources = {
      input,
      runInput: workflowRun.input,
      rootInput: root.input,
      itemInput: run.input,
    };
    return (binding: PathBinding): Json | undefined => {
      if (binding.source === 'itemInput' && !run.batchNodeId)
        throw new InterlockError(
          'itemInput is only available inside a Batch item run',
        );
      if (binding.source === 'execution') {
        const previous = run.executions.findLast(
          (candidate) =>
            candidate.nodeId === binding.nodeId &&
            candidate.status === 'completed',
        );
        return (previous?.provenance ?? undefined) as unknown as
          Json | undefined;
      }
      if (binding.source !== 'node') return sources[binding.source];
      const previous = run.executions.findLast(
        (candidate) =>
          candidate.nodeId === binding.nodeId &&
          candidate.status === 'completed',
      );
      return previous?.output;
    };
  }
  prepareResult(run: Run, node: WorkflowNode, result: Json) {
    let port = 'default';
    if (node.routing) {
      try {
        const matched = matchRouting(node.routing, result, (nodeId, path) => {
          const previous = run.executions.findLast(
            (e) => e.nodeId === nodeId && e.status === 'completed',
          );
          if (path === 'visitCount')
            return previous?.provenance?.visitCount ?? 0;
          if (!previous?.provenance) return null;
          return readPath(previous.provenance as unknown as Json, path);
        });
        if (matched === undefined)
          throw new InterlockError(
            `No result branch matched at "${node.routing.path || '$'}"`,
          );
        port = matched;
      } catch (error) {
        throw new ResultProcessingError(
          'routing',
          `${node.label} result routing: ${message(error)}`,
        );
      }
    }
    try {
      const output = node.outputBindings
        ? resolveBindingFields(
            node.outputBindings,
            this.bindingSource(run, result),
          )
        : result;
      return { port, output };
    } catch (error) {
      throw new ResultProcessingError(
        'outputBindings',
        `${node.label} output fields: ${message(error)}`,
      );
    }
  }
  finish(
    run: Run,
    execution: NodeExecution,
    node: WorkflowNode,
    output: Json,
    port: WorkflowEdge['port'] = 'default',
  ) {
    // Lifecycle routes bypass success-result validation, routing and shaping.
    const timeout = port === 'timeout' && hasTimeoutRoute(node);
    if (!timeout) {
      const assertOutput =
        node.kind === 'input' || node.kind === 'parallel'
          ? assertOwnPropertyContract
          : assertContract;
      assertOutput(
        node.kind === 'workflow' && node.mode === 'detached'
          ? STARTED_RUN_SCHEMA
          : node.outputSchema,
        output,
        `${node.label} output`,
      );
    }
    let rawResult: Json | undefined;
    if (port === 'default' && (node.routing || node.outputBindings)) {
      try {
        const prepared = this.prepareResult(run, node, output);
        if (node.outputBindings) rawResult = output;
        output = prepared.output;
        port = prepared.port;
      } catch (error) {
        execution.result = output;
        this.fail(run, execution, message(error));
        return;
      }
    }
    const edge = this.definition(run).edges.find(
      (e) => e.source === node.id && e.port === port && e.kind !== 'tool',
    );
    if (!edge && node.kind !== 'exit' && !run.toolCall)
      throw new InterlockError(
        'Missing outgoing route; connect item paths to End',
      );
    if (edge?.targetHandle === 'end' && edge.target !== run.batchNodeId)
      throw new InterlockError('End must belong to the current Batch group');
    if (
      edge?.targetHandle === 'join' &&
      edge.target !== run.parallelBranch?.nodeId
    )
      throw new InterlockError(
        'Join must belong to the current Parallel group',
      );
    if (node.kind === 'exit' && !node.continueAsNew)
      assertContract(
        this.definition(run).outputSchema,
        output,
        'Workflow output',
      );
    if (node.kind === 'exit' && node.continueAsNew) {
      // A nested savepoint prevents a committed orphan if either write fails.
      // Copies keep rollback IDs out of the engine's failure path.
      this.store.transaction(() => {
        const previous = structuredClone(run);
        assertContract(
          this.definition(previous).inputSchema,
          output,
          'Successor workflow input',
        );
        const successor = this.chains.next(previous, () =>
          this.newRun(
            previous.workflowId,
            previous.version,
            output,
            undefined,
            undefined,
            undefined,
            previous,
          ),
        );
        const step = previous.executions.at(-1)!;
        const visitCount = calculateVisitCount(previous.executions, node.id);
        // One clock read, so the step and its provenance agree on when it ended.
        step.completedAt = now();
        step.provenance = buildExecutionProvenance({
          node,
          execution: step,
          visitCount,
          attempt: step.attempt ?? 1,
          endedAt: step.completedAt,
        });
        step.output = output;
        step.port = port;
        step.status = 'completed';
        previous.value = output;
        previous.status = 'completed';
        // A continuing Exit produces a checkpoint, not a final workflow result.
        this.save(previous);
        this.event(
          previous,
          'run.continued',
          `Continued as run ${successor.id}`,
        );
        this.event(previous, 'node.completed', step.label);
      });
      return;
    }
    const visitCount = calculateVisitCount(run.executions, node.id);
    let managed:
      | {
          profileId?: string | null;
          harness?: string | null;
          sessionId?: string | null;
          requestedModel?: string | null;
          actualModel?: string | null;
          provider?: string | null;
          effort?: string | null;
          usage?: ModelUsage[] | null;
        }
      | undefined;
    let attempt = execution.attempt ?? 1;
    if (node.kind === 'agent') {
      const work = this.store
        .work(undefined, run.id)
        .find((w) => w.executionId === execution.id);
      if (work) {
        attempt = work.attempt;
        managed = this.executors.executionProvenance(work.id, work.attempt);
        if (
          !managed &&
          (work.executorModel || work.modelSelection || node.model)
        ) {
          const actualModel =
            work.modelSelection?.model ??
            work.executorModel ??
            node.model ??
            null;
          const provider = resolveProvider({
            model: actualModel,
            catalogProvider: work.modelSelection?.provider,
            prefixOverrides: this.executors.settings().providerPrefixes,
          });
          managed = {
            profileId: work.executor ?? null,
            harness: null,
            sessionId: null,
            requestedModel: work.executorModel ?? node.model ?? null,
            actualModel,
            provider,
            effort: work.executorEffort ?? null,
            usage: null,
          };
        }
      }
    }
    // One clock read, so the step and its provenance agree on when it ended.
    execution.completedAt = now();
    execution.provenance = buildExecutionProvenance({
      node,
      execution,
      visitCount,
      managed,
      attempt,
      endedAt: execution.completedAt,
    });
    if (rawResult !== undefined) execution.result = rawResult;
    execution.output = output;
    execution.port = port;
    execution.status = 'completed';
    run.value = output;
    if (
      node.kind === 'exit' ||
      run.toolCall ||
      edge?.targetHandle === 'end' ||
      edge?.targetHandle === 'join'
    ) {
      run.status = 'completed';
      run.output = output;
      this.event(
        run,
        'run.completed',
        run.toolCall
          ? 'Tool result returned'
          : run.parallelBranch
            ? 'Branch result returned'
            : run.batchNodeId
              ? 'Item result returned'
              : 'Workflow completed',
      );
    } else {
      run.cursor = edge!.target;
      run.status = 'running';
    }
    this.save(run);
    this.event(run, 'node.completed', execution.label);
  }
}
