import type { Run, Workflow, WorkflowDefinition } from '@interlock/core';
import type { Store } from '@interlock/storage';

/**
 * Captures the harness an owned helper inherits from the run that invoked it,
 * so retries and restarts resolve the same harness after later edits.
 * A Workflow node child captures its caller's effective workflow-level executor
 * from the caller's pinned version when the caller owns it and it sets none.
 * Batch items and parallel branches copy their parent run's capture.
 * Independent workflows and comparison trees never capture one.
 */
export function callerExecutorCapture(
  store: Store,
  run: Run,
  workflow: Workflow,
  definition: WorkflowDefinition,
): Pick<Run, 'callerExecutor'> {
  if (!run.parentRunId || run.comparison || definition.executor) return {};
  const caller = store.get<Run>('runs', run.parentRunId);
  if (!caller) return {};
  const sameWorkflow = !!(run.batchNodeId || run.parallelBranch);
  if (!sameWorkflow && workflow.ownerWorkflowId !== caller.workflowId)
    return {};
  const executor =
    (!sameWorkflow &&
      store.getVersion(caller.workflowId, caller.version)?.definition
        .executor) ||
    caller.callerExecutor;
  return executor ? { callerExecutor: executor } : {};
}
