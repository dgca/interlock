import type { RunSummary, RunSummaryQuery } from '@interlock/core';
import type { DatabaseSync } from 'node:sqlite';

const active = "json_extract(r.value, '$.status') IN ('running', 'waiting')";
const attention = 'r.id IN (SELECT value FROM attention_ids)';
const tabFilter = { active, attention, history: `NOT (${active})` };
const currentStep = "json_extract(r.value, '$.executions[#-1].kind')";

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
  // Keep counts and page selection on indexed expressions. Reading value at
  // this stage would parse large execution payloads outside the selected page.
  const indexedRuns = 'documents r INDEXED BY runs_summary_filters';
  const counts = db
    .prepare(
      `
    ${withAttention}
    SELECT count(*) FILTER (WHERE ${active}) AS active,
      count(*) FILTER (WHERE ${attention}) AS attention,
      count(*) FILTER (WHERE ${tabFilter.history}) AS history
    FROM ${indexedRuns} WHERE ${scope}
  `,
    )
    .get(...parameters) as Record<keyof typeof tabFilter, number>;
  const rows = db
    .prepare(
      `
    ${withAttention}, page AS MATERIALIZED (
      SELECT r.rowid AS position, json_extract(r.value, '$.createdAt') AS createdAt
      FROM ${indexedRuns} WHERE ${scope}
        ${query.tab ? `AND ${tabFilter[query.tab]}` : ''}
      ORDER BY createdAt DESC, position DESC
      LIMIT ? OFFSET ?
    )
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
      END AS parentWorkflowName,
      CASE WHEN json_extract(r.value, '$.status') = 'waiting' THEN
        CASE ${currentStep}
          WHEN 'input' THEN
            CASE WHEN json_extract(r.value, '$.executions[#-1].externalInput.submittedAt') IS NULL
              THEN 'external_input' ELSE 'external_review' END
          WHEN 'wait' THEN 'timer'
          WHEN 'workflow' THEN 'child'
          WHEN 'batch' THEN 'child'
          WHEN 'agent' THEN (
            SELECT CASE json_extract(w.value, '$.status')
              WHEN 'held' THEN 'held'
              WHEN 'claimed' THEN 'claimed'
              WHEN 'available' THEN
                CASE WHEN json_extract(w.value, '$.executor') IS NULL THEN 'agent' ELSE 'managed' END
            END
            FROM documents w
            WHERE w.collection = 'work'
              AND json_extract(w.value, '$.runId') = r.id
              AND json_extract(w.value, '$.executionId') = json_extract(r.value, '$.executions[#-1].id')
              AND json_extract(w.value, '$.status') IN ('held', 'claimed', 'available')
            LIMIT 1
          )
        END
      END AS waitReason
    FROM page CROSS JOIN documents r ON r.rowid = page.position
    ORDER BY page.createdAt DESC, page.position DESC
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
      waitReason,
      ...row
    }) => ({
      ...row,
      ...(parentRunId === null ? {} : { parentRunId }),
      ...(parentMode === null ? {} : { parentMode }),
      ...(parentExecutionId === null ? {} : { parentExecutionId }),
      ...(parentWorkflowName === null ? {} : { parentWorkflowName }),
      ...(waitReason === null ? {} : { waitReason }),
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
