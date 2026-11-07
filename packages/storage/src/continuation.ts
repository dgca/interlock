import type { DatabaseSync } from 'node:sqlite';
import type { Run, NodeExecution, WorkRequest } from '@interlock/core';

export type RunMetadata = Omit<
  Run,
  'input' | 'output' | 'value' | 'executions' | 'promptSnapshots'
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
> & {
  runId: string;
  hasOutput: boolean;
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
  | 'maxAttempts'
  | 'maxLeaseExpiries'
  | 'failureCount'
  | 'leaseExpiryCount'
  | 'workerId'
  | 'leaseSeconds'
  | 'leaseUntil'
  | 'availableUntil'
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

/** Projects only metadata. Stored inputs, outputs, prompts, and tokens never leave SQLite here. */
export function continuationState(db: DatabaseSync, id: string) {
  const runs = parse<RunMetadata>(
    db
      .prepare(
        `${tree}
    SELECT json_set(json_remove(d.value, '$.input', '$.output', '$.value', '$.executions', '$.promptSnapshots'), '$.lifecycleRunId', tree.lifecycle) AS value
    FROM tree JOIN documents d ON d.collection = 'runs' AND d.id = tree.id ORDER BY d.rowid
  `,
      )
      .all(id),
  );
  const executions = parse<ExecutionMetadata>(
    db
      .prepare(
        `${tree}
    SELECT json_set(json_remove(e.value, '$.input', '$.output', '$.result', '$.originalInput', '$.request', '$.retryChildRunIds', '$.check.output'),
      '$.runId', d.id, '$.hasOutput', json_type(e.value, '$.output') IS NOT NULL,
      '$.checkSummary', CASE WHEN json_type(e.value, '$.check.output') IS NOT NULL THEN json_object(
        'output', substr(json_quote(json_extract(e.value, '$.check.output')), 1, 512),
        'truncated', length(json_quote(json_extract(e.value, '$.check.output'))) > 512) END) AS value
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
    SELECT coalesce(max(r.revision), 0) AS revision FROM tree JOIN run_revisions r ON r.run_id = tree.id
  `,
      )
      .get(id)!.revision,
  );
  return { runs, executions, work, revision };
}
