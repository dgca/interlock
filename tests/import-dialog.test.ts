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
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    workflows: {
      discoverGithub: { query: calls.discover },
      importGithub: { mutate: calls.import },
      create: { mutate: calls.create },
      import: { mutate: calls.bundle },
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
let root: Root, container: HTMLDivElement;
const close = vi.fn(),
  local = vi.fn(),
  imported = vi.fn();
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
  calls.discover.mockReset();
  calls.import.mockReset();
  calls.create.mockReset().mockResolvedValue({ id: 'new-workflow' });
  calls.bundle.mockReset().mockResolvedValue({ rootId: 'bundle-root' });
  imported.mockReset();
  close.mockReset();
  local.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(ImportWorkflowDialog, {
          onClose: close,
          onLocalFile: local,
          onImported: imported,
          act: async (fn) => {
            try {
              await fn();
            } catch {}
          },
        }),
      ),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function input(value: string) {
  const el = document.querySelector(
    'input:not([type="radio"]):not([type="checkbox"])',
  )! as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  )!;
  await act(async () => button.click());
}
it('requires explicit selection and import, renders descriptions as text and retains error for retry', async () => {
  calls.discover.mockResolvedValue(preview);
  calls.import
    .mockRejectedValueOnce(new Error('Nothing imported: Late conflict'))
    .mockResolvedValue({ changed: [] });
  await input('https://github.com/o/r/tree/main/workflows');
  await click('Find workflows');
  expect(document.querySelector('b')).toBeNull();
  expect(document.body.textContent).toContain('<b>Text as data</b>');
  expect(calls.import).not.toHaveBeenCalled();
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Import selected',
  )!;
  expect(button.disabled).toBe(true);
  await act(async () =>
    (
      document.querySelector('input[type="checkbox"]')! as HTMLInputElement
    ).click(),
  );
  await click('Import selected');
  expect(document.body.textContent).toContain('Late conflict');
  expect(document.body.textContent).not.toContain('could not be confirmed');
  expect(close).not.toHaveBeenCalled();
  await click('Import selected');
  expect(close).toHaveBeenCalledTimes(1);
  expect(calls.import).toHaveBeenLastCalledWith({
    source,
    files: ['one.json'],
  });
});
it('warns to inspect the library before retrying an uncertain import', async () => {
  calls.discover.mockResolvedValue(preview);
  calls.import.mockRejectedValue(new Error('Connection lost'));
  await input('https://github.com/o/r/tree/main/workflows');
  await click('Find workflows');
  await act(async () =>
    (
      document.querySelector('input[type="checkbox"]')! as HTMLInputElement
    ).click(),
  );
  await click('Import selected');
  expect(document.body.textContent).toContain(
    'The import result could not be confirmed',
  );
  expect(document.body.textContent).toContain(
    'Inspect the library before retrying, especially for legacy files',
  );
  expect(document.body.textContent).not.toContain('Nothing imported:');
  expect(close).not.toHaveBeenCalled();
  expect(calls.import).toHaveBeenCalledTimes(1);
});
it('discards slow prior results after source edits, and closing never imports', async () => {
  let resolve!: (value: typeof preview) => void;
  calls.discover
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValue({ source, items: [] });
  await input('first');
  await click('Find workflows');
  await input('second');
  await click('Find workflows');
  await act(async () => resolve(preview));
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  expect(document.body.textContent).toContain('No importable workflows');
  await click('Cancel');
  expect(close).toHaveBeenCalledTimes(1);
  expect(calls.import).not.toHaveBeenCalled();
});
it('recovers discovery errors and offers the existing local file picker', async () => {
  calls.discover
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(preview);
  await input('source');
  await click('Find workflows');
  expect(document.body.textContent).toContain('offline');
  await click('Retry discovery');
  expect(document.querySelector('input[type="checkbox"]')).not.toBeNull();
  const label = [...document.querySelectorAll('label')].find(
    (l) => l.textContent === 'Local file',
  )!;
  await act(async () => label.click());
  await click('Choose JSON file');
  expect(local).toHaveBeenCalled();
});

async function paste(value: string) {
  const el = document.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function choosePaste() {
  await act(async () =>
    [...document.querySelectorAll('label')]
      .find((l) => l.textContent === 'Paste JSON')!
      .click(),
  );
}
it('imports pasted legacy JSON only on explicit action and preserves server payload', async () => {
  await choosePaste();
  const data = { name: 'Pasted legacy', ownerWorkflowId: 'parent' };
  await paste(JSON.stringify(data));
  expect(calls.create).not.toHaveBeenCalled();
  await click('Import JSON');
  expect(calls.create).toHaveBeenCalledWith(data);
  expect(calls.bundle).not.toHaveBeenCalled();
  expect(imported).toHaveBeenCalledWith('new-workflow');
  expect(close).toHaveBeenCalledOnce();
});
it('retains invalid JSON and import errors for correction, then imports bundles without force', async () => {
  await choosePaste();
  await paste('{');
  await click('Import JSON');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Enter valid JSON',
  );
  expect(document.querySelector('textarea')?.value).toBe('{');
  expect(calls.create).not.toHaveBeenCalled();
  await paste('null');
  await click('Import JSON');
  expect(document.body.textContent).toContain('Expected a workflow object');
  const bundle = {
    format: 'interlock-workflows',
    formatVersion: 2,
    workflows: [],
    prompts: [],
  };
  calls.bundle
    .mockRejectedValueOnce(new Error('Draft conflict'))
    .mockResolvedValueOnce({ rootId: 'bundle-root' });
  await paste(JSON.stringify(bundle));
  await click('Import JSON');
  expect(document.body.textContent).toContain('Draft conflict');
  expect(close).not.toHaveBeenCalled();
  expect(imported).not.toHaveBeenCalled();
  await click('Import JSON');
  expect(calls.bundle).toHaveBeenLastCalledWith({ bundle });
  expect(imported).toHaveBeenCalledWith('bundle-root');
});
it('blocks duplicate paste submissions and closing while the import is pending', async () => {
  let resolve!: (value: { id: string }) => void;
  calls.create.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await choosePaste();
  await paste('{"name":"One"}');
  await click('Import JSON');
  await click('Importing…');
  await click('Cancel');
  expect(close).not.toHaveBeenCalled();
  expect(calls.create).toHaveBeenCalledOnce();
  await act(async () => resolve({ id: 'new-workflow' }));
  expect(close).toHaveBeenCalledOnce();
});
