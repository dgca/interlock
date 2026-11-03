import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@interlock/core';
export type AttentionWork = {
  runId: string;
  executionId: string;
  state: 'needs_human' | 'interrupted' | 'needs_model';
  pendingKinds: ('permission' | 'question')[];
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
      json_extract(w.value, '$.executionId') AS executionId,
      json_extract(w.value, '$.managedExecution.state') AS state,
      (SELECT json_group_array(json_extract(q.value, '$.kind')) FROM json_each(m.value, '$.requests') q
        WHERE json_extract(q.value, '$.state') = 'pending') AS pendingKinds
    FROM candidates w JOIN documents m ON m.collection = 'managedExecutions'
      AND m.id = json_extract(w.value, '$.managedExecution.executionId')
      AND json_extract(m.value, '$.attempt') = json_extract(w.value, '$.attempt')
      AND json_extract(m.value, '$.state') = json_extract(w.value, '$.managedExecution.state')
  `,
    )
    .all()
    .map((row) => ({
      runId: row.runId as string,
      executionId: row.executionId as string,
      state: row.state as AttentionWork['state'],
      pendingKinds: JSON.parse(row.pendingKinds as string),
    }));
}
export function attentionAncestors(db: DatabaseSync, ids: Set<string>) {
  if (!ids.size) return [];
  return db
    .prepare(
      `WITH RECURSIVE lineage(id) AS (
    SELECT value FROM json_each(?) UNION
    SELECT json_extract(d.value, '$.parentRunId') FROM documents d JOIN lineage ON d.id = lineage.id
    WHERE d.collection = 'runs' AND json_extract(d.value, '$.parentRunId') IS NOT NULL
  ) SELECT d.id, json_extract(d.value, '$.parentRunId') AS parentRunId,
    json_extract(d.value, '$.parentMode') AS parentMode
    FROM lineage CROSS JOIN documents d ON d.collection = 'runs' AND d.id = lineage.id
  `,
    )
    .all(JSON.stringify([...ids])) as Pick<
    Run,
    'id' | 'parentRunId' | 'parentMode'
  >[];
}
