import type { DatabaseSync } from 'node:sqlite';
import type { Run, NodeExecution, WorkRequest } from '@interlock/core';

export type RunMetadata = Omit<
  Run,
  | 'input'
  | 'output'
  | 'value'
  | 'executions'
  | 'promptSnapshots'
  | 'versionChanges'
> & { lifecycleRunId: string };
export type ExecutionMetadata = Omit<
  NodeExecution,
  | 'input'
  | 'output'
  | 'result'
  | 'originalInput'
  | 'request'
  | 'retryChildRunIds'
  | 'check'
  | 'humanInput'
> & {
  runId: string;
  hasOutput: boolean;
  humanInput?: boolean;
  /** Runtime-only overlay; never inferred from a persisted polling deadline. */
  pollCheckRunning?: boolean;
  check?: Omit<NonNullable<NodeExecution['check']>, 'output'>;
  checkSummary?: { output: string; truncated: number };
};
export type WorkMetadata = Pick<
  WorkRequest,
  | 'executor'
  | 'executorPermissions'
  | 'executorModel'
  | 'executorModelSource'
  | 'executorEffort'
  | 'executorEffortSource'
  | 'managedExecution'
  | 'id'
  | 'createdAt'
  | 'runId'
  | 'executionId'
  | 'nodeId'
  | 'label'
  | 'status'
  | 'attempt'
  | 'maxExecutionMs'
  | 'maxAttempts'
  | 'maxLeaseExpiries'
  | 'failureCount'
  | 'leaseExpiryCount'
  | 'workerId'
  | 'leaseSeconds'
  | 'leaseUntil'
  | 'availableUntil'
  | 'pauseBlocked'
  | 'budgetBlocked'
  | 'resources'
  | 'resourceBlocked'
  | 'continuity'
  | 'hold'
  | 'holdRevision'
  | 'heldClaimCount'
  | 'resolvedCwd'
  | 'cwdBlocked'
> & {
  context: Pick<
    WorkRequest['context'],
    'mode' | 'tools' | 'skills' | 'continuityGroup' | 'tier'
  >;
  trialEnvironment?: { id: string };
};

// IDs and JSON references are strings. Unary + removes the CTE column's TEXT
// affinity so SQLite can search JSON expression indexes without coercion.
// CROSS JOIN keeps the small scoped tree outside each indexed lookup.
const tree = `WITH RECURSIVE tree(id, lifecycle) AS (
  SELECT id, id FROM documents WHERE collection = 'runs' AND id = ?
  UNION ALL
  SELECT d.id, CASE WHEN json_extract(d.value, '$.parentMode') = 'detached' THEN d.id ELSE tree.lifecycle END
  FROM tree CROSS JOIN documents d ON json_extract(d.value, '$.parentRunId') = +tree.id WHERE d.collection = 'runs'
)`;
const parse = <T>(rows: Record<string, unknown>[]) =>
  rows.map((row) => JSON.parse(row.value as string) as T);

/** Projects metadata plus a bounded poll-output preview. Other payloads and tokens stay in SQLite. */
export function continuationState(db: DatabaseSync, id: string) {
  const runs = parse<RunMetadata>(
    db
      .prepare(
        `${tree}
    SELECT json_set(json_remove(d.value, '$.input', '$.output', '$.value', '$.executions', '$.promptSnapshots', '$.versionChanges'), '$.lifecycleRunId', tree.lifecycle) AS value
    FROM tree CROSS JOIN documents d ON d.collection = 'runs' AND d.id = tree.id ORDER BY d.rowid
  `,
      )
      .all(id),
  );
  const executions = parse<ExecutionMetadata>(
    db
      .prepare(
        `${tree}
    SELECT json_set(json_remove(e.value, '$.input', '$.output', '$.result', '$.originalInput', '$.request', '$.retryChildRunIds', '$.check.output', '$.humanInput'),
      '$.runId', d.id, '$.hasOutput', json_type(e.value, '$.output') IS NOT NULL,
      '$.humanInput', json_type(e.value, '$.humanInput') IS NOT NULL,
      '$.checkSummary', CASE WHEN json_type(e.value, '$.check.output') IS NOT NULL THEN json_object(
        'output', substr(e.value -> '$.check.output', 1, 512),
        'truncated', length(e.value -> '$.check.output') > 512) END) AS value
    FROM tree CROSS JOIN documents d ON d.collection = 'runs' AND d.id = tree.id
    CROSS JOIN run_executions e ON e.run_id = d.id
    ORDER BY d.rowid, e.position
  `,
      )
      .all(id),
  );
  const work = parse<WorkMetadata>(
    db
      .prepare(
        `${tree}
    SELECT json_remove(d.value, '$.input', '$.output', '$.prompt', '$.savedPrompts', '$.executionInstructions', '$.trialEnvironment.workspace', '$.trialEnvironment.baseCommit', '$.trialEnvironment.configurationId', '$.trialEnvironment.policy', '$.outputSchema', '$.token', '$.expiredClaims', '$.holdReceipt', '$.resultRules', '$.hold.reason', '$.hold.checkpointRef', '$.error', '$.context.instructions') AS value
    FROM tree CROSS JOIN documents d ON json_extract(d.value, '$.runId') = +tree.id
    WHERE d.collection = 'work' AND json_extract(d.value, '$.status') IN ('available', 'claimed', 'held') ORDER BY d.rowid
  `,
      )
      .all(id),
  );
  const revision = Number(
    db
      .prepare(
        `${tree}
    SELECT coalesce(max(r.revision), 0) AS revision FROM tree CROSS JOIN run_revisions r ON r.run_id = tree.id
  `,
      )
      .get(id)!.revision,
  );
  return { runs, executions, work, revision };
}
/** Advance a run cursor for state retained outside run/work documents. */
export function touchRunRevision(db: DatabaseSync, id: string) {
  if (
    !db
      .prepare("SELECT id FROM documents WHERE collection = 'runs' AND id = ?")
      .get(id)
  )
    return false;
  db.prepare(
    'UPDATE continuation_sequence SET revision = revision + 1 WHERE id = 1',
  ).run();
  db.prepare(
    'INSERT INTO run_revisions(run_id, revision) SELECT ?, revision FROM continuation_sequence WHERE id = 1 ON CONFLICT(run_id) DO UPDATE SET revision = excluded.revision',
  ).run(id);
  return true;
}

/**
 * Run IDs whose run, execution or work rows changed after `after`, oldest change
 * first, and the revision to pass next. Without `after`, only the current revision.
 */
export function runsChangedSince(
  db: DatabaseSync,
  after?: number,
  limit = 500,
) {
  if (after === undefined) {
    const row = db
      .prepare('SELECT revision FROM continuation_sequence WHERE id = 1')
      .get();
    return { revision: Number(row?.revision ?? 0), runIds: [], more: false };
  }
  const rows = db
    .prepare(
      'SELECT run_id, revision FROM run_revisions WHERE revision > ? ORDER BY revision LIMIT ?',
    )
    .all(after, limit);
  return {
    revision: Number(rows.at(-1)?.revision ?? after),
    runIds: rows.map((row) => row.run_id as string),
    more: rows.length === limit,
  };
}
