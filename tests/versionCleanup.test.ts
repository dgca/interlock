import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  blankDefinition,
  nodeSchema,
  briefingQuerySchema,
  resultQuerySchema,
} from '@interlock/core';
import { appRouter } from '../packages/server/src/router';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';
import {
  importSelection,
  inspectImportDocument,
} from '../packages/runtime/src/importSelection';

const stores: Store[] = [],
  engines: Engine[] = [];
function setup() {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  stores.push(store);
  engines.push(engine);
  return { store, engine, api: appRouter.createCaller({ engine }) };
}
afterEach(() => {
  vi.restoreAllMocks();
  engines.splice(0).forEach((e) => e.stop());
  stores.splice(0).forEach((s) => s.close());
});
function published(
  engine: Engine,
  name = 'Target',
  definition = blankDefinition(),
  owner?: string,
) {
  const w = engine.create(name, '', definition, owner);
  engine.publish(w.id);
  return w.id;
}
const ref = (workflowId: string, version = 1) => ({ workflowId, version });
function remove(
  engine: Engine,
  versions: { workflowId: string; version: number }[],
) {
  const preview = engine.versions.preview({ versions });
  return engine.versions.delete({
    versions,
    confirmation: preview.confirmation,
    acknowledgeHistoryLoss: true,
  });
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

it('validates the shared boundary, protects latest, and permits a valid obsolete control', async () => {
  const { engine, store, api } = setup();
  const id = published(engine);
  const before = state(store);
  for (const versions of [
    [],
    [ref(id, 0)],
    [ref('missing')],
    [ref(id), ref(id)],
  ])
    await expect(
      api.workflows.previewVersionDeletion({ versions }),
    ).rejects.toThrow();
  expect(
    engine.versions.preview({ versions: [ref(id)] }).blockers[0].kind,
  ).toBe('latest');
  expect(() => remove(engine, [ref(id)])).toThrow('Latest');
  expect(state(store)).toEqual(before);
  engine.publish(id);
  const p = await api.workflows.previewVersionDeletion({ versions: [ref(id)] });
  await expect(
    api.workflows.deleteVersions({
      versions: [ref(id)],
      confirmation: p.confirmation,
      acknowledgeHistoryLoss: false as true,
    }),
  ).rejects.toThrow();
  expect(store.getVersion(id, 1)).toBeDefined();
  expect(
    await api.workflows.deleteVersions({
      versions: [ref(id)],
      confirmation: p.confirmation,
      acknowledgeHistoryLoss: true,
    }),
  ).toMatchObject({ deleted: [ref(id)] });
  expect((await api.workflows.versions({ id })).map((v) => v.version)).toEqual([
    2,
  ]);
  expect(engine.publish(id).latestVersion).toBe(3);
});

it.each([
  'draft',
  'latest',
  'historical',
  'mixed',
  'archived',
  'owned',
] as const)(
  'identifies %s pins and requires explicit historical caller selection',
  (mode) => {
    const { engine, store } = setup();
    const owner = mode === 'owned' ? engine.create('Owner').id : undefined;
    const child = published(engine, 'Child', blankDefinition(), owner);
    engine.publish(child);
    const call = workflowCall(child, 'wait');
    const parent = owner ?? engine.create('Caller', '', call).id;
    if (owner)
      engine.update(parent, {
        draft: call,
        draftRevision: engine.workflow(parent).draftRevision,
      });
    if (mode !== 'draft') engine.publish(parent);
    if (['historical', 'mixed', 'owned'].includes(mode)) {
      engine.update(parent, {
        draft: blankDefinition(),
        draftRevision: engine.workflow(parent).draftRevision,
      });
      engine.publish(parent);
      if (mode === 'mixed')
        engine.update(parent, {
          draft: call,
          draftRevision: engine.workflow(parent).draftRevision,
        });
    }
    if (mode === 'archived') engine.update(parent, { archived: true });
    const p = engine.versions.preview({ versions: [ref(child)] });
    const refs = p.blockers.filter((b) => b.kind === 'reference');
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((b) => b.workflowId === parent && b.nodeId)).toBe(true);
    const before = state(store);
    expect(() => remove(engine, [ref(child)])).toThrow('pins');
    expect(state(store)).toEqual(before);
    if (mode === 'historical' || mode === 'owned') {
      remove(engine, [ref(child), ref(parent)]);
      expect(store.getVersion(child, 1)).toBeUndefined();
      expect(store.getVersion(parent, 1)).toBeUndefined();
      expect(store.getVersion(parent, 2)).toBeDefined();
    }
  },
);

