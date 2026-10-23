import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  definitionSchema,
  nodeSchema,
  type WorkflowDefinition,
} from '@interlock/core';
import {
  tidyWorkflow,
  canvasGeometry,
  CANVAS_GAP,
} from '@interlock/core/layout';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { nestedBatches } from './fixtures/batch';
import { appRouter } from '../packages/server/src/router';

const opened: { store: Store; engine: Engine }[] = [];
function setup() {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  opened.push({ store, engine });
  return { store, engine, api: appRouter.createCaller({ engine }) };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const { engine, store } of opened.splice(0)) {
    engine.stop();
    store.close();
  }
});
const semantics = (d: WorkflowDefinition) => ({
  ...d,
  nodes: d.nodes.map(({ position, ...node }) => node),
});
function stacked() {
  const d = blankDefinition();
  for (const n of d.nodes) n.position = { x: 0, y: 0 };
  return d;
}

it.each([stacked, () => nestedBatches(3)])(
  'shares editor geometry and Dagre layout without changing workflow semantics',
  (fixture) => {
    const { engine } = setup();
    const d = fixture();
    const before = structuredClone(d);
    const w = engine.create('Arranged', '', d, null, 'tidy');
    expect(w.draft).toEqual(tidyWorkflow(d));
    expect(semantics(w.draft)).toEqual(semantics(before));
    expect(d).toEqual(before);
    expect(
      new Set(w.draft.nodes.map((n) => JSON.stringify(n.position))).size,
    ).toBeGreaterThan(1);
    const { size, parents } = canvasGeometry(w.draft);
    for (const a of w.draft.nodes)
      for (const b of w.draft.nodes) {
        if (a.id === b.id || parents.get(a.id) !== parents.get(b.id)) continue;
        expect(
          Math.max(
            b.position.x - a.position.x - size(a).width,
            a.position.x - b.position.x - size(b).width,
            b.position.y - a.position.y - size(a).height,
            a.position.y - b.position.y - size(b).height,
          ),
        ).toBeGreaterThanOrEqual(CANVAS_GAP - 0.001);
      }
  },
);

it('preserves supplied positions when omitted and never changes published versions or active runs', () => {
  const { engine, store } = setup();
  const d = stacked();
  d.nodes[0].position = { x: -123.5, y: 47.25 };
  const w = engine.create('Unchanged', '', d);
  expect(w.draft).toEqual(d);
  engine.publish(w.id);
  const version = store.getVersion(w.id, 1);
  const run = engine.start(w.id, {}).run;
  const originalRun = engine.inspect(run.id);
  const updated = engine.update(w.id, {
    draftRevision: w.draftRevision,
    layout: 'tidy',
  });
  expect(updated.draftRevision).toBe(w.draftRevision + 1);
  expect(updated.draft).toEqual(tidyWorkflow(d));
  expect(store.getVersion(w.id, 1)).toEqual(version);
  expect(engine.inspect(run.id)).toEqual(originalRun);
  const replacement = stacked();
  const exact = engine.update(w.id, {
    draftRevision: updated.draftRevision,
    draft: replacement,
  });
  expect(exact.draft).toEqual(replacement);
});

it('requires a current revision for layout-only updates and rejects stale writes atomically', async () => {
  const { engine, api } = setup();
  const w = engine.create('Before', '', stacked());
  for (const draftRevision of [undefined, w.draftRevision + 1]) {
    await expect(
      api.workflows.update({
        id: w.id,
        name: 'Should not persist',
        layout: 'tidy',
        draftRevision,
      }),
    ).rejects.toThrow('Draft changed');
    expect(engine.workflow(w.id)).toEqual(w);
  }
  expect(
    engine.editDraft(
      w.id,
      w.draftRevision + 1,
      [{ op: 'update_node', id: 'agent', set: { label: 'Wrong' } }],
      'all',
      'tidy',
    ),
  ).toMatchObject({
    applied: false,
    diagnostics: [{ code: 'stale_revision' }],
  });
  expect(engine.workflow(w.id)).toEqual(w);
  const good = await api.workflows.update({
    id: w.id,
    layout: 'tidy',
    draftRevision: w.draftRevision,
  });
  expect(good.draftRevision).toBe(w.draftRevision + 1);
});

