import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  type Json,
  type WorkflowDefinition,
} from '@interlock/core';
import { batchDefinition, nestedBatches } from './fixtures/batch';

const engines: Engine[] = [];
const dirs: string[] = [];
const worker = {
  workerId: 'version-test',
  freshContext: false,
  tools: [],
  skills: [],
};
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  engines.splice(0).forEach((e) => {
    e.stop();
    e.store.close();
  });
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
function definition() {
  const d = blankDefinition();
  d.nodes.splice(
    2,
    0,
    nodeSchema.parse({
      id: 'next',
      kind: 'agent',
      label: 'Next',
      prompt: 'Old next instructions',
    }),
  );
  d.edges.find((edge) => edge.source === 'agent')!.target = 'next';
  d.edges.push({
    id: 'next-exit',
    source: 'next',
    target: 'exit',
    port: 'default',
  });
  return d;
}
function publish(e: Engine, d = definition()) {
  const w = e.create('Versioned', '', d);
  e.publish(w.id);
  return w.id;
}
function newer(
  e: Engine,
  id: string,
  mutate: (d: WorkflowDefinition) => void = () => {},
) {
  const w = e.workflow(id),
    d = structuredClone(w.draft);
  mutate(d);
  e.update(id, { draft: d, draftRevision: w.draftRevision });
  return e.publish(id).latestVersion;
}
function complete(e: Engine, runId: string, output: Json = {}) {
  const work = e.claim(e.available(runId)[0].id, worker);
  e.submit(work.id, work.token!, output);
  return work;
}
function policy(
  e: Engine,
  runId: string,
  value: 'pinned' | 'latest-compatible' = 'latest-compatible',
) {
  return e.runVersions.setPolicy({
    runId,
    policy: value,
    expectedRevision: e.runVersions.read({ runId }).revision,
  });
}
function boundary(e: Engine, runId: string, output: Json = {}) {
  const work = e.claim(e.available(runId)[0].id, worker);
  const hold = e.pauses.create({
    target: { scope: 'library' },
    actor: 'test',
    reason: 'Inspect next boundary',
  });
  e.submit(work.id, work.token!, output);
  expect(e.run(runId).cursor).toBe('next');
  return hold;
}
function move(
  e: Engine,
  runId: string,
  version: number,
  recapturePrompts = false,
) {
  const preview = e.runVersions.preview({ runId, version, recapturePrompts });
  expect(preview.blockers).toEqual([]);
  return e.runVersions.apply({
    runId,
    version,
    recapturePrompts,
    confirmation: preview.confirmation,
    reason: 'Published fix',
  });
}
function protectedState(e: Engine) {
  return Object.fromEntries(
    [
      'runs',
      'work',
      'events',
      'contextGroups',
      'contextEvents',
      'runBudgets',
      'runChains',
      'runVersionEvents',
    ].map((c) => [c, e.store.list(c)]),
  );
}

it('keeps defaults pinned while opt-in upgrades use the new next-step config and record execution versions', () => {
  const e = setup(),
    id = publish(e),
    pinned = e.start(id, {}).run;
  const opted = e.start(id, {}, undefined, undefined, {
    versionPolicy: 'latest-compatible',
  }).run;
  newer(e, id, (d) => {
    const n = d.nodes.find((n) => n.id === 'next')!;
    if (n.kind === 'agent') n.prompt = 'Published fix';
  });
  complete(e, pinned.id);
  complete(e, opted.id);
  expect(e.run(pinned.id).version).toBe(1);
  expect(e.available(pinned.id)[0].prompt).toBe('Old next instructions');
  expect(e.run(opted.id).version).toBe(2);
  expect(e.available(opted.id)[0].prompt).toBe('Published fix');
  expect(e.run(opted.id).executions.map((x) => x.version)).toEqual([1, 1, 2]);
  expect(e.runVersions.read({ runId: opted.id }).history.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fromVersion: 1,
        toVersion: 2,
        reason: expect.any(String),
        at: expect.any(String),
      }),
    ]),
  );
});

it('preserves available and claimed assignments, then upgrades only after their captured result and route finish', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  const available = structuredClone(e.available(run.id)[0]);
  newer(e, id, (d) => {
    const n = d.nodes.find((n) => n.id === 'agent')!;
    if (n.kind === 'agent') {
      n.prompt = 'Replacement';
      n.outputSchema = { type: 'string' };
    }
    d.edges.find((x) => x.source === 'entry')!.target = 'next';
    d.edges.find((x) => x.source === 'agent')!.target = 'exit';
    d.edges.find((x) => x.source === 'next')!.target = 'agent';
  });
  policy(e, run.id);
  expect(e.available(run.id)[0]).toEqual(available);
  expect(e.runVersions.preview({ runId: run.id, version: 2 })).toMatchObject({
    canApply: false,
    blockers: expect.arrayContaining([
      expect.stringMatching(/execut|boundary|active/i),
    ]),
  });
  const claim = e.claim(available.id, worker);
  const captured = structuredClone(e.store.work(undefined, run.id)[0]);
  policy(e, run.id, 'pinned');
  policy(e, run.id);
  expect(e.store.work(undefined, run.id)[0]).toEqual(captured);
  e.submit(claim.id, claim.token!, { capturedContract: true });
  expect(e.run(run.id).version).toBe(2);
  expect(e.run(run.id).cursor).toBe('next');
  expect(e.available(run.id)[0].nodeId).toBe('next');
});

