import { expect, it, vi } from 'vitest';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition, nodeSchema } from '@interlock/core';
import { exportWorkflows } from '../packages/runtime/src/transfer';
import {
  importSelection,
  inspectImportDocument,
} from '../packages/runtime/src/importSelection';
import { GithubImporter } from '../packages/server/src/githubImport';

const commit = 'a'.repeat(40);
const url = 'https://github.com/owner/repo/tree/codex/fixtures/workflows';
const source = { owner: 'owner', repo: 'repo', commit, folder: 'workflows' };
const legacy = {
  name: 'Legacy',
  description: '<script>data</script>',
  definition: blankDefinition(),
};
function fixture(entries: Record<string, unknown> = { 'good.json': legacy }) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input));
    if (path.pathname === '/repos/owner/repo')
      return Response.json({ private: false });
    if (
      decodeURIComponent(path.pathname) ===
      '/repos/owner/repo/commits/codex/fixtures'
    )
      return Response.json({ sha: commit });
    if (path.pathname.includes('/commits/'))
      return new Response('', { status: 404 });
    if (path.pathname === '/repos/owner/repo/contents/workflows')
      return Response.json([
        ...Object.keys(entries).map((name) => ({
          name,
          path: `workflows/${name}`,
          type: 'file',
          size: 1,
        })),
        { name: 'nested', path: 'workflows/nested', type: 'dir' },
        { name: 'linked.json', path: 'workflows/linked.json', type: 'symlink' },
        {
          name: 'submodule.json',
          path: 'workflows/submodule.json',
          type: 'file',
          submodule_git_url: 'remote',
        },
      ]);
    const name = path.pathname.split('/').at(-1)!;
    if (name in entries)
      return new Response(
        typeof entries[name] === 'string'
          ? (entries[name] as string)
          : JSON.stringify(entries[name]),
      );
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}

it('resolves slash branches, freezes commit and excludes nested, symlink, unrelated and invalid files', async () => {
  const fetcher = fixture({
    'good.json': legacy,
    'metadata.json': { name: 'metadata' },
    'invalid.json': '{',
  });
  const result = await new GithubImporter(fetcher).discover(url);
  expect(result.source).toEqual(source);
  expect(result.items.map((item) => [item.file, item.valid])).toEqual([
    ['good.json', true],
    ['invalid.json', false],
    ['metadata.json', false],
  ]);
  expect(result.items[0].description).toBe('<script>data</script>');
  for (const call of vi
    .mocked(fetcher)
    .mock.calls.filter((c) => String(c[0]).includes('/contents/')))
    expect(new URL(String(call[0])).searchParams.get('ref')).toBe(commit);
  const downloads = vi
    .mocked(fetcher)
    .mock.calls.filter(
      (call) =>
        new URL(String(call[0])).hostname === 'raw.githubusercontent.com',
    );
  expect(downloads).toHaveLength(3);
  for (const call of downloads)
    expect(new URL(String(call[0])).pathname).toMatch(
      new RegExp(`^/owner/repo/${commit}/workflows/`),
    );
  expect(
    vi
      .mocked(fetcher)
      .mock.calls.some((call) =>
        String(call[0]).includes('/contents/workflows/'),
      ),
  ).toBe(false);
});

it.each(['GitHub rejected', 'Cannot reach GitHub', 'GitHub returned HTTP'])(
  'keeps valid files discoverable when invalid content includes %s',
  async (workflowId) => {
    const definition = blankDefinition();
    definition.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'workflow',
      label: 'Missing child',
      workflowId,
      version: 1,
    });
    const invalid = {
      format: 'interlock-workflows',
      formatVersion: 1,
      rootId: 'root',
      workflows: [
        {
          id: 'root',
          name: 'Broken',
          description: '',
          ownerWorkflowId: null,
          draft: definition,
          draftRevision: 1,
          versions: [],
        },
      ],
    };
    const result = await new GithubImporter(
      fixture({
        'bad.json': invalid,
        'good.json': legacy,
      }),
    ).discover(url);
    expect(result.items.map((item) => [item.file, item.valid])).toEqual([
      ['bad.json', false],
      ['good.json', true],
    ]);
    expect(result.items[0].error).toContain(
      `missing workflow dependency ${workflowId}`,
    );
  },
);

it('keeps malformed workflow diagnostics concise and actionable', async () => {
  const definition = blankDefinition();
  const invalid = structuredClone(legacy) as any;
  invalid.definition = definition;
  invalid.definition.nodes[1].kind = 'unsupported';
  const result = await new GithubImporter(
    fixture({ 'bad.json': invalid }),
  ).discover(url);
  expect(result.items[0].valid).toBe(false);
  expect(result.items[0].error).toBe(
    'Invalid workflow at definition.nodes.1.kind: Unsupported node kind. Correct the export file.',
  );
});

it('stops discovery on actual download transport failures', async () => {
  const base = fixture();
  for (const failure of ['http', 'stream']) {
    const fetcher: typeof fetch = (input, init) => {
      if (new URL(String(input)).hostname !== 'raw.githubusercontent.com')
        return base(input, init);
      return Promise.resolve(
        failure === 'http'
          ? new Response('', { status: 503 })
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error('connection lost'));
                },
              }),
            ),
      );
    };
    await expect(new GithubImporter(fetcher).discover(url)).rejects.toThrow(
      failure === 'http'
        ? 'GitHub returned HTTP 503'
        : 'GitHub response was interrupted',
    );
  }
});

it('shows GitHub retry metadata when rate limited', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response('', {
      status: 429,
      headers: { 'retry-after': '30' },
    }),
  );
  await expect(new GithubImporter(fetcher).discover(url)).rejects.toThrow(
    'Retry after 30 seconds',
  );
});

