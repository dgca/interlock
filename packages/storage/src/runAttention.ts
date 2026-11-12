import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@interlock/core';
export type AttentionWork = {
  runId: string;
  executionId: string;
  managedExecutionId: string;
  workId: string;
  attempt: number;
  state: 'needs_human' | 'interrupted' | 'needs_model';
  startedAt: string;
  endedAt?: string;
  pending: {
    id: string;
    kind: 'permission' | 'question';
    label: string;
    since?: string;
  }[];
};
/** Read the live assignment projection, not historical attempts or task payloads. */
export function attentionWork(db: DatabaseSync): AttentionWork[] {
  return db
    .prepare(
      `
    WITH candidates(value) AS (
      SELECT value FROM documents WHERE collection = 'work' AND json_extract(value, '$.managedExecution.state') = 'needs_human'
      UNION ALL
      SELECT value FROM documents WHERE collection = 'work' AND json_extract(value, '$.managedExecution.state') = 'interrupted'
      UNION ALL
      SELECT value FROM documents WHERE collection = 'work' AND json_extract(value, '$.managedExecution.state') = 'needs_model' AND json_extract(value, '$.status') = 'held'
    )
    SELECT json_extract(w.value, '$.runId') AS runId,
      json_extract(w.value, '$.id') AS workId,
      json_extract(w.value, '$.attempt') AS attempt,
      json_extract(w.value, '$.executionId') AS executionId,
      m.id AS managedExecutionId,
      json_extract(w.value, '$.managedExecution.state') AS state,
      json_extract(m.value, '$.startedAt') AS startedAt,
      json_extract(m.value, '$.endedAt') AS endedAt,
      (SELECT json_group_array(json_object(
        'id', json_extract(q.value, '$.id'),
        'kind', json_extract(q.value, '$.kind'),
        'label', substr(json_extract(q.value, '$.title'), 1, 160),
        'since', json_extract(q.value, '$.createdAt')
      )) FROM json_each(m.value, '$.requests') q
        WHERE json_extract(q.value, '$.state') = 'pending') AS pending
    FROM candidates w JOIN documents m ON m.collection = 'managedExecutions'
      AND m.id = json_extract(w.value, '$.managedExecution.executionId')
      AND json_extract(m.value, '$.attempt') = json_extract(w.value, '$.attempt')
      AND json_extract(m.value, '$.state') = json_extract(w.value, '$.managedExecution.state')
    ORDER BY m.rowid
  `,
    )
    .all()
    .map((row) => ({
      runId: row.runId as string,
      executionId: row.executionId as string,
      managedExecutionId: row.managedExecutionId as string,
      workId: row.workId as string,
      attempt: row.attempt as number,
      state: row.state as AttentionWork['state'],
      startedAt: row.startedAt as string,
      endedAt: row.endedAt as string | undefined,
      pending: JSON.parse(row.pending as string),
    }));
}
export function uncertainResourceAttempts(db: DatabaseSync) {
  return db
    .prepare(
      `
    WITH uncertain AS (
      SELECT value FROM documents WHERE collection = 'uncertainOperations'
      UNION ALL
      SELECT c.value FROM documents c JOIN documents r ON r.collection = 'runs'
        AND r.id = json_extract(c.value, '$.runId')
      WHERE c.collection = 'uncertainClaims'
        AND json_extract(r.value, '$.status') IN ('completed', 'failed', 'cancelled')
      UNION ALL
      SELECT value FROM documents WHERE collection = 'workResources' AND json_extract(value, '$.state') = 'uncertain'
    ), targets AS (
      SELECT json_extract(u.value, '$.runId') AS runId,
        coalesce(json_extract(u.value, '$.executionId'), json_extract(w.value, '$.executionId')) AS executionId,
        json_extract(u.value, '$.workId') AS workId,
        json_extract(u.value, '$.attempt') AS attempt,
        coalesce(json_extract(u.value, '$.revokedAt'), json_extract(u.value, '$.acquiredAt')) AS since
      FROM uncertain u LEFT JOIN documents w ON w.collection = 'work' AND w.id = json_extract(u.value, '$.workId')
    )
    SELECT runId, executionId, workId, attempt, min(since) AS since
    FROM targets WHERE executionId IS NOT NULL GROUP BY runId, executionId, workId, attempt
    ORDER BY since, runId, executionId, attempt
  `,
    )
    .all() as {
    runId: string;
    executionId: string;
    workId: string | null;
    attempt: number;
    since: string;
  }[];
}
export function uncertainBackgroundSteps(db: DatabaseSync) {
  return db
    .prepare(
      `
    SELECT id AS runId, json_extract(value, '$.executions[#-1].id') AS executionId,
      json_extract(value, '$.executions[#-1].startedAt') AS since
    FROM documents INDEXED BY uncertain_background_steps WHERE collection = 'runs'
      AND json_extract(value, '$.executions[#-1].background.state') = 'uncertain'
  `,
    )
    .all() as { runId: string; executionId: string; since: string }[];
}
export function waitingHumanInputs(db: DatabaseSync) {
  return db
    .prepare(
      `
    SELECT id AS runId,
      json_extract(value, '$.executions[#-1].id') AS executionId,
      substr(json_extract(value, '$.executions[#-1].label'), 1, 160) AS label,
      json_extract(value, '$.executions[#-1].startedAt') AS since
    FROM documents INDEXED BY human_input_waiting WHERE collection = 'runs'
      AND json_extract(value, '$.status') = 'waiting'
      AND json_extract(value, '$.executions[#-1].status') = 'waiting'
      AND json_type(value, '$.executions[#-1].humanInput') = 'object'
    ORDER BY rowid
  `,
    )
    .all() as {
    runId: string;
    executionId: string;
    label: string;
    since: string;
  }[];
}
export function attentionAncestors(db: DatabaseSync, ids: Set<string>) {
  if (!ids.size) return [];
  return db
    .prepare(
      `WITH RECURSIVE lineage(id) AS (
    SELECT value FROM json_each(?) UNION
    SELECT d.parent_id FROM lineage CROSS JOIN run_metadata d ON d.id = lineage.id
    WHERE d.parent_id IS NOT NULL
  ) SELECT d.id, d.parent_id AS parentRunId,
    json_extract(d.value, '$.parentMode') AS parentMode,
    d.workflow_id AS workflowId,
    d.chain_root_id AS chainRootRunId,
    d.status
    FROM lineage CROSS JOIN run_metadata d ON d.id = lineage.id
  `,
    )
    .all(JSON.stringify([...ids])) as Pick<
    Run,
    'id' | 'parentRunId' | 'parentMode' | 'workflowId' | 'status'
  >[] &
    { chainRootRunId?: string }[];
}