it('stays on the old path when a newer version removes the next node, then upgrades at a shared node', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  policy(e, run.id);
  newer(e, id, (d) => {
    d.nodes = d.nodes.filter((n) => n.id !== 'next');
    d.edges = d.edges.filter((x) => x.source !== 'next');
    d.edges.find((x) => x.source === 'agent')!.target = 'exit';
  });
  complete(e, run.id);
  expect(e.run(run.id).version).toBe(1);
  expect(e.runVersions.read({ runId: run.id }).blocker).toBeDefined();
  complete(e, run.id);
  expect(e.run(run.id)).toMatchObject({ version: 2, status: 'completed' });
});

it('validates resolved next-node bindings before moving and exposes a compatibility blocker', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  policy(e, run.id);
  newer(e, id, (d) => {
    const n = d.nodes.find((n) => n.id === 'next')!;
    n.inputBindings = { value: { source: 'input', path: 'value' } };
    n.inputSchema = {
      type: 'object',
      properties: { value: { type: 'number' } },
      required: ['value'],
    };
  });
  complete(e, run.id, { value: 'wrong' });
  expect(e.run(run.id).version).toBe(1);
  expect(e.runVersions.read({ runId: run.id }).blocker).toBeDefined();
  const control = e.start(id, {}, 1).run;
  boundary(e, control.id, { value: 42 });
  expect(
    e.runVersions.preview({ runId: control.id, version: 2 }),
  ).toMatchObject({ canApply: true, blockers: [] });
});

it('rejects stale preview confirmations and stale policy writes without changing protected state', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  newer(e, id);
  boundary(e, run.id);
  const preview = e.runVersions.preview({ runId: run.id, version: 2 });
  policy(e, run.id);
  const before = protectedState(e);
  expect(() =>
    e.runVersions.setPolicy({
      runId: run.id,
      policy: 'pinned',
      expectedRevision: 0,
    }),
  ).toThrow();
  expect(() =>
    e.runVersions.apply({
      runId: run.id,
      version: 2,
      confirmation: preview.confirmation,
      reason: 'Fix',
    }),
  ).toThrow();
  expect(protectedState(e)).toEqual(before);
  move(e, run.id, 2);
  expect(e.run(run.id).version).toBe(2);
});

it('rolls back a failed upgrade write and retains the same preview for a successful retry', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  newer(e, id);
  boundary(e, run.id);
  const preview = e.runVersions.preview({ runId: run.id, version: 2 }),
    before = protectedState(e);
  const put = e.store.put.bind(e.store);
  const spy = vi
    .spyOn(e.store, 'put')
    .mockImplementation((collection, value: any) => {
      if (collection === 'runs' && value.id === run.id && value.version === 2)
        throw new Error('injected upgrade write failure');
      return put(collection, value);
    });
  expect(() =>
    e.runVersions.apply({
      runId: run.id,
      version: 2,
      confirmation: preview.confirmation,
      reason: 'Fix',
    }),
  ).toThrow('injected');
  expect(protectedState(e)).toEqual(before);
  spy.mockRestore();
  e.runVersions.apply({
    runId: run.id,
    version: 2,
    confirmation: preview.confirmation,
    reason: 'Fix',
  });
  expect(e.run(run.id).version).toBe(2);
});

it('preserves saved prompts by default and explicitly recaptures exact publish-pinned revisions', () => {
  const e = setup(),
    d = definition();
  const p = e.prompts.create({
    name: 'Guidance',
    description: '',
    content: 'Original',
  });
  for (const n of d.nodes) if (n.kind === 'agent') n.promptIds = [p.id];
  const id = publish(e, d),
    keep = e.start(id, {}).run,
    refresh = e.start(id, {}).run;
  e.prompts.update(p.id, 1, { ...p, content: 'Published prompt' });
  newer(e, id, (d) => {
    d.pinPromptsAtPublish = true;
  });
  e.prompts.update(p.id, 2, { ...p, content: 'Later prompt' });
  const hold = boundary(e, keep.id);
  move(e, keep.id, 2);
  e.pauses.resume(hold.id);
  boundary(e, refresh.id);
  move(e, refresh.id, 2, true);
  expect(e.run(keep.id).promptSnapshots).toEqual(keep.promptSnapshots);
  expect(
    e.run(refresh.id).promptSnapshots?.map((p) => [p.revision, p.content]),
  ).toEqual([[2, 'Published prompt']]);
});

