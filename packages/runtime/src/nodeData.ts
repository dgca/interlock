import type {
  ExecutionProvenance,
  ModelUsage,
  NodeExecution,
  Run,
  WorkflowNode,
} from '@interlock/core';

export interface NodeProvenanceHistory {
  visitCount: number;
  latest: ExecutionProvenance;
  history: ExecutionProvenance[];
}

export function calculateVisitCount(
  executions: NodeExecution[],
  nodeId: string,
): number {
  let count = 0;
  for (const execution of executions) {
    if (execution.nodeId === nodeId && execution.status === 'completed') {
      count++;
    }
  }
  return count + 1;
}

export interface BuildProvenanceOptions {
  node: WorkflowNode;
  execution: NodeExecution;
  visitCount: number;
  managed?: {
    profileId?: string | null;
    harness?: string | null;
    sessionId?: string | null;
    requestedModel?: string | null;
    actualModel?: string | null;
    provider?: string | null;
    effort?: string | null;
    usage?: ModelUsage[] | null;
  };
  attempt?: number;
  endedAt?: string;
}

export function buildExecutionProvenance(
  options: BuildProvenanceOptions,
): ExecutionProvenance {
  const { node, execution, visitCount, managed, attempt, endedAt } = options;
  const now = endedAt ?? new Date().toISOString();
  const effectiveAttempt = attempt ?? execution.attempt ?? 1;

  if (node.kind === 'agent' && managed) {
    return {
      profileId: managed.profileId ?? null,
      harness: managed.harness ?? null,
      sessionId: managed.sessionId ?? null,
      requestedModel: managed.requestedModel ?? null,
      actualModel: managed.actualModel ?? null,
      provider: managed.provider ?? null,
      effort: managed.effort ?? null,
      attempt: effectiveAttempt,
      visitCount,
      startedAt: execution.startedAt ?? null,
      endedAt: now,
      usage: managed.usage ?? null,
    };
  }

  return {
    profileId: null,
    harness: null,
    sessionId: null,
    requestedModel: null,
    actualModel: null,
    provider: null,
    effort: null,
    attempt: effectiveAttempt,
    visitCount,
    startedAt: execution.startedAt ?? null,
    endedAt: now,
    usage: null,
  };
}

export function buildRunExecutionProvenanceFile(
  run: Run,
): Record<string, NodeProvenanceHistory> {
  const result: Record<string, NodeProvenanceHistory> = {};
  for (const execution of run.executions) {
    if (execution.status !== 'completed' || !execution.provenance) continue;
    const history = result[execution.nodeId]?.history ?? [];
    history.push(execution.provenance);
    result[execution.nodeId] = {
      visitCount: execution.provenance.visitCount,
      latest: execution.provenance,
      history,
    };
  }
  return result;
}
