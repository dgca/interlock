import type { RunSummary, RunSummaryQuery } from '@interlock/core';
import type { DatabaseSync } from 'node:sqlite';

const active = "r.status IN ('queued', 'running', 'waiting')";
const attention = 'r.id IN (SELECT value FROM attention_ids)';
const tabFilter = { active, attention, history: `NOT (${active})` };
const currentStep = "json_extract(r.execution, '$.kind')";

type SummaryRow = {
  [Key in keyof RunSummary]-?: Key extends
    'comparison' | 'externalTask' | 'tags' | 'parallelBranch'
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
  const filters = ['1'];
  const parameters = [JSON.stringify(attentionIds)];
  for (const [key, value] of Object.entries(query.tags ?? {})) {
    filters.push(
      'r.id IN (SELECT run_id FROM run_tags WHERE tag_key = ? AND tag_value = ?)',
    );
    parameters.push(key, value);
  }
  if (query.workflowId !== undefined) {
    filters.push('r.workflow_id = ?');
    parameters.push(query.workflowId);
  }
  if (query.status !== undefined) {
    filters.push('r.status = ?');
    parameters.push(query.status);
  }
  filters.push("json_extract(r.value, '$.toolCall') IS NULL");
  if (query.tab)
    filters.push(
      query.workflowId === undefined
        ? "(r.parent_id IS NULL OR json_extract(r.value, '$.parentMode') = 'detached')"
        : "json_extract(r.value, '$.batchNodeId') IS NULL AND json_extract(r.value, '$.parallelBranch') IS NULL",
    );
  const scope = filters.join(' AND ');
  const withAttention =
    'WITH attention_ids AS (SELECT value FROM json_each(?))';
  const indexedRuns = 'run_metadata r';
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
      SELECT r.id, r.position, r.created_at AS createdAt
      FROM ${indexedRuns} WHERE ${scope}
        ${query.tab ? `AND ${tabFilter[query.tab]}` : ''}
      ORDER BY createdAt DESC, position DESC
      LIMIT ? OFFSET ?
    )
    SELECT r.id,
      r.workflow_id AS workflowId,
      json_extract(r.value, '$.workflowName') AS workflowName,
      json_extract(r.value, '$.title') AS title,
      json_extract(r.value, '$.version') AS version,
      r.status AS status,
      r.created_at AS createdAt,
      json_extract(r.value, '$.updatedAt') AS updatedAt,
      r.parent_id AS parentRunId,
      json_extract(r.value, '$.parentMode') AS parentMode,
      json_extract(r.value, '$.parentExecutionId') AS parentExecutionId,
      json_extract(r.value, '$.parallelBranch') AS parallelBranch,
      json_extract(r.value, '$.comparison') AS comparison,
      json_extract(r.value, '$.externalTask') AS externalTask,
      json_extract(r.value, '$.tags') AS tags,
      json_extract(r.value, '$.startRequestId') AS startRequestId,
      r.execution_count AS executionCount,
      CASE WHEN json_extract(r.value, '$.parentMode') = 'detached' THEN
        (SELECT json_extract(parent.value, '$.workflowName') FROM run_metadata parent WHERE parent.id = r.parent_id)
      END AS parentWorkflowName,
      CASE WHEN r.status = 'waiting' THEN
        CASE ${currentStep}
          WHEN 'input' THEN
            CASE WHEN json_extract(r.execution, '$.externalInput.submittedAt') IS NULL
              THEN 'external_input' ELSE 'external_review' END
          WHEN 'wait' THEN 'timer'
          WHEN 'workflow' THEN 'child'
          WHEN 'batch' THEN 'child'
          WHEN 'parallel' THEN 'child'
          WHEN 'agent' THEN (
            SELECT CASE w.status
              WHEN 'held' THEN 'held'
              WHEN 'claimed' THEN 'claimed'
              WHEN 'available' THEN
                CASE WHEN w.executor IS NULL THEN 'agent' ELSE 'managed' END
            END
            FROM work_metadata w
            WHERE w.run_id = r.id
              AND w.execution_id = json_extract(r.execution, '$.id')
              AND w.status IN ('held', 'claimed', 'available')
            ORDER BY w.position LIMIT 1
          )
        END
      END AS waitReason
    FROM page CROSS JOIN run_metadata r ON r.id = page.id
    ORDER BY page.createdAt DESC, page.position DESC
  `,
    )
    .all(...parameters, query.limit, query.offset) as unknown as SummaryRow[];
  const items: RunSummary[] = rows.map(
    ({
      parentRunId,
      parentMode,
      parentExecutionId,
      parallelBranch,
      parentWorkflowName,
      comparison,
      externalTask,
      tags,
      startRequestId,
      title,
      waitReason,
      ...row
    }) => ({
      ...row,
      ...(parentRunId === null ? {} : { parentRunId }),
      ...(parentMode === null ? {} : { parentMode }),
      ...(parentExecutionId === null ? {} : { parentExecutionId }),
      ...(parallelBranch === null
        ? {}
        : { parallelBranch: JSON.parse(parallelBranch) }),
      ...(parentWorkflowName === null ? {} : { parentWorkflowName }),
      ...(waitReason === null ? {} : { waitReason }),
      ...(comparison === null ? {} : { comparison: JSON.parse(comparison) }),
      ...(externalTask === null
        ? {}
        : { externalTask: JSON.parse(externalTask) }),
      ...(tags === null ? {} : { tags: JSON.parse(tags) }),
      ...(startRequestId === null ? {} : { startRequestId }),
      ...(title === null ? {} : { title }),
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
