import {
  assertContract,
  decideJoin,
  DEFAULT_BATCH_MAX_ITEMS,
  hasFailureRoute,
  InterlockError,
  isStartedRunSchema,
  readPath,
  type Json,
  type NodeExecution,
  type Run,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { message, terminal } from './engineHelpers.js';
import type { RunCancellation } from './runCancellation.js';
import type { RunCreation } from './runCreation.js';
import type { StepCompletion } from './stepCompletion.js';

/**
 * Child runs of a step: starts a detached Workflow, dispatches and joins a
 * waited Workflow's child, Batch items and Parallel branches within their
 * concurrency, and resumes retried children.
 */
export class ChildRuns {
  constructor(
    private readonly store: Store,
    private readonly run: (id: string) => Run,
    private readonly save: (run: Run) => void,
    private readonly definition: (
      run: Pick<Run, 'workflowId' | 'version'>,
    ) => WorkflowDefinition,
    private readonly newRun: RunCreation['newRun'],
    private readonly finish: StepCompletion['finish'],
    private readonly failWorkflow: StepCompletion['failWorkflow'],
    private readonly cancelTree: RunCancellation['cancelTree'],
    private readonly resumeStep: (run: Run) => void,
  ) {}
  private pinnedVersion(node: Extract<WorkflowNode, { kind: 'workflow' }>) {
    if (node.version === null)
      throw new InterlockError(
        'Cannot execute an unpublished workflow reference',
      );
    return node.version;
  }
  advanceDetached(
    run: Run,
    execution: NodeExecution,
    node: Extract<WorkflowNode, { kind: 'workflow' }>,
  ): boolean {
    if (!isStartedRunSchema(node.outputSchema))
      throw new InterlockError(
        `${node.label}: Start and continue requires the fixed Started run output contract`,
      );
    const version = this.pinnedVersion(node);
    const target = this.definition({
      workflowId: node.workflowId,
      version,
    });
    assertContract(
      target.inputSchema,
      execution.input,
      `${node.label}: workflow input`,
    );
    // A savepoint protects child creation if finishing the dispatch fails.
    // Mutate a copy so the failure path never retains rolled-back child IDs.
    this.store.transaction(() => {
      const dispatched = structuredClone(run);
      const step = dispatched.executions.at(-1)!;
      const child = step.childRunIds.length
        ? this.run(step.childRunIds[0])
        : this.newRun(node.workflowId, version, step.input, run.id);
      child.parentMode = 'detached';
      delete child.callerExecutor; // Detached starts keep their own agent.
      child.parentExecutionId = step.id;
      this.save(child);
      step.childRunIds = [child.id];
      this.finish(dispatched, step, node, {
        runId: child.id,
        workflowId: child.workflowId,
        version: child.version,
      });
    });
    return true;
  }
  advanceWorkflowOrBatch(
    run: Run,
    execution: NodeExecution,
    node: Extract<WorkflowNode, { kind: 'workflow' | 'batch' }>,
    starting: boolean,
    /** Receives the live execution when dispatch replaces it, before anything else can throw. */
    replaced: (execution: NodeExecution) => void,
  ): boolean {
    const value =
      node.kind !== 'workflow'
        ? readPath(execution.input, node.itemsPath)
        : [execution.input];
    if (!Array.isArray(value))
      throw new InterlockError('Batch input must resolve to an array');
    if (
      node.kind === 'batch' &&
      value.length > (node.maxItems ?? DEFAULT_BATCH_MAX_ITEMS)
    )
      throw new InterlockError(
        `Batch input has ${value.length} items; limit is ${node.maxItems ?? DEFAULT_BATCH_MAX_ITEMS} items (maxItems). Raise Maximum items or split the input.`,
      );
    let children = execution.childRunIds.map((id) => this.run(id));
    if (node.kind === 'workflow' || node.failurePolicy === 'all') {
      const failed = children.find(
        (c) =>
          (c.status === 'failed' || c.status === 'cancelled') &&
          !execution.retryChildRunIds?.includes(c.id),
      );
      if (failed) {
        if (
          node.kind === 'workflow' &&
          hasFailureRoute(node) &&
          failed.status === 'failed'
        ) {
          this.failWorkflow(
            run,
            node,
            failed,
            `Child run ${failed.id}: ${failed.error ?? 'failed'}`,
            'child',
          );
          return true;
        }
        for (const child of children)
          if (!terminal(child.status)) this.cancelTree(child.id);
        throw new InterlockError(
          `Child run ${failed.id}: ${failed.error ?? failed.status}${node.kind === 'batch' ? `; ${children.filter((c) => c.status === 'completed').length} of ${value.length} Batch items completed` : ''}`,
        );
      }
    }
    let changed = starting;
    const concurrency = node.kind !== 'workflow' ? node.concurrency : 1;
    let active = children.filter((c) => !terminal(c.status)).length;
    while (execution.retryChildRunIds?.length && active < concurrency) {
      this.resumeStep(this.run(execution.retryChildRunIds.shift()!));
      active++;
      changed = true;
    }
    while (
      execution.nextItem < value.length &&
      active < concurrency &&
      !execution.retryChildRunIds?.length
    ) {
      if (node.kind === 'workflow' && hasFailureRoute(node))
        assertContract(
          this.definition({
            workflowId: node.workflowId,
            version: this.pinnedVersion(node),
          }).inputSchema,
          execution.input,
          `${node.label}: workflow input`,
        );
      if (node.kind === 'workflow' && hasFailureRoute(node)) {
        // Dispatch configuration and persistence failures are terminal, not
        // child outcomes. Commit allocation and its caller link together.
        const dispatched = this.store.transaction(() => {
          const copy = structuredClone(run),
            step = copy.executions.at(-1)!;
          const child = this.newRun(
            node.workflowId,
            this.pinnedVersion(node),
            step.input,
            run.id,
          );
          step.childRunIds.push(child.id);
          step.nextItem++;
          step.status = 'waiting';
          copy.status = 'waiting';
          this.save(copy);
          return copy;
        });
        Object.assign(run, dispatched);
        execution = run.executions.at(-1)!;
        replaced(execution);
      } else {
        const child = this.newRun(
          node.kind === 'batch' ? run.workflowId : node.workflowId,
          node.kind === 'batch' ? run.version : this.pinnedVersion(node),
          value[execution.nextItem],
          run.id,
          node.kind === 'batch' ? node.id : undefined,
        );
        if (node.kind === 'batch') {
          child.workflowName = `${node.label} · item ${execution.nextItem + 1}`;
          child.batchItemIndex = execution.nextItem;
          child.parentExecutionId = execution.id;
          this.save(child);
        }
        execution.childRunIds.push(child.id);
        execution.nextItem++;
      }
      active++;
      changed = true;
    }
    children = execution.childRunIds.map((id) => this.run(id));
    if (
      !execution.retryChildRunIds?.length &&
      execution.nextItem === value.length &&
      children.every((c) => terminal(c.status))
    ) {
      const output: Json =
        node.kind === 'workflow'
          ? children[0].output!
          : node.failurePolicy === 'collect'
            ? children.map((c) => ({
                runId: c.id,
                status: c.status,
                output: c.output ?? null,
                error: c.error ?? null,
              }))
            : children.map((c) => c.output!);
      if (node.kind === 'workflow' && hasFailureRoute(node)) {
        try {
          assertContract(node.outputSchema, output, `${node.label} output`);
        } catch (error) {
          this.failWorkflow(run, node, children[0], message(error), 'output');
          return true;
        }
      }
      this.finish(
        run,
        execution,
        node,
        output,
        node.kind === 'batch' ? 'complete' : 'default',
      );
      return true;
    }
    if (changed || execution.status !== 'waiting' || run.status !== 'waiting') {
      execution.status = 'waiting';
      run.status = 'waiting';
      this.save(run);
    }
    return changed;
  }
  advanceParallel(
    run: Run,
    execution: NodeExecution,
    node: Extract<WorkflowNode, { kind: 'parallel' }>,
    starting: boolean,
  ) {
    const children = execution.childRunIds.map((id) => this.run(id));
    const join = decideJoin(node, children, execution.retryChildRunIds);
    // The ordinary failure path cancels unfinished waited descendants.
    if (join.kind === 'fail') throw new InterlockError(join.error);
    if (join.kind === 'complete') {
      try {
        this.finish(run, execution, node, join.output, 'complete');
      } catch (error) {
        join.cancel = { reason: `${node.label} failed: ${message(error)}` };
        throw error;
      } finally {
        for (const id of execution.childRunIds)
          this.cancelTree(id, undefined, join.cancel);
      }
      return true;
    }
    let changed = starting;
    let active = children.filter((child) => !terminal(child.status)).length;
    while (execution.retryChildRunIds?.length && active < node.concurrency) {
      this.resumeStep(this.run(execution.retryChildRunIds.shift()!));
      active++;
      changed = true;
    }
    while (
      execution.nextItem < node.branches.length &&
      active < node.concurrency &&
      !execution.retryChildRunIds?.length
    ) {
      const branch = node.branches[execution.nextItem];
      const next = { ...execution, childRunIds: [...execution.childRunIds] };
      this.store.transaction(() => {
        const child = this.newRun(
          run.workflowId,
          run.version,
          structuredClone(execution.input),
          run.id,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { nodeId: node.id, id: branch.id, key: branch.key },
          execution.id,
        );
        next.childRunIds.push(child.id);
        next.nextItem++;
        next.status = 'waiting';
        this.save({
          ...run,
          status: 'waiting',
          executions: [...run.executions.slice(0, -1), next],
        });
      });
      Object.assign(execution, next);
      active++;
      changed = true;
    }
    if (changed || execution.status !== 'waiting' || run.status !== 'waiting') {
      execution.status = 'waiting';
      run.status = 'waiting';
      this.save(run);
    }
    return changed;
  }
}
