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
import previousRelease from './fixtures/schema-v2.json';

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
  ...migrations.slice(0, 1),
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
  expect(migrate(db, file)).toEqual({ from: 0, to: 19 });
  expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
  expect(migrate(db, file)).toEqual({ from: 19, to: 19 });
  expect(existsSync(`${file}.backups`)).toBe(false);
});

it('indexes queued comparison roots during schema-8 upgrade without rewriting run documents', () => {
  const file = path(),
    db = open(file);
  migrate(db, file, migrations.slice(0, 8));
  const run = {
    id: 'queued-root',
    status: 'queued',
    comparison: { comparisonId: 'comparison' },
    admission: { priority: 7 },
  };
  db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(
    'runs',
    run.id,
    JSON.stringify(run),
  );
  expect(db.prepare('SELECT * FROM active_comparison_runs').all()).toEqual([]);
  const before = db.prepare('SELECT * FROM documents ORDER BY rowid').all();
  expect(migrate(db, file)).toMatchObject({
    from: 8,
    to: 19,
    backup: expect.any(String),
  });
  expect(db.prepare('SELECT * FROM documents ORDER BY rowid').all()).toEqual(
    before,
  );
  expect(db.prepare('SELECT * FROM active_comparison_runs').all()).toEqual([
    { run_id: run.id, comparison_id: 'comparison' },
  ]);
  expect(
    db
      .prepare(
        "SELECT id FROM documents INDEXED BY runs_admission_queue WHERE collection='runs' AND json_extract(value,'$.status')='queued'",
      )
      .all(),
  ).toEqual([{ id: run.id }]);
});

it.each([
  { journalMode: 'wal', synchronous: 1, databasePath: path },
  { journalMode: 'memory', synchronous: 2, databasePath: () => ':memory:' },
])(
  'uses synchronous=$synchronous when the store journal mode is $journalMode',
  ({ journalMode, synchronous, databasePath }) => {
    const store = new Store(databasePath());
    connections.push(store);
    expect(store['db'].prepare('PRAGMA journal_mode').get()).toEqual({
      journal_mode: journalMode,
    });
    expect(store['db'].prepare('PRAGMA synchronous').get()).toEqual({
      synchronous,
    });
  },
);

it('snapshots committed WAL data before applying all pending migrations, exactly once', () => {
  const file = path();
  const db = legacy(file);
  expect(statSync(`${file}-wal`).size).toBeGreaterThan(0);
  const before = db.prepare('SELECT * FROM documents ORDER BY rowid').all();
  const result = migrate(db, file, next);
  expect(result).toMatchObject({ from: 1, to: 3 });
  expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 1 });
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
  migrate(db, ':memory:', migrations.slice(0, 1));
  expect(migrate(db, ':memory:', next)).toEqual({ from: 1, to: 3 });
});

it('opens the previous release without rewriting records and executes its published scripts', async () => {
  const file = path();
  const db = legacy(file);
  const before = db.prepare('SELECT * FROM documents ORDER BY rowid').all();
  const store = new Store(file);
  connections.push(store);
  expect(store.migration).toMatchObject({
    from: 1,
    to: 19,
    backup: expect.any(String),
  });
  expect(
    db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'index' AND name LIKE 'runs_%'",
      )
      .all(),
  ).toHaveLength(7);
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

it('upgrades schema-2 documents without rewriting them and persists revisions across reopen', () => {
  const file = path();
  const db = open(file);
  migrate(db, file, migrations.slice(0, 2));
  for (const [collection, records] of Object.entries(previousRelease.documents))
    for (const record of records)
      db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(
        collection,
        record.id,
        JSON.stringify(record),
      );
  const before = db.prepare('SELECT * FROM documents ORDER BY rowid').all();
  const store = new Store(file);
  connections.push(store);
  expect(store.migration).toMatchObject({
    from: 2,
    to: 19,
    backup: expect.any(String),
  });
  expect(db.prepare('SELECT * FROM documents ORDER BY rowid').all()).toEqual(
    before,
  );
  const run = previousRelease.documents.runs[0];
  expect(store.continuation(run.id).revision).toBe(0);
  store.put('runs', { ...run, error: 'revision-test' });
  const revision = store.continuation(run.id).revision;
  expect(revision).toBeGreaterThan(0);
  const reopened = new Store(file);
  connections.push(reopened);
  expect(reopened.migration).toEqual({ from: 19, to: 19 });
  expect(reopened.continuation(run.id).revision).toBe(revision);
  store.remove('runs', run.id);
  expect(
    db.prepare('SELECT * FROM run_revisions WHERE run_id = ?').get(run.id),
  ).toBeUndefined();
});

it('adds run summary indexes to schema-6 databases without rewriting records', () => {
  const file = path();
  const db = open(file);
  migrate(db, file, migrations.slice(0, 6));
  const run = previousRelease.documents.runs[0];
  db.prepare("INSERT INTO documents VALUES ('runs', ?, ?)").run(
    run.id,
    JSON.stringify(run),
  );

  const store = new Store(file);
  connections.push(store);
  expect(store.migration).toMatchObject({
    from: 6,
    to: 19,
    backup: expect.any(String),
  });
  expect(store.get('runs', run.id)).toEqual(run);
  expect(store.runSummaries({ offset: 0, limit: 100 }, []).items).toMatchObject(
    [{ id: run.id, executionCount: run.executions.length }],
  );
  const backup = open(store.migration.backup!);
  expect(
    backup.prepare('SELECT max(version) AS version FROM migrations').get(),
  ).toMatchObject({ version: 6 });
  expect(
    backup.prepare('SELECT value FROM documents WHERE id = ?').get(run.id),
  ).toMatchObject({ value: JSON.stringify(run) });
});

it('continues claimed work and executes script pins from published 0.1.13 after migration', async () => {
  const file = path(),
    db = open(file);
  migrate(db, file, migrations.slice(0, 2));
  for (const [collection, records] of Object.entries(previousRelease.documents))
    for (const record of records)
      db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(
        collection,
        record.id,
        JSON.stringify(record),
      );
  const store = new Store(file);
  connections.push(store);
  const engine = new Engine(store, process.cwd());
  try {
    const claim = previousRelease.documents.work[0];
    const snapshot = engine.continuation.briefing({
      id: claim.runId,
      limit: 20,
    });
    expect(snapshot.claimed.items[0]).toMatchObject({
      id: claim.id,
      workerId: 'fixture-worker',
    });
    expect(JSON.stringify(snapshot)).not.toContain('fixture-token');
    engine.submit(claim.id, claim.token, { upgraded: true });
    expect(engine.run(claim.runId).output).toEqual({ upgraded: true });
    for (const workflow of previousRelease.documents.workflows.filter(
      (w) => w.name !== 'prior-agent',
    )) {
      const run = engine.start(workflow.id, {}).run;
      await vi.waitFor(() =>
        expect(engine.run(run.id).status).toBe('completed'),
      );
      expect(engine.run(run.id).output).toEqual({ answer: 42 });
    }
    for (const version of previousRelease.documents.versions)
      expect(store.get('versions', version.id)).toEqual(version);
  } finally {
    engine.stop();
  }
});

it('indexes human attention independently of completed assignment history', () => {
  const db = open(':memory:');
  migrate(db, ':memory:');
  const plan = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT value FROM documents WHERE collection = 'work' AND json_extract(value, '$.managedExecution.state') = 'needs_human'",
    )
    .all();
  expect(JSON.stringify(plan)).toContain('work_attention');
});

