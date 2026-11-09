import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  runTagsSchema,
  runQuerySchema,
  runSummaryQuerySchema,
  scheduleConfigSchema,
  eventConfigSchema,
  triggerConfig,
  type WorkflowDefinition,
  type TriggerConfig,
  type ScheduleTrigger,
} from '@interlock/core';
import { migrate, migrations } from '../packages/storage/src/migrations';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';

const engines: Engine[] = [];
const worker = { workerId: 'tags', tools: [], skills: [], freshContext: false };
const tags = { repo: 'dgca/interlock', batch: 'november', 'a.b["x"]': '' };
function setup() {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  return e;
}
function publish(
  e: Engine,
  definition: WorkflowDefinition = blankDefinition(),
) {
  const w = e.create('Tags', '', definition);
  e.publish(w.id);
  return w.id;
}
function finish(e: Engine, runId: string) {
  const claim = e.claim(e.available(runId)[0].id, worker);
  e.submit(claim.id, claim.token!, {});
  e.pump();
}
function enable(e: Engine, workflowId: string, config: TriggerConfig) {
  const t = e.triggers.mutate({
    action: 'create',
    workflowId,
    config,
  }).trigger!;
  return e.triggers.mutate({
    action: 'enable',
    id: t.id,
    expectedRevision: t.revision,
  }).trigger!;
}
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  vi.useRealTimers();
});

it('validates exact bounded pairs and rejects invalid starts before mutation', () => {
  expect(runTagsSchema.parse(tags)).toEqual(tags);
  const literal = JSON.parse(
    '{"__proto__":"literal","constructor":"metadata"}',
  );
  expect(Object.entries(runTagsSchema.parse(literal)).sort()).toEqual(
    Object.entries(literal).sort(),
  );
  expect(runTagsSchema.safeParse(JSON.parse('{"__proto__":42}')).success).toBe(
    false,
  );
  expect(runTagsSchema.parse({ [' '.repeat(64)]: 'x'.repeat(64) })).toEqual({
    [' '.repeat(64)]: 'x'.repeat(64),
  });
  const e = setup(),
    w = publish(e);
  for (const invalid of [
    { '': 'v' },
    { ['k'.repeat(65)]: 'v' },
    { k: 'v'.repeat(65) },
    { k: 1 },
    Array(2).fill('x'),
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, 'v'])),
  ]) {
    expect(runTagsSchema.safeParse(invalid).success).toBe(false);
    expect(() =>
      e.start(w, {}, undefined, undefined, { tags: invalid as any }),
    ).toThrow();
    expect(e.store.runs()).toHaveLength(0);
    expect(e.store.list('runStarts')).toHaveLength(0);
  }
  const max = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [`k${i}`, 'v']),
  );
  expect(e.start(w, {}, undefined, undefined, { tags: max }).run.tags).toEqual(
    max,
  );
});

it('captures tags immutably, fingerprints supplied tags and preserves active-task reuse', () => {
  const e = setup(),
    w = publish(e),
    supplied = { ...tags };
  const first = e.start(w, {}, undefined, undefined, {
    tags: supplied,
    requestId: 'first',
  }).run;
  supplied.repo = 'changed';
  expect(e.run(first.id).tags).toEqual(tags);
  const reordered = Object.fromEntries(Object.entries(tags).reverse());
  expect(
    e.start(w, {}, undefined, undefined, {
      tags: reordered,
      requestId: 'first',
    }).run.id,
  ).toBe(first.id);
  for (const changed of [{ repo: 'other' }, undefined, {}])
    expect(() =>
      e.start(w, {}, undefined, undefined, {
        tags: changed as Record<string, string> | undefined,
        requestId: 'first',
      }),
    ).toThrow(/different arguments/);
  expect(e.store.runs()).toHaveLength(1);
  const task = { system: 'tracker', id: 'task' };
  const active = e.start(w, {}, undefined, undefined, {
    tags,
    externalTask: task,
  }).run;
  expect(
    e.start(w, {}, undefined, undefined, {
      tags: { repo: 'other' },
      externalTask: task,
      onActiveExternalTask: 'reuse',
    }).run,
  ).toMatchObject({ id: active.id, tags });
  const literal = JSON.parse('{"__proto__":"literal"}');
  const own = e.start(w, {}, undefined, undefined, { tags: literal }).run;
  expect(Object.hasOwn(e.run(own.id).tags!, '__proto__')).toBe(true);
  expect(
    e.store.findRuns(runQuerySchema.parse({ tags: literal })).map((r) => r.id),
  ).toEqual([own.id]);
  expect(e.continuation.summary(own.id, 20).tags).toEqual(literal);
  const summary = e.continuation.summary(first.id, 20);
  expect(summary.tags).toEqual(tags);
  expect(e.continuation.briefing({ id: first.id, limit: 20 }).run.tags).toEqual(
    tags,
  );
  expect(
    e.store.findRuns(runQuerySchema.parse({ tags: { repo: tags.repo } })),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: first.id, tags })]),
  );
});

