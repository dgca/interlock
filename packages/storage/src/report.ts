import type { DatabaseSync } from 'node:sqlite';
import {
  reportDateBoundMs,
  type ReportFilter,
  type Run,
} from '@interlock/core';

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

  return db
    .prepare(sql)
    .all(...params)
    .map((row) => JSON.parse(row.value as string) as Run);
}
