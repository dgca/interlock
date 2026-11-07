import type {
  ManagedExecution,
  ResourceReservation,
  Run,
  WorkRequest,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

export interface UncertainClaim {
  id: string;
  runId: string;
  workId: string;
  attempt: number;
  revokedAt: string;
  reason: string;
}
export const uncertainClaimCollection = 'uncertainClaims';
export interface UncertainOperation {
  id: string;
  runId: string;
  executionId: string;
  attempt: number;
  revokedAt: string;
  reason: string;
}
export const uncertainOperationCollection = 'uncertainOperations';
const terminal = (run: Run) =>
  ['completed', 'failed', 'cancelled'].includes(run.status);

/** A lost claim or terminal parent never proves that external activity stopped. */
export function sourceQuiescence(
  store: Store,
  runId: string,
  localJobs = new Set<string>(),
) {
  const runs = store.sourceRunTree(runId);
  const ids = new Set(runs.map((run) => run.id));
  const blockers: {
    runId: string;
    kind: string;
    workId?: string;
    executionId?: string;
    attempt?: number;
  }[] = [];
  if (!runs.length) blockers.push({ runId, kind: 'missing_source' });
  for (const run of runs) {
    if (!terminal(run)) blockers.push({ runId: run.id, kind: 'active_run' });
    if (run.chain?.nextRunId && !ids.has(run.chain.nextRunId))
      blockers.push({ runId: run.id, kind: 'missing_continuation' });
    for (const execution of run.executions) {
      if (execution.childRunIds?.some((id) => !ids.has(id)))
        blockers.push({
          runId: run.id,
          executionId: execution.id,
          kind: 'missing_descendant',
        });
      if (localJobs.has(execution.id))
        blockers.push({
          runId: run.id,
          executionId: execution.id,
          kind: 'local_operation',
        });
      if (
        execution.background &&
        ['launching', 'running', 'uncertain'].includes(
          execution.background.state,
        )
      )
        blockers.push({
          runId: run.id,
          executionId: execution.id,
          kind: 'background_script',
        });
    }
  }
  for (const work of store.forRuns<WorkRequest>('work', ids))
    if (work.status === 'claimed')
      blockers.push({
        runId: work.runId,
        workId: work.id,
        attempt: work.attempt,
        kind: 'active_claim',
      });
  for (const claim of store.forRuns<UncertainClaim>(
    uncertainClaimCollection,
    ids,
  ))
    blockers.push({
      runId: claim.runId,
      workId: claim.workId,
      attempt: claim.attempt,
      kind: 'uncertain_claim',
    });
  for (const operation of store.forRuns<UncertainOperation>(
    uncertainOperationCollection,
    ids,
  ))
    blockers.push({
      runId: operation.runId,
      executionId: operation.executionId,
      attempt: operation.attempt,
      kind: 'uncertain_operation',
    });
  for (const reservation of store.forRuns<ResourceReservation>(
    'workResources',
    ids,
  ))
    blockers.push({
      runId: reservation.runId,
      workId: reservation.workId,
      executionId: reservation.executionId,
      attempt: reservation.attempt,
      kind: 'resource_reservation',
    });
  for (const execution of store.forRuns<ManagedExecution>(
    'managedExecutions',
    ids,
  ))
    if (
      ['starting', 'running', 'needs_human', 'interrupted'].includes(
        execution.state,
      )
    )
      blockers.push({
        runId: execution.runId,
        workId: execution.workId,
        executionId: execution.id,
        attempt: execution.attempt,
        kind: 'managed_execution',
      });
  return {
    quiescent: blockers.length === 0,
    runCount: runs.length,
    blockers: {
      items: blockers.slice(0, 20),
      total: blockers.length,
      truncated: blockers.length > 20,
    },
  };
}
