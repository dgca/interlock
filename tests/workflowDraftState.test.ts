import { afterEach, expect, it } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition } from '@interlock/core';
import { appRouter } from '../packages/server/src/router';

const store = new Store(':memory:');
const engine = new Engine(store, process.cwd());
const caller = appRouter.createCaller({ engine });
afterEach(() => {
  for (const collection of ['workflows', 'versions'])
    for (const row of store.list<{ id: string }>(collection))
      store.remove(collection, row.id);
});

it('derives draft state through both read APIs after publication, edits, and manual reverts', async () => {
  const workflow = engine.create('Draft state');
  async function state(expected: boolean | null) {
    expect(
      (await caller.workflows.get({ id: workflow.id })).draftMatchesLatest,
    ).toBe(expected);
    expect(
      (await caller.workflows.list()).find((w) => w.id === workflow.id)
        ?.draftMatchesLatest,
    ).toBe(expected);
    expect(store.get('workflows', workflow.id)).not.toHaveProperty(
      'draftMatchesLatest',
    );
  }
  await state(null);
  engine.publish(workflow.id);
  await state(true);
  engine.update(workflow.id, { name: 'Renamed' });
  await state(true);
  const original = engine.workflow(workflow.id).draft;
  const changed = structuredClone(original);
  changed.nodes[1].label = 'Changed';
  engine.update(workflow.id, {
    draft: changed,
    draftRevision: engine.workflow(workflow.id).draftRevision,
  });
  await state(false);
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  engine.update(workflow.id, {
    draft: reordered as typeof original,
    draftRevision: engine.workflow(workflow.id).draftRevision,
  });
  await state(true);
  expect(engine.workflow(workflow.id).draftRevision).not.toBe(
    engine.workflow(workflow.id).latestVersion,
  );
  engine.update(workflow.id, {
    draft: changed,
    draftRevision: engine.workflow(workflow.id).draftRevision,
  });
  engine.publish(workflow.id);
  await state(true);
  expect(store.getVersion(workflow.id, 1)?.definition).toEqual(original);
});

it('includes layout and array order in structural definition equality', async () => {
  const workflow = engine.create('Layout', '', blankDefinition());
  engine.publish(workflow.id);
  const draft = engine.workflow(workflow.id).draft;
  draft.nodes.reverse();
  engine.update(workflow.id, { draft, draftRevision: workflow.draftRevision });
  expect(
    (await caller.workflows.get({ id: workflow.id })).draftMatchesLatest,
  ).toBe(false);
});
