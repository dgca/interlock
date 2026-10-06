import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  snapshotPrompt,
  composePrompt,
  type WorkflowDefinition,
} from '@interlock/core';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { workflowBundleSchema } from '../packages/core/src/transfer';
import { batchDefinition, itemAgent } from './fixtures/batch';
import { parseRawDefinition } from '../packages/ui/src/features/workflows/rawDefinition';

const stores: Store[] = [];
const dirs: string[] = [];
const worker = {
  workerId: 'prompts-test',
  freshContext: false,
  tools: [],
  skills: [],
};
function setup(path = ':memory:') {
  const store = new Store(path);
  stores.push(store);
  return new Engine(store, process.cwd());
}
function prompt(engine: Engine, content = 'First guidance') {
  return engine.prompts.create({
    name: 'Research standards',
    description: 'Research',
    content,
  });
}
function update(engine: Engine, id: string, content = 'New guidance') {
  const old = engine.prompts.get(id);
  return engine.prompts.update(id, old.revision, { ...old, content });
}
function definition(ids: string[] = []) {
  const d = blankDefinition();
  const agent = d.nodes[1];
  if (agent.kind !== 'agent') throw new Error('Agent');
  agent.promptIds = ids;
  agent.prompt = 'Do this task';
  return d;
}
function publish(engine: Engine, d: WorkflowDefinition) {
  const w = engine.create('Prompt workflow', '', d);
  engine.publish(w.id);
  return w.id;
}
function complete(engine: Engine, root: string) {
  const work = engine.available(root)[0];
  const claim = engine.claim(work.id, worker);
  engine.submit(work.id, claim.token!, null);
}
afterEach(() => {
  vi.useRealTimers();
  stores.splice(0).forEach((s) => {
    try {
      s.close();
    } catch {}
  });
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});

it('protects revision saves, preserves history, and rejects blank names/instructions', () => {
  const engine = setup();
  const p = prompt(engine);
  expect(engine.prompts.update(p.id, 1, p)).toEqual(p);
  const saved = update(engine, p.id);
  expect(saved.revision).toBe(2);
  expect(engine.store.get<any>('promptRevisions', `${p.id}:1`).content).toBe(
    p.content,
  );
  expect(() => engine.prompts.update(p.id, 1, p)).toThrow(/changed elsewhere/);
  expect(engine.prompts.get(p.id)).toEqual(saved);
  expect(() => engine.prompts.create({ ...p, name: ' ' })).toThrow();
  expect(() => engine.prompts.create({ ...p, content: '\n  ' })).toThrow();
});

it('composes saved guidance in order, preserves exact legacy text and raw/stable-ID references', () => {
  const engine = setup();
  const a = prompt(engine, 'Alpha'),
    b = prompt(engine, 'Beta');
  const id = publish(engine, definition([b.id, a.id]));
  const run = engine.start(id, null).run;
  const work = engine.available(run.id)[0];
  expect(work.prompt).toBe(
    composePrompt('Do this task', [snapshotPrompt(b), snapshotPrompt(a)]),
  );
  expect(work.savedPrompts?.map((p) => p.id)).toEqual([b.id, a.id]);
  const raw = parseRawDefinition(JSON.stringify(engine.workflow(id).draft));
  expect(raw.definition?.nodes[1]).toHaveProperty('promptIds', [b.id, a.id]);
  const edited = engine.editDraft(id, engine.workflow(id).draftRevision, [
    { op: 'update_node', id: 'agent', set: { promptIds: [a.id] } },
  ]);
  expect(edited.applied).toBe(true);
  const legacy = engine.start(publish(engine, definition()), null).run;
  expect(engine.available(legacy.id)[0].prompt).toBe('Do this task');
  expect(engine.available(legacy.id)[0].savedPrompts).toBeUndefined();
});

it('uses latest prompts for new runs without changing the published graph', () => {
  const engine = setup();
  const p = prompt(engine);
  const id = publish(engine, definition([p.id]));
  const pin = engine.store.getVersion(id, 1);
  const first = engine.start(id, null).run;
  update(engine, p.id);
  const second = engine.start(id, null).run;
  expect(engine.available(first.id)[0].savedPrompts?.[0].revision).toBe(1);
  expect(engine.available(second.id)[0].savedPrompts?.[0].revision).toBe(2);
  expect(engine.store.getVersion(id, 1)).toEqual(pin);
  expect(engine.workSummaries(first.id)[0]).not.toHaveProperty('savedPrompts');
  expect(
    JSON.stringify(engine.continuation.briefing({ id: first.id, limit: 20 })),
  ).not.toContain('First guidance');
});

