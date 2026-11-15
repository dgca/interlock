import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, type HarnessAdapter } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  nodeSchema,
  STARTED_RUN_SCHEMA,
  type Json,
  type Workflow,
  type WorkflowDefinition,
} from '@interlock/core';
import { appRouter } from '../packages/server/src/router';
import { batchDefinition } from './fixtures/batch';

let store: Store;
let engine: Engine;
let caller: ReturnType<typeof appRouter.createCaller>;
beforeEach(() => {
  store = new Store(':memory:');
  engine = new Engine(store, process.cwd());
  caller = appRouter.createCaller({ engine });
});
afterEach(async () => {
  await engine.executors.stop();
  engine.stop();
  store.close();
});
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
    { ...result.child, draftMatchesLatest: null },
  ]);
  expect(await caller.workflows.list()).toHaveLength(2);
  expect(await caller.workflows.get({ id: result.child.id })).toEqual({
    ...result.child,
    draftMatchesLatest: null,
  });
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

type Call = { profile: string; runId: string; attempt: number };
// Fake harnesses: they record each claim and return `output(call)`.
function harnesses(
  e: Engine,
  output: (call: Call) => Json | Promise<Json> = () => 1,
) {
  const calls: Call[] = [];
  const adapter = (id: 'codex' | 'claude-code'): HarnessAdapter => ({
    id,
    detect: () =>
      Promise.resolve({
        command: `/fake/${id}`,
        status: 'detected' as const,
        version: 'test',
      }),
    run: async (i) => {
      const call = {
        profile: i.profile.id,
        runId: i.work.runId,
        attempt: i.work.attempt,
      };
      calls.push(call);
      return { output: await output(call) };
    },
  });
  for (const id of ['codex', 'claude-code'] as const) {
    const { revision = 0, ...saved } = e.executors
      .profiles()
      .find((p) => p.id === id) ?? { id, harness: id, name: id };
    e.executors.saveProfile({
      ...saved,
      enabled: true,
      expectedRevision: revision,
    });
  }
  e.executors.start([adapter('codex'), adapter('claude-code')]);
  return calls;
}
function agentOnly(executor?: string, node: Record<string, unknown> = {}) {
  const d = blankDefinition();
  d.executor = executor;
  Object.assign(d.nodes[1], node);
  return definitionSchema.parse(d);
}
// Starts an owner whose Workflow node invokes `helper`: an owned child it waits
// for, a library workflow, or an owned child started with Start and continue.
function invoke(
  e: Engine,
  ownerExecutor: string | undefined,
  helper: WorkflowDefinition,
  link: 'owned' | 'library' | 'detached' = 'owned',
) {
  const owner = e.create('Owner');
  const child = e.create(
    'Helper',
    '',
    helper,
    link === 'library' ? null : owner.id,
  );
  e.publish(child.id);
  const draft = withReference(child.id, 1);
  if (link === 'detached')
    Object.assign(draft.nodes[1], {
      mode: 'detached',
      outputSchema: STARTED_RUN_SCHEMA,
    });
  draft.executor = ownerExecutor;
  e.update(owner.id, { draft, draftRevision: owner.draftRevision });
  e.publish(owner.id);
  return { owner, run: e.start(owner.id, [1]).run };
}
function retarget(e: Engine, ownerId: string, executor: string) {
  const owner = e.workflow(ownerId);
  e.update(ownerId, {
    draft: { ...owner.draft, executor },
    draftRevision: owner.draftRevision,
  });
}
const rootOf = (e: Engine, id: string): string => {
  const run = e.run(id);
  return run.parentRunId ? rootOf(e, run.parentRunId) : run.id;
};
const assignments = (e: Engine, root: string) =>
  e.store
    .work()
    .filter((w) => rootOf(e, w.runId) === root)
    .map((w) => [w.status, w.executor, w.executorSource]);
