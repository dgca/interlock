import { afterEach, beforeEach, expect, it } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, nodeSchema } from '@interlock/core';
import { appRouter } from '../packages/server/src/router';

let store: Store;
let engine: Engine;
beforeEach(() => {
  store = new Store(':memory:');
  engine = new Engine(store, process.cwd());
});
afterEach(() => store.close());
function create(name: string, targets: string[] = []) {
  const draft = blankDefinition();
  if (targets.length) {
    draft.nodes.splice(
      1,
      1,
      ...targets.map((workflowId, i) =>
        nodeSchema.parse({
          id: `call-${i}`,
          kind: 'workflow',
          label: 'Call',
          workflowId,
          version: 1,
        }),
      ),
    );
    draft.edges = draft.nodes.slice(1).map((node, i) => ({
      id: `edge-${i}`,
      port: 'default' as const,
      source: draft.nodes[i].id,
      target: node.id,
    }));
  }
  const workflow = engine.create(name, '', draft);
  return engine.publish(workflow.id);
}
it('republishes a diamond once in dependency order and preserves old runs and versions', async () => {
  const child = create('Child');
  const left = create('Left', [child.id]);
  const right = create('Right', [child.id]);
  const root = create('Root', [left.id, right.id, child.id]);
  const oldRun = engine.start(root.id, {}).run;
  const caller = appRouter.createCaller({ engine });
  await caller.workflows.publish({ id: child.id, cascade: true });
  for (const w of [child, left, right, root]) {
    expect(engine.workflow(w.id).latestVersion).toBe(2);
    const published = store.getVersion(w.id, 2)!;
    expect(
      published.definition.nodes
        .filter((n) => n.kind === 'workflow')
        .map((n) => n.version),
    ).toEqual(w.id === child.id ? [] : w.id === root.id ? [2, 2, 2] : [2]);
    expect(store.getVersion(w.id, 1)!.definition).toEqual(w.draft);
  }
  expect(engine.workflow(root.id).draftRevision).toBe(root.draftRevision + 1);
  expect(
    store
      .runs()
      .filter((r) => r.id === oldRun.id || r.parentRunId === oldRun.id)
      .every((r) => r.version === 1),
  ).toBe(true);
  const newRun = engine.start(root.id, {}).run;
  expect(newRun.version).toBe(2);
  expect(store.runs().find((r) => r.parentRunId === newRun.id)?.version).toBe(
    2,
  );
  engine.cancel(oldRun.id);
  engine.cancel(newRun.id);
});
it('rolls back the entire cascade when a dependent has unpublished edits', async () => {
  const child = create('Child');
  const parent = create('Parent', [child.id]);
  const draft = structuredClone(parent.draft);
  draft.nodes[1].label = 'Unfinished edit';
  engine.update(parent.id, { draft, draftRevision: parent.draftRevision });
  const before = store.workflows();
  await expect(
    appRouter
      .createCaller({ engine })
      .workflows.publish({ id: child.id, cascade: true }),
  ).rejects.toThrow('unpublished');
  expect(store.workflows()).toEqual(before);
  expect(store.getVersion(child.id, 2)).toBeUndefined();
});
it('rejects cyclic cascade dependencies without publishing anything', async () => {
  const child = create('Child');
  const parent = create('Parent', [child.id]);
  const draft = structuredClone(parent.draft);
  draft.nodes[1] = nodeSchema.parse({
    id: 'call-0',
    kind: 'workflow',
    label: 'Back',
    workflowId: parent.id,
    version: 1,
  });
  engine.update(child.id, { draft, draftRevision: child.draftRevision });
  await expect(
    appRouter
      .createCaller({ engine })
      .workflows.publish({ id: child.id, cascade: true }),
  ).rejects.toThrow('cycle');
  expect(engine.workflow(child.id).latestVersion).toBe(1);
  expect(engine.workflow(parent.id).latestVersion).toBe(1);
});
it('includes archived callers but excludes draft-only and historical references and leaves unrelated pins alone', () => {
  const child = create('Child');
  const unrelated = create('Unrelated');
  engine.publish(unrelated.id);
  const parent = create('Archived parent', [child.id, unrelated.id]);
  engine.update(parent.id, { archived: true });
  const historical = create('Historical', [child.id]);
  engine.update(historical.id, {
    draft: blankDefinition(),
    draftRevision: historical.draftRevision,
  });
  engine.publish(historical.id);
  const draftOnly = engine.create('Draft only', '', parent.draft);
  engine.publish(child.id, true);
  expect(
    engine
      .workflow(parent.id)
      .draft.nodes.filter((n) => n.kind === 'workflow')
      .map((n) => n.version),
  ).toEqual([2, 1]);
  expect(engine.workflow(parent.id).archived).toBe(true);
  expect(engine.workflow(historical.id).latestVersion).toBe(2);
  expect(engine.workflow(draftOnly.id).latestVersion).toBe(0);
  expect(engine.workflow(unrelated.id).latestVersion).toBe(2);
  expect(() =>
    engine.update(parent.id, {
      draft: parent.draft,
      draftRevision: parent.draftRevision,
    }),
  ).toThrow('changed elsewhere');
});
it('preserves pins when an existing run reaches another child after the cascade', () => {
  const child = create('Child');
  const parent = create('Parent', [child.id, child.id]);
  const old = engine.start(parent.id, {}).run;
  engine.publish(child.id, true);
  const work = engine.available(old.id)[0];
  const claim = engine.claim(work.id, {
    workerId: 'test',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.submit(work.id, claim.token!, {});
  const children = store.runs().filter((r) => r.parentRunId === old.id);
  expect(children).toHaveLength(2);
  expect(children.map((r) => r.version)).toEqual([1, 1]);
  engine.cancel(old.id);
});