it('filters all exact pairs before pagination and counts, composing workflow/status and empty filters', () => {
  const e = setup(),
    w = publish(e),
    other = publish(e);
  const a = e.start(w, {}, undefined, undefined, { tags }).run;
  const b = e.start(w, {}, undefined, undefined, { tags }).run;
  e.start(w, {}, undefined, undefined, {
    tags: { repo: 'other', batch: tags.batch },
  });
  e.start(other, {}, undefined, undefined, { tags });
  e.start(w, {});
  finish(e, a.id);
  const q = { workflowId: w, tags: { repo: tags.repo, batch: tags.batch } };
  expect(
    e.store
      .findRuns(runQuerySchema.parse(q))
      .map((r) => r.id)
      .sort(),
  ).toEqual([a.id, b.id].sort());
  expect(
    e.store
      .findRuns(runQuerySchema.parse({ ...q, status: 'completed' }))
      .map((r) => r.id),
  ).toEqual([a.id]);
  expect(
    e.store.findRuns(runQuerySchema.parse({ tags: { Repo: tags.repo } })),
  ).toEqual([]);
  expect(
    e.store.findRuns(
      runQuerySchema.parse({ tags: { repo: tags.repo.toUpperCase() } }),
    ),
  ).toEqual([]);
  expect(
    e.store.findRuns(runQuerySchema.parse({ tags: { 'a.b["x"]': '' } })),
  ).toHaveLength(3);
  expect(e.store.findRuns(runQuerySchema.parse({ tags: {} }))).toHaveLength(5);
  const page = e.store.runSummaries(
    runSummaryQuerySchema.parse({ ...q, limit: 1 }),
    [b.id],
  );
  expect(page.counts).toEqual({ active: 1, history: 1, attention: 1 });
  expect(page).toMatchObject({ total: 2, nextOffset: 1 });
  const next = e.store.runSummaries(
    runSummaryQuerySchema.parse({ ...q, limit: 1, offset: 1 }),
    [b.id],
  );
  expect(next.items[0].id).not.toBe(page.items[0].id);
  expect(next.items[0].tags).toEqual(tags);
  expect(next.nextOffset).toBeNull();
  expect(
    e.store
      .runSummaries(runSummaryQuerySchema.parse({ ...q, tab: 'history' }), [
        b.id,
      ])
      .items.map((r) => r.id),
  ).toEqual([a.id]);
});

it('backfills a durable indexed table and updates/deletes it atomically with documents', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, ':memory:', migrations.slice(0, -1));
    const insert = db.prepare('INSERT INTO documents VALUES (?, ?, ?)');
    insert.run('runs', 'legacy', JSON.stringify({ id: 'legacy', tags }));
    insert.run('runs', 'untagged', JSON.stringify({ id: 'untagged' }));
    insert.run(
      'other',
      'legacy',
      JSON.stringify({ id: 'legacy', tags: { repo: 'ignored' } }),
    );
    migrate(db, ':memory:');
    expect(db.prepare('SELECT count(*) AS n FROM run_tags').get()!.n).toBe(3);
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT run_id FROM run_tags WHERE tag_key = ? AND tag_value = ?',
      )
      .all('repo', tags.repo);
    expect(JSON.stringify(plan)).toContain('COVERING INDEX run_tags_match');
    db.exec('BEGIN');
    db.prepare(
      "UPDATE documents SET value = ? WHERE collection = 'runs' AND id = 'legacy'",
    ).run(JSON.stringify({ id: 'legacy', tags: { repo: 'updated' } }));
    expect(
      db
        .prepare('SELECT tag_value FROM run_tags WHERE tag_key = ?')
        .get('repo')!.tag_value,
    ).toBe('updated');
    db.exec('ROLLBACK');
    expect(
      db
        .prepare('SELECT tag_value FROM run_tags WHERE tag_key = ?')
        .get('repo')!.tag_value,
    ).toBe(tags.repo);
    db.prepare("DELETE FROM documents WHERE collection = 'other'").run();
    expect(db.prepare('SELECT count(*) AS n FROM run_tags').get()!.n).toBe(3);
    db.prepare(
      "DELETE FROM documents WHERE collection = 'runs' AND id = 'legacy'",
    ).run();
    expect(db.prepare('SELECT count(*) AS n FROM run_tags').get()!.n).toBe(0);
    insert.run('runs', 'new', JSON.stringify({ id: 'new', tags }));
    expect(db.prepare('SELECT count(*) AS n FROM run_tags').get()!.n).toBe(3);
    db.prepare(
      "UPDATE documents SET value = ? WHERE collection = 'runs' AND id = 'new'",
    ).run(JSON.stringify({ id: 'new' }));
    expect(db.prepare('SELECT count(*) AS n FROM run_tags').get()!.n).toBe(0);
  } finally {
    db.close();
  }
});