it.each(['wait', 'batch', 'detached'] as const)(
  'protects transitive future %s invocations before they are dispatched',
  (mode) => {
    const { engine, store } = setup();
    const leaf = published(engine, 'Leaf');
    engine.publish(leaf);
    const middle = published(engine, 'Middle', workflowCall(leaf, 'wait'));
    engine.update(middle, {
      draft: blankDefinition(),
      draftRevision: engine.workflow(middle).draftRevision,
    });
    engine.publish(middle);
    const call = workflowCall(
      middle,
      mode === 'detached' ? 'detached' : 'wait',
    );
    const def = mode === 'batch' ? batchDefinition(call.nodes[1]) : call;
    const entry = def.nodes.find((n) => n.kind === 'entry')!;
    const edge = def.edges.find((e) => e.source === entry.id)!;
    const next = edge.target;
    def.nodes.push(
      nodeSchema.parse({
        id: 'pause',
        kind: 'agent',
        label: 'Before future call',
        prompt: 'Pause before dispatch.',
      }),
    );
    edge.target = 'pause';
    def.edges.push({
      id: 'future',
      source: 'pause',
      target: next,
      port: 'default',
    });
    const root = published(engine, 'Root', def);
    const run = engine.start(root, mode === 'batch' ? ['one'] : {}).run;
    expect(store.runs()).toHaveLength(1);
    // Select the historical root and middle versions so only active execution protects them.
    engine.update(root, {
      draft: blankDefinition(),
      draftRevision: engine.workflow(root).draftRevision,
    });
    engine.publish(root);
    const selection = [ref(root), ref(middle), ref(leaf)];
    const active = engine.versions
      .preview({ versions: selection })
      .blockers.filter((b) => b.kind === 'active_run');
    expect(active.map((b) => b.target.workflowId).sort()).toEqual(
      [root, middle, leaf].sort(),
    );
    expect(() => remove(engine, selection)).toThrow('Active run');
    engine.cancel(run.id);
    remove(engine, selection);
    expect(engine.inspect(run.id)).toMatchObject({
      definition: null,
      definitionAvailable: false,
    });
  },
);

it('protects an active detached child after its parent completes', () => {
  const { engine } = setup();
  const child = published(engine);
  engine.publish(child);
  const parent = published(
    engine,
    'Detached parent',
    workflowCall(child, 'detached'),
  );
  const result = engine.start(parent, {});
  expect(engine.run(result.run.id).status).toBe('completed');
  const detached = result.children[0];
  expect(detached.status).toBe('waiting');
  engine.update(parent, {
    draft: blankDefinition(),
    draftRevision: engine.workflow(parent).draftRevision,
  });
  engine.publish(parent);
  const versions = [ref(parent), ref(child)];
  expect(
    engine.versions
      .preview({ versions })
      .blockers.some((b) => b.runId === detached.id),
  ).toBe(true);
  engine.cancel(detached.id);
  remove(engine, versions);
  expect(engine.inspect(result.run.id).children[0].parentRunId).toBe(
    result.run.id,
  );
});

