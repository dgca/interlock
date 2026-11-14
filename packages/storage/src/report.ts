import type { DatabaseSync } from 'node:sqlite';
import {
  reportDateBoundMs,
  type ReportFilter,
  type Run,
} from '@interlock/core';
import { readRuns } from './runExecutions.js';

export function runsForReport(db: DatabaseSync, filter: ReportFilter): Run[] {
  const conditions = ["collection = 'runs'"];
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

  return readRuns<Run>(db, db.prepare(sql).all(...params));
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
