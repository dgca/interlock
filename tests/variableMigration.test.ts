import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { migrate, migrations } from '../packages/storage/src/migrations';
import {
  blankDefinition,
  nodeSchema,
  type SavedVariable,
} from '@interlock/core';

const directories: string[] = [];
const connections: { close(): void }[] = [];
afterEach(() => {
  for (const db of connections.splice(0).reverse()) db.close();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
type Row = Record<string, string | number | null>;

it('deletes disabled variables at schema 23 so referenced, bound and captured values stay unusable', async () => {
  // A 0.2.x store: enabled, disabled, referenced-and-disabled and captured-and-disabled variables.
  const dir = mkdtempSync(join(tmpdir(), 'interlock-variables-upgrade-'));
  directories.push(dir);
  const secretKeyFile = join(dir, 'private', 'key');
  const source = new Engine(
    new Store(join(dir, 'source.db'), { secretKeyFile }),
    dir,
  );
  const create = (name: string) =>
    source.variables.mutate({
      action: 'create',
      name,
      kind: 'config',
      value: `${name}-value`,
    }) as SavedVariable;
  const [kept, unused, referenced, captured] = [
    'kept',
    'unused',
    'referenced',
    'captured',
  ].map(create);
  const publish = (variableId: string) => {
    const d = blankDefinition();
    d.nodes.splice(
      2,
      0,
      nodeSchema.parse({
        id: 'use',
        kind: 'script',
        label: 'Use variable',
        language: 'javascript',
        command: 'return { echo: process.env.TOKEN };',
        environment: [{ name: 'TOKEN', variableId }],
      }),
    );
    d.edges.find((e) => e.source === 'agent')!.target = 'use';
    d.edges.push({ ...d.edges[0], id: 'e3', source: 'use', target: 'exit' });
    const workflow = source.create(`Uses ${variableId}`, '', d);
    source.publish(workflow.id);
    return workflow.id;
  };
  const keptWorkflow = publish(kept.id);
  const referencedWorkflow = publish(referenced.id);
  const capturedWorkflow = publish(captured.id);
  for (const [portable, variable] of [
    ['portable-kept', kept],
    ['portable-referenced', referenced],
  ] as const)
    source.variables.mutate({
      action: 'bind',
      id: portable,
      variableId: variable.id,
      kind: 'config',
      expectedRevision: 0,
    });
  const keptRun = source.start(keptWorkflow, {}).run.id;
  const capturedRun = source.start(capturedWorkflow, {}).run.id;
  source.stop();
  // Copy into a schema-22 database, adding the enabled flag 0.2.x stored.
  const file = join(dir, 'interlock.db');
  const db = new DatabaseSync(file);
  connections.push(db);
  migrate(db, file, migrations.slice(0, 22));
  const disabled = new Set([unused.id, referenced.id, captured.id]);
  const rows = (sql: string) => source.store['db'].prepare(sql).all() as Row[];
  const insert = db.prepare('INSERT INTO documents VALUES (?, ?, ?)');
  for (const row of rows('SELECT * FROM documents ORDER BY rowid')) {
    const value = JSON.parse(row.value as string) as SavedVariable;
    insert.run(
      row.collection,
      row.id,
      JSON.stringify(
        row.collection === 'variables'
          ? { ...value, enabled: !disabled.has(value.id) }
          : value,
      ),
    );
  }
  const execution = db.prepare(
    'INSERT INTO run_executions VALUES (?, ?, ?, ?)',
  );
  for (const row of rows('SELECT * FROM run_executions'))
    execution.run(row.run_id, row.position, row.id, row.value);
  const keptRecord = source.store.get('variables', kept.id);
  source.store.close();

  const store = new Store(file, { secretKeyFile });
  connections.push(store);
  expect(store.migration).toMatchObject({ from: 22, to: 23 });
  expect(existsSync(store.migration.backup!)).toBe(true);
  expect(store.list('variables')).toEqual([keptRecord]);
  expect(
    store
      .list<{ variableId: string }>('variableValues')
      .map((e) => e.variableId),
  ).toEqual([kept.id]);
  expect(store.list('variableBindings')).toEqual([
    expect.objectContaining({ id: 'portable-kept', variableId: kept.id }),
  ]);
  // A restored pre-upgrade backup upgrades again with the same result.
  const restoredFile = join(dir, 'restored.db');
  copyFileSync(store.migration.backup!, restoredFile);
  const restored = new Store(restoredFile, { secretKeyFile });
  connections.push(restored);
  expect(restored.migration).toMatchObject({ from: 22, to: 23 });
  expect(restored.list('variables')).toEqual([keptRecord]);
  expect(restored.list('variableBindings')).toEqual(
    store.list('variableBindings'),
  );
  const engine = new Engine(store, dir);
  const worker = {
    workerId: 'upgrade',
    freshContext: false,
    tools: [],
    skills: [],
  };
  const finish = async (runId: string) => {
    const work = engine.claim(engine.available(runId)[0].id, worker);
    engine.submit(work.id, work.token!, {});
    await vi.waitFor(() =>
      expect(['completed', 'failed']).toContain(engine.run(runId).status),
    );
    return engine.run(runId);
  };
  try {
    expect((await finish(keptRun)).output).toEqual({ echo: 'kept-value' });
    expect(() => engine.start(referencedWorkflow, {})).toThrow(/missing/);
    const failed = await finish(capturedRun);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Variable captured was deleted');
    // Re-provisioning the same identity gives a new revision; the old capture stays unusable.
    engine.variables.importRequirements(
      [{ id: captured.id, name: 'captured', kind: 'config' }],
      { [captured.id]: { action: 'provision' } },
    );
    const replaced = engine.variables.mutate({
      action: 'update',
      id: captured.id,
      expectedRevision: 1,
      value: 'replacement',
    }) as SavedVariable;
    expect(replaced.valueRevision).toBe(2);
    engine.retry(capturedRun);
    await vi.waitFor(() =>
      expect(engine.run(capturedRun).error).toContain('revision is missing'),
    );
    expect(engine.run(capturedRun).status).toBe('failed');
  } finally {
    engine.stop();
  }
});

it('treats every value 0.2.x read as falsy as disabled, and upgrades an empty store', () => {
  const db = new DatabaseSync(':memory:');
  connections.push(db);
  migrate(db, ':memory:', migrations.slice(0, 22));
  const cases: [string, unknown][] = [
    ['missing', undefined],
    ['null', null],
    ['false', false],
    ['zero', 0],
    ['real-zero', 0.0],
    ['empty', ''],
    ['true', true],
    ['one', 1],
    ['text-false', 'false'],
    ['object', {}],
  ];
  const kept = ['true', 'one', 'text-false', 'object'];
  const insert = db.prepare('INSERT INTO documents VALUES (?, ?, ?)');
  for (const [id, enabled] of cases) {
    const variable: Record<string, unknown> = { id, name: id, kind: 'secret' };
    if (enabled !== undefined) variable.enabled = enabled;
    insert.run('variables', id, JSON.stringify(variable));
    insert.run(
      'variableValues',
      `${id}:1`,
      JSON.stringify({ id: `${id}:1`, variableId: id }),
    );
    insert.run(
      'variableBindings',
      `portable-${id}`,
      JSON.stringify({ id: `portable-${id}`, variableId: id }),
    );
  }
  // 0.0 is stored as a JSON real, not an integer.
  db.prepare(
    `UPDATE documents SET value = json_set(value, '$.enabled', json('0.0')) WHERE id = 'real-zero' AND collection = 'variables'`,
  ).run();
  expect(migrate(db, ':memory:')).toEqual({ from: 22, to: 23 });
  const ids = (collection: string) =>
    (
      db
        .prepare(
          `SELECT json_extract(value, '$.variableId') AS id FROM documents WHERE collection = ? ORDER BY id`,
        )
        .all(collection) as { id: string }[]
    ).map((row) => row.id);
  expect(
    db
      .prepare(
        `SELECT id, json_type(value, '$.enabled') AS flag FROM documents WHERE collection = 'variables' ORDER BY id`,
      )
      .all(),
  ).toEqual(kept.sort().map((id) => ({ id, flag: null })));
  expect(ids('variableValues')).toEqual(kept.sort());
  expect(ids('variableBindings')).toEqual(kept.sort());

  const empty = new DatabaseSync(':memory:');
  connections.push(empty);
  migrate(empty, ':memory:', migrations.slice(0, 22));
  expect(migrate(empty, ':memory:')).toEqual({ from: 22, to: 23 });
  expect(empty.prepare('SELECT count(*) AS n FROM documents').get()).toEqual({
    n: 0,
  });
});
