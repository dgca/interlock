// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImportWorkflowDialog } from '../packages/ui/src/features/workflows/ImportWorkflowDialog';
const calls = vi.hoisted(() => ({
  discover: vi.fn(),
  import: vi.fn(),
  create: vi.fn(),
  bundle: vi.fn(),
  starters: vi.fn(),
  add: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    workflows: {
      discoverGithub: { query: calls.discover },
      importGithub: { mutate: calls.import },
      create: { mutate: calls.create },
      import: { mutate: calls.bundle },
      starters: { query: calls.starters },
      importStarter: { mutate: calls.add },
      previewImport: { query: calls.preview },
    },
  },
  errorMessage: (e: Error) => e.message,
}));
const source = {
  owner: 'o',
  repo: 'r',
  commit: 'a'.repeat(40),
  folder: 'workflows',
};
const preview = {
  source,
  items: [
    {
      file: 'one.json',
      valid: true,
      name: 'One',
      description: '<b>Text as data</b>',
      workflows: [],
      prompts: [],
      error: '',
    },
  ],
};
const catalog = [
  {
    id: 'sdlc',
    name: 'SDLC workflow',
    description: 'Plan a change',
    requirements: 'Needs a coding agent',
    nodeCount: 27,
  },
];
let root: Root,
  container: HTMLDivElement,
  key = 0;
const close = vi.fn(),
  imported = vi.fn();
async function render(rows: any[] = catalog, allowLocalFile = true) {
  calls.starters.mockResolvedValue(rows);
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(ImportWorkflowDialog, {
          key: ++key,
          onClose: close,
          onImported: imported,
          allowLocalFile,
          act: async (fn) => {
            try {
              await fn();
            } catch {}
          },
        }),
      ),
    ),
  );
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => 'intent-' + Math.random()),
  });
  for (const c of Object.values(calls)) c.mockReset();
  calls.discover.mockResolvedValue(preview);
  calls.import.mockResolvedValue({ rootIds: ['one'] });
  calls.create.mockResolvedValue({ id: 'created' });
  calls.bundle.mockResolvedValue({ rootId: 'bundle' });
  calls.add.mockResolvedValue({ workflow: { id: 'starter' }, created: true });
  calls.preview.mockImplementation(async ({ document }) => ({
    name: document.name ?? 'Bundle',
    description: document.description ?? '',
    workflows: [],
    prompts: [],
    published: document.format === 'interlock-workflows',
  }));
  close.mockReset();
  imported.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;
