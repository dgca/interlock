import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  nodeSchema,
  validateDefinition,
  validateBatchScopes,
  type WorkflowDefinition,
  type Json,
} from '@interlock/core';
import { parseRawDefinition } from '../packages/ui/src/features/workflows/rawDefinition';
import { seed } from '../packages/server/src/seed';
import {
  batchDefinition,
  nestedBatches,
  itemAgent,
  itemScript,
} from './fixtures/batch';

const engines: Engine[] = [],
  dirs: string[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});
function setup(path = ':memory:') {
  const engine = new Engine(new Store(path), process.cwd());
  engines.push(engine);
  return engine;
}
function publish(engine: Engine, definition: WorkflowDefinition) {
  const workflow = engine.create('Batch test', '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}
const worker = {
  workerId: 'batch-test',
  freshContext: false,
  tools: [],
  skills: [],
};
function claim(engine: Engine, root: string, index = 0) {
  return engine.claim(engine.available(root)[index].id, worker);
}
function complete(engine: Engine, root: string, output: Json, index = 0) {
  const work = claim(engine, root, index);
  engine.submit(work.id, work.token!, output);
}
it('parses and round-trips a flat Batch graph including explicit Batch membership', () => {
  const definition = nestedBatches(2, itemScript());
  expect(validateDefinition(definition)).toEqual(definition);
  expect(parseRawDefinition(JSON.stringify(definition))).toEqual({
    definition,
  });
  expect(validateBatchScopes(definition)).toEqual(
    new Map([
      ['batch1', 'batch'],
      ['work', 'batch1'],
    ]),
  );
  const invalid = JSON.parse(JSON.stringify(definition));
  invalid.edges[2].targetHnadle = 'default';
  expect(parseRawDefinition(JSON.stringify(invalid)).error).toContain(
    'targetHnadle',
  );
});
it.each(['item', 'complete'])(
  'requires exactly one %s route but permits incomplete saved drafts',
  (port) => {
    const d = batchDefinition();
    const edge = d.edges.find((e) => e.port === port)!;
    d.edges = d.edges.filter((e) => e !== edge);
    const raw = parseRawDefinition(JSON.stringify(d));
    expect(raw.definition).toEqual(d);
    expect(raw.publishError).toContain('outgoing routes');
    d.edges.push(edge, { ...edge, id: 'duplicate' });
    expect(() => validateDefinition(d)).toThrow('outgoing routes');
  },
);
it('rejects unknown handles, invalid owners, and circular membership', () => {
  const d = batchDefinition();
  expect(() =>
    definitionSchema.parse({
      ...d,
      edges: [
        ...d.edges,
        {
          id: 'return',
          source: 'work',
          target: 'batch',
          port: 'default',
          targetHandle: 'result',
        },
      ],
    }),
  ).toThrow();
  d.nodes.find((n) => n.id === 'work')!.batchId = 'missing';
  expect(() => validateDefinition(d)).toThrow('Batch group does not exist');
  const circular = nestedBatches(2);
  circular.nodes.find((n) => n.id === 'batch')!.batchId = 'batch1';
  expect(() => validateDefinition(circular)).toThrow('circular');
});
it('rejects item leaks, outer entry into groups, and Complete entering item work', () => {
  for (const mutate of [
    (d: WorkflowDefinition) => {
      d.edges = d.edges.filter((e) => e.id !== 'end');
      d.edges.push({
        id: 'leak',
        source: 'work',
        target: 'exit',
        port: 'default',
      });
    },
    (d: WorkflowDefinition) => {
      d.edges[0].target = 'work';
    },
    (d: WorkflowDefinition) => {
      d.edges[2].target = 'work';
    },
    (d: WorkflowDefinition) => {
      d.edges[1].target = 'exit';
    },
  ]) {
    const d = batchDefinition();
    mutate(d);
    expect(() => validateDefinition(d)).toThrow('cannot cross Batch groups');
  }
});
it('rejects entering the wrong Batch and unreachable group members', () => {
  const wrong = nestedBatches(2);
  wrong.edges[1].target = 'work';
  expect(() => validateDefinition(wrong)).toThrow('cannot cross Batch groups');
  const orphan = batchDefinition();
  orphan.nodes.push({ ...itemAgent(), id: 'orphan', batchId: 'batch' });
  orphan.edges.push({
    id: 'orphan-end',
    source: 'orphan',
    port: 'default',
    target: 'batch',
    targetHandle: 'end',
  });
  expect(() => validateDefinition(orphan)).toThrow(/reachable/);
});
it('requires both Condition branches and rejects item cycles', () => {
  const d = batchDefinition(
    nodeSchema.parse({
      id: 'work',
      label: 'Check',
      kind: 'condition',
      path: '',
      equals: true,
    }),
  );
  expect(() => validateDefinition(d)).toThrow('outgoing routes');
  d.edges = d.edges.filter((e) => e.id !== 'end');
  d.nodes.push(
    { ...itemAgent(), id: 'yes', batchId: 'batch' },
    { ...itemAgent(), id: 'no', batchId: 'batch' },
  );
  d.edges.push(
    { id: 'yes', source: 'work', port: 'true', target: 'yes' },
    { id: 'no', source: 'work', port: 'false', target: 'no' },
  );
  d.edges.push(
    {
      id: 'yes-end',
      source: 'yes',
      port: 'default',
      target: 'batch',
      targetHandle: 'end',
    },
    {
      id: 'no-end',
      source: 'no',
      port: 'default',
      target: 'batch',
      targetHandle: 'end',
    },
  );
  expect(() => validateDefinition(d)).not.toThrow();
  d.edges = d.edges.filter((e) => e.id !== 'no-end');
  d.edges.push({ id: 'cycle', source: 'no', port: 'default', target: 'work' });
  expect(() => validateDefinition(d)).toThrow('cycles');
});
it.each([0, 51])('rejects concurrency %s', (concurrency) => {
  expect(() => batchDefinition(undefined, { concurrency })).toThrow();
});
it('doubles [3, 4, 5] and inspects persisted item paths in the published graph', async () => {
  const engine = setup(),
    definition = batchDefinition(itemScript());
  const run = engine.start(publish(engine, definition), [3, 4, 5]).run;
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));
  expect(engine.run(run.id).output).toEqual([6, 8, 10]);
  expect(engine.store.workflows()).toHaveLength(1);
  expect(engine.run(run.id).executions.map((e) => e.nodeId)).toEqual([
    'entry',
    'batch',
    'exit',
  ]);
  for (const child of engine.inspect(run.id).children) {
    expect(child.batchNodeId).toBe('batch');
    expect(child.executions.map((e) => e.nodeId)).toEqual(['work']);
    expect(engine.inspect(child.id).definition).toEqual(definition);
  }
});
it('selects itemsPath and returns an empty result without item runs', () => {
  const engine = setup(),
    id = publish(engine, batchDefinition(undefined, { itemsPath: 'items' }));
  const empty = engine.start(id, { items: [] });
  expect(empty.run.output).toEqual([]);
  expect(empty.children).toHaveLength(0);
  const run = engine.start(id, { items: [3] }).run;
  expect(engine.available(run.id)[0].input).toBe(3);
  complete(engine, run.id, 6);
  expect(engine.run(run.id).output).toEqual([6]);
});
it('enforces concurrency, orders out-of-order results, and waits before Complete', () => {
  const engine = setup(),
    definition = batchDefinition();
  definition.nodes.push(
    nodeSchema.parse({
      id: 'synthesis',
      label: 'Synthesis',
      kind: 'agent',
      prompt: 'Combine the item results.',
    }),
  );
  definition.edges[2].target = 'synthesis';
  definition.edges.push({
    id: 'out',
    source: 'synthesis',
    target: 'exit',
    port: 'default',
  });
  const run = engine.start(publish(engine, definition), ['a', 'b', 'c']).run;
  expect(engine.available(run.id).map((w) => w.input)).toEqual(['a', 'b']);
  complete(engine, run.id, 'B', 1);
  expect(engine.available(run.id).map((w) => w.input)).toEqual(['a', 'c']);
  complete(engine, run.id, 'C', 1);
  expect(engine.run(run.id).executions.map((e) => e.nodeId)).toEqual([
    'entry',
    'batch',
  ]);
  complete(engine, run.id, 'A');
  const synthesis = engine.available(run.id);
  expect(synthesis).toHaveLength(1);
  expect(synthesis[0]).toMatchObject({
    runId: run.id,
    nodeId: 'synthesis',
    input: ['A', 'B', 'C'],
  });
  complete(engine, run.id, 'summary');
  expect(engine.run(run.id).output).toBe('summary');
});
it('supports 200 items and concurrency 50; rejects invalid input', () => {
  const engine = setup(),
    id = publish(engine, batchDefinition(undefined, { concurrency: 50 })),
    input = Array.from({ length: 200 }, (_, i) => i);
  const run = engine.start(id, input).run;
  expect(engine.available(run.id)).toHaveLength(50);
  while (engine.available(run.id).length) {
    const work = claim(engine, run.id);
    engine.submit(work.id, work.token!, work.input);
  }
  expect(engine.run(run.id).output).toEqual(input);
  expect(engine.start(id, Array(201).fill(null)).run.error).toContain(
    '200 items',
  );
  expect(engine.start(id, {}).run.error).toContain('array');
});
it('collects failures, successes, and cancelled item executions', () => {
  const engine = setup(),
    run = engine.start(
      publish(engine, batchDefinition(undefined, { failurePolicy: 'collect' })),
      ['a', 'b', 'c'],
    ).run;
  const a = claim(engine, run.id);
  engine.reportFailure(a.id, a.token!, 'Unavailable');
  complete(engine, run.id, 'B');
  const c = claim(engine, run.id);
  engine.cancel(c.runId);
  expect(engine.run(run.id).output).toMatchObject([
    { status: 'failed', output: null, error: 'Unavailable' },
    { status: 'completed', output: 'B', error: null },
    { status: 'cancelled', output: null, error: null },
  ]);
});
it('applies root/Batch contracts to the aggregate and node contracts to items', () => {
  const engine = setup(),
    item = itemAgent();
  item.inputSchema = { type: 'number' };
  const d = batchDefinition(item, {
    failurePolicy: 'collect',
    inputSchema: { type: 'array' },
    outputSchema: { type: 'array' },
  });
  d.inputSchema = { type: 'array' };
  d.outputSchema = { type: 'array' };
  const run = engine.start(publish(engine, d), ['bad', 2]).run;
  complete(engine, run.id, 4);
  expect(engine.run(run.id).output).toMatchObject([
    { status: 'failed', output: null },
    { status: 'completed', output: 4 },
  ]);
});
it('fails all, cancels unfinished work, and retries only failed or cancelled items', () => {
  const engine = setup(),
    run = engine.start(publish(engine, batchDefinition()), [
      'a',
      'b',
      'c',
      'd',
    ]).run;
  complete(engine, run.id, 'A');
  const successful = engine.inspect(run.id).children[0],
    b = claim(engine, run.id);
  engine.reportFailure(b.id, b.token!, 'Temporary failure');
  expect(engine.run(run.id).status).toBe('failed');
  expect(engine.available(run.id)).toHaveLength(0);
  expect(engine.inspect(run.id).children.map((c) => c.status)).toEqual([
    'completed',
    'failed',
    'cancelled',
  ]);
  engine.retry(run.id);
  expect(engine.available(run.id).map((w) => w.input)).toEqual(['b', 'c']);
  complete(engine, run.id, 'B');
  expect(engine.available(run.id).map((w) => w.input)).toEqual(['c', 'd']);
  complete(engine, run.id, 'C');
  complete(engine, run.id, 'D');
  expect(engine.run(run.id).output).toEqual(['A', 'B', 'C', 'D']);
  expect(engine.run(successful.id)).toEqual(successful);
});
it('keeps retries within concurrency after collect encounters many failures', () => {
  const engine = setup(),
    d = batchDefinition(undefined, {
      failurePolicy: 'collect',
      outputSchema: { type: 'number' },
    });
  const run = engine.start(publish(engine, d), [1, 2, 3, 4]).run;
  while (engine.available(run.id).length) {
    const work = claim(engine, run.id);
    engine.reportFailure(work.id, work.token!, 'Failed');
  }
  expect(engine.run(run.id).status).toBe('failed');
  engine.retry(run.id);
  expect(engine.available(run.id)).toHaveLength(2);
});
it('cancels nested item assignments and refuses late results', () => {
  const engine = setup(),
    run = engine.start(publish(engine, nestedBatches(2)), [
      [1, 2],
      [3, 4],
    ]).run;
  const work = claim(engine, run.id);
  expect(engine.available(run.id)).toHaveLength(3);
  engine.cancel(run.id);
  expect(engine.available(run.id)).toHaveLength(0);
  expect(engine.store.runs().every((r) => r.status === 'cancelled')).toBe(true);
  expect(() => engine.submit(work.id, work.token!, null)).toThrow();
});
it('executes nested Batches, connecting inner Batch Output to outer End', async () => {
  const engine = setup(),
    definition = nestedBatches(2, itemScript());
  const run = engine.start(publish(engine, definition), [[3, 4], [5]]).run;
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));
  expect(engine.run(run.id).output).toEqual([[6, 8], [10]]);
  const grandchild = engine.store
    .runs()
    .find((r) => r.batchNodeId === 'batch1')!;
  expect(engine.inspect(grandchild.id).definition).toEqual(definition);
});
it('enforces ten nesting levels across Batches and referenced workflows', () => {
  const d = nestedBatches(10);
  expect(() => validateDefinition(d)).not.toThrow();
  expect(() => validateDefinition(nestedBatches(11))).toThrow(
    'depth exceeded 10',
  );
  const engine = setup(),
    childId = publish(engine, d),
    reference = blankDefinition();
  reference.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Reference',
    kind: 'workflow',
    workflowId: childId,
    version: 1,
  });
  let input: Json = 1;
  for (let i = 0; i < 10; i++) input = [input];
  const run = engine.start(publish(engine, reference), input).run;
  expect(run.status).toBe('failed');
  expect(run.error).toContain('depth exceeded 10');
});
it('supports Workflow and Condition nodes in an item path and validates references', async () => {
  const engine = setup(),
    childId = publish(engine, blankDefinition());
  const d = batchDefinition(
    nodeSchema.parse({
      id: 'work',
      kind: 'workflow',
      label: 'Call',
      workflowId: childId,
      version: 1,
    }),
  );
  d.nodes.push(
    nodeSchema.parse({
      id: 'check',
      batchId: 'batch',
      kind: 'condition',
      label: 'Check',
      path: '',
      equals: true,
    }),
  );
  d.nodes.push({
    ...itemScript('return input;'),
    id: 'identity',
    batchId: 'batch',
  });
  d.edges.push({
    id: 'identity-end',
    source: 'identity',
    port: 'default',
    target: 'batch',
    targetHandle: 'end',
  });
  d.edges[1].target = 'check';
  d.edges.push(
    { id: 'yes', source: 'check', port: 'true', target: 'work' },
    {
      id: 'no',
      source: 'check',
      port: 'false',
      target: 'identity',
    },
  );
  const run = engine.start(publish(engine, d), [true, false]).run;
  const work = claim(engine, run.id);
  expect(engine.run(work.runId).batchNodeId).toBeUndefined();
  engine.submit(work.id, work.token!, 'yes');
  await vi.waitFor(() =>
    expect(engine.run(run.id).output).toEqual(['yes', false]),
  );
  const node = d.nodes.find((n) => n.id === 'work')!;
  if (node.kind === 'workflow') node.version = 99;
  expect(() => publish(engine, d)).toThrow('referenced workflow version');
});
it('keeps item definitions immutable across restart, draft edits, and publication', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-batch-'));
  dirs.push(dir);
  const path = join(dir, 'test.db'),
    engine = setup(path),
    original = batchDefinition();
  const id = publish(engine, original),
    run = engine.start(id, [1, 2]).run,
    work = claim(engine, run.id);
  engine.update(id, { draft: batchDefinition(itemScript()), draftRevision: 1 });
  engine.publish(id);
  engine.stop();
  engine.store.close();
  engines.pop();
  const restarted = setup(path);
  expect(restarted.inspect(work.runId).definition).toEqual(original);
  expect(restarted.inspect(run.id).definition).toEqual(original);
  restarted.submit(work.id, work.token!, 2);
  complete(restarted, run.id, 4);
  expect(restarted.run(run.id).output).toEqual([2, 4]);
  expect(restarted.store.workflows()).toHaveLength(1);
});
it.each(['map', 'list'])(
  'rejects removed %s nodes in definitions and raw editing',
  (kind) => {
    const definition = batchDefinition();
    const removed = {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.kind === 'batch' ? { ...node, kind } : node,
      ),
    };
    expect(() => definitionSchema.parse(removed)).toThrow();
    expect(
      parseRawDefinition(JSON.stringify(removed)).definition,
    ).toBeUndefined();
  },
);
it('queues individual item retries when collect has no free slot', () => {
  const engine = setup(),
    run = engine.start(
      publish(engine, batchDefinition(undefined, { failurePolicy: 'collect' })),
      [1, 2, 3],
    ).run;
  const first = claim(engine, run.id);
  engine.reportFailure(first.id, first.token!, 'Retry later');
  engine.retry(first.runId);
  expect(engine.available(run.id).map((w) => w.input)).toEqual([2, 3]);
  complete(engine, run.id, 4);
  expect(engine.available(run.id).map((w) => w.input)).toEqual([3, 1]);
  complete(engine, run.id, 6);
  complete(engine, run.id, 2);
  expect(engine.run(run.id).output).toMatchObject([
    { output: 2 },
    { output: 4 },
    { output: 6 },
  ]);
});
it('cancels item scripts before their delayed side effects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-batch-cancel-'));
  dirs.push(dir);
  const engine = setup(),
    item = itemScript(`const fs = require('node:fs');
    const dir = ${JSON.stringify(dir)};
    fs.writeFileSync(dir + '/' + input + '-ready', 'ready');
    await new Promise(resolve => setTimeout(resolve, 500));
    fs.writeFileSync(dir + '/' + input + '-late', 'late'); return input;`);
  const run = engine.start(publish(engine, batchDefinition(item)), [1, 2]).run;
  await vi.waitFor(() => {
    expect(existsSync(join(dir, '1-ready'))).toBe(true);
    expect(existsSync(join(dir, '2-ready'))).toBe(true);
  });
  engine.cancel(run.id);
  await new Promise((resolve) => setTimeout(resolve, 550));
  expect(existsSync(join(dir, '1-late'))).toBe(false);
  expect(existsSync(join(dir, '2-late'))).toBe(false);
  expect(
    engine
      .inspect(run.id)
      .children.every((child) => child.status === 'cancelled'),
  ).toBe(true);
});
it('does not advance stale nested runs after an all-policy parent cancels them', () => {
  const engine = setup(),
    run = engine.start(
      publish(
        engine,
        nestedBatches(2, itemAgent(), { failurePolicy: 'collect' }),
      ),
      [null, [1, 2, 3]],
    ).run;
  expect(run.status).toBe('failed');
  expect(engine.available(run.id)).toHaveLength(0);
  expect(
    engine.store
      .runs()
      .every((r) => ['failed', 'cancelled'].includes(r.status)),
  ).toBe(true);
});
it('seeds a Batch with a published Workflow on its visible item path', () => {
  const engine = setup();
  seed(engine);
  const d = engine.store
    .workflows()
    .find((w) => w.name === 'Build a team roster')!.draft;
  const batch = d.nodes.find((n) => n.kind === 'batch')!;
  const item = d.nodes.find(
    (n) =>
      n.id ===
      d.edges.find((e) => e.source === batch.id && e.port === 'item')!.target,
  )!;
  expect(item.kind).toBe('workflow');
  expect(item.batchId).toBe(batch.id);
  expect(d.edges.find((e) => e.source === item.id)).toMatchObject({
    target: batch.id,
    targetHandle: 'end',
  });
  expect(() => validateDefinition(d)).not.toThrow();
});
it('seeds once per store and never revives deleted example workflows', () => {
  const engine = setup();
  seed(engine);
  expect(engine.store.workflows()).toHaveLength(2);
  seed(engine);
  expect(engine.store.workflows()).toHaveLength(2);
  for (const name of ['Build a team roster', 'Size up a Pokémon'])
    engine.deleteWorkflow(
      engine.store.workflows().find((w) => w.name === name)!.id,
    );
  seed(engine);
  expect(engine.store.workflows()).toHaveLength(0);
});
it('treats a store with preexisting workflows as already seeded', () => {
  const engine = setup();
  const own = engine.create('Mine', '', blankDefinition());
  seed(engine);
  expect(engine.store.workflows().map((w) => w.id)).toEqual([own.id]);
  engine.deleteWorkflow(own.id);
  seed(engine);
  expect(engine.store.workflows()).toHaveLength(0);
});

