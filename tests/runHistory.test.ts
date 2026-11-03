import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';

const engines: Engine[] = [];
const worker = {
  workerId: 'cleanup-test',
  freshContext: false,
  tools: [],
  skills: [],
};
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
function publish(
  engine: Engine,
  definition: WorkflowDefinition = blankDefinition(),
) {
  const workflow = engine.create('Cleanup', '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}
function complete(engine: Engine, runId?: string) {
  for (const item of engine.available(runId)) {
    const claim = engine.claim(item.id, worker);
    engine.submit(claim.id, claim.token!, null);
  }
}
function preview(engine: Engine, id: string) {
  return engine.history.preview({ rootRunIds: [id] }).items[0];
}
function deletion(item: ReturnType<typeof preview>) {
  return {
    roots: [{ runId: item.rootRunId, confirmation: item.confirmation! }],
    acknowledgeHistoryLoss: true as const,
  };
}

it('removes a complete run tree, values and audit records while preserving workflows, other runs and deleted start receipts', () => {
  const engine = setup();
  const childId = publish(engine),
    parentId = publish(engine, workflowCall(childId, 'wait'));
  const { run } = engine.start(
    parentId,
    { secret: 'payload-not-in-preview' },
    undefined,
    undefined,
    { requestId: 'original' },
  );
  complete(engine, run.id);
  const unrelated = engine.start(childId, null).run;
  const before = engine.store
    .runs()
    .filter((r) => r.id === run.id || r.parentRunId === run.id);
  const plan = preview(engine, run.id);
  expect(plan).toMatchObject({ canDelete: true, runCount: 2 });
  expect(JSON.stringify(plan)).not.toContain('payload-not-in-preview');
  const result = engine.history.delete(deletion(plan));
  expect(result).toMatchObject({ deletedRuns: 2, retainedStartReceipts: 1 });
  expect(result.removedDocumentBytes).toBe(plan.documentBytes);
  for (const item of before) {
    expect(engine.store.get('runs', item.id)).toBeUndefined();
    expect(engine.store.forRuns('work', new Set([item.id]))).toEqual([]);
    expect(engine.store.forRuns('events', new Set([item.id]))).toEqual([]);
    expect(engine.store.forRuns('usageAttempts', new Set([item.id]))).toEqual(
      [],
    );
  }
  expect(engine.run(unrelated.id).status).toBe('waiting');
  expect(engine.workflow(parentId).latestVersion).toBe(1);
  expect(engine.store.getVersion(childId, 1)).toBeDefined();
  expect(() =>
    engine.start(
      parentId,
      { secret: 'payload-not-in-preview' },
      undefined,
      undefined,
      { requestId: 'original' },
    ),
  ).toThrow('deleted or missing history');
  expect(
    engine.store.list<{ deletedAt: string }>('runStarts')[0].deletedAt,
  ).toBeTruthy();
  expect(result.spaceGuidance).toContain('not reclaimed file bytes');
});

it('protects active detached descendants and terminal ancestors needed by their budgets', () => {
  const engine = setup();
  const root = engine.start(
    publish(engine, workflowCall(publish(engine), 'detached')),
    null,
    undefined,
    {
      scope: 'tree',
      unknownUsage: 'allow',
      limits: { claims: { max: 1 } },
    },
  ).run;
  expect(root.status).toBe('completed');
  const plan = preview(engine, root.id);
  expect(plan.canDelete).toBe(false);
  expect(plan.blockers.join(' ')).toContain('budget accounting');
  expect(plan.confirmation).toBeNull();
  complete(engine, root.id);
  expect(preview(engine, root.id).canDelete).toBe(true);
});

it('selects only whole Batch trees, paginates roots and filters by workflow and tree update age', () => {
  const engine = setup(),
    workflowId = publish(engine, batchDefinition());
  const first = engine.start(workflowId, [1, 2]).run;
  complete(engine, first.id);
  const child = engine.store.runs().find((r) => r.parentRunId === first.id)!;
  expect(() => preview(engine, child.id)).toThrow('child runs');
  const second = engine.start(workflowId, []).run;
  const page = engine.history.preview({ workflowId, limit: 1 });
  expect(page).toMatchObject({ total: 2, nextOffset: 1 });
  expect(
    engine.history.preview({ workflowId, limit: 1, offset: 1 }).items[0]
      .rootRunId,
  ).not.toBe(page.items[0].rootRunId);
  expect(
    engine.history.preview({ workflowId, before: '2000-01-01T00:00:00Z' })
      .total,
  ).toBe(0);
  const plan = preview(engine, first.id);
  expect(plan.runCount).toBe(3);
  engine.history.delete(deletion(plan));
  expect(engine.run(second.id).status).toBe('completed');
});

it('keeps complete rollover chains together and protects accounting while any member remains active', () => {
  const engine = setup(),
    definition = blankDefinition();
  definition.nodes[2] = nodeSchema.parse({
    id: 'exit',
    kind: 'exit',
    label: 'Checkpoint',
    continueAsNew: { maxRuns: 2 },
  });
  const root = engine.start(publish(engine, definition), null).run;
  complete(engine, root.id);
  const next = engine.store.runs().find((run) => run.chain?.index === 2)!;
  expect(preview(engine, root.id).canDelete).toBe(false);
  expect(() => preview(engine, next.id)).toThrow('first chain member');
  engine.cancel(next.id, 'chain');
  const plan = preview(engine, root.id);
  expect(plan).toMatchObject({ runCount: 2, canDelete: true });
  engine.history.delete(deletion(plan));
  expect(engine.store.list('runChains')).toEqual([]);
  expect(engine.store.runs()).toEqual([]);
});

it('rejects stale previews and rolls back the entire selected set on any write failure', () => {
  const engine = setup(),
    id = publish(engine);
  const first = engine.start(id, null, undefined, undefined, {
    requestId: 'rollback-start',
  }).run;
  complete(engine, first.id);
  const second = engine.start(id, null).run;
  complete(engine, second.id);
  const old = preview(engine, first.id);
  const work = engine.store.forRuns<any>('work', new Set([first.id]))[0];
  engine.store.put('work', { ...work, output: 'changed' });
  expect(() => engine.history.delete(deletion(old))).toThrow('Nothing deleted');
  const roots = [preview(engine, first.id), preview(engine, second.id)].map(
    (item) => deletion(item).roots[0],
  );
  const remove = engine.store.deleteHistoryDocuments.bind(engine.store);
  vi.spyOn(engine.store, 'deleteHistoryDocuments').mockImplementation((ids) => {
    remove(ids);
    throw new Error('disk failure');
  });
  expect(() =>
    engine.history.delete({ roots, acknowledgeHistoryLoss: true }),
  ).toThrow('disk failure');
  expect(engine.run(first.id).status).toBe('completed');
  expect(engine.run(second.id).status).toBe('completed');
  expect(
    engine.store.list<{ deletedAt?: string }>('runStarts')[0].deletedAt,
  ).toBeUndefined();
});

it('keeps cancelled native executions until their job has actually settled', async () => {
  let settle!: (value: null) => void;
  const engine = setup({
    substituteOperation: () =>
      new Promise<null>((resolve) => {
        settle = resolve;
      }),
  });
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Pending operation',
    language: 'javascript',
    command: 'return input;',
  });
  const root = engine.start(publish(engine, definition), null).run;
  engine.cancel(root.id);
  expect(preview(engine, root.id).blockers.join(' ')).toContain(
    'still closing',
  );
  settle(null);
  await vi.waitFor(() => expect(preview(engine, root.id).canDelete).toBe(true));
});