it('blocks uncaptured new saved prompt references until explicit recapture is requested', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  const p = e.prompts.create({
    name: 'New guidance',
    description: '',
    content: 'New instructions',
  });
  newer(e, id, (d) => {
    const n = d.nodes.find((n) => n.id === 'next')!;
    if (n.kind === 'agent') n.promptIds = [p.id];
  });
  boundary(e, run.id);
  expect(e.runVersions.preview({ runId: run.id, version: 2 })).toMatchObject({
    canApply: false,
    blockers: expect.arrayContaining([expect.stringMatching(/prompt/i)]),
  });
  move(e, run.id, 2, true);
  expect(e.run(run.id).promptSnapshots?.[0].id).toBe(p.id);
});

it('keeps continuity session bindings and budget consumption across a move', () => {
  const e = setup(),
    d = definition();
  for (const n of d.nodes)
    if (n.kind === 'agent') n.context.continuityGroup = 'author';
  const id = publish(e, d),
    run = e.start(id, {}, undefined, {
      scope: 'run',
      unknownUsage: 'allow',
      limits: { claims: { max: 1 } },
    }).run;
  const session = { executorId: 'test', sessionId: 'same-session' };
  const claim = e.claim(e.available(run.id)[0].id, { ...worker, session });
  newer(e, id);
  policy(e, run.id);
  const binding = e.contextGroups.describe(run.id, 'author');
  e.submit(claim.id, claim.token!, {});
  expect(e.run(run.id).version).toBe(2);
  expect(e.contextGroups.describe(run.id, 'author')).toEqual(binding);
  expect(e.available(run.id)).toEqual([]);
  expect(e.budgets.read(run.id).governing[0]).toMatchObject({
    attempts: 1,
    state: 'blocked',
  });
  e.budgets.set({ runId: run.id, expectedRevision: 1, budget: null });
  expect(() =>
    e.claim(e.available(run.id)[0].id, {
      ...worker,
      session: { ...session, sessionId: 'other' },
    }),
  ).toThrow(/session/i);
  expect(
    e.claim(e.available(run.id)[0].id, { ...worker, session }).continuity
      ?.session,
  ).toEqual(session);
});

it.each(['wait', 'detached'] as const)(
  'keeps already-dispatched %s children independent while future calls use the upgraded parent pin',
  (mode) => {
    const e = setup(),
      child = publish(e, blankDefinition()),
      d = definition();
    const call = nodeSchema.parse({
      id: 'call',
      kind: 'workflow',
      label: 'Call child',
      workflowId: child,
      version: 1,
      mode,
    });
    d.nodes.splice(1, 0, call);
    d.edges.find((x) => x.source === 'entry')!.target = 'call';
    d.edges.push({
      id: 'call-agent',
      source: 'call',
      target: 'agent',
      port: 'default',
    });
    const agent = d.nodes.find((n) => n.id === 'agent')!;
    agent.routing = {
      path: 'again',
      cases: [{ port: 'again', equals: true }],
      default: 'done',
    };
    const out = d.edges.find((x) => x.source === 'agent')!;
    out.port = 'done';
    d.edges.push({
      id: 'repeat',
      source: 'agent',
      target: 'call',
      port: 'again',
    });
    const parent = publish(e, d),
      run = e.start(parent, {}).run;
    const firstChild = e.store.runs().find((r) => r.parentRunId === run.id)!;
    newer(e, child);
    newer(e, parent, (d) => {
      const n = d.nodes.find((n) => n.id === 'call')!;
      if (n.kind === 'workflow') n.version = 2;
    });
    policy(e, run.id);
    expect(e.run(firstChild.id).version).toBe(1);
    if (mode === 'wait') {
      expect(
        e.runVersions.preview({ runId: run.id, version: 2 }).canApply,
      ).toBe(false);
      complete(e, firstChild.id);
    }
    const ownWork = e.available(run.id).find((w) => w.runId === run.id)!;
    const claim = e.claim(ownWork.id, worker);
    e.submit(claim.id, claim.token!, { again: true });
    const children = e.store.runs().filter((r) => r.parentRunId === run.id);
    expect(children).toHaveLength(2);
    expect(children.map((r) => r.version)).toEqual([1, 2]);
    expect(e.run(firstChild.id).version).toBe(1);
    expect(e.run(children[1].id).versionPolicy ?? 'pinned').toBe('pinned');
  },
);

