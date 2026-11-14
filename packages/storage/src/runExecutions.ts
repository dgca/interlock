import type { DatabaseSync } from 'node:sqlite';
import type { NodeExecution, Run } from '@interlock/core';

/**
 * Run documents keep an empty `executions` placeholder (preserving field order);
 * each execution is its own row keyed by run and position.
 */
export function migrateRunExecutions(db: DatabaseSync) {
  // Moving executions changes no run content, so continuation cursors stay valid.
  const revisionTrigger = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name = 'continuation_update'")
    .get()!.sql as string;
  db.exec(`
    DROP TRIGGER continuation_update;
    DROP TRIGGER run_metadata_insert;
    DROP TRIGGER run_metadata_update;
    DROP TRIGGER active_background_runs_insert;
    DROP TRIGGER active_background_runs_update;
    DROP INDEX human_input_waiting;
    DROP INDEX uncertain_background_steps;
    DROP INDEX script_approval_waiting;
    CREATE TABLE run_executions (
      run_id TEXT NOT NULL, position INTEGER NOT NULL, id TEXT, value TEXT NOT NULL,
      PRIMARY KEY (run_id, position)
    );
    CREATE INDEX run_executions_id ON run_executions(run_id, id);
    CREATE INDEX run_executions_resource_active ON run_executions(run_id)
      WHERE json_extract(value, '$.resourceActive') = 1;
    CREATE INDEX run_executions_background ON run_executions(run_id)
      WHERE json_extract(value, '$.background.state') IN ('launching', 'running');
    -- Schema 13+ triggers reject run documents whose executions are not objects.
    INSERT INTO run_executions
      SELECT d.id, CAST(e.key AS INTEGER), json_extract(e.value, '$.id'), e.value
      FROM documents d, json_each(d.value, '$.executions') e
      WHERE d.collection = 'runs' AND e.type = 'object';
    UPDATE documents SET value = json_set(value, '$.executions', json_array())
      WHERE collection = 'runs' AND json_type(value, '$.executions') = 'array';
  `);
  db.exec(revisionTrigger);
  db.exec(`
    CREATE INDEX run_metadata_parent ON run_metadata(parent_id);
    CREATE INDEX run_metadata_comparison ON run_metadata(
      json_extract(value, '$.comparison.comparisonId'), json_extract(value, '$.comparison.sampleId'));
    CREATE INDEX run_metadata_human_input ON run_metadata(position)
      WHERE status = 'waiting' AND json_extract(execution, '$.status') = 'waiting'
        AND json_extract(execution, '$.humanInput') = 1;
    CREATE INDEX run_metadata_uncertain_background ON run_metadata(position)
      WHERE json_extract(execution, '$.background.state') = 'uncertain';
    CREATE INDEX run_metadata_script_approval ON run_metadata(position)
      WHERE status = 'waiting' AND json_type(execution, '$.scriptApproval') = 'object';
    CREATE TRIGGER run_executions_cascade AFTER DELETE ON documents WHEN OLD.collection = 'runs'
    BEGIN DELETE FROM run_executions WHERE run_id = OLD.id; END;
  `);
  const x = (path: string) => `json_extract(NEW.value, '$.${path}')`;
  const columns =
    'id, status, workflow_id, created_at, parent_id, request_id, task_system, task_id, chain_root_id, value';
  const fields = `NEW.id, ${x('status')}, ${x('workflowId')}, ${x('createdAt')},
    ${x('parentRunId')}, ${x('startRequestId')}, ${x('externalTask.system')},
    ${x('externalTask.id')}, ${x('chain.rootRunId')},
    json_remove(NEW.value, '$.input', '$.output', '$.value', '$.executions',
      '$.promptSnapshots', '$.versionChanges', '$.variableCaptures', '$.modelAliasCaptures')`;
  db.exec(`
    CREATE TRIGGER run_metadata_insert AFTER INSERT ON documents WHEN NEW.collection = 'runs'
    BEGIN INSERT INTO run_metadata (${columns}, execution_count) VALUES (${fields}, 0); END;
    CREATE TRIGGER run_metadata_update AFTER UPDATE ON documents WHEN NEW.collection = 'runs'
    BEGIN UPDATE run_metadata SET (${columns}) = (${fields}) WHERE id = OLD.id; END;
  `);
  for (const [operation, row] of [
    ['INSERT', 'NEW'],
    ['UPDATE', 'NEW'],
    ['DELETE', 'OLD'],
  ] as const) {
    const run = `${row}.run_id`;
    const exists = `EXISTS (SELECT 1 FROM documents WHERE collection = 'runs' AND id = ${run})`;
    db.exec(`
      CREATE TRIGGER run_executions_${operation.toLowerCase()} AFTER ${operation} ON run_executions
      BEGIN
        UPDATE run_metadata SET
          execution = (SELECT ${projection('e.value', run)} FROM run_executions e
            WHERE e.run_id = ${run} ORDER BY e.position DESC LIMIT 1),
          execution_count = (SELECT coalesce(max(position) + 1, 0) FROM run_executions WHERE run_id = ${run})
          WHERE id = ${run};
        UPDATE continuation_sequence SET revision = revision + 1 WHERE id = 1 AND ${exists};
        INSERT INTO run_revisions(run_id, revision)
          SELECT ${run}, revision FROM continuation_sequence WHERE id = 1 AND ${exists}
          ON CONFLICT(run_id) DO UPDATE SET revision = excluded.revision;
        DELETE FROM active_background_runs WHERE run_id = ${run};
        INSERT INTO active_background_runs SELECT ${run} WHERE ${exists} AND EXISTS (
          SELECT 1 FROM run_executions WHERE run_id = ${run}
            AND json_extract(value, '$.background.state') IN ('launching', 'running'));
      END;
    `);
  }
  // Backfilled rows predate the triggers; derive the latest-step projection once.
  db.exec(`
    UPDATE run_metadata SET
      execution = (SELECT ${projection('e.value', 'run_metadata.id')} FROM run_executions e
        WHERE e.run_id = run_metadata.id ORDER BY e.position DESC LIMIT 1),
      execution_count = (SELECT coalesce(max(position) + 1, 0) FROM run_executions WHERE run_id = run_metadata.id);
  `);
}

