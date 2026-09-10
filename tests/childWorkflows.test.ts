import { afterEach, beforeEach, expect, it } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, nodeSchema, type Workflow } from '@interlock/core';
import { appRouter } from '../packages/server/src/router';

let store: Store;
let engine: Engine;
let caller: ReturnType<typeof appRouter.createCaller>;
beforeEach(() => {
  store = new Store(':memory:');
  engine = new Engine(store, process.cwd());
  caller = appRouter.createCaller({ engine });
});
afterEach(() => store.close());
function withReference(id: string, version: number | null = null) {
  const draft = blankDefinition();
  draft.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'workflow',
    label: 'Gather evidence',
    workflowId: id,
    version,
  });
  return draft;
}
function creation(parent: Workflow) {
  return {
    ownerWorkflowId: parent.id,
    name: 'Gather evidence',
    parentDraftRevision: parent.draftRevision,
    parent: {
      name: 'Edited parent',
      description: 'Unsaved description',
      definition: withReference('new-child'),
    },
    nodeId: 'agent',
  };
}
it('creates the child and parent reference atomically, retaining unsaved parent edits', async () => {
  const parent = engine.create('Parent');
  const result = await caller.workflows.createChild(creation(parent));
  expect(result.parent).toMatchObject({
    name: 'Edited parent',
    description: 'Unsaved description',
    draftRevision: 2,
  });
  expect(result.child).toMatchObject({
    ownerWorkflowId: parent.id,
    latestVersion: 0,
  });
  expect(result.parent.draft.nodes[1]).toMatchObject({
    workflowId: result.child.id,
    version: null,
  });
  expect(await caller.workflows.list({ ownerWorkflowId: null })).toHaveLength(
    1,
  );
  expect(await caller.workflows.list({ ownerWorkflowId: parent.id })).toEqual([
    result.child,
  ]);
  expect(await caller.workflows.list()).toHaveLength(2);
  expect(await caller.workflows.get({ id: result.child.id })).toEqual(
    result.child,
  );
  expect(() => engine.publish(parent.id)).toThrow('select a version');
});
it('rolls back creation for stale drafts and invalid node IDs', () => {
  const parent = engine.create('Parent');
  expect(() =>
    engine.createChild({ ...creation(parent), parentDraftRevision: 0 }),
  ).toThrow('changed elsewhere');
  expect(() =>
    engine.createChild({ ...creation(parent), nodeId: 'missing' }),
  ).toThrow('not found');
  expect(store.workflows()).toEqual([parent]);
});
it('creates an unused child from its parent without changing graph routes', () => {
  const parent = engine.create('Parent');
  const result = engine.createChild({
    ...creation(parent),
    nodeId: undefined,
    parent: { name: parent.name, description: '', definition: parent.draft },
  });
  expect(result.parent.draft).toEqual(parent.draft);
  expect(result.child.ownerWorkflowId).toBe(parent.id);
});
it('rejects grandchildren, missing owners, and creation under an archived parent', () => {
  const parent = engine.create('Parent');
  const child = engine.create('Child', '', undefined, parent.id);
  expect(() => engine.create('Grandchild', '', undefined, child.id)).toThrow(
    'cannot own',
  );
  expect(() => engine.create('Orphan', '', undefined, 'missing')).toThrow(
    'not found',
  );
  engine.update(parent.id, { archived: true });
  expect(() => engine.create('Child', '', undefined, parent.id)).toThrow(
    'Restore the parent',
  );
});
it('rejects outside, sibling, and self references in drafts and on publication', () => {
  const parent = engine.create('Parent');
  const child = engine.create('Child', '', undefined, parent.id);
  const sibling = engine.create('Sibling', '', undefined, parent.id);
  const outside = engine.create('Outside');
  for (const source of [outside, sibling, child]) {
    expect(() =>
      engine.update(source.id, {
        draft: withReference(child.id),
        draftRevision: 1,
      }),
    ).toThrow('only the owning workflow');
    expect(engine.workflow(source.id).draftRevision).toBe(1);
  }
  expect(() => engine.create('Outside', '', withReference(child.id))).toThrow(
    'only the owning workflow',
  );
  engine.publish(child.id);
  store.put('workflows', { ...outside, draft: withReference(child.id, 1) });
  expect(() => engine.publish(outside.id)).toThrow('only the owning workflow');
});
it('keeps published parent pins unchanged when the child and parent draft advance', () => {
  const parent = engine.create('Parent');
  const { child, parent: edited } = engine.createChild(creation(parent));
  engine.publish(child.id);
  const pinned = engine.useChildVersion({
    id: parent.id,
    childId: child.id,
    nodeId: 'agent',
    version: 1,
    draftRevision: edited.draftRevision,
  });
  engine.publish(parent.id);
  engine.publish(child.id);
  expect(engine.workflow(parent.id).draft.nodes[1]).toMatchObject({
    version: 1,
  });
  const next = engine.useChildVersion({
    id: parent.id,
    childId: child.id,
    nodeId: 'agent',
    version: 2,
    draftRevision: pinned.draftRevision,
  });
  expect(next.draft.nodes[1]).toMatchObject({ version: 2 });
  expect(store.getVersion(parent.id, 1)!.definition.nodes[1]).toMatchObject({
    version: 1,
  });
  const run = engine.start(parent.id, {}).run;
  const nested = store.runs().find((r) => r.parentRunId === run.id)!;
  expect(nested).toMatchObject({ workflowId: child.id, version: 1 });
  engine.cancel(run.id);
});
it('rejects stale pins, nonexistent versions, and removed references', () => {
  const parent = engine.create('Parent');
  const { child, parent: edited } = engine.createChild(creation(parent));
  engine.publish(child.id);
  const input = {
    id: parent.id,
    childId: child.id,
    nodeId: 'agent',
    version: 1,
    draftRevision: edited.draftRevision,
  };
  expect(() => engine.useChildVersion({ ...input, draftRevision: 1 })).toThrow(
    'changed elsewhere',
  );
  expect(() => engine.useChildVersion({ ...input, version: 2 })).toThrow(
    'not found',
  );
  engine.update(parent.id, {
    draft: blankDefinition(),
    draftRevision: edited.draftRevision,
  });
  expect(() =>
    engine.useChildVersion({
      ...input,
      draftRevision: edited.draftRevision + 1,
    }),
  ).toThrow('no longer references');
});
it('permits library invocations from children and rejects direct starts under archived parents', () => {
  const library = engine.create('Library');
  engine.publish(library.id);
  const parent = engine.create('Parent');
  const child = engine.create(
    'Child',
    '',
    withReference(library.id, 1),
    parent.id,
  );
  engine.publish(child.id);
  engine.update(parent.id, { archived: true });
  expect(() => engine.start(child.id, {})).toThrow('Restore');
});
it('blocks incomplete parent clone and deletion without removing owned records', () => {
  const parent = engine.create('Parent');
  const child = engine.create('Child', '', undefined, parent.id);
  expect(() => engine.clone(parent.id)).toThrow('not available yet');
  expect(() => engine.deleteWorkflow(parent.id)).toThrow('children first');
  expect(engine.workflow(child.id).ownerWorkflowId).toBe(parent.id);
  engine.deleteWorkflow(child.id);
  engine.deleteWorkflow(parent.id);
  expect(store.workflows()).toEqual([]);
});
it('normalizes legacy records as library workflows without rewriting definitions', () => {
  const old = engine.create('Legacy');
  delete old.ownerWorkflowId;
  store.put('workflows', old);
  expect(engine.workflow(old.id).ownerWorkflowId).toBeNull();
  expect(store.workflows()[0].ownerWorkflowId).toBeNull();
  expect(engine.workflow(old.id).draft).toEqual(old.draft);
});