it('keeps active Batch parent stable while newly dispatched items inherit policy and upgrade independently', () => {
  const e = setup(),
    d = batchDefinition(undefined, { concurrency: 1 }),
    id = publish(e, d);
  const run = e.start(id, [1, 2]).run;
  newer(e, id, (d) => {
    const n = d.nodes.find((n) => n.kind === 'agent')!;
    if (n.kind === 'agent') n.prompt = 'New item';
  });
  policy(e, run.id);
  expect(e.runVersions.preview({ runId: run.id, version: 2 }).canApply).toBe(
    false,
  );
  const first = e.available(run.id)[0];
  expect(first.prompt).not.toBe('New item');
  complete(e, first.runId, 10);
  const second = e.available(run.id)[0];
  expect(second.runId).not.toBe(first.runId);
  expect(e.run(run.id).version).toBe(1);
  expect(e.run(second.runId).version).toBe(2);
  expect(second.prompt).toBe('New item');
  complete(e, second.runId, 20);
  expect(e.run(run.id)).toMatchObject({
    version: 2,
    output: [10, 20],
    status: 'completed',
  });
});

it('continues from the upgraded version without resetting chain caps or prompt capture', () => {
  const e = setup(),
    d = definition();
  d.nodes = d.nodes.map((n) =>
    n.kind === 'exit'
      ? nodeSchema.parse({ ...n, continueAsNew: { maxRuns: 2 } })
      : n,
  );
  const id = publish(e, d),
    run = e.start(id, {}, undefined, undefined, {
      versionPolicy: 'latest-compatible',
    }).run;
  newer(e, id);
  complete(e, run.id);
  complete(e, run.id, { checkpoint: 1 });
  const next = e.run(e.run(run.id).chain!.nextRunId!);
  expect(next).toMatchObject({
    version: 2,
    versionPolicy: 'latest-compatible',
    input: { checkpoint: 1 },
  });
  expect(next.promptSnapshots).toEqual(run.promptSnapshots);
  expect(e.inspect(run.id).chain).toMatchObject({ maxRuns: 2, runCount: 2 });
});

it('rejects upgrades that change continue-as-new limits and leaves the old chain usable', () => {
  const e = setup(),
    d = definition();
  d.nodes = d.nodes.map((n) =>
    n.kind === 'exit'
      ? nodeSchema.parse({ ...n, continueAsNew: { maxRuns: 2 } })
      : n,
  );
  const id = publish(e, d),
    run = e.start(id, {}).run;
  newer(e, id, (d) => {
    d.nodes = d.nodes.map((n) =>
      n.kind === 'exit'
        ? nodeSchema.parse({ ...n, continueAsNew: { maxRuns: 3 } })
        : n,
    );
  });
  boundary(e, run.id);
  expect(e.runVersions.preview({ runId: run.id, version: 2 })).toMatchObject({
    canApply: false,
    blockers: expect.arrayContaining([expect.stringMatching(/chain|continu/i)]),
  });
  expect(e.inspect(run.id).chain?.maxRuns).toBe(2);
});

it.each(['swap', 'add', 'remove'] as const)(
  'rejects a same-cap %s of continuing Exit settings and preserves the original exit behavior',
  (change) => {
    const e = setup(),
      d = definition();
    d.nodes.push(
      nodeSchema.parse({
        id: 'choose',
        kind: 'switch',
        label: 'Choose',
        path: 'again',
        cases: [{ port: 'again', equals: true }],
        default: 'done',
      }),
      nodeSchema.parse({
        id: 'continue',
        kind: 'exit',
        label: 'Continue',
        continueAsNew: { maxRuns: 2 },
      }),
    );
    d.edges.find((edge) => edge.source === 'entry')!.target = 'choose';
    d.edges.push(
      { id: 'again', source: 'choose', port: 'again', target: 'continue' },
      { id: 'done', source: 'choose', port: 'done', target: 'agent' },
    );
    if (change === 'remove') {
      const exit = d.nodes.find((node) => node.id === 'exit')!;
      if (exit.kind === 'exit') exit.continueAsNew = { maxRuns: 2 };
    }
    const prompt = e.prompts.create({
      name: 'Chain capture',
      description: '',
      content: 'Original chain instructions',
    });
    for (const node of d.nodes)
      if (node.kind === 'agent') node.promptIds = [prompt.id];
    const id = publish(e, d),
      run = e.start(id, { again: false }).run;
    e.prompts.update(prompt.id, 1, {
      ...prompt,
      content: 'Later chain instructions',
    });
    newer(e, id, (target) => {
      for (const node of target.nodes) {
        if (node.kind !== 'exit') continue;
        if (node.id === 'exit') {
          if (change === 'remove') delete node.continueAsNew;
          else node.continueAsNew = { maxRuns: 2 };
        }
        if (node.id === 'continue' && change === 'swap')
          delete node.continueAsNew;
      }
    });
    complete(e, run.id, { again: false });
    const work = e.claim(e.available(run.id)[0].id, worker);
    policy(e, run.id);
    const hold = e.pauses.create({
      target: { scope: 'library' },
      actor: 'test',
      reason: 'Exit boundary',
    });
    e.submit(work.id, work.token!, { again: false });
    expect(e.run(run.id).cursor).toBe('exit');
    const before = protectedState(e),
      preview = e.runVersions.preview({ runId: run.id, version: 2 });
    expect(preview).toMatchObject({
      canApply: false,
      blockers: ['Continue-as-new configuration must remain unchanged'],
    });
    expect(protectedState(e)).toEqual(before);
    expect(() =>
      e.runVersions.apply({
        runId: run.id,
        version: 2,
        confirmation: preview.confirmation,
        reason: 'Changed Exit selection',
      }),
    ).toThrow(/Continue-as-new configuration/);
    expect(protectedState(e)).toEqual(before);
    e.pauses.resume(hold.id);
    e.pump();
    const finished = e.run(run.id);
    expect(finished.version).toBe(1);
    expect(finished.versionRevision).toBe(1);
    expect(finished.promptSnapshots).toEqual(run.promptSnapshots);
    expect(finished.promptSnapshots?.[0].revision).toBe(1);
    expect(finished.versionChanges ?? []).toEqual([]);
    expect(finished.versionBlocker?.reasons).toEqual([
      'Continue-as-new configuration must remain unchanged',
    ]);
    expect(finished.status).toBe('completed');
    expect(Boolean(finished.chain?.nextRunId)).toBe(change === 'remove');
    expect(e.inspect(run.id).chain?.maxRuns).toBe(2);
    if (finished.chain?.nextRunId) {
      const successor = e.run(finished.chain.nextRunId);
      expect(successor).toMatchObject({
        version: 1,
        versionPolicy: 'latest-compatible',
        chain: { index: 2, previousRunId: run.id },
      });
      expect(successor.promptSnapshots).toEqual(run.promptSnapshots);
      expect(e.inspect(run.id).chain?.runCount).toBe(2);
    } else {
      expect(e.store.runs()).toHaveLength(1);
      expect(e.inspect(run.id).chain?.runCount).toBe(1);
    }
  },
);

