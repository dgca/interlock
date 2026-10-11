import { afterAll, afterEach, expect, it } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, nodeSchema } from '@interlock/core';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';
import { appRouter } from '../packages/server/src/router';
const store = new Store(':memory:');
const engine = new Engine(store, process.cwd());
const caller = appRouter.createCaller({ engine });
afterAll(() => store.close());
afterEach(() => {
  for (const collection of ['workflows', 'versions', 'runs', 'work', 'events'])
    for (const row of store.list<{ id: string }>(collection))
      store.remove(collection, row.id);
});
function published(name: string, child?: string) {
  const definition = blankDefinition();
  if (child)
    definition.nodes[1] = nodeSchema.parse({
      id: 'agent',
      label: 'Child',
      kind: 'workflow',
      workflowId: child,
      version: 1,
    });
  const workflow = engine.create(name, '', definition);
  return engine.publish(workflow.id);
}
it.each([false, true])(
  'permanently deletes a workflow through the API, archived=%s',
  async (archived) => {
    const workflow = published('Delete me');
    engine.update(workflow.id, { archived });
    await caller.workflows.delete({ id: workflow.id });
    expect(store.getVersion(workflow.id, 1)).toBeUndefined();
    expect(() => engine.workflow(workflow.id)).toThrow('not found');
  },
);
it('blocks active runs without deleting data, then removes cancelled runs and descendants', () => {
  const child = published('Child');
  const parent = published('Parent', child.id);
  const run = engine.start(parent.id, {}).run;
  expect(() => engine.deleteWorkflow(parent.id)).toThrow('active runs');
  expect(engine.workflow(parent.id).id).toBe(parent.id);
  expect(store.work().length).toBeGreaterThan(0);
  engine.cancel(run.id);
  engine.deleteWorkflow(parent.id);
  expect(store.runs()).toEqual([]);
  expect(store.work()).toEqual([]);
  expect(store.list('events')).toEqual([]);
  expect(engine.workflow(child.id).id).toBe(child.id);
  expect(store.getVersion(child.id, 1)).toBeDefined();
});
it('blocks references in drafts and published versions, including archived workflows', () => {
  const child = published('Child');
  const parent = published('Parent', child.id);
  expect(() => engine.deleteWorkflow(child.id)).toThrow('Parent');
  engine.update(parent.id, {
    archived: true,
    draft: blankDefinition(),
    draftRevision: parent.draftRevision,
  });
  expect(() => engine.deleteWorkflow(child.id)).toThrow('Parent');
  engine.deleteWorkflow(parent.id);
  const draft = engine.create('Unpublished reference', '', {
    ...blankDefinition(),
    nodes: [
      blankDefinition().nodes[0],
      nodeSchema.parse({
        id: 'ref',
        kind: 'workflow',
        label: 'Ref',
        workflowId: child.id,
        version: 1,
      }),
    ],
  });
  expect(() => engine.deleteWorkflow(child.id)).toThrow(
    'Unpublished reference',
  );
  engine.deleteWorkflow(draft.id);
  engine.deleteWorkflow(child.id);
});

it.each(['wait', 'batch', 'detached'] as const)(
  'preserves the entire tree when deleting a workflow invoked through %s',
  (mode) => {
    const child = published('Child');
    const call = workflowCall(
      child.id,
      mode === 'detached' ? 'detached' : 'wait',
    );
    const definition = mode === 'batch' ? batchDefinition(call.nodes[1]) : call;
    const parent = engine.create('Parent', '', definition);
    engine.publish(parent.id);
    const result = engine.start(parent.id, mode === 'batch' ? ['item'] : {});
    engine.cancel(result.run.id);
    for (const run of store.runs())
      if (run.status === 'waiting' || run.status === 'running')
        engine.cancel(run.id);
    const before = Object.fromEntries(
      ['workflows', 'versions', 'runs', 'work', 'events'].map((name) => [
        name,
        store.list(name),
      ]),
    );
    expect(() => engine.deleteWorkflow(child.id)).toThrow('Cannot delete');
    for (const [name, rows] of Object.entries(before))
      expect(store.list(name)).toEqual(rows);

    // Isolate the run-ancestry guard from the independent definition-reference guard.
    engine.update(parent.id, {
      draft: blankDefinition(),
      draftRevision: parent.draftRevision,
    });
    store.remove('versions', `${parent.id}:1`);
    expect(() => engine.deleteWorkflow(child.id)).toThrow(
      'runs belonging to another workflow',
    );
    for (const name of ['runs', 'work', 'events'])
      expect(store.list(name)).toEqual(before[name]);

    engine.deleteWorkflow(parent.id);
    expect(store.runs()).toEqual([]);
    expect(store.work()).toEqual([]);
    expect(store.list('events')).toEqual([]);
    expect(engine.workflow(child.id).id).toBe(child.id);
    expect(store.getVersion(child.id, 1)).toBeDefined();
  },
);

it.each(['draft', 'latest', 'historical', 'mixed'] as const)(
  'identifies exact %s references while preserving the target and its history',
  (scope) => {
    const child = published('Target');
    const targetRun = engine.start(child.id, {}).run;
    engine.cancel(targetRun.id);
    const definition = blankDefinition();
    definition.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'workflow',
      label: 'Target',
      workflowId: child.id,
      version: 1,
    });
    const parent = engine.create('Caller', '', definition);
    if (scope !== 'draft') engine.publish(parent.id);
    if (scope === 'historical' || scope === 'mixed') {
      engine.publish(parent.id);
      engine.update(parent.id, {
        draft: blankDefinition(),
        draftRevision: parent.draftRevision,
      });
      engine.publish(parent.id);
    }
    if (scope === 'mixed') {
      engine.update(parent.id, {
        draft: definition,
        draftRevision: engine.workflow(parent.id).draftRevision,
      });
      published('Second caller', child.id);
    }
    const before = Object.fromEntries(
      ['workflows', 'versions', 'runs', 'work', 'events'].map((name) => [
        name,
        store.list(name),
      ]),
    );
    let error = '';
    try {
      engine.deleteWorkflow(child.id);
    } catch (caught) {
      error = (caught as Error).message;
    }
    expect(error).toContain(`"Caller" (${parent.id})`);
    expect(error).toContain('archive');
    if (scope === 'draft' || scope === 'mixed')
      expect(error).toContain('draft');
    if (scope === 'latest')
      expect(error).toContain('published versions v1 (latest)');
    if (scope === 'historical' || scope === 'mixed') {
      expect(error).toContain('published versions v1, v2');
      expect(error).toContain('latest v3 does not reference it');
    }
    if (scope === 'mixed') expect(error).toContain('"Second caller"');
    for (const [name, rows] of Object.entries(before))
      expect(store.list(name)).toEqual(rows);
  },
);

it('uses the same historical-reference diagnostics for owned children', async () => {
  const parent = engine.create('Owner');
  const child = engine.create('Owned target', '', blankDefinition(), parent.id);
  engine.publish(child.id);
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'workflow',
    label: 'Child',
    workflowId: child.id,
    version: 1,
  });
  engine.update(parent.id, {
    draft: definition,
    draftRevision: parent.draftRevision,
  });
  engine.publish(parent.id);
  engine.update(parent.id, {
    draft: blankDefinition(),
    draftRevision: engine.workflow(parent.id).draftRevision,
  });
  engine.publish(parent.id);
  await expect(caller.workflows.delete({ id: child.id })).rejects.toThrow(
    'published versions v1; latest v2 does not reference it',
  );
  expect(engine.workflow(child.id).ownerWorkflowId).toBe(parent.id);
});
