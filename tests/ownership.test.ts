import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition, type WorkflowDefinition } from '@interlock/core';
import { appRouter } from '../packages/server/src/router';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';

const stores: Store[] = [],
  engines: Engine[] = [];
function setup() {
  const store = new Store(':memory:'),
    engine = new Engine(store, process.cwd());
  stores.push(store);
  engines.push(engine);
  return { store, engine, api: appRouter.createCaller({ engine }) };
}
afterEach(() => {
  vi.restoreAllMocks();
  engines.splice(0).forEach((e) => e.stop());
  stores.splice(0).forEach((s) => s.close());
});
function publish(
  engine: Engine,
  name: string,
  draft = blankDefinition(),
  owner?: string,
) {
  const w = engine.create(name, '', draft, owner);
  engine.publish(w.id);
  return w.id;
}
function move(
  engine: Engine,
  id: string,
  ownerWorkflowId: string | null,
  expectedOwnerWorkflowId = engine.workflow(id).ownerWorkflowId ?? null,
) {
  return engine.ownership.set({ id, ownerWorkflowId, expectedOwnerWorkflowId });
}
function state(store: Store) {
  return Object.fromEntries(
    [
      'workflows',
      'versions',
      'deletedVersions',
      'runs',
      'work',
      'events',
      'prompts',
      'promptRevisions',
    ].map((c) => [c, store.list(c)]),
  );
}
function revise(engine: Engine, id: string, draft: WorkflowDefinition) {
  engine.update(id, {
    draft,
    draftRevision: engine.workflow(id).draftRevision,
  });
}
function cleanup(engine: Engine, workflowId: string) {
  const versions = [{ workflowId, version: 1 }];
  engine.versions.delete({
    confirmation: engine.versions.preview({ versions }).confirmation,
    versions,
    acknowledgeHistoryLoss: true,
  });
}

it('validates shared input boundaries and preview without writes, with valid adoption control', async () => {
  const { engine, store, api } = setup(),
    target = publish(engine, 'Target'),
    owner = publish(engine, 'Owner');
  const before = state(store);
  for (const input of [
    { id: target },
    { id: target, ownerWorkflowId: '' },
    { id: '', ownerWorkflowId: null },
    { id: target, ownerWorkflowId: owner, extra: true },
  ])
    await expect(
      api.workflows.previewOwnership(input as any),
    ).rejects.toThrow();
  await expect(
    api.workflows.previewOwnership({ id: 'missing', ownerWorkflowId: owner }),
  ).rejects.toThrow('not found');
  await expect(
    api.workflows.previewOwnership({ id: target, ownerWorkflowId: 'missing' }),
  ).rejects.toThrow('not found');
  await expect(
    api.workflows.setOwner({ id: target, ownerWorkflowId: owner } as any),
  ).rejects.toThrow();
  expect(
    await api.workflows.previewOwnership({
      id: target,
      ownerWorkflowId: owner,
    }),
  ).toMatchObject({
    currentOwnerWorkflowId: null,
    canSetOwner: true,
    blockers: [],
  });
  expect(state(store)).toEqual(before);
  expect(
    await api.workflows.setOwner({
      id: target,
      ownerWorkflowId: owner,
      expectedOwnerWorkflowId: null,
    }),
  ).toMatchObject({
    applied: true,
    workflow: { id: target, ownerWorkflowId: owner },
  });
});

it('preserves all stored definitions, active work and ancestry through adoption and release', async () => {
  const { engine, store } = setup(),
    target = publish(engine, 'Target'),
    owner = publish(engine, 'Owner', workflowCall(target));
  engine.publish(target);
  const direct = engine.start(target, { saved: 'direct' }).run,
    parent = engine.start(owner, { saved: 'parent' }).run;
  const before = state(store),
    targetBefore = engine.workflow(target);
  const result = move(engine, target, owner);
  expect(result.workflow).toEqual({
    ...targetBefore,
    ownerWorkflowId: owner,
    updatedAt: result.workflow.updatedAt,
  });
  const after = state(store);
  for (const collection of Object.keys(before).filter((c) => c !== 'workflows'))
    expect(after[collection]).toEqual(before[collection]);
  expect((after.workflows as any[]).filter((w) => w.id !== target)).toEqual(
    (before.workflows as any[]).filter((w) => w.id !== target),
  );
  expect(engine.inspect(parent.id).children[0].parentRunId).toBe(parent.id);
  for (const run of [direct, engine.inspect(parent.id).children[0]]) {
    const work = engine.available(run.id)[0];
    const claimed = engine.claim(work.id, {
      workerId: 'ownership-test',
      freshContext: false,
      tools: [],
      skills: [],
    });
    engine.submit(work.id, claimed.token!, { done: true });
  }
  expect(engine.run(parent.id).status).toBe('completed');
  expect(engine.run(direct.id).status).toBe('completed');
  const runState = state(store);
  expect(move(engine, target, null).applied).toBe(true);
  for (const c of ['versions', 'runs', 'work', 'events'])
    expect(state(store)[c]).toEqual(runState[c]);
});