it('allows unchanged continuing Exit settings in a different declaration order and keeps normal termination', () => {
  const e = setup(),
    d = definition();
  d.nodes.push(
    nodeSchema.parse({
      id: 'choose',
      kind: 'switch',
      label: 'Choose',
      path: 'again',
      cases: [{ port: 'again', equals: true }],
      default: 'done',
    }),
    nodeSchema.parse({
      id: 'continue',
      kind: 'exit',
      label: 'Continue',
      continueAsNew: { maxRuns: 2 },
    }),
  );
  d.edges.find((edge) => edge.source === 'entry')!.target = 'choose';
  d.edges.push(
    { id: 'again', source: 'choose', port: 'again', target: 'continue' },
    { id: 'done', source: 'choose', port: 'done', target: 'agent' },
  );
  const id = publish(e, d),
    run = e.start(id, { again: false }).run;
  newer(e, id, (target) => target.nodes.reverse());
  const hold = boundary(e, run.id, { again: false });
  move(e, run.id, 2);
  e.pauses.resume(hold.id);
  complete(e, run.id, { again: false });
  expect(e.run(run.id)).toMatchObject({
    version: 2,
    status: 'completed',
    output: { again: false },
  });
  expect(e.run(run.id).chain?.nextRunId).toBeUndefined();
  expect(e.inspect(run.id).chain).toMatchObject({ maxRuns: 2, runCount: 1 });
});

it('protects the current binding for cleanup and permits obsolete execution definitions after a move', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  newer(e, id);
  boundary(e, run.id);
  const old = { workflowId: id, version: 1 };
  expect(e.versions.preview({ versions: [old] }).blockers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'active_run', runId: run.id }),
    ]),
  );
  move(e, run.id, 2);
  const preview = e.versions.preview({ versions: [old] });
  expect(preview.canDelete).toBe(true);
  expect(preview.affectedRuns).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        runId: run.id,
        executionVersions: [1],
        currentDefinitionDeleted: false,
      }),
    ]),
  );
  e.versions.delete({
    versions: [old],
    confirmation: preview.confirmation,
    acknowledgeHistoryLoss: true,
  });
  expect(e.run(run.id).version).toBe(2);
  expect(e.run(run.id).executions.filter((x) => x.version === 1)).toHaveLength(
    2,
  );
  expect(e.inspect(run.id).definitionAvailable).toBe(true);
});

