import type { DatabaseSync } from 'node:sqlite';
import {
  reportDateBoundMs,
  type ReportFilter,
  type Run,
} from '@interlock/core';
import { readRuns } from './runExecutions.js';

export function runsForReport(db: DatabaseSync, filter: ReportFilter): Run[] {
  // Tool calls are not runs of the workflow; their steps count under the caller.
  const conditions = [
    "collection = 'runs'",
    "json_extract(value, '$.toolCall') IS NULL",
  ];
  const params: (string | number)[] = [];

  for (const [key, value] of Object.entries(filter.tags ?? {})) {
    conditions.push(
      'id IN (SELECT run_id FROM run_tags WHERE tag_key = ? AND tag_value = ?)',
    );
    params.push(key, value);
  }

  if (filter.workflowId !== undefined) {
    conditions.push("json_extract(value, '$.workflowId') = ?");
    params.push(filter.workflowId);
  }
  if (filter.since !== undefined) {
    conditions.push("json_extract(value, '$.createdAt') >= ?");
    params.push(new Date(reportDateBoundMs(filter.since, true)).toISOString());
  }
  if (filter.until !== undefined) {
    conditions.push("json_extract(value, '$.createdAt') <= ?");
    params.push(new Date(reportDateBoundMs(filter.until, false)).toISOString());
  }

  const limit = filter.limit ?? 500;
  params.push(limit);

  const sql = `
    SELECT value FROM documents
    WHERE ${conditions.join(' AND ')}
    ORDER BY json_extract(value, '$.createdAt') DESC
    LIMIT ?
  `;

  return withToolSteps(db, readRuns<Run>(db, db.prepare(sql).all(...params)));
}

/** Append each run's tool call steps to its executions, so node stats include them. */
function withToolSteps(db: DatabaseSync, runs: Run[]) {
  if (!runs.length) return runs;
  const calls = readRuns<Run>(
    db,
    db
      .prepare(
        `SELECT d.value FROM run_metadata r
        CROSS JOIN documents d ON d.collection = 'runs' AND d.id = r.id
        WHERE r.parent_id IN (SELECT value FROM json_each(?))
        AND json_extract(r.value, '$.toolCall') IS NOT NULL ORDER BY r.position`,
      )
      .all(JSON.stringify(runs.map((run) => run.id))),
  );
  const byId = new Map(runs.map((run) => [run.id, run]));
  for (const call of calls)
    byId.get(call.parentRunId!)?.executions.push(...call.executions);
  return runs;
}

/** Exact run counts for a report window from the indexed run metadata, without the run limit. */
export function countReportRuns(db: DatabaseSync, filter: ReportFilter) {
  const conditions = [
    "json_extract(value, '$.cancellationKind') IS NOT 'join'",
  ];
  const params: string[] = [];
  for (const [key, value] of Object.entries(filter.tags ?? {})) {
    conditions.push(
      'id IN (SELECT run_id FROM run_tags WHERE tag_key = ? AND tag_value = ?)',
    );
    params.push(key, value);
  }
  if (filter.workflowId !== undefined) {
    conditions.push('workflow_id = ?');
    params.push(filter.workflowId);
  }
  if (filter.since !== undefined) {
    conditions.push('created_at >= ?');
    params.push(new Date(reportDateBoundMs(filter.since, true)).toISOString());
  }
  if (filter.until !== undefined) {
    conditions.push('created_at <= ?');
    params.push(new Date(reportDateBoundMs(filter.until, false)).toISOString());
  }
  const row = db
    .prepare(
      `SELECT count(*) AS runs,
        count(*) FILTER (WHERE status = 'completed') AS completed,
        count(*) FILTER (WHERE status = 'failed') AS failed,
        count(*) FILTER (WHERE status = 'cancelled') AS cancelled
      FROM run_metadata WHERE ${conditions.join(' AND ')}`,
    )
    .get(...params) as Record<
    'runs' | 'completed' | 'failed' | 'cancelled',
    number
  >;
  return {
    runs: row.runs,
    completed: row.completed,
    failed: row.failed,
    cancelled: row.cancelled,
  };
}