it('combines edits and layout in one revision and reports every moved node, with idempotent no-ops', () => {
  const { engine } = setup();
  const w = engine.create('Edits', '', stacked());
  const result = engine.editDraft(
    w.id,
    w.draftRevision,
    [{ op: 'update_node', id: 'agent', set: { label: 'Arranged agent' } }],
    'summary',
    'tidy',
  );
  expect(result).toMatchObject({
    applied: true,
    draftRevision: w.draftRevision + 1,
    changes: { nodes: { updated: ['entry', 'agent', 'exit'] } },
  });
  const saved = engine.workflow(w.id);
  expect(saved.draft.nodes[1].label).toBe('Arranged agent');
  expect(
    engine.editDraft(w.id, saved.draftRevision, [], 'all', 'tidy'),
  ).toMatchObject({
    applied: true,
    draftRevision: saved.draftRevision,
    changes: { nodes: { updated: [] } },
  });
  expect(engine.workflow(w.id)).toEqual(saved);
  const before = engine.workflow(w.id);
  expect(
    engine.editDraft(
      w.id,
      before.draftRevision,
      [{ op: 'update_node', id: 'missing', set: { label: 'Missing' } }],
      'all',
      'tidy',
    ).applied,
  ).toBe(false);
  expect(engine.workflow(w.id)).toEqual(before);
});

it('allows incomplete drafts and ignores dangling routes while retaining publication diagnostics', () => {
  const { engine } = setup();
  const d = stacked();
  d.edges.push({
    id: 'dangling',
    source: 'agent',
    target: 'missing',
    port: 'default',
  });
  d.nodes.push(
    nodeSchema.parse({
      id: 'detached',
      kind: 'agent',
      label: 'Unconnected',
      prompt: '',
    }),
  );
  const w = engine.create('Incomplete', '', d, null, 'tidy');
  expect(w.draft.edges).toEqual(d.edges);
  expect(engine.validateDraft(w.id)).toMatchObject({
    saveable: true,
    publishable: false,
  });
  expect(
    engine.editDraft(w.id, w.draftRevision, [], 'all', 'tidy').applied,
  ).toBe(true);
});

it('rolls back edits, positions and metadata after an injected persistence failure', () => {
  const { engine, store } = setup();
  const w = engine.create('Before', '', stacked());
  const before = store.workflows();
  const put = store.put.bind(store);
  const spy = vi.spyOn(store, 'put').mockImplementation((collection, value) => {
    put(collection, value);
    if (collection === 'workflows') throw new Error('Injected write failure');
  });
  expect(() =>
    engine.update(w.id, {
      name: 'After',
      draftRevision: w.draftRevision,
      layout: 'tidy',
    }),
  ).toThrow('Injected write');
  expect(store.workflows()).toEqual(before);
  expect(() =>
    engine.editDraft(
      w.id,
      w.draftRevision,
      [{ op: 'update_node', id: 'agent', set: { label: 'Changed' } }],
      'all',
      'tidy',
    ),
  ).toThrow('Injected write');
  expect(store.workflows()).toEqual(before);
  spy.mockRestore();
  expect(
    engine.update(w.id, { draftRevision: w.draftRevision, layout: 'tidy' })
      .draftRevision,
  ).toBe(w.draftRevision + 1);
});

it('validates layout requests and keeps authoring-summary defaults compact', async () => {
  const { engine, api, store } = setup();
  const raw = {
    nodes: [
      { id: 'a', kind: 'entry', label: 'Input' },
      { id: 'b', kind: 'exit', label: 'Output' },
    ],
    edges: [{ id: 'ab', source: 'a', target: 'b' }],
  };
  const summary = await api.workflows.createSummary({
    name: 'Summary',
    definition: definitionSchema.parse(raw),
    layout: 'tidy',
  });
  expect(summary).not.toHaveProperty('draft');
  const w = engine.workflow(summary.id);
  expect(w.draft.nodes[1].position.x).toBeGreaterThan(
    w.draft.nodes[0].position.x,
  );
  const before = store.workflows();
  for (const layout of ['missing', 'elk', '', null]) {
    await expect(
      api.workflows.create({ name: 'Invalid', layout: layout as any }),
    ).rejects.toThrow();
    await expect(
      api.workflows.update({
        id: w.id,
        draftRevision: w.draftRevision,
        layout: layout as any,
      }),
    ).rejects.toThrow();
    await expect(
      api.workflows.edit({
        id: w.id,
        draftRevision: w.draftRevision,
        edits: [],
        layout: layout as any,
      }),
    ).rejects.toThrow();
    expect(store.workflows()).toEqual(before);
  }
  expect(
    await api.workflows.updateSummary({
      id: w.id,
      draft: stacked(),
      layout: 'tidy',
      draftRevision: w.draftRevision,
    }),
  ).not.toHaveProperty('draft');
});
