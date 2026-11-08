import type { DatabaseSync } from 'node:sqlite';
import type { ReportFilter, Run } from '@interlock/core';

// Run creation timestamps are stored as canonical UTC milliseconds. Round a
// finer lower bound up to the next stored instant, and an upper bound down.
function reportBoundary(value: string, lower: boolean): string {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] ?? '';
  const roundUp = lower && /[1-9]/.test(fraction.slice(3));
  return new Date(Date.parse(value) + (roundUp ? 1 : 0)).toISOString();
}

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
    params.push(reportBoundary(filter.since, true));
  }
  if (filter.until !== undefined) {
    conditions.push("json_extract(value, '$.createdAt') <= ?");
    params.push(reportBoundary(filter.until, false));
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
