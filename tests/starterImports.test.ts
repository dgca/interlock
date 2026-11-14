import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  type BoardImportSetup,
} from '@interlock/core';
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
    'sdlc-v2',
    'evaluate-comparison',
  ]);
  expect(e.store.workflows()).toEqual([]);
  expect(e.store.list('starterCopies')).toEqual([]);
  expect(e.store.runs()).toEqual([]);
});
it.each(['draft', 'version'])(
  'ignores an incompatible saved %s when listing and importing starters',
  (source) => {
    const e = setup(),
      w = e.create('Legacy workflow', '', blankDefinition());
    e.publish(w.id);
    const version = e.store.getVersion(w.id, 1)!;
    const definition = {
      ...w.draft,
      nodes: w.draft.nodes.map((n, i) =>
        i === 1 ? { ...n, kind: source === 'draft' ? 'map' : 'list' } : n,
      ),
    };
    // Older definitions can remain in storage after their node kinds are removed.
    if (source === 'draft')
      e.store.put('workflows', { ...e.workflow(w.id), draft: definition });
    else e.store.put('versions', { ...version, id: `${w.id}:1`, definition });
    const before = e.workflow(w.id),
      versions = e.store.listVersions(w.id);

    expect(listStarters(e).map((s) => s.id)).toEqual([
      'sdlc',
      'sdlc-v2',
      'evaluate-comparison',
    ]);
    expect(listStarters(e).every((s) => !s.existing)).toBe(true);
    expect(add(e)).toMatchObject({ created: true });
    expect(e.workflow(w.id)).toEqual(before);
    expect(e.store.listVersions(w.id)).toEqual(versions);
    expect(e.store.runs()).toEqual([]);
  },
);
it('recognizes a retained starter after an incompatible draft and earlier version', () => {
  const e = setup(),
    w = e.create('My SDLC', '', definitionSchema.parse(sdlc.definition));
  e.publish(w.id);
  const first = e.store.getVersion(w.id, 1)!;
  e.publish(w.id);
  const definition = {
    ...w.draft,
    nodes: w.draft.nodes.map((n, i) => (i === 1 ? { ...n, kind: 'map' } : n)),
  };
  e.store.put('workflows', { ...e.workflow(w.id), draft: definition });
  e.store.put('versions', { ...first, id: `${w.id}:1`, definition });
  const before = e.workflow(w.id),
    versions = e.store.listVersions(w.id);

  expect(listStarters(e)[0].existing?.id).toBe(w.id);
  expect(add(e)).toMatchObject({ created: false, workflow: { id: w.id } });
  expect(e.store.workflows()).toHaveLength(1);
  expect(e.workflow(w.id)).toEqual(before);
  expect(e.store.listVersions(w.id)).toEqual(versions);
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
it('adds SDLC v2 as its own copy and leaves an existing v1 copy untouched', () => {
  const e = setup(),
    v1 = add(e).workflow.id,
    before = e.workflow(v1),
    versions = e.store.listVersions(v1);
  const v2 = importStarter(e, { starterId: 'sdlc-v2', requestId: 'two' });
  expect(v2).toMatchObject({ created: true });
  expect(v2.workflow.id).not.toBe(v1);
  expect(e.workflow(v1)).toEqual(before);
  expect(e.store.listVersions(v1)).toEqual(versions);
  const listed = new Map(listStarters(e).map((s) => [s.id, s.existing?.id]));
  expect(listed.get('sdlc')).toBe(v1);
  expect(listed.get('sdlc-v2')).toBe(v2.workflow.id);
  expect(add(e, 'again')).toMatchObject({
    created: false,
    workflow: { id: v1 },
  });
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
it('recognizes pre-stage SDLC copies and sets up a board only for a new copy', () => {
  const e = setup();
  const staged = definitionSchema.parse(sdlc.definition);
  const unstaged = {
    ...staged,
    nodes: staged.nodes.map(({ stage, stageId, ...node }) => node),
  };
  const old = e.create('Previously imported SDLC', '', unstaged);
  e.publish(old.id);
  const retained = e.store.getVersion(old.id, 1);
  const preview = listStarters(e)[0];
  expect(preview.existing?.id).toBe(old.id);
  expect(preview.boardSetup?.suggestions[0]).toMatchObject({
    id: 'sdlc-board',
    workflows: [{ workflowId: 'sdlc', currentBoardId: null }],
    columns: [
      { name: 'Planning' },
      { name: 'Implementation' },
      { name: 'Review' },
      { name: 'Delivery' },
    ],
  });
  const requestId = 'create-starter-board';
  const boardSetup: BoardImportSetup = {
    requestId,
    choices: [
      {
        suggestionId: 'sdlc-board',
        action: 'create',
        expectedBoards: { sdlc: null },
      },
    ],
  };
  const request = { starterId: 'sdlc', requestId, boardSetup };
  expect(() => importStarter(e, request)).toThrow(/another copy/);
  expect(e.store.workflows()).toHaveLength(1);
  expect(e.boards.list()).toHaveLength(0);
  expect(add(e).workflow.id).toBe(old.id);

  const copied = importStarter(e, { ...request, copy: true });
  expect(copied.workflow.id).not.toBe(old.id);
  expect(importStarter(e, { ...request, copy: true })).toEqual(copied);
  const [board] = e.boards.list();
  expect(e.boards.list()).toHaveLength(1);
  expect(board.workflowIds).toEqual([copied.workflow.id]);
  expect(e.store.getVersion(copied.workflow.id, 1)?.definition).toEqual(staged);
  expect(e.store.getVersion(old.id, 1)).toEqual(retained);
  expect(e.workflow(old.id).boardId).toBeUndefined();
  const run = e.start(copied.workflow.id, {
    request: 'Disposable board fixture',
  }).run;
  expect(
    e.boards.read({ id: board.id, status: 'all', offset: 0, limit: 20 })
      .columns[0],
  ).toMatchObject({
    name: 'Planning',
    cards: [{ runId: run.id }],
  });
});

it('rolls back starter publication when its destination board revision is stale', () => {
  const e = setup();
  const board = e.boards.save({
    name: 'Destination',
    columns: [{ name: 'Plan work' }],
    workflowIds: [],
  });
  const requestId = 'reuse-starter-board';
  const request = {
    starterId: 'sdlc',
    requestId,
    boardSetup: {
      requestId,
      choices: [
        {
          suggestionId: 'sdlc-board',
          action: 'existing' as const,
          boardId: board.id,
          expectedRevision: board.revision + 1,
          expectedBoards: { sdlc: null },
          stageColumns: { sdlc: { planning: board.columns[0].id } },
        },
      ],
    },
  };
  expect(() => importStarter(e, request)).toThrow(/Board settings changed/);
  expect(e.store.workflows()).toHaveLength(0);
  expect(e.store.list('starterImports')).toHaveLength(0);
  request.boardSetup.choices[0].expectedRevision = board.revision;
  const added = importStarter(e, request);
  expect(e.boards.list()).toHaveLength(1);
  expect(e.workflow(added.workflow.id).boardStageColumns).toMatchObject({
    planning: board.columns[0].id,
    delivery: null,
  });
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