it('indexes unresolved stalls during schema-10 upgrade without discarding resolved history', () => {
  const file = path(),
    db = open(file);
  migrate(db, file, migrations.slice(0, 10));
  for (const [id, resolvedAt] of [
    ['active', null],
    ['resolved', '2026-11-07T00:00:00Z'],
  ])
    db.prepare('INSERT INTO documents VALUES (?,?,?)').run(
      'stalls',
      id,
      JSON.stringify({
        id,
        runId: 'run',
        resolvedAt,
        detectedAt: '2026-11-06T00:00:00Z',
      }),
    );
  const before = db.prepare('SELECT * FROM documents ORDER BY rowid').all();
  expect(migrate(db, file)).toMatchObject({
    from: 10,
    to: 19,
    backup: expect.any(String),
  });
  expect(db.prepare('SELECT * FROM documents ORDER BY rowid').all()).toEqual(
    before,
  );
  const plan = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT value FROM documents INDEXED BY stalls_unresolved WHERE collection = 'stalls' AND json_extract(value, '$.resolvedAt') IS NULL AND json_extract(value, '$.runId') = ?",
    )
    .all('run');
  expect(JSON.stringify(plan)).toContain(
    'SEARCH documents USING INDEX stalls_unresolved',
  );
  const store = new Store(file);
  connections.push(store);
  expect(store.currentStalls('run')).toMatchObject([{ id: 'active' }]);
  expect(store.forRuns('stalls', new Set(['run']))).toHaveLength(2);
});

it('adds lifecycle indexes and active background projection to schema-12 without rewriting documents', () => {
  const file = path();
  const db = open(file);
  migrate(db, file, migrations.slice(0, 12));
  const value = JSON.stringify({
    id: 'pending',
    triggerId: 'trigger',
    createdAt: '2026-01-01T00:00:00Z',
    settled: false,
  });
  db.prepare(
    "INSERT INTO documents VALUES ('eventDeliveries', 'pending', ?)",
  ).run(value);
  const background = {
    id: 'background',
    status: 'cancelled',
    executions: [{ background: { state: 'running' } }],
  };
  db.prepare("INSERT INTO documents VALUES ('runs', 'background', ?)").run(
    JSON.stringify(background),
  );
  const before = db.prepare('SELECT * FROM documents ORDER BY rowid').all();
  expect(migrate(db, file)).toMatchObject({
    from: 12,
    to: 19,
    backup: expect.any(String),
  });
  expect(db.prepare('SELECT * FROM documents ORDER BY rowid').all()).toEqual(
    before,
  );
  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'index' AND name LIKE 'event_deliveries_%'",
    )
    .all()
    .map((row) => row.name);
  expect(indexes.sort()).toEqual([
    'event_deliveries_pending',
    'event_deliveries_trigger',
  ]);
  const store = new Store(file);
  connections.push(store);
  expect(store.terminalBackgroundRuns()).toMatchObject([{ id: 'background' }]);
  // Store.put uses an outer upsert, whose conflict policy also affects triggers.
  store.put('runs', { ...background, updatedAt: 'first update' });
  store.put('runs', { ...background, updatedAt: 'second update' });
  expect(store.terminalBackgroundRuns()).toHaveLength(1);
  store.put('runs', {
    ...background,
    executions: [{ background: { state: 'completed' } }],
  });
  expect(store.terminalBackgroundRuns()).toEqual([]);
});