it('retries nested Batches while preserving successful outer and inner item executions', () => {
  const engine = setup(),
    run = engine.start(publish(engine, nestedBatches(2)), [
      [1, 2],
      [3, 4],
    ]).run;
  complete(engine, run.id, 2);
  complete(engine, run.id, 4);
  complete(engine, run.id, 6);
  const successful = engine.store
    .runs()
    .filter((r) => r.status === 'completed');
  const last = claim(engine, run.id);
  engine.reportFailure(last.id, last.token!, 'Retry last item');
  expect(engine.run(run.id).status).toBe('failed');
  engine.retry(run.id);
  expect(engine.available(run.id).map((w) => w.input)).toEqual([4]);
  complete(engine, run.id, 8);
  expect(engine.run(run.id).output).toEqual([
    [2, 4],
    [6, 8],
  ]);
  for (const child of successful) expect(engine.run(child.id)).toEqual(child);
});

it('requires explicit End connections and rejects returns to a different group', () => {
  const d = batchDefinition();
  d.edges = d.edges.filter((e) => e.id !== 'end');
  expect(parseRawDefinition(JSON.stringify(d)).definition).toEqual(d);
  expect(() => validateDefinition(d)).toThrow('outgoing routes');
  const nested = nestedBatches(2);
  nested.edges.find((e) => e.source === 'work')!.target = 'batch';
  expect(() => validateDefinition(nested)).toThrow('End must belong');
  const ordinary = batchDefinition();
  ordinary.edges.find((e) => e.id === 'end')!.target = 'work';
  expect(() => validateDefinition(ordinary)).toThrow('End must belong');
  const outer = batchDefinition();
  outer.edges[0].targetHandle = 'end';
  expect(() => validateDefinition(outer)).toThrow('End must belong');
});
it('requires array input for blank Items path and allows an enclosing object for a named path', () => {
  expect(() =>
    validateDefinition(
      batchDefinition(undefined, { inputSchema: { type: 'string' } }),
    ),
  ).toThrow('array input contract');
  expect(() =>
    validateDefinition(
      batchDefinition(undefined, {
        itemsPath: 'guests',
        inputSchema: { type: 'object' },
      }),
    ),
  ).not.toThrow();
  const engine = setup();
  const id = publish(
    engine,
    batchDefinition(undefined, {
      itemsPath: 'guests',
      inputSchema: { type: 'object' },
    }),
  );
  expect(engine.start(id, { guests: 'wrong' }).run.error).toContain('array');
});
