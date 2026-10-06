import type { DatabaseSync } from 'node:sqlite';
import type { Run, NodeExecution, WorkRequest } from '@interlock/core';

export type RunMetadata = Omit<
  Run,
  'input' | 'output' | 'value' | 'executions'
> & { lifecycleRunId: string };
export type ExecutionMetadata = Omit<
  NodeExecution,
  | 'input'
  | 'output'
  | 'originalInput'
  | 'request'
  | 'retryChildRunIds'
  | 'check'
> & {
  runId: string;
  hasOutput: boolean;
  check?: Omit<NonNullable<NodeExecution['check']>, 'output'>;
};
export type WorkMetadata = Pick<
  WorkRequest,
  | 'id'
  | 'runId'
  | 'executionId'
  | 'nodeId'
  | 'label'
  | 'status'
  | 'attempt'
  | 'maxAttempts'
  | 'workerId'
  | 'leaseUntil'
  | 'availableUntil'
> & { context: Pick<WorkRequest['context'], 'mode' | 'tools' | 'skills'> };

const tree = `WITH RECURSIVE tree(id, lifecycle) AS (
  SELECT id, id FROM documents WHERE collection = 'runs' AND id = ?
  UNION ALL
  SELECT d.id, CASE WHEN json_extract(d.value, '$.parentMode') = 'detached' THEN d.id ELSE tree.lifecycle END
  FROM documents d JOIN tree ON json_extract(d.value, '$.parentRunId') = tree.id WHERE d.collection = 'runs'
)`;
const parse = <T>(rows: Record<string, unknown>[]) =>
  rows.map((row) => JSON.parse(row.value as string) as T);

/** Projects only metadata. Stored inputs, outputs, prompts, and tokens never leave SQLite here. */
export function continuationState(db: DatabaseSync, id: string) {
  const runs = parse<RunMetadata>(
    db
      .prepare(
        `${tree}
    SELECT json_set(json_remove(d.value, '$.input', '$.output', '$.value', '$.executions'), '$.lifecycleRunId', tree.lifecycle) AS value
    FROM tree JOIN documents d ON d.collection = 'runs' AND d.id = tree.id ORDER BY d.rowid
  `,
      )
      .all(id),
  );
  const executions = parse<ExecutionMetadata>(
    db
      .prepare(
        `${tree}
    SELECT json_set(json_remove(e.value, '$.input', '$.output', '$.originalInput', '$.request', '$.retryChildRunIds', '$.check.output'),
      '$.runId', d.id, '$.hasOutput', json_type(e.value, '$.output') IS NOT NULL) AS value
    FROM tree JOIN documents d ON d.collection = 'runs' AND d.id = tree.id, json_each(d.value, '$.executions') e
    ORDER BY d.rowid, CAST(e.key AS INTEGER)
  `,
      )
      .all(id),
  );
  const work = parse<WorkMetadata>(
    db
      .prepare(
        `${tree}
    SELECT json_remove(d.value, '$.input', '$.output', '$.prompt', '$.executionInstructions', '$.outputSchema', '$.token', '$.error', '$.context.instructions') AS value
    FROM documents d JOIN tree ON json_extract(d.value, '$.runId') = tree.id
    WHERE d.collection = 'work' AND json_extract(d.value, '$.status') IN ('available', 'claimed') ORDER BY d.rowid
  `,
      )
      .all(id),
  );
  const revision = Number(
    db
      .prepare(
        `${tree}
    SELECT coalesce(max(r.revision), 0) AS revision FROM tree JOIN run_revisions r ON r.run_id = tree.id
  `,
      )
      .get(id)!.revision,
  );
  return { runs, executions, work, revision };
}
