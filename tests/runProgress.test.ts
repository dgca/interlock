import { afterAll, afterEach, expect, it } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition } from '@interlock/core';
import { batchDefinition, nestedBatches } from './fixtures/batch';
import { runProgress } from '../packages/ui/src/features/runs/runProgress';
const store = new Store(':memory:');
const engine = new Engine(store, process.cwd());
afterAll(() => store.close());
afterEach(() => {
  for (const name of ['workflows', 'versions', 'runs', 'work', 'events'])
    for (const row of store.list<{ id: string }>(name))
      store.remove(name, row.id);
});
const worker = { workerId: 'test', freshContext: false, tools: [], skills: [] };
function start(definition = batchDefinition(), input: any = [1, 2, 3]) {
  const w = engine.create('Progress', '', definition);
  engine.publish(w.id);
  return engine.start(w.id, input).run.id;
}
function progress(id: string) {
  const d = engine.inspect(id);
  return runProgress(d.run, d.definition, d.descendants, d.descendantWork);
}
it('distinguishes unclaimed and working agents and masks descendant claim tokens', () => {
  const id = start(blankDefinition(), {});
  expect(progress(id).title).toBe('Waiting for an agent · Agent assignment');
  const work = engine.available(id)[0];
  const claim = engine.claim(work.id, worker);
  expect(progress(id).title).toBe('Agent working · Agent assignment');
  expect(engine.inspect(id).descendantWork[0]).not.toHaveProperty('token');
  engine.submit(work.id, claim.token!, 'done');
  expect(progress(id).title).toBe('Completed');
});
it('aggregates ordered Batch item executions, queued items, and claimed work', () => {
  const id = start();
  const a = engine.available(id)[0],
    claim = engine.claim(a.id, worker);
  expect(progress(id).nodes.batch.label).toBe(
    '0 of 3 finished · 1 running · 1 waiting · 1 queued',
  );
  expect(progress(id).nodes.work.label).toBe('1 running · 1 waiting');
  engine.submit(a.id, claim.token!, 10);
  const p = progress(id);
  expect(p.nodes.batch.label).toBe('1 of 3 finished · 2 waiting');
  expect(p.nodes.work.items.map((item) => item.run.input)).toEqual([1, 2, 3]);
  expect(p.nodes.work.items[0].execution?.output).toBe(10);
  expect(p.nodes.work.items[1].execution?.output).toBeUndefined();
  expect(progress(a.runId).nodes.work.state).toBe('completed');
});
it('handles nested Batches, failed retries, and cancellation using each latest attempt', () => {
  const id = start(nestedBatches(2), [[1, 2], [3]]);
  const work = engine.available(id)[0],
    claim = engine.claim(work.id, worker);
  expect(progress(id).nodes.work.items).toHaveLength(3);
  engine.reportFailure(work.id, claim.token!, 'broken');
  expect(progress(id).title).toContain('Failed');
  engine.retry(id);
  expect(progress(id).nodes.work.items).toHaveLength(3);
  expect(progress(id).nodes.work.state).toBe('waiting');
  engine.cancel(id);
  expect(progress(id).title).toBe('Cancelled');
  expect(progress(id).nodes.work.state).toBe('cancelled');
});
it('shows failed input selection without throwing and handles empty Batches', () => {
  const invalid = start(
    batchDefinition(undefined, { itemsPath: 'missing' }),
    {},
  );
  expect(progress(invalid).title).toContain('Failed');
  expect(progress(invalid).detail).toContain('missing');
  const empty = start(batchDefinition(), []);
  expect(progress(empty).nodes.batch.label).toBe('0 of 0 finished');
  expect(progress(empty).title).toBe('Completed');
});

it('distinguishes managed human attention from an agent working without changing the persisted claim', () => {
  const id = start(blankDefinition(), {});
  const work = engine.available(id)[0];
  engine.claim(work.id, worker);
  const d = engine.inspect(id);
  const assignment = d.descendantWork[0];
  assignment.executor = 'codex';
  assignment.managedExecution = {
    profileId: 'codex',
    state: 'needs_human',
    pendingRequests: 1,
  };
  let p = runProgress(d.run, d.definition, d.descendants, [assignment]);
  expect(p.title).toBe('Waiting for your response · Agent assignment');
  expect(p.nodes[assignment.nodeId]).toMatchObject({
    state: 'waiting',
    label: 'Waiting for your response',
  });
  expect(assignment.status).toBe('claimed');
  assignment.status = 'held';
  assignment.managedExecution.state = 'interrupted';
  p = runProgress(d.run, d.definition, d.descendants, [assignment]);
  expect(p.title).toBe('Recovery needed · Agent assignment');
  assignment.status = 'available';
  assignment.managedExecution.state = 'queued';
  p = runProgress(d.run, d.definition, d.descendants, [assignment]);
  expect(p.nodes[assignment.nodeId].label).toBe(
    'Queued for automatic execution',
  );
});
it('surfaces attention in an owned Batch item but excludes detached runs', () => {
  const id = start();
  const d = engine.inspect(id);
  const assignment = d.descendantWork[0];
  assignment.executor = 'codex';
  assignment.managedExecution = {
    profileId: 'codex',
    state: 'needs_human',
    pendingRequests: 1,
  };
  expect(
    runProgress(d.run, d.definition, d.descendants, d.descendantWork).title,
  ).toBe(`Waiting for your response · ${assignment.label}`);
  const child = d.descendants.find((r) => r.id === assignment.runId)!;
  child.parentMode = 'detached';
  expect(
    runProgress(d.run, d.definition, d.descendants, d.descendantWork).title,
  ).not.toContain('Waiting for your response');
});
