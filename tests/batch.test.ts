import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankBatchBody,
  definitionSchema,
  nodeSchema,
  validateDefinition,
  type WorkflowDefinition,
  type Json,
} from '@interlock/core';
import { parseRawDefinition } from '../packages/ui/src/features/workflows/rawDefinition';

const engines: Engine[] = [];
const dirs: string[] = [];
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
function batch(body = blankBatchBody(), options: Record<string, unknown> = {}) {
  return definitionSchema.parse({
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Input' },
      {
        id: 'batch',
        kind: 'batch',
        label: 'Workflow Batch',
        body,
        concurrency: 2,
        ...options,
      },
      { id: 'exit', kind: 'exit', label: 'Output' },
    ],
    edges: [
      { id: 'in', source: 'entry', target: 'batch' },
      { id: 'out', source: 'batch', target: 'exit' },
    ],
  });
}
function agentBody() {
  const body = blankBatchBody();
  if (body.nodes[1].kind === 'agent') body.nodes[1].maxAttempts = 1;
  return body;
}
function scriptBody(command = 'return input * 2;') {
  const body = blankBatchBody();
  body.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Double',
    language: 'javascript',
    command,
  });
  return body;
}
it('parses inline definitions and keeps raw JSON, defaults, and nested fields', () => {
  const definition = batch(batch(scriptBody()));
  expect(validateDefinition(definition)).toEqual(definition);
  expect(parseRawDefinition(JSON.stringify(definition))).toEqual({
    definition,
  });
  const invalid = JSON.parse(JSON.stringify(definition));
  invalid.nodes[1].body.nodes[1].body.nodes[1].typo = true;
  expect(parseRawDefinition(JSON.stringify(invalid)).error).toContain(
    'body.nodes.1.body.nodes.1.typo',
  );
});
it.each(['entry', 'exit'])('requires an inline %s', (kind) => {
  const body = blankBatchBody();
  body.nodes = body.nodes.filter((n) => n.kind !== kind);
  const result = parseRawDefinition(JSON.stringify(batch(body)));
  expect(result.definition).toBeDefined();
  expect(result.publishError).toContain(kind);
});
it('rejects duplicate inline entry and exit and a missing body', () => {
  for (const kind of ['entry', 'exit'] as const) {
    const body = blankBatchBody();
    body.nodes.push(nodeSchema.parse({ id: 'extra', kind, label: 'Extra' }));
    expect(() => validateDefinition(batch(body))).toThrow(kind);
  }
  const invalid = JSON.parse(JSON.stringify(batch()));
  delete invalid.nodes[1].body;
  expect(definitionSchema.safeParse(invalid).success).toBe(false);
});
it('rejects cross-scope edges in both directions while allowing scoped IDs', () => {
  const definition = batch();
  definition.edges[0].target = 'agent';
  expect(() => validateDefinition(definition)).toThrow('missing node');
  const body = blankBatchBody();
  body.edges[0].target = 'batch';
  expect(() => validateDefinition(batch(body))).toThrow('missing node');
  expect(() => validateDefinition(batch())).not.toThrow();
});
it.each([0, 51])('rejects concurrency %s', (concurrency) => {
  expect(() => batch(undefined, { concurrency })).toThrow();
});
it('doubles [3, 4, 5] through inline JavaScript without hidden workflows', async () => {
  const engine = setup();
  const run = engine.start(publish(engine, batch(scriptBody())), [3, 4, 5]).run;
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));
  expect(engine.run(run.id).output).toEqual([6, 8, 10]);
  expect(engine.store.workflows()).toHaveLength(1);
  for (const child of engine.inspect(run.id).children) {
    expect(child.definitionPath).toEqual(['batch']);
    expect(engine.inspect(child.id).definition).toEqual(scriptBody());
  }
});
it('selects itemsPath and handles an empty list without item runs', () => {
  const engine = setup();
  const id = publish(engine, batch(undefined, { itemsPath: 'items' }));
  const empty = engine.start(id, { items: [] });
  expect(empty.run.output).toEqual([]);
  expect(empty.children).toHaveLength(0);
  const run = engine.start(id, { items: [3] }).run;
  expect(engine.available(run.id)[0].input).toBe(3);
  complete(engine, run.id, 6);
  expect(engine.run(run.id).output).toEqual([6]);
});
it('enforces concurrency and orders out-of-order results; root discovers agent work', () => {
  const engine = setup();
  const run = engine.start(publish(engine, batch()), ['a', 'b', 'c']).run;
  expect(engine.available(run.id).map((w) => w.input)).toEqual(['a', 'b']);
  complete(engine, run.id, 'B', 1);
  expect(engine.available(run.id).map((w) => w.input)).toEqual(['a', 'c']);
  complete(engine, run.id, 'C', 1);
  complete(engine, run.id, 'A');
  expect(engine.run(run.id).output).toEqual(['A', 'B', 'C']);
});
it('accepts 200 items, rejects 201 and non-list input, and allows concurrency 50', () => {
  const engine = setup();
  const id = publish(engine, batch(undefined, { concurrency: 50 }));
  const run = engine.start(
    id,
    Array.from({ length: 200 }, (_, i) => i),
  ).run;
  expect(engine.available(run.id)).toHaveLength(50);
  engine.cancel(run.id);
  expect(engine.start(id, Array(201).fill(null)).run.error).toContain(
    '200 items',
  );
  expect(engine.start(id, {}).run.error).toContain('array');
});
it('collects a record per item for failures, successes, and cancelled item runs', () => {
  const engine = setup();
  const run = engine.start(
    publish(engine, batch(agentBody(), { failurePolicy: 'collect' })),
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
it('collects item input contract failures as persisted item runs', () => {
  const engine = setup();
  const body = agentBody();
  body.inputSchema = { type: 'number' };
  const run = engine.start(
    publish(engine, batch(body, { failurePolicy: 'collect' })),
    ['bad', 2],
  ).run;
  complete(engine, run.id, 4);
  expect(engine.run(run.id).output).toMatchObject([
    { status: 'failed', output: null },
    { status: 'completed', output: 4 },
  ]);
  expect(engine.inspect(run.id).children).toHaveLength(2);
});
it('fails all, cancels unfinished work, and retries only failed or cancelled items', () => {
  const engine = setup();
  const run = engine.start(publish(engine, batch(agentBody())), [
    'a',
    'b',
    'c',
    'd',
  ]).run;
  complete(engine, run.id, 'A');
  const successful = engine.inspect(run.id).children[0];
  const b = claim(engine, run.id);
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
it('keeps retries within concurrency even after collect encounters many failures', () => {
  const engine = setup();
  const definition = batch(agentBody(), {
    failurePolicy: 'collect',
    outputSchema: { type: 'number' },
  });
  const run = engine.start(publish(engine, definition), [1, 2, 3, 4]).run;
  while (engine.available(run.id).length) {
    const work = claim(engine, run.id);
    engine.reportFailure(work.id, work.token!, 'Failed');
  }
  expect(engine.run(run.id).status).toBe('failed');
  engine.retry(run.id);
  expect(engine.available(run.id)).toHaveLength(2);
});
it('cancels all nested item assignments and rejects late results', () => {
  const engine = setup();
  const run = engine.start(publish(engine, batch(batch())), [
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
it('executes nested batches with independent definition paths', async () => {
  const engine = setup();
  const run = engine.start(publish(engine, batch(batch(scriptBody()))), [
    [3, 4],
    [5],
  ]).run;
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));
  expect(engine.run(run.id).output).toEqual([[6, 8], [10]]);
  const grandchild = engine.store
    .runs()
    .find((r) => r.definitionPath?.length === 2)!;
  expect(engine.inspect(grandchild.id).definition).toEqual(scriptBody());
});
it('enforces ten nesting levels across inline and referenced workflows', () => {
  let definition = blankBatchBody();
  for (let i = 0; i < 10; i++) definition = batch(definition);
  expect(() => validateDefinition(definition)).not.toThrow();
  expect(() => validateDefinition(batch(definition))).toThrow(
    'depth exceeded 10',
  );
  const engine = setup();
  const childId = publish(engine, definition);
  const reference = blankBatchBody();
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
it('validates references inside nested bodies and supports conditions and workflow nodes', () => {
  const engine = setup();
  const childId = publish(engine, blankBatchBody());
  const body = definitionSchema.parse({
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Each item' },
      {
        id: 'check',
        kind: 'condition',
        label: 'Check',
        path: '',
        equals: true,
      },
      {
        id: 'call',
        kind: 'workflow',
        label: 'Call',
        workflowId: childId,
        version: 1,
      },
      { id: 'exit', kind: 'exit', label: 'Item result' },
    ],
    edges: [
      { id: '1', source: 'entry', target: 'check' },
      { id: '2', source: 'check', target: 'call', port: 'true' },
      { id: '3', source: 'check', target: 'exit', port: 'false' },
      { id: '4', source: 'call', target: 'exit' },
    ],
  });
  const run = engine.start(publish(engine, batch(body)), [true, false]).run;
  const work = claim(engine, run.id);
  expect(engine.run(work.runId).definitionPath).toBeUndefined();
  engine.submit(work.id, work.token!, 'yes');
  expect(engine.run(run.id).output).toEqual(['yes', false]);
  if (body.nodes[2].kind === 'workflow') body.nodes[2].version = 99;
  expect(() => publish(engine, batch(batch(body)))).toThrow(
    'referenced workflow version',
  );
});
it('resolves immutable published bodies after restart, draft edits, and publication', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-batch-'));
  dirs.push(dir);
  const path = join(dir, 'test.db');
  const engine = setup(path);
  const original = batch(agentBody());
  const id = publish(engine, original);
  const run = engine.start(id, [1, 2]).run;
  const work = claim(engine, run.id);
  const changed = batch(scriptBody());
  engine.update(id, { draft: changed, draftRevision: 1 });
  engine.publish(id);
  engine.stop();
  engine.store.close();
  engines.pop();
  const restarted = setup(path);
  expect(restarted.inspect(work.runId).definition).toEqual(agentBody());
  expect(restarted.inspect(run.id).definition).toEqual(original);
  restarted.submit(work.id, work.token!, 2);
  complete(restarted, run.id, 4);
  expect(restarted.run(run.id).output).toEqual([2, 4]);
  expect(restarted.store.workflows()).toHaveLength(1);
});
it('round-trips legacy map definitions and inspects and retries their published child runs', () => {
  const engine = setup();
  const child = publish(engine, agentBody());
  const definition = batch();
  definition.nodes[1] = nodeSchema.parse({
    id: 'batch',
    label: 'Old batching',
    kind: 'map',
    workflowId: child,
    version: 1,
  });
  expect(parseRawDefinition(JSON.stringify(definition))).toEqual({
    definition,
  });
  const run = engine.start(publish(engine, definition), [1, 2]).run;
  complete(engine, run.id, 2);
  const work = claim(engine, run.id);
  engine.reportFailure(work.id, work.token!, 'Retry');
  expect(engine.inspect(work.runId).definition).toEqual(agentBody());
  engine.retry(run.id);
  complete(engine, run.id, 4);
  expect(engine.run(run.id).output).toEqual([2, 4]);
});

it('queues an individual item retry when its collect Batch has no free slot', () => {
  const engine = setup();
  const run = engine.start(
    publish(engine, batch(agentBody(), { failurePolicy: 'collect' })),
    [1, 2, 3],
  ).run;
  const first = claim(engine, run.id);
  engine.reportFailure(first.id, first.token!, 'Retry later');
  expect(engine.available(run.id).map((w) => w.input)).toEqual([2, 3]);
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

it('cancels running inline scripts before their delayed side effects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-batch-cancel-'));
  dirs.push(dir);
  const engine = setup();
  const body = scriptBody(`const fs = require('node:fs');
    const dir = ${JSON.stringify(dir)};
    fs.writeFileSync(dir + '/' + input + '-ready', 'ready');
    await new Promise(resolve => setTimeout(resolve, 500));
    fs.writeFileSync(dir + '/' + input + '-late', 'late');
    return input;`);
  const run = engine.start(publish(engine, batch(body)), [1, 2]).run;
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
  const engine = setup();
  const run = engine.start(
    publish(engine, batch(batch(agentBody(), { failurePolicy: 'collect' }))),
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
