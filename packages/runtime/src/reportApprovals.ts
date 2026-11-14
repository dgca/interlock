import type { ApprovalsReport, ManagedExecution, Run } from '@interlock/core';

/**
 * Permission requests per run across its managed executions. A person answered
 * the prompted ones; the workflow permission policy answered the rest.
 */
export function approvalsReport(
  runs: Run[],
  executions: {
    runId: string;
    requests?: Pick<ManagedExecution['requests'][number], 'kind'>[];
    permissionPolicy?: ManagedExecution['permissionPolicy'];
  }[],
): ApprovalsReport {
  const byRun = new Map<string, ApprovalsReport['byRun'][number]>();
  const workflows = new Map(runs.map((run) => [run.id, run.workflowId]));
  for (const execution of executions) {
    const workflowId = workflows.get(execution.runId);
    const prompted = (execution.requests ?? []).filter(
      (request) => request.kind === 'permission',
    ).length;
    const policy = execution.permissionPolicy;
    if (!workflowId || (!prompted && !policy)) continue;
    const entry = byRun.get(execution.runId) ?? {
      runId: execution.runId,
      workflowId,
      prompted: 0,
      autoAllowed: 0,
    };
    entry.prompted += prompted;
    entry.autoAllowed += policy?.autoAllowed ?? 0;
    const notApplied = new Set([
      ...(entry.notApplied ?? []),
      ...(policy?.notApplied ?? []),
    ]);
    if (notApplied.size) entry.notApplied = [...notApplied];
    byRun.set(execution.runId, entry);
  }
  const rows = [...byRun.values()];
  return {
    prompted: rows.reduce((sum, row) => sum + row.prompted, 0),
    autoAllowed: rows.reduce((sum, row) => sum + row.autoAllowed, 0),
    byRun: rows,
  };
}
