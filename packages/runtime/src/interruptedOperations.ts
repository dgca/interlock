import type { NodeExecution, Run } from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { WorkResources } from './workResources.js';

/** Fail foreground operations a restart interrupted, and forget interrupted poll checks. */
export function recoverInterruptedOperations(
  store: Store,
  resources: WorkResources,
  effects: {
    save: (run: Run) => void;
    fail: (run: Run, execution: NodeExecution, error: string) => void;
  },
) {
  // A process interruption gives no evidence that local work or remote side effects completed.
  for (const run of store.activeRuns()) {
    const execution = run.executions.at(-1);
    if (
      run.status === 'waiting' &&
      execution?.kind === 'wait' &&
      execution.operationStartedAt
    ) {
      resources.uncertainExecution(
        run.id,
        execution,
        'Service interrupted during polling check',
        true,
      );
      execution.operationStartedAt = undefined;
      effects.save(run);
    }
    if (
      run.status === 'running' &&
      (execution?.kind === 'script' || execution?.kind === 'fetch') &&
      execution.status === 'running' &&
      !execution.background &&
      (!execution.resources?.length || execution.operationStartedAt)
    ) {
      resources.uncertainExecution(
        run.id,
        execution,
        'Service interrupted during operation',
        true,
      );
      effects.fail(
        run,
        execution,
        `Service interrupted during ${execution.kind} execution. Inspect side effects before retrying.`,
      );
    }
  }
}
