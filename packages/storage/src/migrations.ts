import type { DatabaseSync } from 'node:sqlite';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

/** Append migrations; never change a migration that has shipped. */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE migrations (version INTEGER PRIMARY KEY);
        CREATE TABLE documents (
          collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
          PRIMARY KEY(collection, id)
        );
      `);
    },
  },
  {
    version: 2,
    up(db) {
      db.exec(`
        CREATE INDEX runs_created ON documents(json_extract(value, '$.createdAt') DESC) WHERE collection = 'runs';
        CREATE INDEX runs_workflow_created ON documents(json_extract(value, '$.workflowId'), json_extract(value, '$.createdAt') DESC) WHERE collection = 'runs';
        CREATE INDEX runs_status_created ON documents(json_extract(value, '$.status'), json_extract(value, '$.createdAt') DESC) WHERE collection = 'runs';
      `);
    },
  },
  {
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE continuation_sequence (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
        INSERT INTO continuation_sequence VALUES (1, 0);
        CREATE TABLE run_revisions (run_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
        INSERT INTO run_revisions SELECT id, 0 FROM documents WHERE collection = 'runs';
        CREATE INDEX runs_parent ON documents(json_extract(value, '$.parentRunId')) WHERE collection = 'runs';
      `);
      for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
        const row = operation === 'DELETE' ? 'OLD' : 'NEW';
        db.exec(`
          CREATE TRIGGER continuation_${operation.toLowerCase()} AFTER ${operation} ON documents
          WHEN ${row}.collection IN ('runs', 'work') ${operation === 'UPDATE' ? "AND json_remove(OLD.value, '$.updatedAt') != json_remove(NEW.value, '$.updatedAt')" : ''}
          BEGIN
            UPDATE continuation_sequence SET revision = revision + 1 WHERE id = 1;
            INSERT INTO run_revisions(run_id, revision)
              VALUES (CASE WHEN ${row}.collection = 'runs' THEN ${row}.id ELSE json_extract(${row}.value, '$.runId') END,
                      (SELECT revision FROM continuation_sequence WHERE id = 1))
              ON CONFLICT(run_id) DO UPDATE SET revision = excluded.revision;
            ${operation === 'DELETE' ? "DELETE FROM run_revisions WHERE OLD.collection = 'runs' AND run_id = OLD.id;" : ''}
          END;
        `);
      }
    },
  },
  {
    version: 4,
    up(db) {
      db.exec(`
        CREATE INDEX work_status ON documents(json_extract(value, '$.status')) WHERE collection = 'work';
        CREATE INDEX work_run_status ON documents(json_extract(value, '$.runId'), json_extract(value, '$.status')) WHERE collection = 'work';
        CREATE INDEX work_admission ON documents((json_extract(value, '$.status') = 'available' OR json_type(value, '$.resourceBlocked') IS NOT NULL)) WHERE collection = 'work';
        CREATE INDEX runs_chain ON documents(json_extract(value, '$.chain.rootRunId')) WHERE collection = 'runs';
        CREATE INDEX documents_run ON documents(collection, json_extract(value, '$.runId'));
      `);
    },
  },
  {
    version: 5,
    up(db) {
      db.exec(`
        CREATE TABLE comparison_schedule (
          comparison_id TEXT PRIMARY KEY, execution_pending INTEGER NOT NULL, trial_pending INTEGER NOT NULL
        );
        CREATE INDEX comparison_execution_pending ON comparison_schedule(execution_pending, comparison_id);
        CREATE INDEX comparison_trial_pending ON comparison_schedule(trial_pending, comparison_id);
        CREATE TABLE active_comparison_runs (run_id TEXT PRIMARY KEY, comparison_id TEXT NOT NULL);
        CREATE INDEX resource_state ON documents(json_extract(value, '$.state')) WHERE collection = 'workResources';
        CREATE INDEX documents_work ON documents(collection, json_extract(value, '$.workId'));
      `);
      const projection = (value: string) => `
        (json_extract(${value}, '$.status') = 'running' OR
          (json_extract(${value}, '$.status') = 'cancelled' AND EXISTS (
            SELECT 1 FROM json_each(${value}, '$.samples') s WHERE json_extract(s.value, '$.observation') IS NULL))),
        coalesce((json_type(${value}, '$.trialSetup') = 'object' AND
          (json_extract(${value}, '$.status') = 'running' OR EXISTS (
            SELECT 1 FROM json_each(${value}, '$.samples') s
            WHERE json_extract(s.value, '$.trial.cleanup') IN ('pending', 'running')
              OR json_extract(s.value, '$.trial.preparation') = 'preparing'))), 0)
      `;
      db.exec(`INSERT INTO comparison_schedule
        SELECT d.id, ${projection('d.value')} FROM documents d WHERE d.collection = 'comparisons';`);
      for (const operation of ['INSERT', 'UPDATE'])
        db.exec(`CREATE TRIGGER comparison_schedule_${operation.toLowerCase()} AFTER ${operation} ON documents
          WHEN NEW.collection = 'comparisons' BEGIN
          INSERT INTO comparison_schedule VALUES (NEW.id, ${projection('NEW.value')})
          ON CONFLICT(comparison_id) DO UPDATE SET execution_pending = excluded.execution_pending, trial_pending = excluded.trial_pending; END;`);
      db.exec(`CREATE TRIGGER comparison_schedule_delete AFTER DELETE ON documents
        WHEN OLD.collection = 'comparisons' BEGIN
        DELETE FROM comparison_schedule WHERE comparison_id = OLD.id; END;`);
      const activeComparison = (
        value: string,
      ) => `json_extract(${value}, '$.status') IN ('running', 'waiting')
        AND json_type(${value}, '$.comparison.comparisonId') = 'text'`;
      db.exec(`INSERT INTO active_comparison_runs SELECT d.id, json_extract(d.value, '$.comparison.comparisonId')
        FROM documents d WHERE d.collection = 'runs' AND ${activeComparison('d.value')};`);
      for (const operation of ['INSERT', 'UPDATE'])
        db.exec(`CREATE TRIGGER active_comparison_${operation.toLowerCase()} AFTER ${operation} ON documents
          WHEN NEW.collection = 'runs' BEGIN
          DELETE FROM active_comparison_runs WHERE run_id = NEW.id;
          INSERT INTO active_comparison_runs SELECT NEW.id, json_extract(NEW.value, '$.comparison.comparisonId')
            WHERE ${activeComparison('NEW.value')}; END;`);
      db.exec(`CREATE TRIGGER active_comparison_delete AFTER DELETE ON documents
        WHEN OLD.collection = 'runs' BEGIN DELETE FROM active_comparison_runs WHERE run_id = OLD.id; END;`);
    },
  },
  {
    version: 6,
    up(db) {
      db.exec(
        `CREATE INDEX work_attention ON documents(json_extract(value, '$.managedExecution.state')) WHERE collection = 'work';`,
      );
    },
  },
  {
    version: 7,
    up(db) {
      db.exec(`
        CREATE INDEX runs_summary_filters ON documents(
          json_extract(value, '$.workflowId'),
          json_extract(value, '$.createdAt') DESC,
          json_extract(value, '$.status'),
          json_extract(value, '$.parentRunId'),
          json_extract(value, '$.parentMode'),
          json_extract(value, '$.batchNodeId'),
          id
        ) WHERE collection = 'runs';
      `);
    },
  },
];