it.each(['wait', 'detached'] as const)(
  'inherits tags into %s Workflow children and Batch items',
  (mode) => {
    const e = setup(),
      child = publish(e),
      parent = publish(e, workflowCall(child, mode));
    const root = e.start(parent, {}, undefined, undefined, { tags }).run;
    e.pump();
    const nested = e.store.runs().find((r) => r.parentRunId === root.id)!;
    expect(nested.tags).toEqual(tags);
    expect(
      e.continuation.briefing({ id: root.id, limit: 20 }).descendants.items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: nested.id, tags }),
      ]),
    );
    const batch = e.start(
      publish(e, batchDefinition()),
      [1, 2],
      undefined,
      undefined,
      { tags },
    ).run;
    e.pump();
    const items = e.store.runs().filter((r) => r.parentRunId === batch.id);
    expect(items).toHaveLength(2);
    expect(
      items.every((r) => JSON.stringify(r.tags) === JSON.stringify(tags)),
    ).toBe(true);
  },
);

it('inherits tags into continue-as-new members', () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes[d.nodes.length - 1] = nodeSchema.parse({
    ...d.nodes.at(-1),
    continueAsNew: { maxRuns: 2 },
  });
  const first = e.start(publish(e, d), {}, undefined, undefined, { tags }).run;
  finish(e, first.id);
  expect(e.run(e.run(first.id).chain!.nextRunId!).tags).toEqual(tags);
});

it('captures tags on schedule and lifecycle starts, and preserves disabled transfer', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-11-07T12:00:00.000Z');
  const e = setup(),
    w = publish(e);
  const schedule = enable(
    e,
    w,
    scheduleConfigSchema.parse({
      name: 'Tagged',
      timing: { type: 'interval', intervalMs: 30000 },
      tags,
    }),
  ) as ScheduleTrigger;
  expect(triggerConfig(schedule).tags).toEqual(tags);
  vi.setSystemTime(schedule.nextFireAt);
  e.pump();
  const scheduleRun = e.triggers.inspect(schedule.id).fires.items[0].runId!;
  expect(e.run(scheduleRun).tags).toEqual(tags);
  const handlerTags = { role: 'handler' };
  const handler = publish(e),
    event = enable(
      e,
      handler,
      eventConfigSchema.parse({
        kind: 'event',
        name: 'Tagged event',
        tags: handlerTags,
        events: ['completed'],
        scope: { type: 'workflow', workflowId: w },
      }),
    );
  finish(e, scheduleRun);
  const handlerRun = e.run(e.store.eventDeliveries(event.id).items[0].runId!);
  expect(handlerRun.tags).toEqual(handlerTags);
  expect(handlerRun.input).toMatchObject({ tags });
  const bundle = exportWorkflows(e.store, w);
  const other = setup();
  importWorkflows(other.store, bundle);
  importWorkflows(other.store, exportWorkflows(e.store, handler));
  for (const t of [schedule, event]) {
    const imported = other.triggers.inspect(t.id).trigger;
    expect(imported.enabled).toBe(false);
    expect(imported.tags).toEqual(t.tags);
  }
});
