import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { migrate, migrations } from '../packages/storage/src/migrations';

const engines: Engine[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
});
function setup() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  return engine;
}

it('does not parse completed comparison captures or uncertain resource history during repeated idle ticks', () => {
  const engine = setup();
  engine.store.transaction(() => {
    for (let i = 0; i < 1000; i++) {
      engine.store.put('comparisons', {
        id: `comparison-${i}`,
        status: 'completed',
        samples: [],
        judgments: [],
        prompts: [{ content: 'archived-capture'.repeat(100) }],
      });
      engine.store.put('workResources', {
        id: `resource-${i}`,
        state: 'uncertain',
        runId: `old-${i}`,
        name: 'archived-resource',
        reason: 'external worker must stop',
      });
    }
  });
  const parse = vi.spyOn(JSON, 'parse');
  for (let i = 0; i < 5; i++) engine.pump();
  expect(
    parse.mock.calls.filter(([value]) =>
      /archived-capture|archived-resource/.test(value),
    ).length,
  ).toBe(0);
  expect(engine.store.list('workResources')).toHaveLength(1000);
});

it('maintains pending comparison selection across completion, retry, cancelled descendants, cleanup and rollback', () => {
  const { store } = setup();
  const current = {
    id: 'comparison',
    status: 'running',
    samples: [{ runId: 'root' }],
    judgments: [],
  };
  store.put('comparisons', current);
  expect(store.scheduledComparisons().map((c) => c.id)).toEqual(['comparison']);
  store.put('comparisons', { ...current, status: 'completed' });
  expect(store.scheduledComparisons()).toEqual([]);
  store.put('comparisons', current);
  expect(store.scheduledComparisons()).toHaveLength(1);
  store.put('comparisons', { ...current, status: 'cancelled' });
  expect(store.scheduledComparisons()).toHaveLength(1);
  const observed = {
    ...current,
    status: 'cancelled',
    samples: [{ runId: 'root', observation: { status: 'cancelled' } }],
  };
  store.put('comparisons', observed);
  expect(store.scheduledComparisons()).toEqual([]);
  const cleanup = {
    ...observed,
    status: 'completed',
    trialSetup: {},
    samples: [
      {
        ...observed.samples[0],
        trial: { preparation: 'ready', cleanup: 'pending' },
      },
    ],
  };
  store.put('comparisons', cleanup);
  expect(store.scheduledComparisons()).toEqual([]);
  expect(store.scheduledComparisons(true)).toHaveLength(1);
  expect(() =>
    store.transaction(() => {
      store.put('comparisons', { ...cleanup, samples: [] });
      throw new Error('rollback');
    }),
  ).toThrow('rollback');
  expect(store.scheduledComparisons(true)).toHaveLength(1);
  store.put('comparisons', {
    ...cleanup,
    samples: [
      {
        ...cleanup.samples[0],
        trial: { preparation: 'ready', cleanup: 'blocked' },
      },
    ],
  });
  expect(store.scheduledComparisons(true)).toEqual([]);
  store.put('comparisons', current);
  store.remove('comparisons', current.id);
  expect(store.scheduledComparisons(true)).toEqual([]);
});

it('backfills scheduling metadata during upgrade without changing comparison documents', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, ':memory:', migrations.slice(0, 4));
    const records = [
      { id: 'active', status: 'running', samples: [] },
      { id: 'done', status: 'completed', samples: [] },
      {
        id: 'cleanup',
        status: 'completed',
        trialSetup: {},
        samples: [{ trial: { preparation: 'ready', cleanup: 'pending' } }],
      },
    ];
    for (const record of records)
      db.prepare("INSERT INTO documents VALUES ('comparisons', ?, ?)").run(
        record.id,
        JSON.stringify(record),
      );
    db.prepare("INSERT INTO documents VALUES ('runs', ?, ?)").run(
      'retried',
      JSON.stringify({
        id: 'retried',
        status: 'waiting',
        comparison: { comparisonId: 'done' },
      }),
    );
    const before = db.prepare('SELECT * FROM documents ORDER BY rowid').all();
    expect(migrate(db, ':memory:')).toEqual({ from: 4, to: 6 });
    expect(db.prepare('SELECT * FROM documents ORDER BY rowid').all()).toEqual(
      before,
    );
    expect(
      db
        .prepare('SELECT * FROM comparison_schedule ORDER BY comparison_id')
        .all(),
    ).toEqual([
      { comparison_id: 'active', execution_pending: 1, trial_pending: 0 },
      { comparison_id: 'cleanup', execution_pending: 0, trial_pending: 1 },
      { comparison_id: 'done', execution_pending: 0, trial_pending: 0 },
    ]);
    expect(db.prepare('SELECT * FROM active_comparison_runs').all()).toEqual([
      { run_id: 'retried', comparison_id: 'done' },
    ]);
  } finally {
    db.close();
  }
});

it('tracks active terminal-comparison retries transactionally without changing frozen observations', () => {
  const { store } = setup();
  const comparison = {
    id: 'finished',
    status: 'completed',
    samples: [{ runId: 'sample', observation: { status: 'failed' } }],
  };
  store.put('comparisons', comparison);
  expect(store.scheduledComparisons()).toEqual([]);
  const run = {
    id: 'retried',
    status: 'waiting',
    comparison: { comparisonId: comparison.id },
  };
  store.put('runs', run);
  expect(store.scheduledComparisons().map((c) => c.id)).toEqual(['finished']);
  expect(store.get('comparisons', comparison.id)).toEqual(comparison);
  store.put('runs', { ...run, status: 'completed' });
  expect(store.scheduledComparisons()).toEqual([]);
  expect(() =>
    store.transaction(() => {
      store.put('runs', run);
      throw new Error('rollback');
    }),
  ).toThrow('rollback');
  expect(store.scheduledComparisons()).toEqual([]);
  store.put('runs', run);
  store.remove('runs', run.id);
  expect(store.scheduledComparisons()).toEqual([]);
});

it('uses indexed pending metadata and claimed-resource lookups without archive scans', () => {
  const engine = setup();
  const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
  engine.store.scheduledComparisons(true);
  engine.store.resourcesForReconciliation();
  engine.store.forWork('managedExecutions', 'example-work');
  const calls = prepare.mock.calls.map(([sql], i) => ({
    sql,
    db: prepare.mock.contexts[i] as DatabaseSync,
  }));
  prepare.mockRestore();
  const plans = calls
    .map(({ sql, db }) =>
      db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(
          ...(sql.includes('$.workId')
            ? ['managedExecutions', 'example-work']
            : []),
        )
        .map((r) => r.detail)
        .join('\n'),
    )
    .join('\n');
  expect(plans).toContain('comparison_execution_pending');
  expect(plans).toContain('comparison_trial_pending');
  expect(plans).toContain('resource_state');
  expect(plans).toContain('documents_work');
  expect(plans).not.toContain('(collection=?)');
});
