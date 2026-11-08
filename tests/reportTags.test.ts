import { afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  reportFilterSchema,
  type Run,
  type RunTags,
  type UsageAttempt,
} from '@interlock/core';
import { parseReportArgs } from '../packages/cli/src/commands';

const stores: Store[] = [];
const engines: Engine[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.stop();
  for (const s of stores.splice(0)) s.close();
  vi.restoreAllMocks();
});
function setup() {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  stores.push(store);
  engines.push(engine);
  const workflow = engine.create('Reports', '', blankDefinition());
  engine.publish(workflow.id);
  return { store, engine, workflowId: workflow.id };
}
const tags = Object.assign(
  JSON.parse('{"__proto__":"literal","constructor":"metadata"}'),
  { repo: 'dgca/interlock', batch: 'factory=7', 'a.b["x"]': '' },
) as RunTags;
function seed(
  store: Store,
  workflowId: string,
  id: string,
  day: number,
  runTags: RunTags | null = tags,
) {
  const at = `2026-11-${String(day).padStart(2, '0')}T00:00:00.000Z`;
  const end = `2026-11-${String(day).padStart(2, '0')}T00:00:10.000Z`;
  const run: Run = {
    id,
    workflowId,
    workflowName: 'Reports',
    version: 1,
    status: 'completed',
    createdAt: at,
    updatedAt: end,
    cursor: 'exit',
    input: {},
    value: {},
    ...(runTags === null ? {} : { tags: runTags }),
    executions: [
      {
        id: id + '-execution',
        nodeId: 'agent',
        kind: 'agent',
        label: id,
        status: 'completed',
        startedAt: at,
        completedAt: end,
        childRunIds: [],
        nextItem: 0,
        input: {},
      },
    ],
  };
  store.put('runs', run);
  const receipt: UsageAttempt = {
    id: id + ':1',
    workId: id + '-work',
    runId: id,
    nodeId: id,
    label: id,
    attempt: 1,
    outcome: 'failed',
    workerId: null,
    claimedAt: at,
    endedAt: end,
    observerReport: {
      reportedAt: end,
      snapshot: {
        sequence: 1,
        final: true,
        models: [
          {
            provider: id,
            model: id,
            inputTokens: day,
            outputTokens: day,
            cost: { amountMicros: day, currency: 'USD', source: 'test' },
          },
        ],
      },
    },
  };
  store.put('usageAttempts', receipt);
  store.put('work', {
    id: id + '-work',
    runId: id,
    nodeId: id,
    context: { continuityGroup: 'report-test' },
    createdAt: at,
    attempt: 1,
    leaseExpiryCount: 1,
  });
  store.put('workHolds', {
    id: id + '-hold',
    runId: id,
    workId: id + '-work',
    heldAt: at,
    endedAt: end,
  });
  store.put('contextEvents', {
    id: id + '-context',
    runId: id,
    workId: id + '-work',
    kind: 'claim',
    attempt: 1,
    revision: 2,
  });
  store.put('events', {
    id: id + '-expiry',
    runId: id,
    type: 'work.lease_expired',
    at: end,
  });

  store.put('runUsage', {
    id: id + '-stream',
    runId: id,
    streamId: 'test',
    source: 'observer',
    reportedAt: end,
    snapshot: {
      sequence: 1,
      final: true,
      models: [
        {
          provider: id,
          model: 'overhead',
          inputTokens: day,
          cost: { amountMicros: day, currency: 'USD', source: 'test' },
        },
      ],
    },
  });
  store.put('stalls', { id: id + '-stall', runId: id });
  store.put('managedExecutions', {
    id: id + '-managed',
    runId: id,
    recoveryEvents: [{ action: 'retry', at: end }],
  });
  return run;
}
function content(report: ReturnType<Engine['report']>) {
  const { generatedAt, filter, ...rest } = report;
  return rest;
}

it('validates report tags with the existing bounded literal-pair contract', () => {
  expect(
    Object.entries(reportFilterSchema.parse({ tags }).tags!).sort(),
  ).toEqual(Object.entries(tags).sort());
  expect(reportFilterSchema.parse({})).toEqual({ limit: 500 });
  for (const bad of [
    { '': 'v' },
    { ['k'.repeat(65)]: 'v' },
    { k: 'v'.repeat(65) },
    { k: 1 },
    JSON.parse('{"__proto__":42}'),
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['k' + i, 'v'])),
  ])
    expect(reportFilterSchema.safeParse({ tags: bad }).success).toBe(false);
  expect(reportFilterSchema.safeParse({ limit: 5001 }).success).toBe(false);
  expect(
    reportFilterSchema.parse({
      tags: Object.fromEntries(
        Array.from({ length: 16 }, (_, i) => ['k' + i, 'v']),
      ),
    }).tags,
  ).toHaveProperty('k15');
});

