import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition, nodeSchema } from '@interlock/core';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { parseImportDocument } from '../packages/core/src/importDocument';
import { importSelection } from '../packages/runtime/src/importSelection';
import {
  GithubImports,
  parseGithubFolderUrl,
} from '../packages/server/src/githubImport';
import { appRouter } from '../packages/server/src/router';

const sha = '4c43bd7e54651dd9f8356456d647fb86f504252c';
const url = `https://github.com/owner/repo/tree/${sha}/workflows`;
const stores: Store[] = [];
const engines: Engine[] = [];
function setup() {
  const store = new Store(':memory:');
  stores.push(store);
  const engine = new Engine(store, process.cwd());
  engines.push(engine);
  return { store, engine };
}
afterEach(() => {
  engines.forEach((e) => e.stop());
  stores.forEach((s) => s.close());
  engines.length = 0;
  stores.length = 0;
});
const legacy = {
  name: 'Legacy',
  description: '<img src=x onerror=alert(1)>',
  definition: blankDefinition(),
};
const file = (data: unknown, filename = 'legacy.json') => ({
  data,
  filename,
  fileId: filename,
});
function bundle() {
  const { engine, store } = setup();
  const prompt = engine.prompts.create({
    name: 'Instructions',
    description: '',
    content: 'Do the work',
  });
  const root = engine.create('Root');
  const child = engine.create('Child', '', undefined, root.id);
  engine.publish(child.id);
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'step',
    kind: 'workflow',
    label: 'Child',
    workflowId: child.id,
    version: 1,
  });
  const agent = nodeSchema.parse({
    id: 'prompt',
    kind: 'agent',
    label: 'Prompt',
    prompt: '',
    promptIds: [prompt.id],
  });
  definition.nodes.push(agent);
  engine.update(root.id, { draft: definition, draftRevision: 1 });
  return exportWorkflows(store, root.id);
}
const snapshot = (s: Store) =>
  Object.fromEntries(
    [
      'workflows',
      'versions',
      'prompts',
      'promptRevisions',
      'runs',
      'work',
      'events',
    ].map((k) => [k, s.list(k)]),
  );
