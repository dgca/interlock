import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  sameWorkflowContent,
  workflowPositionsSchema,
  type WorkflowPositions,
  type Workflow,
} from '@interlock/core';
import { appRouter } from '../packages/server/src/router';
import { definitionHash } from '../packages/runtime/src/versionIdentity';

const opened: { engine: Engine; store: Store }[] = [];
const directories: string[] = [];
function setup(path = ':memory:') {
  const store = new Store(path);
  const engine = new Engine(store, tmpdir());
  opened.push({ engine, store });
  return { store, engine, api: appRouter.createCaller({ engine }) };
}
afterEach(() => {
  for (const { engine, store } of opened.splice(0)) {
    engine.stop();
    store.close();
  }
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

it('persists layout independently, merges positions by literal ID, and rejects stale revisions', async () => {
  const { engine, store, api } = setup();
  const workflow = engine.create('Shared layout');
  engine.publish(workflow.id);
  const before = store.get<Workflow>('workflows', workflow.id)!;
  const version = store.getVersion(workflow.id, 1)!;
  const hash = definitionHash(version.definition);
  const positions = JSON.parse(
    '{"entry":{"x":300,"y":150},"__proto__":{"x":12,"y":34}}',
  );
  const first = await api.workflows.saveLayout({
    id: workflow.id,
    expectedRevision: 0,
    positions,
  });
  expect(first.revision).toBe(1);
  expect(Object.hasOwn(first.positions, '__proto__')).toBe(true);
  expect(first.positions.__proto__).toEqual({ x: 12, y: 34 });
  expect(({} as { x?: number }).x).toBeUndefined();
  expect(store.get('workflows', workflow.id)).toEqual(before);
  expect(store.getVersion(workflow.id, 1)).toEqual(version);
  expect(definitionHash(store.getVersion(workflow.id, 1)!.definition)).toBe(
    hash,
  );
  const read = await api.workflows.get({ id: workflow.id });
  expect(read.layoutRevision).toBe(1);
  expect(read.draft.nodes[0].position).toEqual({ x: 300, y: 150 });
  expect(read.draftMatchesLatest).toBe(true);
  expect(
    (await engine.doctor()).checks.some((check) =>
      check.name.includes('Unpublished draft'),
    ),
  ).toBe(false);
  const next = await api.workflows.saveLayout({
    id: workflow.id,
    expectedRevision: 1,
    positions: { exit: { x: 900, y: 150 } },
  });
  expect(next.revision).toBe(2);
  expect(next.positions.entry).toEqual(positions.entry);
  expect(Object.hasOwn(next.positions, '__proto__')).toBe(true);
  await expect(
    api.workflows.saveLayout({
      id: workflow.id,
      expectedRevision: 1,
      positions: { entry: { x: 0, y: 0 } },
    }),
  ).rejects.toThrow('Layout changed elsewhere');
  expect((await api.workflows.get({ id: workflow.id })).layoutRevision).toBe(2);
  expect(
    (
      await api.workflows.saveLayout({
        id: workflow.id,
        expectedRevision: 2,
        positions: next.positions,
      })
    ).revision,
  ).toBe(2);
});

it('validates finite coordinates without introducing limits on accepted legacy node IDs', async () => {
  const { engine, api } = setup();
  const workflow = engine.create('Validation');
  expect(
    workflowPositionsSchema.safeParse({ ['x'.repeat(2048)]: { x: 0, y: 0 } })
      .success,
  ).toBe(true);
  for (const positions of [
    { entry: { x: Infinity, y: 0 } },
    { entry: { x: 0, y: NaN } },
    { '': { x: 0, y: 0 } },
    { entry: { x: 0, y: 0, label: 'not layout' } },
  ])
    await expect(
      api.workflows.saveLayout({
        id: workflow.id,
        expectedRevision: 0,
        positions: positions as unknown as WorkflowPositions,
      }),
    ).rejects.toThrow();
  await expect(
    api.workflows.saveLayout({
      id: 'missing',
      expectedRevision: 0,
      positions: {},
    }),
  ).rejects.toThrow('Workflow not found');
});

it('restores layout after a restart, clones its current arrangement, and removes it on deletion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-layout-'));
  directories.push(dir);
  const path = join(dir, 'workflow.db');
  const first = setup(path);
  const workflow = first.engine.create('Persistent');
  await first.api.workflows.saveLayout({
    id: workflow.id,
    expectedRevision: 0,
    positions: { entry: { x: 770, y: 440 } },
  });
  opened.splice(
    opened.findIndex(({ store }) => store === first.store),
    1,
  );
  first.engine.stop();
  first.store.close();
  const second = setup(path);
  const restored = await second.api.workflows.get({ id: workflow.id });
  expect(restored.draft.nodes[0].position).toEqual({ x: 770, y: 440 });
  expect(restored.layoutRevision).toBe(1);
  const cloned = await second.api.workflows.clone({ id: workflow.id });
  expect(cloned.draft.nodes[0].position).toEqual(
    restored.draft.nodes[0].position,
  );
  await second.api.workflows.saveLayout({
    id: cloned.id,
    expectedRevision: 0,
    positions: { entry: { x: 1, y: 2 } },
  });
  expect(
    (await second.api.workflows.get({ id: workflow.id })).draft.nodes[0]
      .position,
  ).toEqual({ x: 770, y: 440 });
  second.engine.deleteWorkflow(workflow.id);
  expect(second.store.get('workflowLayouts', workflow.id)).toBeUndefined();
});