it('requires uncaptured variables and model aliases to be supplied by a new run, even with prompt recapture', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  const variable = e.variables.mutate({
    action: 'create',
    kind: 'config',
    name: 'upgrade_config',
    value: 'test-only',
  }) as import('@interlock/core').SavedVariable;
  e.modelAliases.mutate({
    action: 'create',
    name: 'upgrade_builder',
    candidates: [{ model: 'test-model' }],
  });
  newer(e, id, (d) => {
    d.nodes = d.nodes.map((n) =>
      n.id === 'next'
        ? nodeSchema.parse({
            id: 'next',
            kind: 'script',
            label: 'Use new capture',
            language: 'javascript',
            command: 'return input;',
            environment: [{ name: 'TEST_CONFIG', variableId: variable.id }],
          })
        : n,
    );
    d.agentModel = 'upgrade_builder';
  });
  boundary(e, run.id);
  const before = protectedState(e);
  for (const recapturePrompts of [false, true]) {
    const p = e.runVersions.preview({
      runId: run.id,
      version: 2,
      recapturePrompts,
    });
    expect(p.canApply).toBe(false);
    expect(p.blockers.join(' ')).toMatch(/Variable capture/);
  }
  expect(protectedState(e)).toEqual(before);
  // Remove the missing variable from a later target to reach the alias check itself.
  newer(e, id, (d) => {
    d.nodes.find((n) => n.id === 'next')!.kind === 'script' &&
      delete (d.nodes.find((n) => n.id === 'next') as any).environment;
  });
  expect(
    e.runVersions.preview({ runId: run.id, version: 3 }).blockers.join(' '),
  ).toMatch(/Model alias capture/);
  const fresh = e.start(id, {}, 2).run;
  expect(fresh.variableCaptures?.[0].referenceId).toBe(variable.id);
  expect(fresh.modelAliasCaptures?.[0].name).toBe('upgrade_builder');
});

it('keeps the exact protected variable and alias captures when existing references remain compatible', () => {
  const e = setup(),
    d = definition();
  const variable = e.variables.mutate({
    action: 'create',
    kind: 'config',
    name: 'original_config',
    value: 'original',
  }) as import('@interlock/core').SavedVariable;
  const alias = e.modelAliases.mutate({
    action: 'create',
    name: 'original_builder',
    candidates: [{ model: 'original-model' }],
  }) as import('@interlock/core').SavedModelAlias;
  d.agentModel = alias.name;
  d.nodes = d.nodes.map((n) =>
    n.id === 'next'
      ? nodeSchema.parse({
          id: 'next',
          kind: 'script',
          label: 'Captured configuration',
          language: 'javascript',
          command: 'return input;',
          environment: [{ name: 'TEST_CONFIG', variableId: variable.id }],
        })
      : n,
  );
  const id = publish(e, d),
    run = e.start(id, {}).run;
  e.variables.mutate({
    action: 'update',
    id: variable.id,
    expectedRevision: 1,
    value: 'replacement',
  });
  e.modelAliases.mutate({
    action: 'update',
    id: alias.id,
    expectedRevision: 1,
    candidates: [{ model: 'replacement-model' }],
  });
  newer(e, id);
  boundary(e, run.id);
  move(e, run.id, 2);
  expect(e.run(run.id).variableCaptures).toEqual(run.variableCaptures);
  expect(e.run(run.id).modelAliasCaptures).toEqual(run.modelAliasCaptures);
});

it('includes explicit version policy in start-request identity and keeps receipt replays read-only', () => {
  const e = setup(),
    id = publish(e),
    options = {
      requestId: 'policy-receipt',
      versionPolicy: 'latest-compatible' as const,
    };
  const run = e.start(id, {}, undefined, undefined, options).run;
  newer(e, id);
  const before = protectedState(e);
  expect(e.start(id, {}, undefined, undefined, options).run.id).toBe(run.id);
  expect(protectedState(e)).toEqual(before);
  for (const versionPolicy of [undefined, 'pinned'] as const) {
    expect(() =>
      e.start(id, {}, undefined, undefined, { ...options, versionPolicy }),
    ).toThrow(/different arguments/);
    expect(protectedState(e)).toEqual(before);
  }
});

it('retains moved versions, execution attribution, policy, and history across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-upgrade-'));
  dirs.push(dir);
  const path = join(dir, 'test.db'),
    e = setup(path),
    id = publish(e),
    run = e.start(id, {}).run;
  newer(e, id);
  boundary(e, run.id);
  policy(e, run.id);
  move(e, run.id, 2);
  const expected = e.runVersions.read({ runId: run.id });
  e.stop();
  e.store.close();
  engines.pop();
  const resumed = setup(path);
  resumed.pump();
  expect(resumed.runVersions.read({ runId: run.id })).toEqual(expected);
  expect(resumed.run(run.id).executions.map((x) => x.version)).toEqual([1, 1]);
  expect(resumed.run(run.id).versionPolicy).toBe('latest-compatible');
  expect(resumed.run(run.id).cursor).toBe('next');
});

