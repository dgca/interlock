import type { RunSummary, RunSummaryQuery } from '@interlock/core';
import type { DatabaseSync } from 'node:sqlite';

const active = "json_extract(r.value, '$.status') IN ('running', 'waiting')";
const attention = 'r.id IN (SELECT value FROM attention_ids)';
const tabFilter = { active, attention, history: `NOT (${active})` };

type SummaryRow = {
  [Key in keyof RunSummary]-?: Key extends 'comparison'
    ? string | null
    : undefined extends RunSummary[Key]
      ? Exclude<RunSummary[Key], undefined> | null
      : RunSummary[Key];
};

export function runSummaries(
  db: DatabaseSync,
  query: RunSummaryQuery,
  attentionIds: string[],
) {
  const filters = ["r.collection = 'runs'"];
  const parameters = [JSON.stringify(attentionIds)];
  if (query.workflowId !== undefined) {
    filters.push("json_extract(r.value, '$.workflowId') = ?");
    parameters.push(query.workflowId);
  }
  if (query.status !== undefined) {
    filters.push("json_extract(r.value, '$.status') = ?");
    parameters.push(query.status);
  }
  if (query.tab)
    filters.push(
      query.workflowId === undefined
        ? "(json_extract(r.value, '$.parentRunId') IS NULL OR json_extract(r.value, '$.parentMode') = 'detached')"
        : "json_extract(r.value, '$.batchNodeId') IS NULL",
    );
  const scope = filters.join(' AND ');
  const withAttention =
    'WITH attention_ids AS (SELECT value FROM json_each(?))';
  const counts = db
    .prepare(
      `
    ${withAttention}
    SELECT count(*) FILTER (WHERE ${active}) AS active,
      count(*) FILTER (WHERE ${attention}) AS attention,
      count(*) FILTER (WHERE ${tabFilter.history}) AS history
    FROM documents r WHERE ${scope}
  `,
    )
    .get(...parameters) as Record<keyof typeof tabFilter, number>;
  const rows = db
    .prepare(
      `
    ${withAttention}
    SELECT r.id,
      json_extract(r.value, '$.workflowId') AS workflowId,
      json_extract(r.value, '$.workflowName') AS workflowName,
      json_extract(r.value, '$.version') AS version,
      json_extract(r.value, '$.status') AS status,
      json_extract(r.value, '$.createdAt') AS createdAt,
      json_extract(r.value, '$.updatedAt') AS updatedAt,
      json_extract(r.value, '$.parentRunId') AS parentRunId,
      json_extract(r.value, '$.parentMode') AS parentMode,
      json_extract(r.value, '$.parentExecutionId') AS parentExecutionId,
      json_extract(r.value, '$.comparison') AS comparison,
      coalesce(json_array_length(r.value, '$.executions'), 0) AS executionCount,
      CASE WHEN json_extract(r.value, '$.parentMode') = 'detached' THEN
        (SELECT json_extract(parent.value, '$.workflowName') FROM documents parent
         WHERE parent.collection = 'runs' AND parent.id = json_extract(r.value, '$.parentRunId'))
      END AS parentWorkflowName
    FROM documents r WHERE ${scope}
      ${query.tab ? `AND ${tabFilter[query.tab]}` : ''}
    ORDER BY json_extract(r.value, '$.createdAt') DESC, r.rowid DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(...parameters, query.limit, query.offset) as unknown as SummaryRow[];
  const items: RunSummary[] = rows.map(
    ({
      parentRunId,
      parentMode,
      parentExecutionId,
      parentWorkflowName,
      comparison,
      ...row
    }) => ({
      ...row,
      ...(parentRunId === null ? {} : { parentRunId }),
      ...(parentMode === null ? {} : { parentMode }),
      ...(parentExecutionId === null ? {} : { parentExecutionId }),
      ...(parentWorkflowName === null ? {} : { parentWorkflowName }),
      ...(comparison === null ? {} : { comparison: JSON.parse(comparison) }),
    }),
  );
  const total = query.tab ? counts[query.tab] : counts.active + counts.history;
  const nextOffset = query.offset + items.length;
  return {
    items,
    counts,
    offset: query.offset,
    total,
    nextOffset: nextOffset < total ? nextOffset : null,
  };
}
