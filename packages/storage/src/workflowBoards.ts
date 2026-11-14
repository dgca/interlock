import type { BoardQuery, BoardRun, WorkflowBoard } from '@interlock/core';
import type { DatabaseSync } from 'node:sqlite';

export function referencedBoardColumns(db: DatabaseSync, ids: string[]) {
  if (!ids.length) return [];
  const rows = db
    .prepare(
      `
    WITH candidates(id) AS (SELECT value FROM json_each(?))
    SELECT candidates.id FROM candidates WHERE EXISTS (
      SELECT 1 FROM documents d, json_each(d.value, '$.boardStageColumns') m
      WHERE d.collection = 'workflows' AND m.value = candidates.id
    ) OR EXISTS (
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

export function workflowBoardStageColumn(
  db: DatabaseSync,
  workflowId: string,
  stageId: string,
): string | null | undefined {
  const match = db
    .prepare(
      `SELECT m.value FROM documents d, json_each(d.value, '$.boardStageColumns') m
       WHERE d.collection = 'workflows' AND d.id = ? AND m.key = ?`,
    )
    .get(workflowId, stageId);
  return match?.value as string | null | undefined;
}

/** Page Board metadata before retrieving the selected runs' card fields. */
export function boardRuns(
  db: DatabaseSync,
  board: WorkflowBoard,
  query: BoardQuery,
  attentionCounts: Readonly<Record<string, number>>,
  since: string,
  terminalLimit: number,
) {
  const { workflowId, status, column, offset, limit } = query;
  const statusFilter =
    status === 'all'
      ? ''
      : status === 'attention'
        ? 'WHERE requestCount > 0'
        : 'WHERE status = ?';
  // Unary + removes column affinity from join inputs so SQLite can seek the JSON expression indexes.
  const row = db
    .prepare(
      `
    WITH RECURSIVE
      attention AS MATERIALIZED (
        SELECT key AS id, value AS requestCount FROM json_each(?)
      ),
      roots AS MATERIALIZED (
        SELECT r.id, w.id AS workflowId,
          coalesce(json_extract(c.value, '$.latestRunId'), r.id) AS runId,
          coalesce(a.requestCount, 0) AS requestCount
        FROM documents w
        CROSS JOIN documents r INDEXED BY runs_workflow_created
        LEFT JOIN documents c ON c.collection = 'runChains' AND c.id = r.id
        LEFT JOIN attention a ON a.id = r.id
        WHERE w.collection = 'workflows' AND json_extract(w.value, '$.boardId') = ?
          ${workflowId === undefined ? '' : 'AND w.id = ?'}
          AND r.collection = 'runs' AND json_extract(r.value, '$.workflowId') = +w.id
          AND (json_extract(r.value, '$.parentRunId') IS NULL OR json_extract(r.value, '$.parentMode') = 'detached')
          AND json_extract(r.value, '$.chain.previousRunId') IS NULL
      ),
      latest AS MATERIALIZED (
        SELECT roots.*, json_extract(t.value, '$.status') AS status,
          json_extract(t.value, '$.updatedAt') AS updatedAt
        FROM roots CROSS JOIN documents t ON t.collection = 'runs' AND t.id = roots.runId
      ),
      dated AS MATERIALIZED (
        SELECT latest.*, coalesce(
          CASE WHEN status IN ('completed','cancelled','failed') THEN (
            SELECT json_extract(e.value, '$.at')
            FROM documents e INDEXED BY documents_run
            WHERE e.collection = 'events' AND json_extract(e.value, '$.runId') = latest.runId
              AND json_extract(e.value, '$.type') IN ('run.completed','run.cancelled','node.failed')
            ORDER BY e.rowid DESC LIMIT 1
          ) END, updatedAt
        ) AS changedAt
        FROM latest ${statusFilter}
      ),
      visible AS MATERIALIZED (
        SELECT id, runId, workflowId, status, changedAt, requestCount FROM dated
        WHERE status IN ('queued','running','waiting') OR changedAt >= ? OR requestCount > 0
      ),
      members(root, id) AS (
        SELECT id, id FROM visible
        UNION ALL
        SELECT v.id, r.id FROM visible v CROSS JOIN documents r INDEXED BY runs_chain
        WHERE r.collection = 'runs' AND json_extract(r.value, '$.chain.rootRunId') = +v.id
          AND r.id <> v.id
        UNION ALL
        SELECT m.root, r.id FROM members m CROSS JOIN documents r INDEXED BY runs_parent
        WHERE r.collection = 'runs' AND json_extract(r.value, '$.parentRunId') = +m.id
          AND json_extract(r.value, '$.parentMode') IS NOT 'detached'
      ),
      boardColumns AS MATERIALIZED (
        SELECT value AS id FROM json_each(?)
      ),
      placements AS (
        SELECT m.root, max(e.rowid) AS entry
        FROM members m CROSS JOIN boardColumns col
        CROSS JOIN documents e INDEXED BY board_stage_entries
        WHERE e.collection = 'events' AND json_type(e.value, '$.boardColumnId') = 'text'
          AND json_extract(e.value, '$.boardColumnId') = +col.id
          AND json_extract(e.value, '$.runId') = +m.id
        GROUP BY m.root
      ),
      placed AS MATERIALIZED (
        SELECT v.*, json_extract(e.value, '$.boardColumnId') AS columnId,
          CASE WHEN v.status = 'queued' THEN 'queued'
            ELSE coalesce(json_extract(e.value, '$.boardColumnId'), 'unstaged')
          END AS pageColumn,
          CASE WHEN v.requestCount > 0 THEN 0
            WHEN v.status IN ('completed','cancelled','failed') THEN 2
            ELSE 1
          END AS priority
        FROM visible v LEFT JOIN placements p ON p.root = v.id
        LEFT JOIN documents e ON e.rowid = p.entry
      ),
      ranked AS (
        SELECT placed.*, row_number() OVER cardOrder AS ordinal,
          count(*) FILTER (WHERE priority = 2) OVER cardOrder AS terminalOrdinal
        FROM placed
        WINDOW cardOrder AS (
          PARTITION BY pageColumn ORDER BY priority, changedAt DESC, id
          ROWS UNBOUNDED PRECEDING
        )
      ),
      capped AS MATERIALIZED (
        SELECT * FROM ranked WHERE terminalOrdinal <= ?
      ),
      totals AS (
        SELECT pageColumn, count(*) AS total FROM capped GROUP BY pageColumn
      ),
      board_page AS MATERIALIZED (
        SELECT * FROM capped WHERE ordinal > ? AND ordinal <= ?
          ${column === undefined ? '' : 'AND pageColumn = ?'}
      )
    SELECT
      (SELECT coalesce(sum(requestCount), 0) FROM latest) AS attentionCount,
      (SELECT json_group_array(json_array(pageColumn, total)) FROM totals) AS totals,
      (SELECT json_group_array(json_object(
        'column', page.pageColumn,
        'run', json_object(
          'id', page.id,
          'runId', page.runId,
          'workflowId', page.workflowId,
          'status', page.status,
          'changedAt', page.changedAt,
          'columnId', page.columnId,
          'workflowName', json_extract(r.value, '$.workflowName'),
          'title', json_extract(r.value, '$.title'),
          'externalTask', json_extract(r.value, '$.externalTask'),
          'error', substr(json_extract(t.value, '$.error'), 1, 240),
          'activity', substr(json_extract(m.execution, '$.label'), 1, 160)
        )
      ) ORDER BY page.pageColumn, page.ordinal)
      FROM board_page page
      CROSS JOIN documents r ON r.collection = 'runs' AND r.id = page.id
      CROSS JOIN documents t ON t.collection = 'runs' AND t.id = page.runId
      CROSS JOIN run_metadata m ON m.id = page.runId) AS cards
  `,
    )
    .get(
      JSON.stringify(attentionCounts),
      board.id,
      ...(workflowId === undefined ? [] : [workflowId]),
      ...(status === 'all' || status === 'attention' ? [] : [status]),
      since,
      JSON.stringify(board.columns.map((column) => column.id)),
      terminalLimit,
      offset,
      offset + limit,
      ...(column === undefined ? [] : [column]),
    )!;
  const cards = JSON.parse(row.cards as string) as {
    column: string;
    run: BoardRun;
  }[];
  return {
    attentionCount: Number(row.attentionCount),
    totals: new Map<string, number>(JSON.parse(row.totals as string)),
    cards: cards.map(({ column, run }) => ({
      column,
      run: Object.fromEntries(
        Object.entries(run).filter(([, value]) => value !== null),
      ) as BoardRun,
    })),
  };
}
