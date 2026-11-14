import { afterEach, expect, it, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankDefinition, definitionSchema } from '@interlock/core';
import type { WorkflowBundle } from '@interlock/core/transfer';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { ScriptApprovals } from '../packages/runtime/src/scriptApprovals';
import { WorkflowSync } from '../packages/runtime/src/workflowSync';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup(options: { missing?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'interlock-sync-'));
  const folder = join(root, 'workflows');
  if (!options.missing) mkdirSync(folder);
  const engine = new Engine(new Store(':memory:'), process.cwd());
  const sync = new WorkflowSync(engine, folder, {
    debounceMs: 20,
    retryMs: 20,
  });
  cleanups.push(() => {
    sync.stop();
    engine.stop();
    engine.store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { engine, sync, folder };
}

const script = (command: string) => {
  const blank = blankDefinition();
  return definitionSchema.parse({
    ...blank,
    nodes: blank.nodes.map((node) =>
      node.kind === 'agent'
        ? {
            id: node.id,
            kind: 'script',
            label: 'Say hello',
            language: 'javascript',
            command,
            position: node.position,
          }
        : node,
    ),
  });
};

/** Publish and let the post-commit export run. */
async function publish(engine: Engine, id: string) {
  engine.publish(id);
  await new Promise((resolve) => setImmediate(resolve));
}

const readJson = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as WorkflowBundle;
const editFile = (path: string, edit: (bundle: WorkflowBundle) => void) => {
  const bundle = readJson(path);
  edit(bundle);
  writeFileSync(path, JSON.stringify(bundle));
};

it('writes the file on publish and imports a pulled edit into the draft only', async () => {
  const { engine, sync, folder } = setup();
  const w = engine.create('Greeter', '', script('return 1;'));
  sync.scan();
  await publish(engine, w.id);
  const path = join(folder, `${w.id}.json`);
  const written = readFileSync(path, 'utf8');
  expect(readJson(path).workflows[0]).toMatchObject({
    id: w.id,
    name: 'Greeter',
    versions: [],
  });
  // Writing the file is not an import, and an unchanged publish writes the same bytes.
  const revision = engine.workflow(w.id).draftRevision;
  expect(sync.scan().items).toEqual([]);
  expect(engine.workflow(w.id).draftRevision).toBe(revision);
  await publish(engine, w.id);
  expect(readFileSync(path, 'utf8')).toBe(written);

  editFile(path, (bundle) => {
    bundle.workflows[0].name = 'Greeter from Git';
    for (const node of bundle.workflows[0].draft.nodes)
      if (node.kind === 'script') node.command = 'return 2;';
  });
  expect(sync.scan().items).toEqual([]);
  const after = engine.workflow(w.id);
  expect(after.name).toBe('Greeter from Git');
  expect(after.latestVersion).toBe(2);
  expect(engine.store.list('runs')).toEqual([]);
  // Code that arrived through the folder waits for approval like any import.
  const approvals = new ScriptApprovals(engine.store);
  expect(
    approvals.required(w.id, { language: 'javascript', command: 'return 2;' }),
  ).toBeTruthy();
});

it('keeps the last good draft for an invalid file and clears the item once fixed', async () => {
  const { engine, sync, folder } = setup();
  const w = engine.create('Greeter', '', script('return 1;'));
  await publish(engine, w.id);
  const path = join(folder, `${w.id}.json`);
  const good = readJson(path);
  writeFileSync(path, '{ "format": "interlock-workflows", ');
  const draft = engine.workflow(w.id).draft;

  const [item, ...rest] = sync.scan().items;
  expect(rest).toEqual([]);
  expect(item.file).toBe(`${w.id}.json`);
  expect(item.reason).toContain('Not valid JSON');
  expect(engine.workflow(w.id).draft).toEqual(draft);
  // Publishing does not overwrite a file someone is still editing.
  await publish(engine, w.id);
  expect(readFileSync(path, 'utf8')).toContain(
    '"format": "interlock-workflows", ',
  );

  good.workflows[0].description = 'Fixed';
  writeFileSync(path, JSON.stringify(good));
  expect(sync.scan().items).toEqual([]);
  expect(engine.workflow(w.id).description).toBe('Fixed');
});

it('refuses a file change that would replace unsynced draft edits', async () => {
  const { engine, sync, folder } = setup();
  const w = engine.create('Greeter', '', script('return 1;'));
  await publish(engine, w.id);
  const path = join(folder, `${w.id}.json`);
  // A rename is a draft edit even though versions do not record names.
  engine.update(w.id, {
    name: 'Greeter (renamed)',
    draftRevision: engine.workflow(w.id).draftRevision,
  });
  editFile(path, (bundle) => {
    bundle.workflows[0].description = 'From Git';
  });

  const [item, ...rest] = sync.scan().items;
  expect(rest).toEqual([]);
  expect(item.file).toBe(`${w.id}.json`);
  expect(item.reason).toContain('draft edits in Interlock');
  expect(engine.workflow(w.id)).toMatchObject({
    name: 'Greeter (renamed)',
    description: '',
  });
  engine.update(w.id, {
    draft: script('return "ui";'),
    draftRevision: engine.workflow(w.id).draftRevision,
  });

  // Publishing keeps the Interlock edits as a version; the file then loads into the draft.
  await publish(engine, w.id);
  expect(readJson(path).workflows[0].description).toBe('From Git');
  expect(
    JSON.stringify(engine.store.getVersion(w.id, 2)!.definition),
  ).toContain('return \\"ui\\";');
  expect(engine.workflow(w.id).description).toBe('From Git');
  expect(sync.status().items.map((i) => i.reason)).toEqual([
    expect.stringContaining('did not overwrite'),
  ]);
});

it('imports neither file when two files claim one workflow', async () => {
  const { engine, sync, folder } = setup();
  const w = engine.create('Greeter', '', script('return 1;'));
  await publish(engine, w.id);
  const copy = readJson(join(folder, `${w.id}.json`));
  copy.workflows[0].description = 'Copy';
  writeFileSync(join(folder, 'copy.json'), JSON.stringify(copy));

  const items = sync.scan().items;
  expect(items.map((item) => item.file).sort()).toEqual(
    ['copy.json', `${w.id}.json`].sort(),
  );
  expect(engine.workflow(w.id).description).toBe('');
});

it('watches a folder created after startup', async () => {
  const { engine, sync, folder } = setup({ missing: true });
  sync.start();
  expect(sync.status().items[0].reason).toContain('does not exist');

  const source = new Engine(new Store(':memory:'), process.cwd());
  const sourceSync = new WorkflowSync(source, folder);
  cleanups.push(() => {
    sourceSync.stop();
    source.stop();
    source.store.close();
  });
  const w = source.create('Shared', '', script('return 1;'));
  mkdirSync(folder);
  await vi.waitFor(() => expect(sync.status().items).toEqual([]));
  sourceSync.scan();
  await publish(source, w.id);
  await vi.waitFor(() =>
    expect(engine.store.get('workflows', w.id)).toMatchObject({
      name: 'Shared',
      latestVersion: 0,
    }),
  );
});
