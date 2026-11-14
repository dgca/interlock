import type { DatabaseSync } from 'node:sqlite';
import type { Run, WorkRequest } from '@interlock/core';
import type {
  ExecutionMetadata,
  RunMetadata,
  WorkMetadata,
} from './continuation.js';

export type CurrentRun = Omit<RunMetadata, 'lifecycleRunId'>;
export type CurrentWork = WorkMetadata &
  Pick<WorkRequest, 'lastActivityAt' | 'claimedAt' | 'availableSince'>;

export type ProjectionState = {
  runs: Pick<
    Run,
    | 'id'
    | 'status'
    | 'workflowId'
    | 'version'
    | 'cursor'
    | 'createdAt'
    | 'parentMode'
    | 'admission'
  >[];
  executions: ExecutionMetadata[];
  work: WorkMetadata[];
};

export function migrateCurrentState(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE run_metadata (
      position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, status TEXT,
      workflow_id TEXT, created_at TEXT, parent_id TEXT,
      request_id TEXT, task_system TEXT, task_id TEXT, chain_root_id TEXT,
      value TEXT NOT NULL, execution TEXT, execution_count INTEGER NOT NULL
    );
    CREATE INDEX run_metadata_created ON run_metadata(created_at DESC, position DESC);
    CREATE INDEX run_metadata_status ON run_metadata(status, created_at DESC, position DESC);
    CREATE INDEX run_metadata_workflow ON run_metadata(workflow_id, created_at DESC, position DESC);
    CREATE INDEX run_metadata_workflow_status ON run_metadata(workflow_id, status);
    CREATE INDEX run_metadata_request ON run_metadata(request_id);
    CREATE INDEX run_metadata_task ON run_metadata(task_system, task_id);
    CREATE INDEX run_metadata_chain ON run_metadata(chain_root_id);
    CREATE TABLE work_metadata (
      position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, run_id TEXT,
      execution_id TEXT, status TEXT, executor TEXT,
      available_until TEXT, value TEXT NOT NULL
    );
    CREATE INDEX work_metadata_status ON work_metadata(status, position);
    CREATE INDEX work_metadata_available_deadline ON work_metadata(available_until) WHERE status = 'available';
    CREATE INDEX work_metadata_resource_block ON work_metadata(position) WHERE json_type(value, '$.resourceBlocked') IS NOT NULL;
    CREATE INDEX work_metadata_execution ON work_metadata(run_id, execution_id, position);
  `);
  // Backfill in document order, then keep positions stable across updates and VACUUM.
  const run = (row: string) => {
    const x = (path: string) => `json_extract(${row}.value, '$.${path}')`;
    const latest = x('executions[#-1]');
    const checkOutput = `(${latest} -> '$.check.output')`;
    return `${row}.id, ${x('status')}, ${x('workflowId')}, ${x('createdAt')},
      ${x('parentRunId')}, ${x('startRequestId')}, ${x('externalTask.system')},
      ${x('externalTask.id')}, ${x('chain.rootRunId')},
      json_remove(${row}.value, '$.input', '$.output', '$.value', '$.executions',
        '$.promptSnapshots', '$.versionChanges', '$.variableCaptures', '$.modelAliasCaptures'),
      CASE WHEN ${latest} IS NOT NULL THEN json_set(
        json_remove(${latest}, '$.input', '$.output', '$.result', '$.originalInput',
          '$.request', '$.retryChildRunIds', '$.check.output', '$.humanInput'),
        '$.runId', ${row}.id,
        '$.hasOutput', json_type(${latest}, '$.output') IS NOT NULL,
        '$.humanInput', json_type(${latest}, '$.humanInput') IS NOT NULL,
        '$.checkSummary', CASE WHEN ${checkOutput} IS NOT NULL THEN json_object(
          'output', substr(${checkOutput}, 1, 512), 'truncated', length(${checkOutput}) > 512) END
      ) END, coalesce(json_array_length(${row}.value, '$.executions'), 0)`;
  };
  const work = (row: string) => {
    const x = (path: string) => `json_extract(${row}.value, '$.${path}')`;
    return `${row}.id, ${x('runId')}, ${x('executionId')},
      ${x('status')}, ${x('executor')}, ${x('availableUntil')},
      json_remove(${row}.value, '$.input', '$.output', '$.prompt', '$.savedPrompts',
        '$.executionInstructions', '$.outputSchema', '$.token', '$.expiredClaims',
        '$.holdReceipt', '$.resultRules', '$.error', '$.context.instructions',
        '$.trialEnvironment.workspace', '$.trialEnvironment.baseCommit',
        '$.trialEnvironment.configurationId', '$.trialEnvironment.policy')`;
  };
  for (const [collection, table, columns, fields] of [
    [
      'runs',
      'run_metadata',
      'id, status, workflow_id, created_at, parent_id, request_id, task_system, task_id, chain_root_id, value, execution, execution_count',
      run,
    ],
    [
      'work',
      'work_metadata',
      'id, run_id, execution_id, status, executor, available_until, value',
      work,
    ],
  ] as const) {
    db.exec(`
      INSERT INTO ${table} (${columns})
        SELECT ${fields('d')} FROM documents d WHERE d.collection = '${collection}' ORDER BY d.rowid;
      CREATE TRIGGER ${table}_insert AFTER INSERT ON documents WHEN NEW.collection = '${collection}'
      BEGIN INSERT INTO ${table} (${columns}) VALUES (${fields('NEW')}); END;
      CREATE TRIGGER ${table}_update AFTER UPDATE ON documents WHEN NEW.collection = '${collection}'
      BEGIN UPDATE ${table} SET (${columns}) = (${fields('NEW')}) WHERE id = OLD.id; END;
      CREATE TRIGGER ${table}_delete AFTER DELETE ON documents WHEN OLD.collection = '${collection}'
      BEGIN DELETE FROM ${table} WHERE id = OLD.id; END;
    `);
  }
}

export function currentProjection(
  db: DatabaseSync,
  ids: readonly string[],
): ProjectionState {
  const empty: ProjectionState = { runs: [], executions: [], work: [] };
  if (!ids.length) return empty;
  const tree = `WITH RECURSIVE tree(id) AS (
    SELECT value FROM json_each(?)
    UNION
    SELECT child.id FROM tree
    CROSS JOIN run_metadata parent ON parent.id = tree.id
    CROSS JOIN json_each(parent.execution, '$.childRunIds') link
    CROSS JOIN run_metadata child ON child.id = link.value AND child.parent_id = parent.id
    WHERE parent.status IN ('running', 'waiting')
      AND json_extract(parent.execution, '$.status') IN ('queued', 'running', 'waiting')
      AND child.status IN ('queued', 'running', 'waiting')
      AND json_extract(child.value, '$.parentMode') IS NOT 'detached'
  )`;
  const roots = JSON.stringify(ids);
  const rows = db
    .prepare(
      `${tree}
    SELECT r.value, r.execution FROM tree
    CROSS JOIN run_metadata r ON r.id = tree.id
  `,
    )
    .all(roots);
  for (const row of rows) {
    empty.runs.push(JSON.parse(row.value as string));
    if (row.execution !== null)
      empty.executions.push(JSON.parse(row.execution as string));
  }
  empty.work = db
    .prepare(
      `${tree}
    SELECT w.value FROM tree
    CROSS JOIN run_metadata r ON r.id = tree.id
    CROSS JOIN work_metadata w ON w.run_id = r.id AND w.execution_id = json_extract(r.execution, '$.id')
    WHERE r.status IN ('running', 'waiting') AND w.status IN ('available', 'claimed', 'held')
    ORDER BY w.position
  `,
    )
    .all(roots)
    .map((row) => JSON.parse(row.value as string));
  return empty;
}

export function activeRunState(db: DatabaseSync): {
  run: CurrentRun;
  execution: ExecutionMetadata | undefined;
}[] {
  return db
    .prepare(
      "SELECT value, execution FROM run_metadata INDEXED BY run_metadata_status WHERE status IN ('queued', 'running', 'waiting') ORDER BY position",
    )
    .all()
    .map((row) => ({
      run: JSON.parse(row.value as string) as CurrentRun,
      execution:
        row.execution === null
          ? undefined
          : (JSON.parse(row.execution as string) as ExecutionMetadata),
    }));
}

export function dueAgentExecutions(db: DatabaseSync, at: string) {
  return new Set(
    db
      .prepare(
        "SELECT execution_id FROM work_metadata WHERE status = 'available' AND available_until <= ?",
      )
      .all(at)
      .map((row) => row.execution_id as string),
  );
}