it('protects uncertain resource owners after cancellation and invalidates previews when a reservation appears', () => {
  const engine = setup(),
    definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    ...definition.nodes[1],
    resources: [{ source: 'literal', value: 'workspace' }],
  });
  const root = engine.start(publish(engine, definition), null).run;
  engine.claim(engine.available(root.id)[0].id, worker);
  engine.cancel(root.id);
  expect(preview(engine, root.id).blockers.join(' ')).toContain(
    'Resource reservations',
  );
  const ordinary = engine.start(publish(engine), null).run;
  complete(engine, ordinary.id);
  const old = preview(engine, ordinary.id);
  engine.store.put('workResources', {
    id: 'late-owner',
    runId: ordinary.id,
    state: 'uncertain',
  });
  expect(() => engine.history.delete(deletion(old))).toThrow('Nothing deleted');
});

it('protects comparison samples and referenced evaluation history, and requires explicit acknowledgment', () => {
  const engine = setup(),
    root = engine.start(publish(engine), null).run;
  complete(engine, root.id);
  engine.store.put('comparisons', {
    id: 'retained',
    status: 'completed',
    samples: [],
    judgments: [{ evaluation: { runId: root.id } }],
  });
  expect(preview(engine, root.id).blockers.join(' ')).toContain(
    'comparison or evaluation',
  );
  engine.store.remove('comparisons', 'retained');
  for (const sample of [
    { runId: root.id },
    { runId: 'another-root', measurement: { runIds: [root.id] } },
  ]) {
    engine.store.put('comparisons', {
      id: 'sample-reference',
      status: 'completed',
      samples: [sample],
      judgments: [],
    });
    expect(preview(engine, root.id).canDelete).toBe(false);
    engine.store.remove('comparisons', 'sample-reference');
  }
  const plan = preview(engine, root.id);
  expect(() =>
    engine.history.delete({
      ...deletion(plan),
      acknowledgeHistoryLoss: false,
    } as any),
  ).toThrow();
  expect(() =>
    engine.history.delete({
      roots: [...deletion(plan).roots, ...deletion(plan).roots],
      acknowledgeHistoryLoss: true,
    }),
  ).toThrow('only once');
  engine.store.put('runs', {
    ...engine.run(root.id),
    comparison: { comparisonId: 'missing' },
  });
  expect(preview(engine, root.id).canDelete).toBe(false);
});
