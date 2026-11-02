import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, definitionSchema } from '@interlock/core';
import { importStarter, listStarters } from '../packages/server/src/starters';
import sdlc from '../workflows/sdlc.json';
import { appRouter } from '../packages/server/src/router';
import { exportWorkflows } from '../packages/runtime/src/transfer';
const engines: Engine[] = [],
  dirs: string[] = [];
const setup = (path = ':memory:') => {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
};
const add = (e: Engine, requestId = 'one', copy = false) =>
  importStarter(e, { starterId: 'sdlc', requestId, copy });
afterEach(() => {
  vi.restoreAllMocks();
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
it('lists bundled choices without installing, publishing or starting anything', () => {
  const e = setup();
  expect(listStarters(e).map((s) => s.id)).toEqual([
    'sdlc',
    'evaluate-comparison',
  ]);
  expect(e.store.workflows()).toEqual([]);
  expect(e.store.list('starterCopies')).toEqual([]);
  expect(e.store.runs()).toEqual([]);
});
it('explicitly adds a published copy, recovers retries and offers the existing copy by default', () => {
  const e = setup(),
    a = add(e);
  expect(a).toMatchObject({ created: true, workflow: { latestVersion: 1 } });
  expect(add(e)).toEqual(a);
  expect(add(e, 'different')).toMatchObject({
    created: false,
    workflow: { id: a.workflow.id },
  });
  expect(e.store.workflows()).toHaveLength(1);
  expect(listStarters(e)[0].existing?.id).toBe(a.workflow.id);
  expect(e.store.runs()).toEqual([]);
});
it('recognizes renamed legacy drafts and retained originals without changing them', () => {
  const e = setup(),
    w = e.create('My SDLC', '', definitionSchema.parse(sdlc.definition));
  e.publish(w.id);
  const draft = structuredClone(w.draft),
    n = draft.nodes.find((n) => n.kind === 'agent')!;
  if (n.kind === 'agent') n.prompt = 'Customized';
  e.update(w.id, { draft, draftRevision: w.draftRevision });
  e.publish(w.id);
  const before = e.workflow(w.id);
  expect(listStarters(e)[0].existing?.id).toBe(w.id);
  expect(add(e)).toMatchObject({ created: false });
  expect(e.workflow(w.id)).toEqual(before);
});
it('keeps recognition after user edits and archives an explicitly imported copy', () => {
  const e = setup(),
    a = add(e),
    w = e.workflow(a.workflow.id);
  e.update(w.id, {
    name: 'My procedure',
    draft: blankDefinition(),
    draftRevision: w.draftRevision,
    archived: true,
  });
  expect(listStarters(e)[0].existing).toMatchObject({
    id: w.id,
    name: 'My procedure',
    archived: true,
  });
  expect(add(e, 'repeat').workflow.id).toBe(w.id);
});
it('creates another copy only when requested and deduplicates its lost-response retry', () => {
  const e = setup(),
    a = add(e),
    b = add(e, 'copy-request', true);
  expect(b.workflow.id).not.toBe(a.workflow.id);
  expect(add(e, 'copy-request', true)).toEqual(b);
  expect(e.store.workflows()).toHaveLength(2);
  expect(() => add(e, 'copy-request', false)).toThrow(/different arguments/);
});
it('does not mistake a display-name collision for identity or overwrite it', () => {
  const e = setup(),
    w = e.create(sdlc.name, 'Mine', blankDefinition());
  e.publish(w.id);
  const before = e.workflow(w.id);
  expect(listStarters(e)[0].existing).toBeUndefined();
  expect(add(e).created).toBe(true);
  expect(e.workflow(w.id)).toEqual(before);
});
it('allows intentional re-add after deletion while refusing an old delivered request', () => {
  const e = setup(),
    a = add(e);
  e.deleteWorkflow(a.workflow.id);
  expect(listStarters(e)[0].existing).toBeUndefined();
  expect(() => add(e)).toThrow(/deleted/);
  expect(e.store.workflows()).toEqual([]);
  expect(add(e, 'new-intent').created).toBe(true);
});
it('rolls back workflow, publication, copy tracking and request receipts on publication failure', () => {
  const e = setup(),
    fail = vi.spyOn(e, 'publish').mockImplementationOnce(() => {
      throw Error('injected');
    });
  expect(() => add(e)).toThrow('injected');
  expect(e.store.workflows()).toEqual([]);
  expect(e.store.list('versions')).toEqual([]);
  expect(e.store.list('starterCopies')).toEqual([]);
  expect(e.store.list('starterImports')).toEqual([]);
  fail.mockRestore();
  expect(add(e).created).toBe(true);
});
it('persists retry receipts across restart and excludes local tracking from portable exports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-starter-choice-'));
  dirs.push(dir);
  const path = join(dir, 'state.db'),
    e = setup(path),
    a = add(e);
  expect(JSON.stringify(exportWorkflows(e.store, a.workflow.id))).not.toContain(
    'starterImports',
  );
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  const next = setup(path);
  expect(add(next)).toEqual(a);
  expect(next.store.workflows()).toHaveLength(1);
});
it('previews legacy and bundle metadata through the shared API without writes, preserving publish/import rules', async () => {
  const e = setup(),
    api = appRouter.createCaller({ engine: e });
  const before = e.store.workflows();
  const p = await api.workflows.previewImport({ document: sdlc as any });
  expect(p).toMatchObject({
    name: sdlc.name,
    published: false,
    workflows: [],
    prompts: [],
  });
  expect(e.store.workflows()).toEqual(before);
  const added = await api.workflows.importStarter({
    starterId: 'sdlc',
    requestId: 'api',
  });
  const bundle = exportWorkflows(e.store, added.workflow.id);
  expect(
    await api.workflows.previewImport({ document: bundle as any }),
  ).toMatchObject({ published: true, name: sdlc.name });
  expect(() =>
    importStarter(e, { starterId: 'missing', requestId: 'bad' }),
  ).toThrow(/not found/);
});