it('keeps later steps, reclaim and explicit retry on the original capture', () => {
  const engine = setup();
  const p = prompt(engine);
  const d = definition([p.id]);
  d.nodes.splice(
    2,
    0,
    nodeSchema.parse({
      id: 'later',
      kind: 'agent',
      label: 'Later',
      prompt: 'Later task',
      promptIds: [p.id],
      maxAttempts: 1,
    }),
  );
  d.edges[1].target = 'later';
  d.edges.push({
    id: 'later-exit',
    source: 'later',
    target: 'exit',
    port: 'default',
  });
  const root = engine.start(publish(engine, d), null).run;
  const first = engine.available(root.id)[0];
  let claim = engine.claim(first.id, worker);
  update(engine, p.id);
  engine.reportFailure(first.id, claim.token!, 'Retry');
  claim = engine.claim(first.id, worker);
  engine.submit(first.id, claim.token!, null);
  const later = engine.available(root.id)[0];
  expect(later.savedPrompts?.[0].revision).toBe(1);
  const failed = engine.claim(later.id, worker);
  engine.reportFailure(later.id, failed.token!, 'Failed');
  engine.retry(root.id);
  expect(engine.available(root.id)[0].savedPrompts?.[0].revision).toBe(1);
});

it('keeps captured guidance through loop visits and expired leases', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T22:00:00Z'));
  const engine = setup();
  const p = prompt(engine);
  const d = definition([p.id]);
  d.nodes.splice(
    2,
    0,
    nodeSchema.parse({
      id: 'route',
      kind: 'condition',
      label: 'Again?',
      path: '',
      equals: 'again',
    }),
  );
  d.edges[1].target = 'route';
  d.edges.push(
    { id: 'again', source: 'route', target: 'agent', port: 'true' },
    { id: 'done', source: 'route', target: 'exit', port: 'false' },
  );
  d.maxSteps = 6;
  const run = engine.start(publish(engine, d), null).run;
  const work = engine.available(run.id)[0];
  const claim = engine.claim(work.id, worker, 10);
  update(engine, p.id);
  vi.setSystemTime(new Date('2026-10-06T22:00:11Z'));
  engine.pump();
  const next = engine.claim(work.id, worker);
  expect(next.savedPrompts?.[0].revision).toBe(1);
  engine.submit(work.id, next.token!, 'again');
  expect(engine.available(run.id)[0].savedPrompts?.[0].revision).toBe(1);
  expect(() => engine.submit(work.id, claim.token!, null)).toThrow();
});

it('shares the enclosing workflow capture with later Batch items', () => {
  const engine = setup();
  const p = prompt(engine);
  const item = itemAgent();
  if (item.kind !== 'agent') throw new Error('Agent');
  item.promptIds = [p.id];
  const root = engine.start(
    publish(engine, batchDefinition(item, { concurrency: 1 })),
    [1, 2, 3],
  ).run;
  update(engine, p.id);
  complete(engine, root.id);
  expect(engine.available(root.id)[0].savedPrompts?.[0].revision).toBe(1);
  complete(engine, root.id);
  expect(engine.available(root.id)[0].savedPrompts?.[0].revision).toBe(1);
});

it.each(['wait', 'detached'] as const)(
  'captures independently when a delayed %s Workflow run starts',
  (mode) => {
    const engine = setup();
    const p = prompt(engine);
    const child = publish(engine, definition([p.id]));
    const d = definition([p.id]);
    d.nodes.splice(
      2,
      0,
      nodeSchema.parse({
        id: 'child',
        kind: 'workflow',
        label: 'Child',
        workflowId: child,
        version: 1,
        mode,
      }),
    );
    d.edges[1].target = 'child';
    d.edges.push({
      id: 'child-exit',
      source: 'child',
      target: 'exit',
      port: 'default',
    });
    const root = engine.start(publish(engine, d), null).run;
    update(engine, p.id);
    complete(engine, root.id);
    expect(engine.run(root.id).promptSnapshots?.[0].revision).toBe(1);
    const work = engine.available(root.id)[0];
    expect(work.savedPrompts?.[0].revision).toBe(2);
    expect(engine.run(work.runId).promptSnapshots?.[0].revision).toBe(2);
  },
);

