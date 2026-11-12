import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  blankDefinition,
  nodeSchema,
  type WorkflowDefinition,
  type Json,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { batchDefinition } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';

const engines: Engine[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
});
function setup(options: ConstructorParameters<typeof Engine>[2] = {}) {
  const engine = new Engine(new Store(':memory:'), process.cwd(), options);
  engines.push(engine);
  return engine;
}
function publish(engine: Engine, definition: WorkflowDefinition) {
  const workflow = engine.create('Idle scheduling', '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}
function seedHistory(engine: Engine, count: number) {
  const id = publish(engine, blankDefinition());
  const { run } = engine.start(id, null);
  const work = engine.claim(engine.available(run.id)[0].id, {
    workerId: 'history',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.submit(work.id, work.token!, null);
  const terminal = engine.run(run.id);
  engine.store.transaction(() => {
    for (let i = 0; i < count; i++) {
      engine.store.put('runs', {
        ...terminal,
        id: `history-${i}`,
        input: 'archived-payload'.repeat(1000),
      });
      engine.store.put('work', {
        ...work,
        id: `history-work-${i}`,
        runId: `history-${i}`,
        status: 'completed',
        input: 'archived-payload'.repeat(1000),
      });
      engine.store.put('runBudgets', {
        id: `history-${i}`,
        revision: 1,
        budget: {
          scope: 'tree',
          unknownUsage: 'allow',
          limits: { claims: { max: 1 } },
        },
        updatedAt: terminal.updatedAt,
      });
    }
  });
  return id;
}

it.each([false, true])(
  'does not deserialize unrelated history during idle pumping, active budget %s',
  (budget) => {
    const engine = setup();
    seedHistory(engine, 200);
    if (budget)
      engine.start(publish(engine, blankDefinition()), null, undefined, {
        scope: 'tree',
        unknownUsage: 'allow',
        limits: { claims: { max: 10 } },
      });
    const parse = vi.spyOn(JSON, 'parse');
    engine.pump();
    const archivedReads = parse.mock.calls.filter(
      ([value]) =>
        typeof value === 'string' && value.includes('archived-payload'),
    );
    expect(archivedReads.length).toBe(0);
  },
);

it('does not reload completed comparison sample trees while scheduling', () => {
  const engine = setup();
  const workflowId = seedHistory(engine, 20);
  engine.publish(workflowId);
  const suite = engine.testbench.createSuite({
    workflowId,
    content: {
      name: 'History',
      cases: [{ id: 'case', name: 'Case', input: null, assertions: [] }],
    },
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: 1,
    candidateVersion: 2,
    repetitions: 1,
    concurrency: 2,
  };
  const preview = engine.testbench.preview(selection);
  const comparison = engine.testbench.start({
    ...selection,
    confirmation: preview.confirmation,
    requestId: 'history',
  });
  engine.pump();
  for (const item of engine.available()) {
    const claim = engine.claim(item.id, {
      workerId: 'history',
      freshContext: false,
      tools: [],
      skills: [],
    });
    engine.submit(claim.id, claim.token!, null);
  }
  expect(engine.testbench.progress(comparison.id).status).toBe('completed');
  const sample = engine.store.runs().find((run) => run.comparison)!;
  engine.store.put('runs', { ...sample, input: 'archived-payload' });
  const parse = vi.spyOn(JSON, 'parse');
  engine.pump();
  expect(
    parse.mock.calls.filter(([value]) => value.includes('archived-payload'))
      .length,
  ).toBe(0);
});

it.each(['workflow', 'batch'])(
  'does not rewrite or notify an unchanged waiting %s run',
  async (kind) => {
    const engine = setup();
    const definition =
      kind === 'batch'
        ? batchDefinition()
        : workflowCall(publish(engine, blankDefinition()), 'wait');
    const { run } = engine.start(
      publish(engine, definition),
      kind === 'batch' ? [1, 2] : null,
    );
    expect(run.status).toBe('waiting');
    await Promise.resolve();
    const notify = vi.fn();
    engine.store.subscribe(notify);
    const put = vi.spyOn(engine.store, 'put');
    const before = engine.store.continuation(run.id).revision;
    const snapshot = engine.continuation.briefing({ id: run.id, limit: 20 });
    const briefing = vi.spyOn(engine.continuation, 'briefing');
    const waiter = engine.continuation.wait({
      id: run.id,
      cursor: snapshot.cursor,
      timeoutMs: 60000,
      limit: 20,
    });
    briefing.mockClear();
    for (let i = 0; i < 3; i++) engine.pump();
    await Promise.resolve();
    expect(put.mock.calls.length).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(briefing).not.toHaveBeenCalled();
    expect(engine.store.continuation(run.id).revision).toBe(before);
    engine.cancel(run.id);
    expect(await waiter).toMatchObject({
      changed: true,
      run: { status: 'cancelled' },
    });
  },
);

it.each(['script', 'fetch'] as const)(
  'does not rewrite a pending native %s execution',
  async (kind) => {
    let complete!: (output: Json) => void;
    const engine = setup({
      substituteOperation: () =>
        new Promise<Json>((resolve) => {
          complete = resolve;
        }),
    });
    const definition = blankDefinition();
    definition.nodes[1] = nodeSchema.parse(
      kind === 'script'
        ? {
            id: 'agent',
            label: 'Script',
            kind,
            language: 'javascript',
            command: 'return input;',
          }
        : {
            id: 'agent',
            label: 'Fetch',
            kind,
            url: 'https://example.com',
          },
    );
    const { run } = engine.start(publish(engine, definition), null);
    expect(run.status).toBe('running');
    await Promise.resolve();
    const put = vi.spyOn(engine.store, 'put');
    for (let i = 0; i < 3; i++) engine.pump();
    expect(put.mock.calls.length).toBe(0);
    complete(
      kind === 'script'
        ? { done: true }
        : { status: 200, headers: {}, body: null },
    );
    await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));
  },
);

it('uses indexed lookups for work maintenance and continuation joins', () => {
  const engine = setup();
  seedHistory(engine, 200);
  const { run } = engine.start(publish(engine, blankDefinition()), null);
  function plan(
    action: () => unknown,
    select: (sql: string) => boolean,
    bindings: string[],
  ) {
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
    action();
    const index = prepare.mock.calls.findIndex(([sql]) => select(sql));
    expect(index).toBeGreaterThanOrEqual(0);
    const sql = prepare.mock.calls[index][0];
    const db = prepare.mock.contexts[index] as DatabaseSync;
    prepare.mockRestore();
    return db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...bindings)
      .map((row) => row.detail)
      .join('\n');
  }
  expect(
    plan(
      () => engine.store.workState('claimed'),
      () => true,
      ['claimed'],
    ),
  ).toContain('SEARCH work_metadata USING INDEX work_metadata_status');
  const resources = plan(
    () => engine.store.resourceAdmissionWork(),
    () => true,
    [],
  );
  expect(resources).toContain('INDEX work_metadata_status');
  expect(resources).toContain('INDEX work_metadata_resource_block');
  expect(resources).toContain('(collection=? AND id=?)');
  const background = plan(
    () => engine.store.terminalBackgroundRuns(),
    () => true,
    [],
  );
  expect(background.split('\n')[0]).toContain('SCAN b');
  expect(background).toContain('(collection=? AND id=?)');
  const continuation = plan(
    () => engine.store.continuation(run.id),
    (sql) => sql.includes("d.collection = 'work'"),
    [run.id],
  );
  expect(continuation).toContain('SEARCH d USING INDEX work_run_status');
  expect(continuation).toContain('SEARCH d USING INDEX runs_parent');
  expect(continuation).not.toContain('SCAN d');
  expect(continuation).not.toContain('(collection=?)');
  expect(
    plan(
      () => engine.store.activeRunState(),
      () => true,
      [],
    ),
  ).toContain('SEARCH run_metadata USING INDEX run_metadata_status');
  for (const read of [
    () => engine.store.runAncestors(new Set([run.id])),
    () => engine.store.runTrees(new Set([run.id])),
  ]) {
    const scoped = plan(read, () => true, [JSON.stringify([run.id])]);
    expect(scoped).not.toContain('(collection=?)');
    expect(scoped).not.toContain('SCAN d');
  }
  expect(
    plan(
      () => engine.store.forRuns('usageAttempts', new Set([run.id])),
      () => true,
      ['usageAttempts', JSON.stringify([run.id])],
    ),
  ).toContain(
    'SEARCH documents USING INDEX documents_run (collection=? AND <expr>=?)',
  );
});
