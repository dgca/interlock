import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  blankDefinition,
  eventConfigSchema,
  scheduleConfigSchema,
} from '@interlock/core';
import { workflowBundleSchema } from '../packages/core/src/transfer';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { migrate, migrations } from '../packages/storage/src/migrations';
import published from './fixtures/published-0.2.13.json';

const directories: string[] = [];
const engines: Engine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function databasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'interlock-webhook-removal-'));
  directories.push(directory);
  return join(directory, 'interlock.db');
}
function engine(file = ':memory:') {
  const e = new Engine(new Store(file), process.cwd());
  engines.push(e);
  return e;
}

it('upgrades the published 0.2.13 database unchanged and executes both published script languages', async () => {
  const file = databasePath();
  const db = new DatabaseSync(file);
  try {
    // Restore SQL and rows from the npm release, independently of current migrations.
    for (const row of published.schema.filter((row) => row.type !== 'trigger'))
      db.exec(row.sql);
    for (const [table, rows] of Object.entries(published.tables))
      for (const row of rows) {
        const keys = Object.keys(row);
        db.prepare(
          `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        ).run(...Object.values(row));
      }
    for (const row of published.schema.filter((row) => row.type === 'trigger'))
      db.exec(row.sql);
    const before = db.prepare('SELECT * FROM documents ORDER BY rowid').all();
    const e = engine(file);
    expect(e.store.migration).toMatchObject({
      from: 7,
      to: 18,
      backup: expect.any(String),
    });
    expect(db.prepare('SELECT * FROM documents ORDER BY rowid').all()).toEqual(
      before,
    );
    const backup = new DatabaseSync(e.store.migration.backup!);
    try {
      expect(
        backup.prepare('SELECT max(version) AS version FROM migrations').get(),
      ).toMatchObject({ version: 7 });
      expect(
        backup.prepare('SELECT * FROM documents ORDER BY rowid').all(),
      ).toEqual(before);
    } finally {
      backup.close();
    }
    for (const workflow of e.store.workflows()) {
      const bundle = exportWorkflows(e.store, workflow.id);
      expect(bundle.formatVersion).toBe(1);
      const target = engine();
      importWorkflows(target.store, bundle);
      const run = target.start(workflow.id, {}).run;
      await vi.waitFor(() =>
        expect(target.run(run.id).status).toBe('completed'),
      );
      expect(target.run(run.id).output).toEqual({ answer: 42 });
    }
    expect(db.prepare('SELECT * FROM documents ORDER BY rowid').all()).toEqual(
      before,
    );
  } finally {
    db.close();
  }
});

it.each([12, 13, 14])(
  'removes only obsolete integration data when upgrading development schema %s',
  (version) => {
    const file = databasePath();
    const db = new DatabaseSync(file);
    try {
      migrate(db, file, migrations.slice(0, version));
      const put = (
        collection: string,
        value: { id: string; [key: string]: unknown },
      ) =>
        db
          .prepare('INSERT INTO documents VALUES (?, ?, ?)')
          .run(collection, value.id, JSON.stringify(value));
      put('workflowTriggers', { id: 'inbound', kind: 'webhook' });
      put('workflowTriggers', {
        id: 'outbound',
        kind: 'event',
        action: { type: 'webhook' },
      });
      put('workflowTriggers', {
        id: 'schedule',
        ...scheduleConfigSchema.parse({
          name: 'Keep schedule',
          timing: { type: 'interval', intervalMs: 30000 },
        }),
      });
      put('workflowTriggers', {
        id: 'event',
        ...eventConfigSchema.parse({
          kind: 'event',
          name: 'Keep handler',
          events: ['completed'],
          scope: { type: 'library' },
        }),
      });
      put('workflowTriggers', {
        id: 'explicit',
        ...eventConfigSchema.parse({
          kind: 'event',
          name: 'Explicit handler',
          events: ['failed'],
          scope: { type: 'library' },
          action: { type: 'workflow' },
        }),
      });
      put('eventDeliveries', {
        id: 'outbound-delivery',
        triggerId: 'outbound',
        settled: false,
      });
      put('eventDeliveries', {
        id: 'handler-delivery',
        triggerId: 'event',
        settled: false,
      });
      put('eventTriggerReceipts', { id: 'receipt', triggerId: 'event' });
      put('runs', { id: 'keep-run', status: 'completed', executions: [] });
      put('variables', { id: 'keep-secret', kind: 'secret' });
      for (const collection of [
        'webhookDeliveries',
        'webhookReceipts',
        'webhookOutcomes',
      ])
        put(collection, { id: collection });
      const kept = db
        .prepare(
          "SELECT * FROM documents WHERE id IN ('schedule', 'event', 'explicit', 'handler-delivery', 'receipt', 'keep-run', 'keep-secret') ORDER BY rowid",
        )
        .all();
      const upgrade = migrate(db, file);
      expect(upgrade).toMatchObject({
        from: version,
        to: 18,
        backup: expect.any(String),
      });
      expect(
        db.prepare('SELECT * FROM documents ORDER BY rowid').all(),
      ).toEqual(kept);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'index' AND name LIKE 'webhook_%'",
          )
          .all(),
      ).toEqual([]);
      expect(migrate(db, file)).toEqual({ from: 18, to: 18 });
    } finally {
      db.close();
    }
  },
);

it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
  'retains bundle format %s while rejecting removed webhook configurations atomically',
  (formatVersion) => {
    const source = engine();
    const w = source.create('Portable', '', blankDefinition());
    const bundle = { ...exportWorkflows(source.store, w.id), formatVersion };
    expect(workflowBundleSchema.parse(bundle).formatVersion).toBe(
      formatVersion,
    );
    const target = engine();
    importWorkflows(target.store, bundle as any);
    expect(target.workflow(w.id).draft).toEqual(w.draft);
    // The published reader strips unrelated annotations instead of rejecting them.
    const annotated = structuredClone(bundle) as any;
    annotated.workflows[0].source = 'annotated export';
    expect(
      workflowBundleSchema.parse(annotated).workflows[0],
    ).not.toHaveProperty('source');
    importWorkflows(target.store, annotated);
    const inbound = structuredClone(bundle) as any;
    inbound.workflows[0].webhooks = [
      { id: 'old', config: { kind: 'webhook' } },
    ];
    expect(() =>
      importWorkflows(target.store, inbound, { force: true }),
    ).toThrow();
    const outbound = structuredClone(bundle) as any;
    outbound.workflows[0].eventTriggers = [
      {
        id: 'old',
        config: {
          kind: 'event',
          name: 'Removed',
          events: ['failed'],
          scope: { type: 'library' },
          action: { type: 'webhook', url: 'https://example.com' },
        },
      },
    ];
    expect(() =>
      importWorkflows(target.store, outbound, { force: true }),
    ).toThrow();
    expect(target.store.workflowTriggers()).toEqual([]);
    expect(target.workflow(w.id).draftRevision).toBe(w.draftRevision);
  },
);