/** Same latest-step projection that schema 19 derived from the run document. */
function projection(value: string, runId: string) {
  const checkOutput = `(${value} -> '$.check.output')`;
  return `json_set(
    json_remove(${value}, '$.input', '$.output', '$.result', '$.originalInput',
      '$.request', '$.retryChildRunIds', '$.check.output', '$.humanInput'),
    '$.runId', ${runId},
    '$.hasOutput', json_type(${value}, '$.output') IS NOT NULL,
    '$.humanInput', json_type(${value}, '$.humanInput') IS NOT NULL,
    '$.checkSummary', CASE WHEN ${checkOutput} IS NOT NULL THEN json_object(
      'output', substr(${checkOutput}, 1, 512), 'truncated', length(${checkOutput}) > 512) END)`;
}

/**
 * Writes the run document, then only the execution rows whose content changed,
 * as one unit: a savepoint nests inside a caller's transaction or stands alone.
 */
export function writeRun(db: DatabaseSync, run: Run) {
  db.exec('SAVEPOINT write_run');
  try {
    writeRunRows(db, run);
    db.exec('RELEASE write_run');
  } catch (error) {
    db.exec('ROLLBACK TO write_run');
    db.exec('RELEASE write_run');
    throw error;
  }
}

function writeRunRows(db: DatabaseSync, run: Run) {
  const executions = run.executions as NodeExecution[] | undefined;
  // A run written without executions keeps its stored ones readable.
  const kept =
    !executions &&
    db
      .prepare('SELECT 1 FROM run_executions WHERE run_id = ? LIMIT 1')
      .get(run.id);
  db.prepare(
    'INSERT INTO documents VALUES (?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET value = excluded.value',
  ).run(
    'runs',
    run.id,
    JSON.stringify(executions || kept ? { ...run, executions: [] } : run),
  );
  if (!executions) return;
  const upsert = db.prepare(
    `INSERT INTO run_executions (run_id, position, id, value) VALUES (?, ?, ?, ?)
    ON CONFLICT(run_id, position) DO UPDATE SET id = excluded.id, value = excluded.value
    WHERE run_executions.value IS NOT excluded.value`,
  );
  executions.forEach((execution, position) =>
    upsert.run(
      run.id,
      position,
      execution.id ?? null,
      JSON.stringify(execution),
    ),
  );
  db.prepare(
    'DELETE FROM run_executions WHERE run_id = ? AND position >= ?',
  ).run(run.id, executions.length);
}

/** Attaches stored executions to parsed run documents that carry the placeholder. */
export function readRuns<T = Run>(
  db: DatabaseSync,
  rows: Record<string, unknown>[],
): T[] {
  const runs = rows.map((row) => JSON.parse(row.value as string) as Run);
  const owners = runs.filter((run) => Array.isArray(run.executions));
  if (!owners.length) return runs as T[];
  const byRun = new Map(owners.map((run) => [run.id, run.executions]));
  const select =
    owners.length === 1
      ? db
          .prepare(
            'SELECT run_id, value FROM run_executions WHERE run_id = ? ORDER BY position',
          )
          .iterate(owners[0].id)
      : db
          .prepare(
            `SELECT run_id, value FROM run_executions
            WHERE run_id IN (SELECT value FROM json_each(?)) ORDER BY run_id, position`,
          )
          .iterate(JSON.stringify([...byRun.keys()]));
  for (const row of select)
    byRun
      .get(row.run_id as string)!
      .push(JSON.parse(row.value as string) as NodeExecution);
  return runs as T[];
}

/** Length of the array at `path` in one execution's input, read without parsing the run. */
export function batchSize(
  db: DatabaseSync,
  id: string,
  executionId: string,
  path: string,
) {
  const keys =
    !path || path === '$' ? [] : path.replace(/^\$\./, '').split('.');
  let value = "json_quote(json_extract(e.value, '$.input'))";
  for (let depth = 0; depth < keys.length; depth++)
    value = `(SELECT CASE WHEN j.type IN ('array', 'object') THEN json(j.value) ELSE json_quote(j.value) END FROM json_each(${value}) j WHERE CAST(j.key AS TEXT) = ?)`;
  const row = db
    .prepare(
      `SELECT coalesce(json_array_length(${value}), 0) AS size
    FROM run_executions e WHERE e.run_id = ? AND e.id = ?`,
    )
    .get(...keys, id, executionId);
  return Number(row?.size ?? 0);
}