it('filters all report queries and attribution before sampling, with exact all-pairs semantics', () => {
  const { store, engine, workflowId } = setup();
  seed(store, workflowId, 'selected', 3);
  const filter = {
    workflowId,
    since: '2026-11-02T00:00:00.000Z',
    until: '2026-11-08T00:00:00.000Z',
    limit: 1,
    tags,
  };
  const expected = engine.report(filter);
  seed(store, workflowId, 'missing-pair', 7, { repo: tags.repo });
  seed(store, workflowId, 'wrong-case', 6, { ...tags, repo: 'DGCA/interlock' });
  seed(store, workflowId, 'untagged', 5, null);
  seed(store, 'other-workflow', 'other-workflow-run', 4);
  seed(store, workflowId, 'before-window', 1);
  seed(store, workflowId, 'after-window', 9);
  const report = engine.report(filter);
  expect(content(report)).toEqual(content(expected));
  expect(report.summary.totalRuns).toBe(1);
  expect(report.summary.humanWaitMs.median).toBe(10_000);
  expect(report.claims).toMatchObject({
    totalAttempts: 1,
    failures: 1,
    leaseExpiries: 1,
    h7Recoveries: 1,
    h12Stalls: 1,
    continuingSession: { count: 1 },
  });
  expect(report.usage.tokens.inputTokens).toBe(6);
  expect(report.usage.costs).toMatchObject([
    { currency: 'USD', amountMicros: 6 },
  ]);
  expect(report.usage.byRun.map((r) => r.runId)).toEqual(['selected']);
  expect(report.usage.byNode.map((n) => n.nodeId)).toEqual(['selected']);
  expect(report.usage.byModel.map((m) => m.model).sort()).toEqual([
    'overhead',
    'selected',
  ]);
  expect(report.usage.byProvider.map((p) => p.provider)).toEqual(['selected']);
  expect(
    engine.report({ tags: { repo: tags.repo }, limit: 1 }).usage.byRun[0].runId,
  ).toBe('after-window');
  expect(engine.report({ tags: { batch: 'absent' } }).summary.totalRuns).toBe(
    0,
  );
  const omitted = engine.report({});
  expect(content(engine.report({ tags: {} }))).toEqual(content(omitted));
  expect(omitted.filter).toEqual({ limit: 500 });
});

it('uses the covering tag index in the actual report selection query', () => {
  const { store, workflowId } = setup();
  seed(store, workflowId, 'indexed', 3);
  const db = (store as unknown as { db: import('node:sqlite').DatabaseSync })
    .db;
  const prepare = db.prepare.bind(db);
  let reportSql = '';
  vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    if (sql.includes('SELECT value FROM documents')) reportSql = sql;
    return prepare(sql);
  });
  expect(
    store
      .runsForReport({ tags: { repo: tags.repo, batch: tags.batch }, limit: 1 })
      .map((r) => r.id),
  ).toEqual(['indexed']);
  expect(reportSql).toContain('run_tags');
  const plan = prepare('EXPLAIN QUERY PLAN ' + reportSql).all(
    'repo',
    tags.repo,
    'batch',
    tags.batch,
    1,
  );
  expect(JSON.stringify(plan)).toContain('COVERING INDEX run_tags_match');
});

it('shares repeatable report CLI tag parsing and rejects ambiguous keys', () => {
  expect(
    parseReportArgs([
      '--tag',
      'repo=dgca/interlock',
      '--tag=batch=factory=7',
      '--tag',
      'empty=',
      '--json',
    ]),
  ).toMatchObject({
    filter: { tags: { repo: 'dgca/interlock', batch: 'factory=7', empty: '' } },
    json: true,
  });
  for (const args of [
    ['--tag', 'bad'],
    ['--tag', 'repo=a', '--tag', 'repo=b'],
    ['--tag', 'x=' + 'v'.repeat(65)],
  ])
    expect(() => parseReportArgs(args)).toThrow();
});

it('compares inclusive report bounds by instant across offsets and timestamp precision', () => {
  const { store, engine, workflowId } = setup();
  const boundary = seed(store, workflowId, 'at-boundary', 3);
  for (const [id, createdAt] of [
    ['before-boundary', '2026-11-02T23:59:59.999Z'],
    ['after-boundary', '2026-11-03T00:00:00.001Z'],
  ]) {
    store.put('runs', { ...boundary, id, createdAt });
  }
  for (const value of [
    '2026-11-03T00:00:00.000Z',
    '2026-11-03T00:00:00Z',
    '2026-11-03T01:00:00+01:00',
    '2026-11-02T17:00:00-07:00',
    '2026-11-03T00:00:00.0000Z',
  ]) {
    const report = engine.report({
      workflowId,
      tags,
      since: value,
      until: value,
    });
    expect(report.summary.totalRuns, value).toBe(1);
    expect(
      report.usage.byRun.map((r) => r.runId),
      value,
    ).toEqual(['at-boundary']);
    expect(report.window).toEqual({ since: value, until: value });
    expect(
      engine.report({ workflowId, tags, since: value }).summary.totalRuns,
      value,
    ).toBe(2);
    expect(
      engine.report({ workflowId, tags, until: value }).summary.totalRuns,
      value,
    ).toBe(2);
  }
  expect(
    engine
      .report({ workflowId, tags, since: '2026-11-03T00:00:00.0001Z' })
      .usage.byRun.map((r) => r.runId),
  ).toEqual(['after-boundary']);
  expect(
    engine
      .report({ workflowId, tags, until: '2026-11-02T23:59:59.9999Z' })
      .usage.byRun.map((r) => r.runId),
  ).toEqual(['before-boundary']);
});