it('pages history without returning definitions, captures, prompts, or execution bodies', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  boundary(e, run.id);
  for (let version = 2; version <= 24; version++) {
    newer(e, id);
    move(e, run.id, version);
  }
  const first = e.runVersions.read({ runId: run.id }),
    second = e.runVersions.read({ runId: run.id, offset: 20, limit: 100 });
  expect(first.history).toMatchObject({ total: 23, truncated: true });
  expect(first.history.items).toHaveLength(20);
  expect(first.history.items[0]).toMatchObject({
    fromVersion: 23,
    toVersion: 24,
  });
  expect(second.history).toMatchObject({ total: 23, truncated: false });
  expect(second.history.items.map((x) => x.toVersion)).toEqual([4, 3, 2]);
  expect(Object.keys(first).sort()).toEqual([
    'history',
    'policy',
    'revision',
    'runId',
    'version',
  ]);
  expect(Object.keys(first.history.items[0]).sort()).toEqual([
    'at',
    'fromVersion',
    'reason',
    'recapturePrompts',
    'toVersion',
  ]);
  expect(() => e.runVersions.read({ runId: run.id, limit: 101 })).toThrow();
});

it('keeps live comparison samples bound to their selected published side', () => {
  const e = setup(),
    id = publish(e);
  newer(e, id);
  const suite = e.testbench.createSuite({
    workflowId: id,
    content: {
      name: 'Upgrade comparison',
      cases: [{ id: 'case', name: 'Case', input: {}, assertions: [] }],
    },
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: 1,
    candidateVersion: 2,
    concurrency: 2,
    repetitions: 1,
  };
  const preview = e.testbench.preview(selection);
  const comparison = e.testbench.start({
    ...selection,
    confirmation: preview.confirmation,
    requestId: 'upgrade-comparison',
  });
  e.pump();
  const samples = e.store
    .runs()
    .filter((r) => r.comparison?.comparisonId === comparison.id);
  expect(samples).toHaveLength(2);
  newer(e, id);
  for (const sample of samples) {
    const before = protectedState(e);
    expect(() => policy(e, sample.id)).toThrow(/comparison/i);
    expect(
      e.runVersions.preview({ runId: sample.id, version: 3 }),
    ).toMatchObject({
      canApply: false,
      blockers: expect.arrayContaining([expect.stringMatching(/comparison/i)]),
    });
    expect(protectedState(e)).toEqual(before);
  }
});

it('lets an active Wait finish its original deadline and outgoing route before an upgrade', () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-11-07T00:00:00Z');
  const e = setup(),
    d = definition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'wait',
    label: 'Original wait',
    timing: { kind: 'duration', ms: 1000 },
  });
  const id = publish(e, d),
    run = e.start(id, {}).run;
  newer(e, id, (d) => {
    d.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'wait',
      label: 'New wait',
      timing: { kind: 'duration', ms: 60000 },
    });
    d.edges.find((x) => x.source === 'entry')!.target = 'next';
    d.edges.find((x) => x.source === 'agent')!.target = 'exit';
    d.edges.find((x) => x.source === 'next')!.target = 'agent';
  });
  policy(e, run.id);
  const waiting = structuredClone(e.run(run.id).executions.at(-1));
  expect(e.runVersions.preview({ runId: run.id, version: 2 }).canApply).toBe(
    false,
  );
  e.pump();
  expect(e.run(run.id).executions.at(-1)).toEqual(waiting);
  vi.setSystemTime('2026-11-07T00:00:01Z');
  e.pump();
  expect(e.run(run.id).version).toBe(2);
  expect(e.run(run.id).cursor).toBe('next');
  expect(e.run(run.id).executions.find((x) => x.kind === 'wait')).toMatchObject(
    { version: 1, completedAt: '2026-11-07T00:00:01.000Z' },
  );
  expect(e.available(run.id)[0].nodeId).toBe('next');
});

it('stamps legacy executions before a move so their original version survives cleanup and inspection', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  newer(e, id);
  boundary(e, run.id);
  const old = e.run(run.id);
  for (const execution of old.executions) delete execution.version;
  e.store.put('runs', old);
  move(e, run.id, 2);
  expect(e.run(run.id).executions.map((x) => x.version)).toEqual([1, 1]);
  const impact = e.versions.preview({
    versions: [{ workflowId: id, version: 1 }],
  });
  expect(impact.affectedRuns).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        runId: run.id,
        version: 2,
        executionVersions: [1],
        currentDefinitionDeleted: false,
      }),
    ]),
  );
});

it('previews an exhausted target step limit without writes and accepts a target with room for the next visit', () => {
  const e = setup(),
    id = publish(e),
    run = e.start(id, {}).run;
  boundary(e, run.id);
  expect(e.run(run.id).executions).toHaveLength(2);
  newer(e, id, (d) => {
    d.maxSteps = 2;
  });
  const before = protectedState(e);
  const blocked = e.runVersions.preview({ runId: run.id, version: 2 });
  expect(blocked).toMatchObject({
    canApply: false,
    blockers: ['Target step limit would reject the next execution'],
  });
  expect(protectedState(e)).toEqual(before);
  expect(() =>
    e.runVersions.apply({
      runId: run.id,
      version: 2,
      confirmation: blocked.confirmation,
      reason: 'Reduced limit',
    }),
  ).toThrow(/step limit/);
  expect(protectedState(e)).toEqual(before);
  newer(e, id, (d) => {
    d.maxSteps = 3;
  });
  const beforeControl = protectedState(e);
  const compatible = e.runVersions.preview({ runId: run.id, version: 3 });
  expect(compatible).toMatchObject({ canApply: true, blockers: [] });
  expect(protectedState(e)).toEqual(beforeControl);
  move(e, run.id, 3);
  expect(e.run(run.id).version).toBe(3);
  expect(e.run(run.id).executions).toHaveLength(2);
});

