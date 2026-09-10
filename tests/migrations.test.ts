import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { migrate, migrations } from '../packages/storage/src/migrations';
import fixture from './fixtures/schema-v1.json';

const directories: string[] = [];
const connections: { close(): void }[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of connections.splice(0).reverse()) db.close();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function path() {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-migration-'));
  directories.push(dir);
  return join(dir, 'interlock.db');
}
function open(file: string) {
  const db = new DatabaseSync(file);
  connections.push(db);
  return db;
}
function legacy(file: string) {
  const db = open(file);
  // Schema from @type_of/interlock@0.1.3, independent of the current initializer.
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE documents (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(collection, id));
    INSERT INTO migrations VALUES (1);`);
  for (const [collection, records] of Object.entries(fixture))
    for (const record of records)
      db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(
        collection,
        record.id,
        JSON.stringify(record),
      );
  return db;
}
const next = [
  ...migrations,
  {
    version: 2,
    up(db: DatabaseSync) {
      db.exec('CREATE TABLE upgrade_test (value TEXT)');
    },
  },
  {
    version: 3,
    up(db: DatabaseSync) {
      db.exec("INSERT INTO upgrade_test VALUES ('applied in order')");
    },
  },
];

it('initializes empty databases and reopens current databases without a backup', () => {
  const file = path();
  const db = open(file);
  expect(migrate(db, file)).toEqual({ from: 0, to: 1 });
  expect(migrate(db, file)).toEqual({ from: 1, to: 1 });
  expect(existsSync(`${file}.backups`)).toBe(false);
});

it('snapshots committed WAL data before applying all pending migrations, exactly once', () => {
  const file = path();
  const db = legacy(file);
  expect(statSync(`${file}-wal`).size).toBeGreaterThan(0);
  const before = db.prepare('SELECT * FROM documents ORDER BY rowid').all();
  const result = migrate(db, file, next);
  expect(result).toMatchObject({ from: 1, to: 3 });
  expect(db.prepare('SELECT * FROM upgrade_test').get()).toEqual({
    value: 'applied in order',
  });
  expect(db.prepare('SELECT * FROM documents ORDER BY rowid').all()).toEqual(
    before,
  );
  const snapshot = open(result.backup!);
  expect(snapshot.prepare('PRAGMA integrity_check').get()).toEqual({
    integrity_check: 'ok',
  });
  expect(snapshot.prepare('SELECT * FROM migrations').all()).toEqual([
    { version: 1 },
  ]);
  expect(
    snapshot.prepare('SELECT * FROM documents ORDER BY rowid').all(),
  ).toEqual(before);
  expect(statSync(result.backup!).mode & 0o777).toBe(0o600);
  expect(migrate(db, file, next)).toEqual({ from: 3, to: 3 });
  expect(readdirSync(`${file}.backups`)).toHaveLength(1);
});

it('rolls back the entire upgrade and preserves a usable backup if a later migration fails', () => {
  const file = path();
  const db = legacy(file);
  const before = db.prepare('SELECT * FROM documents').all();
  expect(() =>
    migrate(db, file, [
      ...next,
      {
        version: 4,
        up(db) {
          db.exec('DELETE FROM documents; CREATE TABLE partial (id TEXT)');
          throw new Error('conversion failed');
        },
      },
    ]),
  ).toThrow(/conversion failed.*Pre-upgrade backup:/);
  expect(db.prepare('SELECT * FROM documents').all()).toEqual(before);
  expect(db.prepare('SELECT * FROM migrations').all()).toEqual([
    { version: 1 },
  ]);
  expect(
    db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE name IN ('upgrade_test', 'partial')",
      )
      .all(),
  ).toEqual([]);
  const backup = join(
    `${file}.backups`,
    readdirSync(`${file}.backups`)[0],
    'interlock.db',
  );
  const restored = new Store(backup);
  connections.push(restored);
  expect(restored.runs()).toEqual(fixture.runs);
  expect(migrate(db, file, next)).toMatchObject({ from: 1, to: 3 });
  expect(readdirSync(`${file}.backups`)).toHaveLength(2);
});

it('does not migrate if the backup cannot be created', () => {
  const file = path();
  const db = legacy(file);
  writeFileSync(`${file}.backups`, 'blocked');
  expect(() => migrate(db, file, next)).toThrow(
    'Cannot open Interlock database',
  );
  expect(db.prepare('SELECT * FROM migrations').all()).toEqual([
    { version: 1 },
  ]);
});

it('rejects an intervening writer so the backup matches the migration input', () => {
  const file = path();
  const db = legacy(file);
  const writer = open(file);
  const exec = db.exec.bind(db);
  vi.spyOn(db, 'exec').mockImplementation((sql) => {
    if (sql === 'BEGIN IMMEDIATE')
      writer.exec("INSERT INTO documents VALUES ('test','concurrent','{}')");
    exec(sql);
  });
  expect(() => migrate(db, file, next)).toThrow(
    'Database changed during upgrade',
  );
  expect(db.prepare('SELECT * FROM migrations').all()).toEqual([
    { version: 1 },
  ]);
});

it('rejects a newer database before changing its schema or journal mode', () => {
  const file = path();
  const db = open(file);
  db.exec(
    'CREATE TABLE migrations (version INTEGER PRIMARY KEY); INSERT INTO migrations VALUES (99);',
  );
  const before = readFileSync(file);
  expect(() => new Store(file)).toThrow('schema 99 is newer');
  expect(readFileSync(file)).toEqual(before);
  expect(db.prepare('PRAGMA journal_mode').get()).toEqual({
    journal_mode: 'delete',
  });
  expect(existsSync(`${file}.backups`)).toBe(false);
});

it.each([
  'CREATE TABLE unrelated (id TEXT)',
  'CREATE TABLE migrations (version INTEGER PRIMARY KEY)',
  'CREATE TABLE migrations (version INTEGER PRIMARY KEY); INSERT INTO migrations VALUES (0)',
  'CREATE TABLE migrations (version INTEGER PRIMARY KEY); INSERT INTO migrations VALUES (1)',
])(
  'rejects an unrecognized or incomplete database without initializing over it: %s',
  (sql) => {
    const file = path();
    const db = open(file);
    db.exec(sql);
    const before = readFileSync(file);
    expect(() => new Store(file)).toThrow('Cannot open Interlock database');
    expect(readFileSync(file)).toEqual(before);
  },
);

it('supports in-memory upgrades without filesystem backups', () => {
  const db = open(':memory:');
  migrate(db, ':memory:');
  expect(migrate(db, ':memory:', next)).toEqual({ from: 1, to: 3 });
});

it('opens the previous release without rewriting records and executes its published scripts', async () => {
  const file = path();
  const db = legacy(file);
  const before = db.prepare('SELECT * FROM documents ORDER BY rowid').all();
  const store = new Store(file);
  connections.push(store);
  expect(store.migration).toEqual({ from: 1, to: 1 });
  expect(db.prepare('SELECT * FROM documents ORDER BY rowid').all()).toEqual(
    before,
  );
  expect(
    store.workflows().every((workflow) => workflow.ownerWorkflowId === null),
  ).toBe(true);
  const engine = new Engine(store, process.cwd());
  try {
    for (const workflow of fixture.workflows) {
      const run = engine.start(workflow.id, {}).run;
      await vi.waitFor(() =>
        expect(engine.run(run.id).status).toBe('completed'),
      );
      expect(engine.run(run.id).output).toBe(42);
    }
    for (const collection of ['versions', 'runs', 'events'] as const)
      for (const record of fixture[collection])
        expect(store.get(collection, record.id)).toEqual(record);
  } finally {
    engine.stop();
  }
});