it('retains instructions and library history after reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-prompts-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  const engine = setup(path);
  const p = prompt(engine);
  const root = engine.start(publish(engine, definition([p.id])), null).run;
  update(engine, p.id);
  engine.stop();
  engine.store.close();
  const reopened = setup(path);
  expect(reopened.prompts.get(p.id).revision).toBe(2);
  expect(reopened.available(root.id)[0].savedPrompts?.[0].content).toBe(
    'First guidance',
  );
  expect(reopened.store.get<any>('promptRevisions', `${p.id}:1`).content).toBe(
    'First guidance',
  );
});

it('guards deletion using drafts and every published version and allows incomplete drafts', () => {
  const engine = setup();
  const p = prompt(engine);
  const id = publish(engine, definition([p.id]));
  expect(engine.prompts.usage(p.id)[0]).toMatchObject({
    workflowId: id,
    draft: true,
    versions: [1],
  });
  expect(() => engine.prompts.delete(p.id)).toThrow(
    /referenced by Prompt workflow/,
  );
  engine.update(id, { draft: definition(), draftRevision: 1 });
  expect(() => engine.prompts.delete(p.id)).toThrow(/referenced by/);
  const unused = prompt(engine);
  engine.prompts.delete(unused.id);
  expect(() => engine.prompts.get(unused.id)).toThrow();
  const broken = engine.create('Missing', '', definition(['missing']));
  expect(engine.validateDraft(broken.id)).toMatchObject({
    saveable: true,
    publishable: false,
  });
  expect(engine.validateDraft(broken.id).diagnostics).toContainEqual(
    expect.objectContaining({ code: 'missing_prompt', nodeId: 'agent' }),
  );
  expect(() => engine.publish(broken.id)).toThrow(/missing/);
  const duplicate = engine.create('Duplicate', '', definition([p.id, p.id]));
  expect(() => engine.publish(duplicate.id)).toThrow(/unique/);
  engine.store.remove('prompts', p.id);
  expect(() => engine.start(id, null, 1)).toThrow(/does not exist/);
});

it('exports dependencies and owned children with shared prompt IDs and imports transactionally', () => {
  const source = setup();
  const p = prompt(source);
  update(source, p.id);
  const dependency = publish(source, definition([p.id]));
  const parent = source.create('Owner', '', definition([p.id]));
  const child = source.create('Owned', '', definition([p.id]), parent.id);
  source.publish(child.id);
  const d = definition([p.id]);
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'workflow',
    label: 'Dependency',
    workflowId: dependency,
    version: 1,
  });
  source.update(parent.id, { draft: d, draftRevision: 1 });
  source.publish(parent.id);
  const bundle = exportWorkflows(source.store, parent.id);
  expect(bundle.formatVersion).toBe(2);
  expect(bundle.prompts).toHaveLength(1);
  expect(bundle.workflows.map((w) => w.id)).toEqual(
    expect.arrayContaining([dependency, child.id]),
  );
  const target = setup();
  importWorkflows(target.store, bundle);
  expect(target.prompts.get(p.id).content).toBe('New guidance');
  expect(importWorkflows(target.store, bundle).changed).toEqual([]);
  update(target, p.id, 'Local guidance');
  expect(() => importWorkflows(target.store, bundle, { force: true })).toThrow(
    /Prompt conflict/,
  );
  expect(target.prompts.get(p.id).content).toBe('Local guidance');
  const empty = setup();
  const missing = structuredClone(bundle);
  missing.prompts = [];
  expect(() => importWorkflows(empty.store, missing)).toThrow(
    /missing saved prompt/,
  );
  expect(empty.store.workflows()).toEqual([]);
  expect(empty.prompts.list()).toEqual([]);
  const invalid = structuredClone(bundle);
  invalid.workflows[0].versions[0].definition.edges = [];
  expect(() => importWorkflows(empty.store, invalid)).toThrow();
  expect(empty.prompts.list()).toEqual([]);
  expect(() =>
    workflowBundleSchema.parse({ ...bundle, formatVersion: 1 }),
  ).toThrow(/formatVersion 2/);
  const legacy = exportWorkflows(source.store, publish(source, definition()));
  expect(legacy.formatVersion).toBe(1);
  expect(() => importWorkflows(empty.store, legacy)).not.toThrow();
});