it('handles recursive dependencies without looping and still protects the selected version', () => {
  const { engine, store } = setup();
  const a = published(engine, 'A'),
    b = published(engine, 'B');
  const cycle = workflowCall(b, 'wait');
  store.version({
    workflowId: a,
    version: 1,
    definition: cycle,
    createdAt: new Date().toISOString(),
  });
  store.version({
    workflowId: b,
    version: 1,
    definition: workflowCall(a, 'wait'),
    createdAt: new Date().toISOString(),
  });
  // Existing persisted execution is the boundary under test; do not dispatch a recursive graph.
  const run = {
    id: 'cycle-run',
    workflowId: a,
    workflowName: 'A',
    version: 1,
    status: 'waiting',
    input: {},
    value: {},
    cursor: 'entry',
    executions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.put('runs', run);
  engine.publish(a);
  engine.publish(b);
  expect(
    engine.versions
      .preview({ versions: [ref(a), ref(b)] })
      .blockers.filter((b) => b.kind === 'active_run'),
  ).toHaveLength(2);
});

it('rejects changed impact and rolls back every definition and identity on a late write failure', () => {
  const { engine, store } = setup();
  const id = published(engine);
  engine.publish(id);
  engine.publish(id);
  const versions = [ref(id), ref(id, 2)];
  const p = engine.versions.preview({ versions });
  const run = engine.start(id, {}, 1).run;
  engine.cancel(run.id);
  let before = state(store);
  expect(() =>
    engine.versions.delete({
      versions,
      confirmation: p.confirmation,
      acknowledgeHistoryLoss: true,
    }),
  ).toThrow('impact changed');
  expect(state(store)).toEqual(before);
  const removeOriginal = store.remove.bind(store);
  let writes = 0;
  const failure = vi
    .spyOn(store, 'remove')
    .mockImplementation((collection, key) => {
      if (collection === 'versions' && ++writes === 2)
        throw new Error('injected deletion failure');
      removeOriginal(collection, key);
    });
  expect(() => remove(engine, versions)).toThrow('injected');
  expect(state(store)).toEqual(before);
  failure.mockRestore();
  remove(engine, versions);
  expect(store.listVersions(id).map((v) => v.version)).toEqual([3]);
  expect(engine.inspect(run.id).events).toEqual(before.events);
});

it('rejects a draft pin added after preview, including a changed selected set', () => {
  const { engine, store } = setup();
  const id = published(engine);
  engine.publish(id);
  engine.publish(id);
  const p = engine.versions.preview({ versions: [ref(id)] });
  const parent = engine.create('New draft', '', workflowCall(id, 'wait'));
  const before = state(store);
  expect(() =>
    engine.versions.delete({
      versions: [ref(id)],
      confirmation: p.confirmation,
      acknowledgeHistoryLoss: true,
    }),
  ).toThrow('impact changed');
  expect(() =>
    engine.versions.delete({
      versions: [ref(id, 2)],
      confirmation: p.confirmation,
      acknowledgeHistoryLoss: true,
    }),
  ).toThrow('impact changed');
  expect(state(store)).toEqual(before);
  engine.deleteWorkflow(parent.id);
  remove(engine, [ref(id)]);
});

it('keeps failed history and rejects deleted-version starts/retries without mutating records', () => {
  const { engine, store } = setup();
  const definition = blankDefinition();
  if (definition.nodes[1].kind === 'agent') definition.nodes[1].maxAttempts = 1;
  const id = published(engine, 'Failed history', definition);
  const run = engine.start(id, { input: 'kept' }).run;
  const work = engine.available(run.id)[0];
  const claim = engine.claim(work.id, {
    workerId: 'test',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.reportFailure(work.id, claim.token!, 'fail');
  expect(engine.run(run.id).status).toBe('failed');
  engine.publish(id);
  remove(engine, [ref(id)]);
  const before = state(store);
  const detail = engine.inspect(run.id);
  expect(detail.definition).toBeNull();
  expect(detail.run.input).toEqual({ input: 'kept' });
  expect(detail.work).toHaveLength(1);
  expect(detail.events.length).toBeGreaterThan(0);
  expect(
    engine.continuation.briefing(briefingQuerySchema.parse({ id: run.id })).run
      .definitionAvailable,
  ).toBe(false);
  expect(
    engine.continuation.result(
      resultQuerySchema.parse({ id: run.id, field: 'input' }),
    ).value,
  ).toEqual({ input: 'kept' });
  expect(() => engine.retry(run.id)).toThrow('explicit cleanup');
  expect(() => engine.start(id, {}, 1)).toThrow('explicit cleanup');
  expect(state(store)).toEqual(before);
});

it('keeps completed Batch history and reports unknown totals without its definition', () => {
  const { engine } = setup();
  const def = batchDefinition(
    nodeSchema.parse({
      id: 'echo',
      kind: 'agent',
      label: 'Echo',
      prompt: 'Return input.',
      batchId: 'batch',
    }),
  );
  const id = published(engine, 'Batch history', def);
  const root = engine.start(id, ['one', 'two']).run;
  for (const w of engine.available(root.id)) {
    const c = engine.claim(w.id, {
      workerId: 'test',
      freshContext: false,
      tools: [],
      skills: [],
    });
    engine.submit(w.id, c.token!, w.input);
  }
  expect(engine.run(root.id).status).toBe('completed');
  engine.publish(id);
  remove(engine, [ref(id)]);
  const detail = engine.inspect(root.id);
  expect(detail.run.output).toEqual(['one', 'two']);
  expect(detail.children).toHaveLength(2);
  const brief = engine.continuation.briefing(
    briefingQuerySchema.parse({ id: root.id }),
  );
  expect(brief.batches.items[0]).toMatchObject({
    total: null,
    queued: null,
    dispatched: 2,
    definitionAvailable: false,
  });
  expect(
    engine.continuation.result(resultQuerySchema.parse({ id: root.id })).value,
  ).toEqual(['one', 'two']);
});

it('transfers gaps and deletion identities, skips ordinary backup imports, and explicitly restores only original content', () => {
  const { engine, store } = setup(),
    target = setup();
  const id = published(engine);
  engine.publish(id);
  engine.publish(id);
  const backup = exportWorkflows(store, id);
  remove(engine, [ref(id), ref(id, 2)]);
  const clean = exportWorkflows(store, id);
  expect(clean.formatVersion).toBe(3);
  expect(clean.workflows[0].versions.map((v) => v.version)).toEqual([3]);
  expect(clean.workflows[0].deletedVersions).toHaveLength(2);
  importWorkflows(target.store, clean);
  expect(target.engine.publish(id).latestVersion).toBe(4);
  const skipped = importWorkflows(target.store, backup);
  expect(skipped.skippedVersions).toEqual([ref(id), ref(id, 2)]);
  expect(target.store.listVersions(id).map((v) => v.version)).toEqual([3, 4]);
  const wrong = structuredClone(backup);
  wrong.workflows[0].versions[0].definition.nodes[1].label = 'Changed content';
  const before = state(target.store);
  for (const restoreDeletedVersions of [false, true])
    expect(() =>
      importWorkflows(target.store, wrong, {
        force: true,
        restoreDeletedVersions,
      }),
    ).toThrow('identity conflict');
  expect(state(target.store)).toEqual(before);
  const reordered = JSON.parse(
    JSON.stringify(backup, (_k, v) =>
      v && !Array.isArray(v) && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).reverse())
        : v,
    ),
  );
  expect(
    importWorkflows(target.store, reordered, { restoreDeletedVersions: true })
      .restoredVersions,
  ).toEqual([ref(id), ref(id, 2)]);
  expect(target.store.listVersions(id).map((v) => v.version)).toEqual([
    1, 2, 3, 4,
  ]);
  expect(exportWorkflows(target.store, id).formatVersion).toBe(1);
});

it('rejects imported callers of skipped deleted dependencies and rolls back the entire bundle', () => {
  const { engine, store } = setup();
  const child = published(engine);
  engine.publish(child);
  const backupChild = exportWorkflows(store, child);
  remove(engine, [ref(child)]);
  const callerId = 'imported-caller';
  const call = workflowCall(child, 'wait');
  const bundle = structuredClone(backupChild);
  bundle.rootId = callerId;
  bundle.workflows.push({
    id: callerId,
    name: 'Caller',
    description: '',
    ownerWorkflowId: null,
    draft: call,
    draftRevision: 1,
    versions: [{ version: 1, definition: call }],
  });
  const before = state(store);
  expect(() => importWorkflows(store, bundle)).toThrow(
    'Missing published dependency',
  );
  expect(state(store)).toEqual(before);
  expect(
    importWorkflows(store, bundle, { restoreDeletedVersions: true })
      .restoredVersions,
  ).toEqual([ref(child)]);
  expect(store.getVersion(callerId, 1)).toBeDefined();
});

it('does not let imported cleanup metadata delete retained definitions or redefine version identity', () => {
  const source = setup(),
    target = setup();
  const id = published(source.engine);
  source.engine.publish(id);
  const backup = exportWorkflows(source.store, id);
  importWorkflows(target.store, backup);
  remove(source.engine, [ref(id)]);
  const clean = exportWorkflows(source.store, id);
  importWorkflows(target.store, clean);
  expect(target.store.getVersion(id, 1)).toBeDefined();
  expect(target.store.deletedVersion(id, 1)).toBeUndefined();
  clean.workflows[0].deletedVersions![0].definitionHash = '0'.repeat(64);
  const before = state(target.store);
  expect(() => importWorkflows(target.store, clean, { force: true })).toThrow(
    'identity conflict',
  );
  expect(state(target.store)).toEqual(before);
});

it('supports cleanup bundles through selected-file import without silently merging contradictory backups', () => {
  const source = setup(),
    target = setup();
  const id = published(source.engine);
  source.engine.publish(id);
  const backup = exportWorkflows(source.store, id);
  remove(source.engine, [ref(id)]);
  const clean = exportWorkflows(source.store, id);
  expect(inspectImportDocument(clean).document.kind).toBe('bundle');
  importSelection(target.engine, [clean]);
  expect(target.store.deletedVersion(id, 1)).toBeDefined();
  expect(importSelection(target.engine, [backup]).skippedVersions).toEqual([
    ref(id),
  ]);
  const before = state(target.store);
  expect(() => importSelection(target.engine, [clean, backup])).toThrow(
    'Selected files conflict for deleted version',
  );
  expect(() => importSelection(target.engine, [backup, clean])).toThrow(
    'Selected files conflict for deleted version',
  );
  expect(state(target.store)).toEqual(before);
});

it('transfers format-3 prompt dependencies and preserves captured historical guidance', () => {
  const source = setup(),
    target = setup();
  const prompt = source.engine.prompts.create({
    name: 'Guidance',
    content: 'Original captured instructions',
    description: '',
  });
  const def = blankDefinition();
  if (def.nodes[1].kind === 'agent') def.nodes[1].promptIds = [prompt.id];
  const id = published(source.engine, 'Prompt history', def);
  const run = source.engine.start(id, {}).run;
  source.engine.cancel(run.id);
  source.engine.publish(id);
  remove(source.engine, [ref(id)]);
  expect(source.engine.inspect(run.id).run.promptSnapshots).toEqual(
    run.promptSnapshots,
  );
  const bundle = exportWorkflows(source.store, id);
  expect(bundle.formatVersion).toBe(3);
  expect(bundle.prompts?.[0].content).toBe('Original captured instructions');
  importWorkflows(target.store, bundle);
  expect(target.engine.prompts.get(prompt.id).content).toBe(prompt.content);
});

it('rejects duplicate and unordered imported versions and mismatched restoration ownership', () => {
  const { engine, store } = setup();
  const id = published(engine);
  engine.publish(id);
  const backup = exportWorkflows(store, id);
  remove(engine, [ref(id)]);
  const before = state(store);
  const duplicate = structuredClone(backup);
  duplicate.workflows[0].versions.push(duplicate.workflows[0].versions[1]);
  const unordered = structuredClone(backup);
  unordered.workflows[0].versions.reverse();
  for (const invalid of [duplicate, unordered]) {
    expect(() =>
      importWorkflows(store, invalid, { restoreDeletedVersions: true }),
    ).toThrow('increasing order');
    expect(state(store)).toEqual(before);
  }
  const ownership = structuredClone(backup);
  const owner = engine.create('Owner');
  ownership.workflows[0].ownerWorkflowId = owner.id;
  const protectedState = state(store);
  expect(() =>
    importWorkflows(store, ownership, {
      force: true,
      restoreDeletedVersions: true,
    }),
  ).toThrow('Ownership conflict');
  expect(state(store)).toEqual(protectedState);
  expect(
    importWorkflows(store, backup, { restoreDeletedVersions: true })
      .restoredVersions,
  ).toEqual([ref(id)]);
});
