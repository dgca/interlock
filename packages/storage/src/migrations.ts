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