it('rejects unsupported URLs, missing folders and public API errors with recovery feedback', async () => {
  const importer = new GithubImporter(fixture());
  for (const bad of [
    'http://github.com/o/r/tree/main/f',
    'https://evil.example/o/r/tree/main/f',
    'https://github.com/o/r/blob/main/f',
    'https://user@github.com/o/r/tree/main/f',
    'https://github.com/o/r/tree/main/f?token=x',
  ])
    await expect(importer.discover(bad)).rejects.toThrow();
  await expect(
    new GithubImporter(
      vi.fn().mockResolvedValue(new Response('', { status: 429 })),
    ).discover(url),
  ).rejects.toThrow('Wait and retry');
  await expect(
    new GithubImporter(
      vi.fn().mockRejectedValue(new Error('offline')),
    ).discover(url),
  ).rejects.toThrow('Check your connection and retry');
  const missing = fixture();
  const wrapped: typeof fetch = (input, init) =>
    String(input).includes('/contents/')
      ? Promise.resolve(new Response('', { status: 404 }))
      : missing(input, init);
  await expect(new GithubImporter(wrapped).discover(url)).rejects.toThrow(
    'folder was not found',
  );
  const empty = await new GithubImporter(fixture({})).discover(url);
  expect(empty.items).toEqual([]);
});

it('preserves pins, ownership, prompts, no-op reimports and creates legacy copies without runs', () => {
  const origin = new Store(':memory:'),
    target = new Store(':memory:');
  const a = new Engine(origin, process.cwd()),
    b = new Engine(target, process.cwd());
  try {
    const prompt = a.prompts.create({
      name: 'Guide',
      description: '',
      content: 'Instructions',
    });
    const owner = a.create('Owner');
    const childDefinition = blankDefinition();
    childDefinition.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'agent',
      label: 'Guided',
      prompt: 'Task',
      promptIds: [prompt.id],
    });
    const child = a.create('Child', '', childDefinition, owner.id);
    a.publish(child.id);
    const definition = blankDefinition();
    definition.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'workflow',
      label: 'Child',
      workflowId: child.id,
      version: 1,
    });
    a.update(owner.id, { draft: definition, draftRevision: 1 });
    a.publish(owner.id);
    const bundle = exportWorkflows(origin, owner.id);
    const preview = inspectImportDocument(bundle);
    expect(preview.workflows).toEqual([
      { id: child.id, name: 'Child', owned: true },
    ]);
    expect(preview.prompts).toEqual([{ id: prompt.id, name: 'Guide' }]);
    importSelection(b, [legacy, bundle]);
    expect(target.workflows()).toHaveLength(3);
    expect(target.list('prompts')).toHaveLength(1);
    expect(b.workflow(child.id).ownerWorkflowId).toBe(owner.id);
    expect(target.getVersion(owner.id, 1)?.definition).toEqual(
      origin.getVersion(owner.id, 1)?.definition,
    );
    const before = target.workflows();
    expect(importSelection(b, [bundle]).changed).toEqual([]);
    expect(target.workflows()).toEqual(before);
    importSelection(b, [legacy]);
    expect(target.workflows()).toHaveLength(4);
    expect(target.runs()).toEqual([]);
    const omitted = structuredClone(bundle);
    omitted.workflows = omitted.workflows.filter((w) => w.id !== child.id);
    expect(() => inspectImportDocument(omitted)).toThrow(
      'missing workflow dependency',
    );
  } finally {
    a.stop();
    b.stop();
    origin.close();
    target.close();
  }
});

it('rejects cross-file and late conflicts with complete workflow and prompt rollback', async () => {
  const origin = new Store(':memory:'),
    target = new Store(':memory:');
  const a = new Engine(origin, process.cwd()),
    b = new Engine(target, process.cwd());
  try {
    const w = a.create('Published');
    a.publish(w.id);
    const bundle = exportWorkflows(origin, w.id),
      conflict = structuredClone(bundle);
    conflict.workflows[0].versions[0].definition.nodes[1].label = 'Different';
    expect(() => importSelection(b, [legacy, bundle, conflict])).toThrow(
      'Selected files conflict',
    );
    expect(target.workflows()).toEqual([]);
    importSelection(b, [bundle]);
    const fetcher = fixture({ 'legacy.json': legacy, 'bundle.json': conflict });
    const importer = new GithubImporter(fetcher);
    const preview = await importer.discover(url);
    expect(preview.items.every((i) => i.valid)).toBe(true);
    const before = target.workflows();
    await expect(
      importer.import(b, preview.source, ['legacy.json', 'bundle.json']),
    ).rejects.toThrow('Nothing imported: Published version conflict');
    expect(target.workflows()).toEqual(before);
    expect(target.list('prompts')).toEqual([]);
    b.update(w.id, { name: 'Changed since preview' });
    expect(() => importSelection(b, [legacy, bundle])).toThrow(
      'Draft conflict',
    );
    expect(target.workflows()).toHaveLength(1);
    await expect(
      importer.import(b, source, ['../nested.json']),
    ).rejects.toThrow('not a direct JSON file');
  } finally {
    a.stop();
    b.stop();
    origin.close();
    target.close();
  }
});

it('continues ref resolution after GitHub returns 422 for a candidate containing folder segments', async () => {
  const base = fixture({});
  const fetcher: typeof fetch = (input, init) =>
    String(input).includes('/commits/codex%2Ffixtures%2Fworkflows')
      ? Promise.resolve(new Response('', { status: 422 }))
      : base(input, init);
  const nested: typeof fetch = (input, init) =>
    String(input).includes('/contents/workflows/empty')
      ? Promise.resolve(Response.json([]))
      : fetcher(input, init);
  const result = await new GithubImporter(nested).discover(url + '/empty');
  expect(result.source.folder).toBe('workflows/empty');
});