type Migration = { version: number; up: (db: DatabaseSync) => void };
export type MigrationResult = { from: number; to: number; backup?: string };

function version(db: DatabaseSync, latest: number): number {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  if (!tables.length) return 0;
  if (!tables.some((table) => table.name === 'migrations'))
    throw new Error('Unrecognized database: migration history is missing.');
  const history = db
    .prepare('SELECT version FROM migrations ORDER BY version')
    .all();
  const current = Number(history.at(-1)?.version ?? 0);
  if (current > latest)
    throw new Error(
      `Database schema ${current} is newer than this Interlock supports (${latest}). Install a newer Interlock version or restore a backup with its matching version.`,
    );
  if (
    !history.length ||
    history.some((row, index) => row.version !== index + 1)
  )
    throw new Error(
      'Invalid database migration history. Restore a known-good backup.',
    );
  if (!tables.some((table) => table.name === 'documents'))
    throw new Error('Invalid database: documents table is missing.');
  return current;
}

/** SQLite snapshots include committed WAL data. Keep incomplete backups out of the final filename. */
function backup(
  db: DatabaseSync,
  path: string,
  from: number,
  to: number,
): string {
  const directory = `${path}.backups`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = join(
    mkdtempSync(
      join(
        directory,
        `${new Date().toISOString().replaceAll(':', '-')}-v${from}-to-v${to}-`,
      ),
    ),
    'interlock.db',
  );
  try {
    closeSync(openSync(`${destination}.partial`, 'wx', 0o600));
    db.prepare('VACUUM INTO ?').run(`${destination}.partial`);
    renameSync(`${destination}.partial`, destination);
    return destination;
  } catch (error) {
    rmSync(`${destination}.partial`, { force: true });
    throw error;
  }
}

/** Runs before any engine writes. The optional plan lets upgrade tests exercise future migrations. */
export function migrate(
  db: DatabaseSync,
  path: string,
  plan = migrations,
): MigrationResult {
  let snapshot: string | undefined;
  let transaction = false;
  try {
    if (!plan.length || plan.some((item, index) => item.version !== index + 1))
      throw new Error('Migration versions must be consecutive, starting at 1.');
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
    const dataVersion = () =>
      db.prepare('PRAGMA data_version').get()!.data_version;
    const before = dataVersion();
    const latest = plan.at(-1)!.version;
    const current = version(db, latest);
    if (current === latest) return { from: current, to: latest };
    if (current > 0 && path !== ':memory:')
      snapshot = backup(db, path, current, latest);
    db.exec('BEGIN IMMEDIATE');
    transaction = true;
    // VACUUM INTO cannot run inside a transaction. Reject any intervening writer
    // so the backup always represents the database we are about to migrate.
    if (dataVersion() !== before)
      throw new Error(
        'Database changed during upgrade. Stop other Interlock servers and retry.',
      );
    for (const migration of plan.filter((item) => item.version > current)) {
      migration.up(db);
      db.prepare('INSERT INTO migrations (version) VALUES (?)').run(
        migration.version,
      );
    }
    db.exec('COMMIT');
    transaction = false;
    return {
      from: current,
      to: latest,
      ...(snapshot ? { backup: snapshot } : {}),
    };
  } catch (error) {
    if (transaction) db.exec('ROLLBACK');
    throw new Error(
      `Cannot open Interlock database ${path}. ${error instanceof Error ? error.message : String(error)}${snapshot ? ` Pre-upgrade backup: ${snapshot}.` : ''}`,
      { cause: error },
    );
  }
}