it('checks the full nested Batch ancestry even when the next node and immediate owning Batch remain unchanged', () => {
  const e = setup(),
    d = nestedBatches(3);
  d.nodes.push(
    nodeSchema.parse({
      id: 'next',
      kind: 'agent',
      label: 'Next item step',
      prompt: 'Continue item',
      batchId: 'batch2',
    }),
  );
  const end = d.edges.find((edge) => edge.source === 'work')!;
  end.target = 'next';
  delete end.targetHandle;
  d.edges.push({
    id: 'next-end',
    source: 'next',
    target: 'batch2',
    targetHandle: 'end',
    port: 'default',
  });
  const id = publish(e, d),
    root = e.start(id, [[[1]]]).run;
  const item = e.run(e.available(root.id)[0].runId);
  expect(item.batchNodeId).toBe('batch2');
  boundary(e, item.id, 2);
  newer(e, id, (target) => {
    target.nodes.push(
      nodeSchema.parse({
        id: 'wrapper',
        kind: 'batch',
        label: 'Replacement outer scope',
      }),
      nodeSchema.parse({
        id: 'extra',
        kind: 'agent',
        label: 'Old outer item',
        prompt: 'Old outer item',
        batchId: 'batch',
      }),
    );
    target.nodes.find((node) => node.id === 'batch1')!.batchId = 'wrapper';
    target.edges.find((edge) => edge.source === 'entry')!.target = 'wrapper';
    target.edges.find(
      (edge) => edge.source === 'batch' && edge.port === 'item',
    )!.target = 'extra';
    target.edges.find(
      (edge) => edge.source === 'batch1' && edge.port === 'complete',
    )!.target = 'wrapper';
    target.edges.push(
      { id: 'wrapper-item', source: 'wrapper', target: 'batch1', port: 'item' },
      {
        id: 'wrapper-complete',
        source: 'wrapper',
        target: 'batch',
        port: 'complete',
      },
      {
        id: 'extra-end',
        source: 'extra',
        target: 'batch',
        targetHandle: 'end',
        port: 'default',
      },
    );
  });
  const changed = e.store.getVersion(id, 2)!.definition;
  expect(changed.nodes.find((node) => node.id === 'next')?.batchId).toBe(
    'batch2',
  );
  expect(changed.nodes.find((node) => node.id === 'batch2')?.batchId).toBe(
    'batch1',
  );
  const before = protectedState(e);
  const blocked = e.runVersions.preview({ runId: item.id, version: 2 });
  expect(blocked).toMatchObject({
    canApply: false,
    blockers: ['Batch ancestry must remain unchanged'],
  });
  expect(protectedState(e)).toEqual(before);
  expect(() =>
    e.runVersions.apply({
      runId: item.id,
      version: 2,
      confirmation: blocked.confirmation,
      reason: 'Reparent items',
    }),
  ).toThrow(/Batch ancestry/);
  expect(protectedState(e)).toEqual(before);
  newer(e, id, (target) => {
    target.nodes = structuredClone(d.nodes);
    target.edges = structuredClone(d.edges);
  });
  const beforeControl = protectedState(e);
  expect(e.runVersions.preview({ runId: item.id, version: 3 })).toMatchObject({
    canApply: true,
    blockers: [],
  });
  expect(protectedState(e)).toEqual(beforeControl);
  move(e, item.id, 3);
  expect(e.run(item.id)).toMatchObject({
    version: 3,
    batchNodeId: 'batch2',
    cursor: 'next',
  });
  expect(e.run(root.id).version).toBe(1);
});

it('does not move a run from a literal model to an uncaptured explicit preset', () => {
  const e = setup();
  const d = definition();
  const next = d.nodes.find(
    (node) => node.kind === 'agent' && node.id === 'next',
  )!;
  next.model = 'Deep review';
  const id = publish(e, d);
  const run = e.start(id, {}).run;
  e.modelAliases.mutate({
    action: 'create',
    name: 'Deep review',
    candidates: [{ profileId: 'codex', model: 'review-model' }],
  });
  newer(e, id, (draft) => {
    const target = draft.nodes.find(
      (node) => node.kind === 'agent' && node.id === 'next',
    )!;
    target.executorMode = 'preset';
  });
  boundary(e, run.id);
  expect(e.runVersions.preview({ runId: run.id, version: 2 })).toMatchObject({
    canApply: false,
    blockers: expect.arrayContaining([
      expect.stringMatching(/capture Deep review is missing/i),
    ]),
  });
});
