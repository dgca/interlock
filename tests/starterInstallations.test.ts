import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, definitionSchema } from '@interlock/core';
import { seed } from '../packages/server/src/seed';
import {
  starters,
  type Starter,
  type StarterInstallation,
} from '../packages/server/src/starters';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import previousRelease from './fixtures/testbench-previous-release.json';
const opened: Engine[] = [],
  dirs: string[] = [];
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  opened.push(e);
  return e;
}
function close(e: Engine) {
  e.stop();
  e.store.close();
  opened.splice(opened.indexOf(e), 1);
}
function receipt(e: Engine, id: string) {
  return e.store.get<StarterInstallation>('starterInstallations', id)!;
}
function evaluator(e: Engine) {
  return e.workflow(receipt(e, 'evaluate-comparison').workflowId!);
}
function manual(e: Engine, name?: string, publish = false) {
  const t = starters[1].template;
  const w = e.create(
    name ?? t.name,
    t.description,
    definitionSchema.parse(t.definition),
  );
  if (publish) e.publish(w.id);
  return e.workflow(w.id);
}
const future: Starter = {
  id: 'future-starter',
  template: {
    name: 'Future starter',
    description: 'Fixture only',
    definition: blankDefinition(),
  },
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const e of opened.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
it('delivers curated published workflows without starting runs, and performs no work on repeat startup', () => {
  const e = setup(),
    start = vi.spyOn(e, 'start'),
    publish = vi.spyOn(e, 'publish');
  seed(e);
  expect(e.store.workflows()).toHaveLength(2);
  expect(publish).toHaveBeenCalledTimes(2);
  expect(start).not.toHaveBeenCalled();
  expect(e.store.runs()).toEqual([]);
  expect(e.store.work()).toEqual([]);
  const records = e.store.list('starterInstallations'),
    workflows = e.store.workflows(),
    marker = e.store.get('meta', 'seed');
  seed(e);
  expect(e.store.list('starterInstallations')).toEqual(records);
  expect(e.store.workflows()).toEqual(workflows);
  expect(e.store.get('meta', 'seed')).toEqual(marker);
  expect(publish).toHaveBeenCalledTimes(2);
});
it('installs a newly introduced stable identity once after older starters were deleted', () => {
  const e = setup();
  seed(e);
  for (const w of e.store.workflows()) e.deleteWorkflow(w.id);
  seed(e, [...starters, future]);
  expect(e.store.workflows()).toMatchObject([
    { name: 'Future starter', latestVersion: 1 },
  ]);
  e.deleteWorkflow(receipt(e, future.id).workflowId!);
  seed(e, [...starters, future]);
  expect(e.store.workflows()).toEqual([]);
  expect(e.store.list('starterInstallations')).toHaveLength(3);
});
it('preserves user edits, archive state, versions and active run history across catalog updates', () => {
  const e = setup();
  seed(e);
  const w = evaluator(e);
  const draft = structuredClone(w.draft);
  const agent = draft.nodes.find((n) => n.kind === 'agent')!;
  if (agent.kind === 'agent') agent.prompt = 'User-owned grading instructions';
  e.update(w.id, {
    name: 'My evaluator',
    description: 'Customized',
    draft,
    draftRevision: w.draftRevision,
  });
  e.publish(w.id);
  e.update(w.id, { archived: true });
  const sdlc = e.workflow(receipt(e, 'sdlc').workflowId!);
  e.start(sdlc.id, { request: 'Synthetic pending task' });
  const before = [
    'workflows',
    'versions',
    'runs',
    'work',
    'events',
    'starterInstallations',
  ].map((c) => e.store.list(c));
  const changed = starters.map((s) => ({
    ...s,
    template: {
      ...s.template,
      name: s.template.name + ' updated',
      definition: { invalid: 'must not replace installed copies' },
    },
  }));
  seed(e, changed);
  expect(
    [
      'workflows',
      'versions',
      'runs',
      'work',
      'events',
      'starterInstallations',
    ].map((c) => e.store.list(c)),
  ).toEqual(before);
});
it.each([false, true])(
  'recognizes a renamed manual import without publishing or editing it, published=%s',
  (published) => {
    const e = setup(),
      w = manual(e, 'My renamed evaluator', published),
      before = e.store.workflows(),
      versions = e.store.listVersions();
    seed(e);
    expect(e.store.workflows()).toEqual(before);
    expect(e.store.listVersions()).toEqual(versions);
    expect(receipt(e, 'evaluate-comparison')).toMatchObject({
      outcome: 'recognized',
      workflowId: w.id,
    });
    expect(e.workflow(w.id).latestVersion).toBe(published ? 1 : 0);
  },
);
it('recognizes a customized renamed copy from its retained published original', () => {
  const e = setup(),
    w = manual(e, 'Customized review', true),
    draft = structuredClone(w.draft);
  const agent = draft.nodes.find((n) => n.kind === 'agent')!;
  if (agent.kind === 'agent') agent.prompt = 'Custom prompt';
  e.update(w.id, { draft, draftRevision: w.draftRevision });
  e.publish(w.id);
  const before = e.workflow(w.id),
    versions = e.store.listVersions(w.id);
  seed(e);
  expect(receipt(e, 'evaluate-comparison')).toMatchObject({
    outcome: 'recognized',
    workflowId: w.id,
  });
  expect(e.workflow(w.id)).toEqual(before);
  expect(e.store.listVersions(w.id)).toEqual(versions);
  expect(e.store.workflows()).toHaveLength(1);
});
it('ignores canvas positions and declaration order when recognizing a legacy copy', () => {
  const e = setup(),
    t = starters[1].template,
    d = definitionSchema.parse(t.definition);
  d.nodes.reverse().forEach((n) => {
    n.position = { x: 900, y: 700 };
  });
  d.edges.reverse();
  const w = e.create('Rearranged', '', d);
  seed(e);
  expect(receipt(e, 'evaluate-comparison')).toMatchObject({
    outcome: 'recognized',
    workflowId: w.id,
  });
  expect(e.store.workflows()).toHaveLength(1);
});
it('keeps a customized unpublished name collision without claiming official identity', () => {
  const e = setup(),
    w = e.create(
      starters[1].template.name,
      'Unrelated or customized draft',
      blankDefinition(),
    );
  e.publish(w.id);
  const before = e.workflow(w.id);
  seed(e);
  expect(e.store.workflows()).toEqual([before]);
  expect(receipt(e, 'evaluate-comparison')).toMatchObject({
    outcome: 'name-collision',
  });
  expect(receipt(e, 'evaluate-comparison')).not.toHaveProperty('workflowId');
  e.update(w.id, { name: 'Renamed later' });
  seed(e);
  expect(e.store.workflows()).toHaveLength(1);
});
it('does not recreate a recognized manual import after deletion or catalog renaming', () => {
  const e = setup(),
    w = manual(e);
  seed(e);
  e.deleteWorkflow(w.id);
  seed(
    e,
    starters.map((s) => ({
      ...s,
      template: { ...s.template, name: 'New display name' },
    })),
  );
  expect(e.store.workflows()).toEqual([]);
});
it('preserves a marked legacy SDLC with arbitrary customization and introduces only the evaluator', () => {
  const e = setup(),
    w = e.create('My renamed old SDLC', '', blankDefinition());
  e.publish(w.id);
  const marker = { id: 'seed', seededAt: '2025-01-01T00:00:00Z' };
  e.store.put('meta', marker);
  const before = e.workflow(w.id);
  seed(e);
  expect(receipt(e, 'sdlc').outcome).toBe('legacy-skipped');
  expect(e.workflow(w.id)).toEqual(before);
  expect(e.store.get('meta', 'seed')).toEqual(marker);
  expect(e.store.workflows()).toHaveLength(2);
});
it('recognizes an owned archived evaluator rather than adding another library copy', () => {
  const e = setup(),
    owner = e.create('Owner', '', blankDefinition()),
    t = starters[1].template,
    w = e.create(
      'Owned evaluator',
      '',
      definitionSchema.parse(t.definition),
      owner.id,
    );
  e.publish(w.id);
  e.update(w.id, { archived: true });
  const before = e.store.workflows();
  seed(e);
  expect(receipt(e, 'evaluate-comparison').workflowId).toBe(w.id);
  expect(e.store.workflows()).toEqual(before);
});
it('rolls back the entire new catalog delivery when a later publication fails', () => {
  const e = setup(),
    publish = e.publish.bind(e);
  vi.spyOn(e, 'publish')
    .mockImplementationOnce(publish)
    .mockImplementationOnce(() => {
      throw Error('second starter failure');
    });
  expect(() => seed(e)).toThrow('second starter failure');
  expect(e.store.workflows()).toEqual([]);
  expect(e.store.list('versions')).toEqual([]);
  expect(e.store.list('starterInstallations')).toEqual([]);
  expect(e.store.get('meta', 'seed')).toBeUndefined();
  seed(e);
  expect(e.store.workflows()).toHaveLength(2);
});
it('keeps existing receipts and workflows intact when a later release fails to install a new starter', () => {
  const e = setup();
  seed(e);
  const before = [e.store.workflows(), e.store.list('starterInstallations')];
  const fail = vi.spyOn(e, 'publish').mockImplementationOnce(() => {
    throw Error('new starter failure');
  });
  expect(() => seed(e, [...starters, future])).toThrow('new starter failure');
  expect([e.store.workflows(), e.store.list('starterInstallations')]).toEqual(
    before,
  );
  fail.mockRestore();
  seed(e, [...starters, future]);
  expect(e.store.workflows()).toHaveLength(3);
});
it('survives database restart and catalog removal/reintroduction without recreating deleted workflows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-starters-'));
  dirs.push(dir);
  const path = join(dir, 'state.db');
  const e = setup(path);
  seed(e);
  const w = evaluator(e);
  e.deleteWorkflow(w.id);
  const receipts = e.store.list('starterInstallations');
  close(e);
  const next = setup(path);
  seed(next, starters.slice(0, 1));
  seed(next);
  expect(next.store.workflows()).toHaveLength(1);
  expect(next.store.list('starterInstallations')).toEqual(receipts);
});
it('keeps receipts local to the library while portable copies can be recognized elsewhere', () => {
  const a = setup();
  seed(a);
  const w = evaluator(a),
    bundle = exportWorkflows(a.store, w.id);
  expect(JSON.stringify(bundle)).not.toContain('starterInstallations');
  expect(JSON.stringify(bundle)).not.toContain('templateHash');
  const b = setup();
  importWorkflows(b.store, bundle);
  seed(b);
  expect(b.store.workflows()).toHaveLength(1);
  expect(receipt(b, 'evaluate-comparison')).toMatchObject({
    outcome: 'recognized',
    workflowId: w.id,
  });
  for (const own of a.store.workflows()) a.deleteWorkflow(own.id);
  seed(a);
  expect(a.store.workflows()).toEqual([]);
  const fresh = setup();
  seed(fresh);
  expect(fresh.store.workflows()).toHaveLength(2);
});
it('rejects duplicate or blank catalog identities before creating any workflows', () => {
  const e = setup();
  expect(() => seed(e, [starters[0], starters[0]])).toThrow(/unique/);
  expect(() => seed(e, [{ ...future, id: '' }])).toThrow(/identifiers/);
  expect(e.store.workflows()).toEqual([]);
  expect(e.store.list('starterInstallations')).toEqual([]);
});
it('preserves records and claims in a previous-release database while delivering the new evaluator', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-starter-upgrade-'));
  dirs.push(dir);
  const path = join(dir, 'state.db'),
    db = new DatabaseSync(path);
  db.exec(previousRelease.schema.join(';\n'));
  db.exec(
    'INSERT INTO migrations VALUES (1),(2),(3); INSERT INTO continuation_sequence VALUES (1,0);',
  );
  for (const [collection, records] of Object.entries(previousRelease.documents))
    for (const r of records)
      db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run(
        collection,
        r.id,
        JSON.stringify(r),
      );
  db.close();
  const e = setup(path);
  seed(e);
  expect(e.store.migration).toEqual({ from: 3, to: 3 });
  for (const [collection, records] of Object.entries(previousRelease.documents))
    expect(
      e.store
        .list<{ id: string }>(collection)
        .filter((r) => records.some((old) => old.id === r.id)),
    ).toEqual(records);
  expect(
    e.store.workflows().filter((w) => w.name === starters[1].template.name),
  ).toHaveLength(1);
  const claim = e.store.work().find((w) => w.status === 'claimed')!;
  e.submit(claim.id, 'testbench-fixture-token', { resumed: true });
  expect(e.run(claim.runId).status).toBe('completed');
});
