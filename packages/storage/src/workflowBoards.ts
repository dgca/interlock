import type { BoardRun, WorkflowBoard } from '@interlock/core';
import type { DatabaseSync } from 'node:sqlite';

export function referencedBoardColumns(db: DatabaseSync, ids: string[]) {
  if (!ids.length) return [];
  const rows = db
    .prepare(
      `
    WITH candidates(id) AS (SELECT value FROM json_each(?))
    SELECT candidates.id FROM candidates WHERE EXISTS (
      SELECT 1 FROM documents d, json_each(d.value, '$.draft.nodes') n
      WHERE d.collection = 'workflows' AND json_extract(n.value, '$.boardColumnId') = candidates.id
    ) OR EXISTS (
      SELECT 1 FROM documents d, json_each(d.value, '$.definition.nodes') n
      WHERE d.collection = 'versions' AND json_extract(n.value, '$.boardColumnId') = candidates.id
    ) OR EXISTS (
      SELECT 1 FROM documents d
      WHERE d.collection = 'events' AND json_type(d.value, '$.boardColumnId') = 'text'
        AND json_extract(d.value, '$.boardColumnId') = candidates.id
    )
  `,
    )
    .all(JSON.stringify(ids));
  return rows.map((row) => row.id as string);
}

/** Read placement from the ordered entry events across each attached lifecycle. */
export function boardRuns(
  db: DatabaseSync,
  board: WorkflowBoard,
  attentionIds: string[],
  since: string,
  workflowId?: string,
): BoardRun[] {
  const rows = db
    .prepare(
      `
    WITH RECURSIVE
      roots AS MATERIALIZED (
        SELECT r.id, r.value, json_extract(r.value, '$.workflowId') AS workflowId,
          coalesce(json_extract(c.value, '$.latestRunId'), r.id) AS runId
        FROM documents r
        JOIN documents w ON w.collection = 'workflows'
          AND w.id = json_extract(r.value, '$.workflowId')
        LEFT JOIN documents c ON c.collection = 'runChains' AND c.id = r.id
        WHERE r.collection = 'runs' AND json_extract(w.value, '$.boardId') = ?
          AND (json_extract(r.value, '$.parentRunId') IS NULL OR json_extract(r.value, '$.parentMode') = 'detached')
          AND (json_extract(r.value, '$.chain.previousRunId') IS NULL)
          ${workflowId === undefined ? '' : 'AND w.id = ?'}
      ),
      latest AS MATERIALIZED (
        SELECT roots.*, json_extract(t.value, '$.status') AS status,
          substr(json_extract(t.value, '$.error'), 1, 240) AS error,
          substr(json_extract(t.value, '$.executions[#-1].label'), 1, 160) AS activity,
          coalesce(CASE WHEN json_extract(t.value, '$.status') IN ('completed','cancelled','failed')
            THEN (SELECT json_extract(e.value, '$.at') FROM documents e
              WHERE e.collection = 'events' AND json_extract(e.value, '$.runId') = t.id
                AND json_extract(e.value, '$.type') IN ('run.completed','run.cancelled','node.failed')
              ORDER BY e.rowid DESC LIMIT 1)
            END, json_extract(t.value, '$.updatedAt')) AS changedAt
        FROM roots JOIN documents t ON t.collection = 'runs' AND t.id = roots.runId
      ),
      visible AS MATERIALIZED (
        SELECT * FROM latest WHERE status IN ('queued','running','waiting')
          OR changedAt >= ? OR id IN (SELECT value FROM json_each(?))
      ),
      members(root, id) AS (
        SELECT id, id FROM visible
        UNION ALL
        SELECT v.id, r.id FROM visible v JOIN documents r ON r.collection = 'runs'
          AND json_extract(r.value, '$.chain.rootRunId') = v.id AND r.id <> v.id
        UNION ALL
        SELECT m.root, r.id FROM members m JOIN documents r ON r.collection = 'runs'
          AND json_extract(r.value, '$.parentRunId') = m.id
          AND json_extract(r.value, '$.parentMode') IS NOT 'detached'
      ),
      placements AS (
        SELECT m.root, json_extract(e.value, '$.boardColumnId') AS columnId,
          row_number() OVER (PARTITION BY m.root ORDER BY e.rowid DESC) AS ordinal
        FROM members m JOIN documents e ON e.collection = 'events'
          AND json_extract(e.value, '$.runId') = m.id
        WHERE json_type(e.value, '$.boardColumnId') = 'text'
          AND json_extract(e.value, '$.boardColumnId') IN (SELECT value FROM json_each(?))
      )
    SELECT v.id, v.runId, v.workflowId, v.status, v.error, v.activity, v.changedAt, p.columnId,
      json_extract(v.value, '$.workflowName') AS workflowName,
      json_extract(v.value, '$.title') AS title,
      json_extract(v.value, '$.externalTask') AS externalTask
    FROM visible v LEFT JOIN placements p ON p.root = v.id AND p.ordinal = 1
    ORDER BY v.changedAt DESC, v.id
  `,
    )
    .all(
      board.id,
      ...(workflowId === undefined ? [] : [workflowId]),
      since,
      JSON.stringify(attentionIds),
      JSON.stringify(board.columns.map((column) => column.id)),
    );
  return rows.map(
    ({ externalTask, ...row }) =>
      ({
        ...Object.fromEntries(
          Object.entries(row).filter(([, value]) => value !== null),
        ),
        ...(externalTask
          ? { externalTask: JSON.parse(String(externalTask)) }
          : {}),
      }) as BoardRun,
  );
}