async function click(text: string) {
  await act(async () => button(text).click());
}
async function text(value: string, textarea = false) {
  const el = document.querySelector(
    textarea
      ? 'textarea'
      : 'input:not([type="radio"]):not([type="checkbox"]):not([type="file"])',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      textarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function github() {
  await click('GitHub folder');
  await text('https://github.com/o/r/tree/main/workflows');
  await click('Find workflows');
}
async function check() {
  await act(async () => {
    (
      document.querySelector('input[type="checkbox"]') as HTMLInputElement
    ).click();
  });
}
async function file(value: string, name = 'workflow.json') {
  const input = document.querySelector('input[type="file"]')!;
  const f = new File([value], name, { type: 'application/json' });
  Object.defineProperty(f, 'text', { value: async () => value });
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  await act(async () =>
    input.dispatchEvent(new Event('change', { bubbles: true })),
  );
}
it('starts with bundled choices and creates nothing until the user adds one', async () => {
  expect(document.body.textContent).toContain('Starter workflows');
  expect(calls.add).not.toHaveBeenCalled();
  await click('Add to library');
  expect(calls.add).toHaveBeenCalledWith(
    expect.objectContaining({
      starterId: 'sdlc',
      copy: false,
      requestId: expect.any(String),
    }),
  );
  expect(imported).toHaveBeenCalledWith(['starter']);
});
it('opens an existing copy and makes adding another an explicit choice', async () => {
  await render([
    {
      ...catalog[0],
      existing: {
        id: 'mine',
        name: 'My procedure',
        archived: false,
        latestVersion: 2,
      },
    },
  ]);
  await click('Open workflow');
  expect(imported).toHaveBeenCalledWith(['mine']);
  expect(calls.add).not.toHaveBeenCalled();
  await check();
  await click('Add to library');
  expect(calls.add).toHaveBeenCalledWith(
    expect.objectContaining({ copy: true }),
  );
});
it('reuses a request key after an uncertain starter response', async () => {
  calls.add.mockRejectedValueOnce(Error('connection lost'));
  await click('Add to library');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'connection lost',
  );
  await click('Add to library');
  expect(calls.add.mock.calls[1][0]).toEqual(calls.add.mock.calls[0][0]);
});
it('preserves discovered choices across sources and imports their exact pinned selection', async () => {
  await github();
  await check();
  expect(document.body.textContent).not.toContain('0 saved prompts');
  await click('Paste JSON');
  await click('GitHub folder');
  expect(
    (document.querySelector('input[type="checkbox"]') as HTMLInputElement)
      .checked,
  ).toBe(true);
  await click('Import workflow');
  expect(calls.import).toHaveBeenCalledWith({ source, files: ['one.json'] });
  expect(imported).toHaveBeenCalledWith(['one']);
  expect(document.querySelector('b')).toBeNull();
});
it('reports all roots after a multi-file import', async () => {
  calls.discover.mockResolvedValue({
    source,
    items: [
      preview.items[0],
      { ...preview.items[0], name: 'Two', file: 'two.json' },
    ],
  });
  calls.import.mockResolvedValue({ rootIds: ['one', 'two'] });
  await github();
  await act(async () => {
    document
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((e) => e.click());
  });
  await click('Import 2 workflows');
  expect(imported).toHaveBeenCalledWith(['one', 'two']);
});
it('ignores stale discovery results when the URL changes', async () => {
  let resolve!: (v: unknown) => void;
  calls.discover
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({ source, items: [] });
  await click('GitHub folder');
  await text('first');
  await click('Find workflows');
  await text('second');
  await click('Find workflows');
  await act(async () => resolve(preview));
  expect(document.body.textContent).toContain('No importable workflows');
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
});
it('keeps discovery errors with their source and allows retry', async () => {
  calls.discover.mockRejectedValueOnce(Error('offline'));
  await github();
  expect(document.body.textContent).toContain('offline');
  await click('Starters');
  expect(document.body.textContent).not.toContain('offline');
  await click('GitHub folder');
  await click('Find workflows');
  expect(document.body.textContent).toContain('One');
});
it('requires a JSON preview before mutating and preserves the exact input', async () => {
  const data = { name: 'Legacy', definition: { nodes: [], edges: [] } };
  await click('Paste JSON');
  await text(JSON.stringify(data), true);
  expect(calls.create).not.toHaveBeenCalled();
  await click('Preview workflow');
  expect(calls.create).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Added as a draft');
  await click('Import workflow');
  expect(calls.create).toHaveBeenCalledWith(data);
  expect(imported).toHaveBeenCalledWith(['created']);
});
it('keeps the file picker inside the dialog and previews before importing', async () => {
  await click('Local file');
  const pick = vi.spyOn(HTMLInputElement.prototype, 'click');
  await click('Choose JSON file');
  expect(pick).toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  pick.mockRestore();
  await file('{"name":"File workflow"}');
  expect(calls.create).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('File workflow');
  await click('Import workflow');
  expect(calls.create).toHaveBeenCalledWith({ name: 'File workflow' });
});
it('keeps invalid JSON editable and shows an inline error', async () => {
  await click('Paste JSON');
  await text('{broken', true);
  await click('Preview workflow');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'valid JSON',
  );
  expect(
    (document.querySelector('textarea') as HTMLTextAreaElement).value,
  ).toBe('{broken');
  expect(calls.create).not.toHaveBeenCalled();
});
it('keeps the latest selected file when an earlier file finishes reading late', async () => {
  await click('Local file');
  let resolve!: (text: string) => void;
  const slow = new File(['old'], 'old.json', { type: 'application/json' });
  Object.defineProperty(slow, 'text', {
    value: () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
  });
  const input = document.querySelector('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [slow], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await file('{"name":"Latest choice"}', 'new.json');
  await act(async () => resolve('{"name":"Old choice"}'));
  expect(document.body.textContent).toContain('Latest choice');
  expect(document.body.textContent).not.toContain('Old choice');
  await click('Import workflow');
  expect(calls.create).toHaveBeenCalledWith({ name: 'Latest choice' });
});
it('previews portable bundle imports without changing replacement flags', async () => {
  const data = {
    format: 'interlock-workflows',
    name: 'Bundle',
    rootId: 'root',
  };
  await click('Paste JSON');
  await text(JSON.stringify(data), true);
  await click('Preview workflow');
  await click('Import workflow');
  expect(calls.bundle).toHaveBeenCalledWith({ bundle: data });
});
it('does not offer file upload when the surface disables it', async () => {
  await render(catalog, false);
  expect(button('Local file')).toBeUndefined();
});
it('prevents overlapping imports and explains uncertain GitHub delivery', async () => {
  let reject!: (v: Error) => void;
  calls.import.mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  await github();
  await check();
  await act(async () => {
    button('Import workflow').click();
    button('Import workflow')?.click();
  });
  expect(calls.import).toHaveBeenCalledTimes(1);
  await act(async () => reject(Error('connection lost')));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Inspect the library before retrying',
  );
  expect(close).not.toHaveBeenCalled();
});