it('lists every archived foreign draft/latest/historical Batch reference and permits only-owner pins', () => {
  const { engine, store } = setup(),
    target = publish(engine, 'Target'),
    owner = publish(engine, 'Owner', workflowCall(target));
  const foreign = publish(
    engine,
    'Foreign',
    batchDefinition(workflowCall(target).nodes[1]),
  );
  engine.publish(foreign);
  const nullPin = workflowCall(target);
  (nullPin.nodes[1] as any).version = null;
  revise(engine, foreign, nullPin);
  engine.update(foreign, { archived: true });
  const before = state(store),
    preview = engine.ownership.preview({ id: target, ownerWorkflowId: owner });
  expect(preview.blockers).toHaveLength(3);
  expect(preview.blockers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        workflowId: foreign,
        name: 'Foreign',
        draft: true,
        nodeId: 'agent',
      }),
      expect.objectContaining({
        workflowId: foreign,
        version: 1,
        latest: false,
        nodeLabel: 'Start investigation',
      }),
      expect.objectContaining({
        workflowId: foreign,
        version: 2,
        latest: true,
      }),
    ]),
  );
  expect(preview.blockers.find((b) => b.version === 1)!.reason).toContain(
    'explicit old-version cleanup',
  );
  expect(() => move(engine, target, owner)).toThrow('Foreign');
  expect(state(store)).toEqual(before);
  revise(engine, foreign, blankDefinition());
  engine.publish(foreign);
  const versions = [1, 2].map((version) => ({ workflowId: foreign, version }));
  const p = engine.versions.preview({ versions });
  engine.versions.delete({
    versions,
    confirmation: p.confirmation,
    acknowledgeHistoryLoss: true,
  });
  expect(move(engine, target, owner).applied).toBe(true);
});

it('rejects self references until explicitly removed from draft and retained history', () => {
  const { engine, store } = setup(),
    target = publish(engine, 'Recursive'),
    owner = publish(engine, 'Owner');
  revise(engine, target, workflowCall(target));
  engine.publish(target);
  const before = state(store);
  expect(
    engine.ownership
      .preview({ id: target, ownerWorkflowId: owner })
      .blockers.map((b) => b.workflowId),
  ).toEqual([target, target]);
  expect(() => move(engine, target, owner)).toThrow('Recursive');
  expect(state(store)).toEqual(before);
  revise(engine, target, blankDefinition());
  engine.publish(target);
  const versions = [{ workflowId: target, version: 2 }],
    p = engine.versions.preview({ versions });
  engine.versions.delete({
    versions,
    confirmation: p.confirmation,
    acknowledgeHistoryLoss: true,
  });
  expect(move(engine, target, owner).applied).toBe(true);
});

it('enforces one level, self/archived owner rules and preserves archive on target moves', () => {
  const { engine, store } = setup(),
    parent = publish(engine, 'Parent'),
    child = publish(engine, 'Child', blankDefinition(), parent),
    other = publish(engine, 'Other');
  for (const [id, owner] of [
    [other, other],
    [other, child],
    [parent, other],
  ]) {
    const before = state(store);
    expect(() => move(engine, id, owner)).toThrow();
    expect(state(store)).toEqual(before);
  }
  engine.update(other, { archived: true });
  expect(() => move(engine, child, other)).toThrow('Restore');
  const noOpBefore = state(store);
  expect(move(engine, other, null).applied).toBe(false);
  expect(state(store)).toEqual(noOpBefore);
  engine.update(parent, { archived: true });
  const archivedBefore = state(store);
  expect(move(engine, child, parent).applied).toBe(false);
  expect(state(store)).toEqual(archivedBefore);
  expect(move(engine, child, null).applied).toBe(true);
  engine.update(parent, { archived: false });
  expect(move(engine, other, parent).workflow.archived).toBe(true);
});

it('reparents only after old owner references are explicitly cleared and obsolete versions cleaned', () => {
  const { engine, store } = setup(),
    old = publish(engine, 'Old owner'),
    next = publish(engine, 'Next owner'),
    target = publish(engine, 'Child', blankDefinition(), old);
  revise(engine, old, workflowCall(target));
  engine.publish(old);
  revise(engine, old, blankDefinition());
  engine.publish(old);
  const before = state(store);
  expect(() => move(engine, target, next)).toThrow('Old owner');
  expect(state(store)).toEqual(before);
  const versions = [{ workflowId: old, version: 2 }],
    p = engine.versions.preview({ versions });
  engine.versions.delete({
    versions,
    confirmation: p.confirmation,
    acknowledgeHistoryLoss: true,
  });
  expect(move(engine, target, next)).toMatchObject({
    applied: true,
    workflow: { ownerWorkflowId: next },
  });
  expect(move(engine, target, null).applied).toBe(true);
});

