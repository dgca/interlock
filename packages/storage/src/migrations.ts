import type { DatabaseSync } from 'node:sqlite';
import { migrateCurrentState } from './currentState.js';
import { approveExistingScripts } from './scriptApprovals.js';
import { migrateRunExecutions } from './runExecutions.js';
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
  {
    version: 8,
    up(db) {
      db.exec(
        `CREATE INDEX pause_holds_scope ON documents(json_extract(value, '$.scope'), json_extract(value, '$.workflowId'), json_extract(value, '$.createdAt')) WHERE collection = 'pauseHolds';`,
      );
    },
  },
  {
    version: 9,
    up(db) {
      db.exec(`
        DROP TRIGGER active_comparison_insert;
        DROP TRIGGER active_comparison_update;
        DELETE FROM active_comparison_runs;
        INSERT INTO active_comparison_runs SELECT id, json_extract(value, '$.comparison.comparisonId')
        FROM documents WHERE collection = 'runs'
          AND json_extract(value, '$.status') IN ('queued', 'running', 'waiting')
          AND json_type(value, '$.comparison.comparisonId') = 'text';
        CREATE INDEX runs_admission_queue ON documents(coalesce(json_extract(value, '$.admission.priority'), 0) DESC)
          WHERE collection = 'runs' AND json_extract(value, '$.status') = 'queued';
      `);
      for (const operation of ['INSERT', 'UPDATE'])
        db.exec(`CREATE TRIGGER active_comparison_${operation.toLowerCase()} AFTER ${operation} ON documents
          WHEN NEW.collection = 'runs' BEGIN
          DELETE FROM active_comparison_runs WHERE run_id = NEW.id;
          INSERT INTO active_comparison_runs SELECT NEW.id, json_extract(NEW.value, '$.comparison.comparisonId')
            WHERE json_extract(NEW.value, '$.status') IN ('queued', 'running', 'waiting')
            AND json_type(NEW.value, '$.comparison.comparisonId') = 'text'; END;`);
    },
  },
  {
    version: 10,
    up(db) {
      db.exec(`
        CREATE INDEX workflow_triggers_workflow ON documents(json_extract(value, '$.workflowId')) WHERE collection = 'workflowTriggers';
        CREATE INDEX schedule_fires_trigger ON documents(json_extract(value, '$.triggerId'), json_extract(value, '$.scheduledAt') DESC) WHERE collection = 'scheduleFires';
        CREATE INDEX schedule_fires_pending ON documents(json_extract(value, '$.settled')) WHERE collection = 'scheduleFires';
      `);
    },
  },
  {
    version: 11,
    up(db) {
      db.exec(
        `CREATE INDEX stalls_unresolved ON documents(json_extract(value, '$.runId'), json_extract(value, '$.detectedAt')) WHERE collection = 'stalls' AND json_extract(value, '$.resolvedAt') IS NULL;`,
      );
    },
  },
  {
    version: 12,
    up(db) {
      db.exec(`CREATE INDEX webhook_deliveries_trigger ON documents(json_extract(value, '$.triggerId'), json_extract(value, '$.receivedAt') DESC) WHERE collection = 'webhookDeliveries';
        CREATE INDEX webhook_receipts_trigger ON documents(json_extract(value, '$.triggerId')) WHERE collection = 'webhookReceipts';
        CREATE INDEX webhook_outcomes_trigger ON documents(json_extract(value, '$.triggerId')) WHERE collection = 'webhookOutcomes';`);
    },
  },
  {
    version: 13,
    up(db) {
      db.exec(`
        CREATE INDEX event_deliveries_trigger ON documents(json_extract(value, '$.triggerId'), json_extract(value, '$.createdAt') DESC) WHERE collection = 'eventDeliveries';
        CREATE INDEX event_deliveries_pending ON documents(coalesce(json_extract(value, '$.settled'), 0)) WHERE collection = 'eventDeliveries';
        CREATE TABLE active_background_runs (run_id TEXT PRIMARY KEY);
        INSERT INTO active_background_runs SELECT d.id FROM documents d
          WHERE d.collection = 'runs' AND EXISTS (
            SELECT 1 FROM json_each(d.value, '$.executions') e
              WHERE json_extract(e.value, '$.background.state') IN ('launching', 'running'));
      `);
      const active = (value: string) => `EXISTS (
        SELECT 1 FROM json_each(${value}, '$.executions') e
          WHERE json_extract(e.value, '$.background.state') IN ('launching', 'running'))`;
      for (const operation of ['INSERT', 'UPDATE'])
        db.exec(`CREATE TRIGGER active_background_runs_${operation.toLowerCase()} AFTER ${operation} ON documents
          WHEN NEW.collection = 'runs' BEGIN
          DELETE FROM active_background_runs WHERE run_id = NEW.id;
          INSERT INTO active_background_runs SELECT NEW.id WHERE ${active('NEW.value')}; END;`);
      db.exec(`CREATE TRIGGER active_background_runs_delete AFTER DELETE ON documents
        WHEN OLD.collection = 'runs' BEGIN DELETE FROM active_background_runs WHERE run_id = OLD.id; END;`);
    },
  },
  {
    version: 14,
    up(db) {
      db.exec(`
        CREATE TABLE run_tags (
          run_id TEXT NOT NULL, tag_key TEXT NOT NULL, tag_value TEXT NOT NULL,
          PRIMARY KEY (run_id, tag_key)
        );
        CREATE INDEX run_tags_match ON run_tags(tag_key, tag_value, run_id);
        INSERT INTO run_tags
          SELECT d.id, tags.key, tags.value FROM documents d, json_each(d.value, '$.tags') tags
          WHERE d.collection = 'runs' AND tags.type = 'text';
        CREATE TRIGGER run_tags_insert AFTER INSERT ON documents WHEN NEW.collection = 'runs' BEGIN
          INSERT INTO run_tags SELECT NEW.id, key, value FROM json_each(NEW.value, '$.tags') WHERE type = 'text';
        END;
        CREATE TRIGGER run_tags_update AFTER UPDATE ON documents
          WHEN (OLD.collection = 'runs' OR NEW.collection = 'runs') AND
            (OLD.id IS NOT NEW.id OR OLD.collection IS NOT NEW.collection OR
             json_extract(OLD.value, '$.tags') IS NOT json_extract(NEW.value, '$.tags')) BEGIN
          DELETE FROM run_tags WHERE run_id = OLD.id;
          INSERT INTO run_tags SELECT NEW.id, key, value FROM json_each(NEW.value, '$.tags') WHERE NEW.collection = 'runs' AND type = 'text';
        END;
        CREATE TRIGGER run_tags_delete AFTER DELETE ON documents WHEN OLD.collection = 'runs' BEGIN
          DELETE FROM run_tags WHERE run_id = OLD.id;
        END;
      `);
    },
  },
  {
    version: 15,
    up(db) {
      // These integrations existed only in unreleased development builds.
      db.exec(`
        DROP INDEX IF EXISTS webhook_deliveries_trigger;
        DROP INDEX IF EXISTS webhook_receipts_trigger;
        DROP INDEX IF EXISTS webhook_outcomes_trigger;
        DELETE FROM documents WHERE collection = 'eventDeliveries'
          AND json_extract(value, '$.triggerId') IN (
            SELECT id FROM documents WHERE collection = 'workflowTriggers'
              AND json_extract(value, '$.kind') = 'event'
              AND json_extract(value, '$.action.type') = 'webhook'
          );
        DELETE FROM documents WHERE collection = 'workflowTriggers'
          AND (json_extract(value, '$.kind') = 'webhook' OR
            (json_extract(value, '$.kind') = 'event' AND json_extract(value, '$.action.type') = 'webhook'));
        DELETE FROM documents WHERE collection IN ('webhookDeliveries', 'webhookReceipts', 'webhookOutcomes');
      `);
    },
  },
  {
    version: 16,
    up(db) {
      db.exec(`
        UPDATE documents SET value = json_remove(value, '$.distinctProviderFrom', '$.candidateModels', '$.providerDiversityBlocked')
          WHERE collection = 'work' AND (
            json_type(value, '$.distinctProviderFrom') IS NOT NULL OR
            json_type(value, '$.candidateModels') IS NOT NULL OR
            json_type(value, '$.providerDiversityBlocked') IS NOT NULL
          );
      `);
    },
  },
  {
    version: 17,
    up(db) {
      db.exec(`
        CREATE TABLE transcript_executions (
          execution_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, capability TEXT NOT NULL,
          ended_at INTEGER, omitted INTEGER NOT NULL DEFAULT 0, reason TEXT,
          receipts_pruned INTEGER NOT NULL DEFAULT 0, pressure_gap INTEGER NOT NULL DEFAULT 0,
          retained_entries INTEGER NOT NULL DEFAULT 0, retained_bytes INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX transcript_run ON transcript_executions(run_id);
        CREATE INDEX transcript_ended ON transcript_executions(ended_at);
        CREATE TABLE transcript_entries (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, execution_id TEXT NOT NULL,
          entry_key TEXT, value TEXT NOT NULL, bytes INTEGER NOT NULL,
          UNIQUE(execution_id, entry_key)
        );
        CREATE INDEX transcript_page ON transcript_entries(execution_id, sequence);
        CREATE TABLE transcript_receipts (
          execution_id TEXT NOT NULL, request_id TEXT NOT NULL,
          hash TEXT NOT NULL, value TEXT NOT NULL, bytes INTEGER NOT NULL,
          PRIMARY KEY(execution_id, request_id)
        );
        CREATE TABLE transcript_size (id INTEGER PRIMARY KEY CHECK(id = 1), bytes INTEGER NOT NULL);
        INSERT INTO transcript_size VALUES (1, 0);
        CREATE TRIGGER transcript_entry_insert AFTER INSERT ON transcript_entries BEGIN
          UPDATE transcript_executions SET retained_entries = retained_entries + 1, retained_bytes = retained_bytes + NEW.bytes WHERE execution_id = NEW.execution_id;
          UPDATE transcript_size SET bytes = bytes + NEW.bytes WHERE id = 1; END;
        CREATE TRIGGER transcript_entry_delete AFTER DELETE ON transcript_entries BEGIN
          UPDATE transcript_executions SET retained_entries = retained_entries - 1, retained_bytes = retained_bytes - OLD.bytes WHERE execution_id = OLD.execution_id;
          UPDATE transcript_size SET bytes = bytes - OLD.bytes WHERE id = 1; END;
        CREATE TRIGGER transcript_receipt_insert AFTER INSERT ON transcript_receipts BEGIN
          UPDATE transcript_size SET bytes = bytes + NEW.bytes WHERE id = 1; END;
        CREATE TRIGGER transcript_receipt_update AFTER UPDATE ON transcript_receipts BEGIN
          UPDATE transcript_size SET bytes = bytes + NEW.bytes - OLD.bytes WHERE id = 1; END;
        CREATE TRIGGER transcript_receipt_delete AFTER DELETE ON transcript_receipts BEGIN
          UPDATE transcript_size SET bytes = bytes - OLD.bytes WHERE id = 1; END;
        CREATE TRIGGER transcript_execution_delete AFTER DELETE ON transcript_executions BEGIN
          DELETE FROM transcript_entries WHERE execution_id = OLD.execution_id;
          DELETE FROM transcript_receipts WHERE execution_id = OLD.execution_id; END;
        CREATE TRIGGER transcript_managed_delete AFTER DELETE ON documents
          WHEN OLD.collection = 'managedExecutions' BEGIN
          DELETE FROM transcript_executions WHERE execution_id = OLD.id; END;
      `);
    },
  },
  {
    version: 18,
    up(db) {
      db.exec(`
        CREATE INDEX human_input_waiting ON documents(id)
          WHERE collection = 'runs' AND json_extract(value, '$.status') = 'waiting'
            AND json_extract(value, '$.executions[#-1].status') = 'waiting'
            AND json_type(value, '$.executions[#-1].humanInput') = 'object';
        CREATE INDEX board_stage_entries ON documents(
          json_extract(value, '$.boardColumnId'), json_extract(value, '$.runId')
        ) WHERE collection = 'events' AND json_type(value, '$.boardColumnId') = 'text';
        CREATE INDEX uncertain_background_steps ON documents(id)
          WHERE collection = 'runs' AND json_extract(value, '$.executions[#-1].background.state') = 'uncertain';
      `);
    },
  },
  { version: 19, up: migrateCurrentState },
  {
    version: 20,
    up(db) {
      db.exec(`
        CREATE INDEX script_approval_waiting ON documents(id)
          WHERE collection = 'runs' AND json_extract(value, '$.status') = 'waiting'
            AND json_type(value, '$.executions[#-1].scriptApproval') = 'object';
      `);
      approveExistingScripts(db);
    },
  },
  // One-way: run documents no longer embed executions after this version.
  { version: 21, up: migrateRunExecutions },
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
    db.exec('PRAGMA busy_timeout = 5000;');
    if (db.prepare('PRAGMA journal_mode').get()?.journal_mode === 'wal') {
      db.exec('PRAGMA synchronous = NORMAL;');
    } else {
      db.exec('PRAGMA synchronous = FULL;');
    }
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