it('saves content without replacing a newer layout, and seeds new nodes separately', async () => {
  const { engine, store, api } = setup();
  const workflow = engine.create('Content');
  engine.publish(workflow.id);
  const initial = await api.workflows.get({ id: workflow.id });
  await api.workflows.saveLayout({
    id: workflow.id,
    expectedRevision: 0,
    positions: { entry: { x: 100, y: 200 } },
  });
  const stale = await api.workflows.get({ id: workflow.id });
  await api.workflows.saveLayout({
    id: workflow.id,
    expectedRevision: 1,
    positions: { entry: { x: 500, y: 600 } },
  });
  stale.draft.nodes[1].label = 'New content';
  stale.draft.nodes.push({
    ...stale.draft.nodes[1],
    id: 'new-node',
    position: { x: 900, y: 30 },
  });
  const saved = await api.workflows.update({
    id: workflow.id,
    draftRevision: initial.draftRevision,
    draft: stale.draft,
    layout: 'preserve',
  });
  expect(saved.draftRevision).toBe(initial.draftRevision + 1);
  expect(saved.draft.nodes[0].position).toEqual({ x: 500, y: 600 });
  expect(saved.draft.nodes.at(-1)!.position).toEqual({ x: 900, y: 30 });
  expect(saved.layoutRevision).toBe(3);
  expect(
    store.get<Workflow>('workflows', workflow.id)!.draft.nodes[0].position,
  ).toEqual(initial.draft.nodes[0].position);
  expect(saved.draftMatchesLatest).toBe(false);
});

it.each(['update', 'edit'] as const)(
  'preserves already-autosaved positions for unpublished nodes during content %s',
  async (operation) => {
    const { engine, api } = setup();
    const workflow = engine.create('Unsaved node layout');
    const rawNode = {
      id: 'unpublished-node',
      kind: 'script' as const,
      label: 'Unpublished script',
      language: 'javascript' as const,
      command: 'return input;',
      position: { x: 100, y: 100 },
    };
    const node = nodeSchema.parse(rawNode);
    const candidate = structuredClone(workflow.draft);
    candidate.nodes.push(node);
    await api.workflows.saveLayout({
      id: workflow.id,
      expectedRevision: 0,
      positions: { [node.id]: { x: 500, y: 500 } },
    });
    if (operation === 'update') {
      await api.workflows.update({
        id: workflow.id,
        draftRevision: workflow.draftRevision,
        draft: candidate,
        layout: 'preserve',
      });
    } else {
      const result = await api.workflows.edit({
        id: workflow.id,
        draftRevision: workflow.draftRevision,
        edits: [{ op: 'add_node', node: rawNode }],
        layout: 'preserve',
      });
      expect(result.applied).toBe(true);
    }
    const saved = await api.workflows.get({ id: workflow.id });
    expect(
      saved.draft.nodes.find((entry) => entry.id === node.id)!.position,
    ).toEqual({
      x: 500,
      y: 500,
    });
    expect(saved.layoutRevision).toBe(1);
    expect(saved.draftRevision).toBe(workflow.draftRevision + 1);
  },
);

it('ignores only direct node positions when comparing content and keeps publication explicit', async () => {
  const { engine, store, api } = setup();
  const definition = blankDefinition();
  definition.nodes[0].inputSchema = { default: { position: { x: 1, y: 2 } } };
  const moved = structuredClone(definition);
  moved.nodes[0].position = { x: 3, y: 4 };
  expect(sameWorkflowContent(definition, moved)).toBe(true);
  moved.nodes[0].inputSchema = { default: { position: { x: 9, y: 2 } } };
  expect(sameWorkflowContent(definition, moved)).toBe(false);
  const workflow = engine.create('Publish', '', definition);
  engine.publish(workflow.id);
  await api.workflows.saveLayout({
    id: workflow.id,
    expectedRevision: 0,
    positions: { entry: { x: 33, y: 44 } },
  });
  engine.publish(workflow.id);
  expect(
    store.getVersion(workflow.id, 1)!.definition.nodes[0].position,
  ).toEqual(definition.nodes[0].position);
  expect(
    store.getVersion(workflow.id, 2)!.definition.nodes[0].position,
  ).toEqual({ x: 33, y: 44 });
});

it('compares replacement positions with the displayed layout when content also changes', async () => {
  const { engine, store, api } = setup();
  const workflow = engine.create('Return to embedded position');
  const initial = structuredClone(workflow.draft.nodes[0].position);
  const id = workflow.draft.nodes[0].id;
  await api.workflows.saveLayout({
    id: workflow.id,
    expectedRevision: 0,
    positions: { [id]: { x: 999, y: 888 } },
  });
  const current = await api.workflows.get({ id: workflow.id });
  current.draft.nodes[0].position = initial;
  current.draft.nodes[0].label = 'Edited content';
  const saved = await api.workflows.update({
    id: workflow.id,
    draftRevision: current.draftRevision,
    draft: current.draft,
  });
  expect(saved.draft.nodes[0].position).toEqual(initial);
  expect(saved.draftRevision).toBe(current.draftRevision + 1);
  expect(saved.layoutRevision).toBe(2);
  expect(
    store.get<Workflow>('workflows', workflow.id)!.draft.nodes[0].label,
  ).toBe('Edited content');
});
