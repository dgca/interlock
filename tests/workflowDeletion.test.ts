import { afterAll, afterEach, expect, it } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, nodeSchema } from '@interlock/core';
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