it('rejects stale expected ownership and new references after preview without writes', () => {
  const { engine, store } = setup(),
    target = publish(engine, 'Target'),
    owner = publish(engine, 'Owner'),
    other = publish(engine, 'Other');
  const preview = engine.ownership.preview({
    id: target,
    ownerWorkflowId: owner,
  });
  move(engine, target, other);
  const before = state(store);
  expect(() =>
    move(engine, target, owner, preview.currentOwnerWorkflowId),
  ).toThrow('ownership changed');
  expect(state(store)).toEqual(before);
  move(engine, target, null);
  expect(
    engine.ownership.preview({ id: target, ownerWorkflowId: owner })
      .canSetOwner,
  ).toBe(true);
  const foreign = publish(engine, 'New foreign', workflowCall(target));
  const changed = state(store);
  expect(() => move(engine, target, owner, null)).toThrow('New foreign');
  expect(state(store)).toEqual(changed);
  revise(engine, foreign, blankDefinition());
  engine.publish(foreign);
  cleanup(engine, foreign);
  expect(move(engine, target, owner, null).applied).toBe(true);
});

it('rolls back an injected failure after the ownership write with a successful control', () => {
  const { engine, store } = setup(),
    target = publish(engine, 'Target'),
    owner = publish(engine, 'Owner');
  engine.start(target, {});
  const before = state(store),
    put = store.put.bind(store);
  const spy = vi.spyOn(store, 'put').mockImplementation((collection, value) => {
    put(collection, value);
    if (collection === 'workflows') throw new Error('injected after write');
  });
  expect(() => move(engine, target, owner)).toThrow('injected after write');
  expect(state(store)).toEqual(before);
  spy.mockRestore();
  expect(move(engine, target, owner).applied).toBe(true);
});

it('retains authoring checks and permits foreign drafts after release', () => {
  const { engine, store } = setup(),
    target = publish(engine, 'Target'),
    owner = publish(engine, 'Owner'),
    foreign = publish(engine, 'Foreign');
  move(engine, target, owner);
  const before = state(store);
  expect(() => revise(engine, foreign, workflowCall(target))).toThrow(
    'only the owning',
  );
  expect(() => engine.create('Invalid', '', workflowCall(target))).toThrow(
    'only the owning',
  );
  expect(state(store)).toEqual(before);
  revise(engine, owner, workflowCall(target));
  expect(engine.publish(owner).latestVersion).toBe(2);
  move(engine, target, null);
  revise(engine, foreign, workflowCall(target));
  expect(engine.publish(foreign).latestVersion).toBe(2);
});

it('exports resulting ownership and rejects ordinary or forced ownership replacement', () => {
  const { engine, store } = setup(),
    target = publish(engine, 'Target'),
    owner = publish(engine, 'Owner');
  const oldBackup = exportWorkflows(store, target);
  move(engine, target, owner);
  const bundle = exportWorkflows(store, target),
    fresh = setup();
  expect(bundle.workflows.map((w) => w.id)).toEqual(
    expect.arrayContaining([target, owner]),
  );
  importWorkflows(fresh.store, bundle);
  expect(fresh.engine.workflow(target).ownerWorkflowId).toBe(owner);
  const before = state(store);
  for (const force of [false, true])
    expect(() => importWorkflows(store, oldBackup, { force })).toThrow(
      'Ownership conflict',
    );
  expect(state(store)).toEqual(before);
  expect(importWorkflows(store, bundle).changed).toEqual([]);
});

it('rejects restoration of an original foreign caller after adoption and restores after release', () => {
  const { engine, store } = setup(),
    target = publish(engine, 'Target'),
    owner = publish(engine, 'Owner'),
    foreign = publish(engine, 'Foreign', workflowCall(target));
  revise(engine, foreign, blankDefinition());
  engine.publish(foreign);
  const backup = exportWorkflows(store, foreign);
  cleanup(engine, foreign);
  move(engine, target, owner);
  const callerOnly = {
    ...backup,
    workflows: backup.workflows.filter((w) => w.id === foreign),
  };
  const before = state(store);
  expect(() =>
    importWorkflows(store, callerOnly, {
      restoreDeletedVersions: true,
      force: true,
    }),
  ).toThrow('only the owning');
  expect(state(store)).toEqual(before);
  expect(
    importWorkflows(store, callerOnly, { force: true }).skippedVersions,
  ).toEqual([{ workflowId: foreign, version: 1 }]);
  move(engine, target, null);
  expect(
    importWorkflows(store, callerOnly, {
      restoreDeletedVersions: true,
      force: true,
    }).restoredVersions,
  ).toEqual([{ workflowId: foreign, version: 1 }]);
});