it('imports legacy roots and portable dependencies without starting work; preserves no-ops and prompt history', () => {
  const b = bundle(),
    { store } = setup();
  const first = importSelection(store, [file(legacy), file(b, 'bundle.json')]);
  expect(store.workflows().filter((w) => !w.ownerWorkflowId)).toHaveLength(2);
  expect(store.workflows().filter((w) => w.ownerWorkflowId)).toHaveLength(1);
  expect(store.list('prompts')).toHaveLength(1);
  expect(first.changedWorkflowIds).toHaveLength(3);
  expect(store.runs()).toEqual([]);
  expect(store.work()).toEqual([]);
  expect(store.list('events')).toEqual([]);
  expect(store.getVersion(b.workflows[1].id, 1)).toBeDefined();
  const before = snapshot(store);
  expect(importSelection(store, [file(b)]).changedWorkflowIds).toEqual([]);
  expect(snapshot(store)).toEqual(before);
  importSelection(store, [file(legacy)]);
  expect(store.workflows()).toHaveLength(4);
  const promptId = b.prompts![0].id;
  store.remove('prompts', promptId);
  importSelection(store, [file(b)]);
  expect(store.get<any>('prompts', promptId).revision).toBe(2);
});
it('rejects absent dependencies and concrete draft pins independently of local records', () => {
  const b = bundle(),
    missing = structuredClone(b);
  missing.workflows.pop();
  expect(() => parseImportDocument(missing)).toThrow('missing workflow');
  const pin = structuredClone(b);
  (pin.workflows[0].draft.nodes[1] as any).version = 2;
  expect(() => parseImportDocument(pin)).toThrow('published dependency');
  const prompt = structuredClone(b);
  prompt.prompts = [];
  expect(() => parseImportDocument(prompt)).toThrow('missing saved prompt');
  const duplicate = structuredClone(b);
  duplicate.workflows.push(duplicate.workflows[0]);
  expect(() => parseImportDocument(duplicate)).toThrow('unique workflow');
  const ownership = structuredClone(b);
  ownership.workflows[1].ownerWorkflowId = ownership.workflows[1].id;
  expect(() => parseImportDocument(ownership)).toThrow(/own/);
});
it('rejects conflicting selected exports in either order and deduplicates compatible dependencies', () => {
  const b = bundle(),
    conflict = structuredClone(b);
  conflict.workflows[1].versions[0].definition.nodes[1].label = 'different';
  for (const selections of [
    [file(legacy), file(b, 'a.json'), file(conflict, 'b.json')],
    [file(conflict, 'b.json'), file(b, 'a.json'), file(legacy)],
  ]) {
    const { store } = setup(),
      before = snapshot(store);
    expect(() => importSelection(store, selections)).toThrow(
      'Published version conflict',
    );
    expect(snapshot(store)).toEqual(before);
  }
  const { store } = setup();
  importSelection(store, [file(b, 'a.json'), file(b, 'b.json')]);
  expect(store.workflows()).toHaveLength(2);
  expect(store.list('prompts')).toHaveLength(1);
});
it('revalidates drafts, metadata, ownership, versions and prompts against changes made after preview', () => {
  for (const kind of ['draft', 'metadata', 'owner', 'version', 'prompt']) {
    const b = bundle(),
      { store } = setup();
    importWorkflows(store, b);
    if (kind === 'prompt') {
      const p = store.get<any>('prompts', b.prompts![0].id);
      store.put('prompts', { ...p, content: 'different' });
    } else if (kind === 'version') {
      const v = store.getVersion(b.workflows[1].id, 1)!;
      v.definition.nodes[1].label = 'different';
      store.version(v);
    } else {
      const w = store.workflows()[0];
      if (kind === 'draft') w.draft.nodes[0].label = 'different';
      if (kind === 'metadata') w.name = 'different';
      if (kind === 'owner') w.ownerWorkflowId = 'different';
      store.put('workflows', w);
    }
    const before = snapshot(store);
    expect(() => importSelection(store, [file(legacy), file(b)])).toThrow(
      /conflict/i,
    );
    expect(snapshot(store)).toEqual(before);
  }
});
it('rolls back all staged workflow, version, prompt and history writes after a natural storage failure seam', () => {
  const b = bundle(),
    { store } = setup(),
    before = snapshot(store);
  const original = store.put.bind(store);
  let writes = 0;
  vi.spyOn(store, 'put').mockImplementation((collection, value) => {
    if (++writes === 3) throw new Error('Disk write failed');
    original(collection, value);
  });
  expect(() => importSelection(store, [file(legacy), file(b)])).toThrow(
    'Disk write failed',
  );
  expect(snapshot(store)).toEqual(before);
});
it('preserves archive state and old local replacement and incomplete draft behavior', () => {
  const b = bundle(),
    { store, engine } = setup();
  importWorkflows(store, b);
  engine.update(b.rootId, { archived: true });
  importSelection(store, [file(b)]);
  expect(engine.workflow(b.rootId).archived).toBe(true);
  const changed = structuredClone(b);
  changed.workflows[0].name = 'replacement';
  expect(() => importSelection(store, [file(changed)])).toThrow(
    'Inspect the existing',
  );
  importWorkflows(store, changed, { force: true });
  expect(engine.workflow(b.rootId).name).toBe('replacement');
  const draft = blankDefinition();
  draft.edges = [];
  expect(parseImportDocument({ ...legacy, definition: draft }).format).toBe(
    'legacy',
  );
});
it.each([
  'http://github.com/a/b/tree/main/f',
  'https://evil.test/a/b/tree/main/f',
  'https://user@github.com/a/b/tree/main/f',
  'https://github.com/a/b/blob/main/f',
  'https://github.com/a/b/tree/main/%2e%2e',
  'https://github.com/a/b/tree/main/%ZZ',
])('rejects unsafe or non-folder URL %s', (value) =>
  expect(() => parseGithubFolderUrl(value)).toThrow(),
);
function network(files: Record<string, string>, ref = 'main') {
  const calls: string[] = [];
  const fetcher = vi.fn(async (value: string | URL | Request) => {
    const u = new URL(String(value));
    calls.push(u.pathname);
    if (u.pathname.includes('/commits/'))
      return u.pathname.endsWith(encodeURIComponent(ref))
        ? Response.json({ sha })
        : new Response('', { status: 404 });
    const path = decodeURIComponent(
      u.pathname.split('/contents/')[1] ??
        u.pathname.split(`/${sha}/`)[1] ??
        '',
    );
    if (path === 'workflows')
      return Response.json([
        ...Object.keys(files).map((name) => ({
          name,
          path: `workflows/${name}`,
          type: 'file',
          size: files[name].length,
        })),
        { name: 'nested', path: 'workflows/nested', type: 'dir' },
      ]);
    const content = files[path.replace('workflows/', '')];
    return content === undefined
      ? new Response('', { status: 404 })
      : new Response(content);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
it('resolves slash branches longest first, excludes nested files and isolates invalid JSON and missing dependency diagnostics', async () => {
  const b = bundle(),
    missing = structuredClone(b);
  missing.workflows.pop();
  const n = network(
    {
      '01.json': JSON.stringify(legacy),
      '02.json': JSON.stringify(b),
      'bad.json': '{',
      'metadata.json': '{"purpose":"unrelated"}',
      'missing.json': JSON.stringify(missing),
    },
    'codex/branch',
  );
  const { engine } = setup(),
    service = new GithubImports(engine, n.fetcher);
  const p = await service.discover(
    'https://github.com/owner/repo/tree/codex/branch/workflows',
  );
  expect(p.source.requestedRef).toBe('codex/branch');
  expect(p.source.resolvedCommit).toBe(sha);
  expect(p.choices).toHaveLength(2);
  expect(p.diagnostics).toHaveLength(2);
  expect(p.ignoredCount).toBe(1);
  expect(n.calls.some((x) => x.includes('nested'))).toBe(false);
  expect(p.choices[1].prompts).toHaveLength(1);
  expect(JSON.stringify(p)).not.toContain('Do the work');
});
it('pins reviewed content and guards unknown, duplicate, empty, expired and evicted selections', async () => {
  const { engine, store } = setup(),
    files = { '01.json': JSON.stringify(legacy) },
    n = network(files);
  let now = 0;
  const service = new GithubImports(engine, n.fetcher, () => now);
  const p = await service.discover(
    'https://github.com/owner/repo/tree/main/workflows',
  );
  files['01.json'] = JSON.stringify({ ...legacy, name: 'Moved branch' });
  expect(() => service.import(p.previewId, [])).toThrow('Nothing imported');
  expect(() => service.import(p.previewId, ['unknown'])).toThrow('preview');
  expect(() =>
    service.import(p.previewId, [p.choices[0].fileId, p.choices[0].fileId]),
  ).toThrow('unique');
  service.import(p.previewId, [p.choices[0].fileId]);
  expect(store.workflows()[0].name).toBe('Legacy');
  now = 15 * 60_000;
  expect(() => service.import(p.previewId, [p.choices[0].fileId])).toThrow(
    'expired',
  );
  now = 0;
  const old = await service.discover(
    'https://github.com/owner/repo/tree/main/workflows',
  );
  for (let i = 0; i < 8; i++)
    await service.discover('https://github.com/owner/repo/tree/main/workflows');
  expect(() => service.import(old.previewId, [old.choices[0].fileId])).toThrow(
    'removed',
  );
});
it.each([403, 429, 500])(
  'preserves GitHub rejection %s without probing shorter refs',
  async (status) => {
    const { engine } = setup(),
      fetcher = vi.fn(
        async () =>
          new Response('', {
            status,
            headers: status === 429 ? { 'retry-after': '10' } : {},
          }),
      );
    const service = new GithubImports(engine, fetcher as typeof fetch);
    await expect(
      service.discover(
        'https://github.com/owner/repo/tree/codex/branch/workflows',
      ),
    ).rejects.toThrow(status === 429 ? 'Retry after 10' : 'GitHub rejected');
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it('handles missing folders, empty folders, body limits and network failures without writes', async () => {
  const { engine, store } = setup();
  const failures = [
    vi.fn(async () => {
      throw new Error('offline');
    }),
    vi.fn(async (v: any) =>
      String(v).includes('/commits/')
        ? Response.json({ sha })
        : new Response('', { status: 404 }),
    ),
    vi.fn(async (v: any) =>
      String(v).includes('/commits/')
        ? Response.json({ sha })
        : new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    ),
  ];
  for (const f of failures)
    await expect(
      new GithubImports(engine, f as typeof fetch).discover(url),
    ).rejects.toThrow();
  const p = await new GithubImports(engine, network({}, sha).fetcher).discover(
    url,
  );
  expect(p.choices).toEqual([]);
  expect(store.workflows()).toEqual([]);
});
it('shares router discovery and strict selection contracts without adding force options', async () => {
  const { engine } = setup(),
    caller = appRouter.createCaller({ engine });
  await expect(
    caller.workflows.discoverGithubFolder({ url: 'https://evil.test/a' }),
  ).rejects.toThrow('public github.com');
  await expect(
    caller.workflows.importGithubSelection({
      previewId: '00000000-0000-4000-8000-000000000000',
      fileIds: ['a'],
      force: true,
    } as any),
  ).rejects.toThrow();
});

it('imports the frozen 01/02/03 fixture identities and rejects 04 without any partial changes', async () => {
  const { readFileSync, existsSync, mkdtempSync, rmSync } =
    await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(
      readFileSync(
        new URL(`./fixtures/github-import/${name}.json`, import.meta.url),
        'utf8',
      ),
    );
  const a = read('01-quick-summary'),
    b = read('02-review-checklist'),
    c = read('03-team-summary'),
    conflict = read('04-review-checklist-conflict');
  const { store } = setup();
  importSelection(store, [file(a, '01'), file(b, '02'), file(c, '03')]);
  expect(store.workflows().filter((w) => !w.ownerWorkflowId)).toHaveLength(3);
  expect(store.workflows().filter((w) => w.ownerWorkflowId)).toHaveLength(1);
  expect(store.list('prompts')).toHaveLength(1);
  expect(
    store.getVersion(c.workflows.find((w: any) => w.ownerWorkflowId).id, 1),
  ).toBeDefined();
  expect(store.get<any>('workflows', c.rootId).draft).toEqual(
    c.workflows.find((w: any) => w.id === c.rootId).draft,
  );
  const before = snapshot(store);
  expect(importSelection(store, [file(b), file(c)]).changedWorkflowIds).toEqual(
    [],
  );
  expect(snapshot(store)).toEqual(before);
  expect(() =>
    importSelection(store, [file(a), file(c), file(conflict)]),
  ).toThrow(/conflict/i);
  expect(snapshot(store)).toEqual(before);
  const markerDir = mkdtempSync(join(tmpdir(), 'interlock-import-marker-'));
  try {
    for (const language of ['javascript', undefined]) {
      const marker = join(markerDir, language ?? 'bash');
      const definition = blankDefinition();
      definition.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'script',
        label: 'Must not execute',
        ...(language ? { language } : {}),
        command: language
          ? `await import('node:fs').then(fs=>fs.writeFileSync(${JSON.stringify(marker)},'executed'))`
          : `touch '${marker}'`,
      });
      importSelection(store, [file({ ...legacy, definition })]);
      expect(existsSync(marker)).toBe(false);
    }
    expect(store.runs()).toEqual([]);
    expect(store.work()).toEqual([]);
    expect(store.list('events')).toEqual([]);
  } finally {
    rmSync(markerDir, { recursive: true, force: true });
  }
});
it('excludes symlink and submodule files and rejects complete-scan limits', async () => {
  const { engine } = setup();
  const fetcher = (entries: any[]) =>
    vi.fn(async (v: any) =>
      String(v).includes('/commits/')
        ? Response.json({ sha })
        : Response.json(entries),
    ) as typeof fetch;
  const entry = (i: number) => ({
    name: `${i}.json`,
    path: `workflows/${i}.json`,
    type: 'file',
    size: 10,
  });
  for (const entries of [
    Array.from({ length: 201 }, (_, i) => ({ ...entry(i), type: 'dir' })),
    Array.from({ length: 101 }, (_, i) => entry(i)),
  ])
    await expect(
      new GithubImports(engine, fetcher(entries)).discover(url),
    ).rejects.toThrow('smaller folder');
  const p = await new GithubImports(
    engine,
    fetcher([
      { ...entry(1), target: 'elsewhere' },
      { ...entry(2), submodule_git_url: 'https://example.test' },
    ]),
  ).discover(url);
  expect(p.choices).toEqual([]);
});
it('times out stalled metadata requests and rejects aggregate JSON limits with recoverable errors', async () => {
  const { engine } = setup();
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(
      (_v: any, options: any) =>
        new Promise<Response>((_resolve, reject) =>
          options.signal.addEventListener('abort', () =>
            reject(new Error('Timeout')),
          ),
        ),
    );
    const pending = new GithubImports(engine, fetcher as typeof fetch).discover(
      url,
    );
    const expected = expect(pending).rejects.toThrow('Check your connection');
    await vi.advanceTimersByTimeAsync(60_001);
    await expected;
  } finally {
    vi.useRealTimers();
  }
  const text = JSON.stringify({ ...legacy, description: 'x'.repeat(950_000) }),
    files = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`${i}.json`, text]),
    );
  await expect(
    new GithubImports(engine, network(files, sha).fetcher).discover(url),
  ).rejects.toThrow('8 MiB');
});