it('runs owned helpers without their own agent on the caller harness', async () => {
  const calls = harnesses(engine);
  // A helper of a helper cannot exist: only the owner may reference an owned
  // workflow, and owned workflows cannot own others. Batch items inside a
  // helper exercise the inheritance chain instead.
  // Comparison trees are excluded too; they are not covered here because a
  // comparison needs a full testbench suite.
  const cases = [
    ['inherits', 'codex', agentOnly(), 'owned', 'codex', 'caller'],
    [
      'keeps its own',
      'codex',
      agentOnly('claude-code'),
      'owned',
      'claude-code',
    ],
    ['explicit connected', 'codex', agentOnly(undefined, { executor: null })],
    ['independent', 'codex', agentOnly(), 'library'],
    ['detached start', 'codex', agentOnly(), 'detached'],
    [
      'batch items inherit',
      'codex',
      batchDefinition(),
      'owned',
      'codex',
      'caller',
    ],
    ['caller without agent', undefined, agentOnly()],
  ] as const;
  const runs = cases.map(
    ([, caller, helper, link = 'owned']) =>
      invoke(engine, caller, helper, link).run,
  );
  await vi.waitFor(() =>
    cases.forEach(([, , , , harness], i) => {
      if (harness)
        expect(engine.run(runs[i].id).status, cases[i][0]).toBe('completed');
    }),
  );
  cases.forEach(([name, , , , harness, source], i) => {
    expect(assignments(engine, runs[i].id), name).toEqual([
      harness
        ? ['completed', harness, source]
        : ['available', undefined, undefined],
    ]);
    expect(
      calls
        .filter((c) => rootOf(engine, c.runId) === runs[i].id)
        .map((c) => c.profile),
      name,
    ).toEqual(harness ? [harness] : []);
  });
});
it('keeps the captured caller harness through retries after the caller changes', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((r) => (release = r));
  const calls = harnesses(engine, async (call) => {
    if (call.attempt > 1) return 1;
    await blocked;
    return 'invalid';
  });
  const { owner, run } = invoke(
    engine,
    'codex',
    agentOnly(undefined, { outputSchema: { type: 'number' }, maxAttempts: 2 }),
  );
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  retarget(engine, owner.id, 'claude-code');
  engine.publish(owner.id);
  release();
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));
  expect(calls.map((c) => c.profile)).toEqual(['codex', 'codex']);
});
it('resolves the captured harness after a restart and leaves pre-upgrade helper runs connected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-helper-'));
  const file = join(dir, 'db.sqlite');
  try {
    const helper = agentOnly();
    helper.nodes.push(
      nodeSchema.parse({
        id: 'first',
        kind: 'agent',
        label: 'Connected first',
        prompt: 'Start.',
        executor: null,
      }),
    );
    helper.edges = [
      { id: 'e0', source: 'entry', target: 'first', port: 'default' },
      { id: 'e1', source: 'first', target: 'agent', port: 'default' },
      { id: 'e2', source: 'agent', target: 'exit', port: 'default' },
    ];
    let e = new Engine(new Store(file), process.cwd());
    const captured = invoke(e, 'codex', helper);
    const legacy = invoke(e, 'codex', helper);
    const legacyChild = e.store
      .runs()
      .find((r) => r.parentRunId === legacy.run.id)!;
    expect(legacyChild.callerExecutor).toBe('codex');
    delete legacyChild.callerExecutor;
    e.store.put('runs', legacyChild);
    retarget(e, captured.owner.id, 'claude-code');
    e.publish(captured.owner.id);
    e.stop();
    e.store.close();
    e = new Engine(new Store(file), process.cwd());
    try {
      const calls = harnesses(e);
      for (const { run } of [captured, legacy]) {
        const [first] = e.available(rootOf(e, run.id));
        const claim = e.claim(first.id, {
          workerId: 'external',
          freshContext: false,
          tools: [],
          skills: [],
        });
        e.submit(first.id, claim.token!, 1);
      }
      await vi.waitFor(() =>
        expect(e.run(captured.run.id).status).toBe('completed'),
      );
      expect(calls.map((c) => c.profile)).toEqual(['codex']);
      expect(assignments(e, legacy.run.id).at(-1)).toEqual([
        'available',
        undefined,
        undefined,
      ]);
    } finally {
      await e.executors.stop();
      e.stop();
      e.store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
