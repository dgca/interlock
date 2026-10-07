// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkflowLibrary } from '../packages/ui/src/features/workflows/WorkflowLibrary';
import { GithubImportDialog } from '../packages/ui/src/features/workflows/GithubImportDialog';
const { query, mutate, create, importBundle } = vi.hoisted(() => ({
  query: vi.fn(),
  mutate: vi.fn(),
  create: vi.fn(),
  importBundle: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    workflows: {
      discoverGithubFolder: { query },
      importGithubSelection: { mutate },
      create: { mutate: create },
      import: { mutate: importBundle },
    },
  },
  download: vi.fn(),
  errorMessage: (e: Error) => e.message,
}));
vi.mock('../packages/ui/src/components/Modal/Modal', () => ({
  Modal: ({ children, closeDisabled, onClose }: any) =>
    h(
      'div',
      {},
      h(
        'button',
        { disabled: closeDisabled, onClick: onClose },
        'Close dialog',
      ),
      children,
    ),
}));
let root: Root, container: HTMLDivElement;
const close = vi.fn(),
  refresh = vi.fn();
const preview = (name = 'Root', id = 'preview') => ({
  previewId: id,
  expiresAt: 'later',
  source: {
    owner: 'owner',
    repository: 'repo',
    requestedRef: 'main',
    resolvedCommit: 'a'.repeat(40),
    folder: 'workflows',
  },
  choices: [
    {
      fileId: name,
      filename: name + '.json',
      name,
      description: '<img src=x onerror=alert(1)>',
      format: 'portable',
      rootId: name,
      versions: [1],
      workflows: [
        { id: 'child', name: 'Child', ownerWorkflowId: name, versions: [1] },
      ],
      prompts: [{ id: 'prompt', name: 'Instructions' }],
    },
  ],
  diagnostics: [],
  ignoredCount: 0,
});
const click = async (text: string) =>
  act(async () => {
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === text)!
      .click();
  });
const edit = async (value: string) =>
  act(async () => {
    const input = container.querySelector<HTMLInputElement>(
      'input:not([type=checkbox])',
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const deferred = () => {
  let resolve!: (v: any) => void, reject!: (e: any) => void;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  query.mockReset();
  mutate.mockReset();
  close.mockReset();
  refresh.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(MemoryRouter, {}, h(GithubImportDialog, { onClose: close, refresh })),
      ),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('selects explicitly, renders descriptions as text, and distinguishes completed refresh failures', async () => {
  query.mockResolvedValue(preview());
  await edit('https://github.com/o/r/tree/main/workflows');
  await click('Load workflows');
  expect(mutate).not.toHaveBeenCalled();
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('<img');
  expect(
    container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked,
  ).toBe(false);
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(),
  );
  refresh.mockRejectedValue(new Error('Offline'));
  mutate.mockResolvedValue({
    results: [
      {
        fileId: 'Root',
        filename: 'Root.json',
        rootId: 'Root',
        rootChanged: true,
      },
    ],
    changedWorkflowIds: ['Root', 'child'],
    changedPromptIds: ['prompt'],
  });
  await click('Import 1 workflows');
  expect(mutate).toHaveBeenCalledWith({
    previewId: 'preview',
    fileIds: ['Root'],
  });
  expect(container.textContent).toContain(
    'Import completed, but the library could not refresh',
  );
  expect(document.activeElement?.textContent).toBe('Import completed');
});
it('ignores obsolete success, error and finally while the latest source stays loading', async () => {
  const old = deferred(),
    latest = deferred();
  query.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  await edit('https://github.com/o/r/tree/A/workflows');
  await click('Load workflows');
  await edit('https://github.com/o/r/tree/B/workflows');
  await click('Load workflows');
  await act(async () => old.resolve(preview('Old')));
  expect(container.textContent).not.toContain('Old.json');
  expect(container.textContent).toContain('Loading workflows...');
  await act(async () => latest.resolve(preview('Latest', 'latest')));
  expect(container.textContent).toContain('Latest.json');
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(),
  );
  await edit('https://github.com/o/r/tree/C/workflows');
  expect(container.querySelector('input[type=checkbox]')).toBeNull();
  expect(mutate).not.toHaveBeenCalled();
});
it('cancels pending discovery and recovers from rejected network requests without stale choices', async () => {
  const old = deferred();
  query.mockReturnValueOnce(old.promise);
  await edit('https://github.com/o/r/tree/A/workflows');
  await click('Load workflows');
  await click('Cancel loading');
  await act(async () => old.reject(new Error('Old error')));
  expect(container.textContent).not.toContain('Old error');
  query.mockRejectedValueOnce(
    new Error('GitHub rate limit reached. Retry after 10 seconds.'),
  );
  await click('Load workflows');
  expect(container.textContent).toContain('Retry after 10 seconds');
  query.mockResolvedValueOnce(preview());
  await click('Retry');
  expect(container.textContent).toContain('Root.json');
});
it('keeps confirmed conflicts distinct from unknown outcomes and visibly disables close during import', async () => {
  query.mockResolvedValue(preview());
  await edit('https://github.com/o/r/tree/main/workflows');
  await click('Load workflows');
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(),
  );
  const pending = deferred();
  mutate.mockReturnValueOnce(pending.promise);
  await click('Import 1 workflows');
  expect(
    [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Close dialog',
    )!.disabled,
  ).toBe(true);
  await act(async () =>
    pending.reject(new Error('Nothing imported: Published version conflict')),
  );
  expect(container.textContent).toContain(
    'Nothing imported: Published version conflict',
  );
  expect(
    container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked,
  ).toBe(true);
  mutate.mockRejectedValueOnce(new Error('connection lost'));
  await click('Import 1 workflows');
  expect(container.textContent).toContain('result could not be confirmed');
  expect(container.textContent).not.toContain('Nothing imported:');
});
it('shows empty discovery with diagnostics and closing never imports', async () => {
  query.mockResolvedValue({
    ...preview(),
    choices: [],
    diagnostics: [{ filename: 'bad.json', reason: 'Invalid JSON' }],
  });
  await edit('https://github.com/o/r/tree/main/workflows');
  await click('Load workflows');
  expect(container.textContent).toContain('No importable workflows found');
  expect(container.textContent).toContain('bad.json');
  await click('Cancel');
  expect(close).toHaveBeenCalled();
  expect(mutate).not.toHaveBeenCalled();
});

it('preserves local legacy and bundle picker dispatch, navigation, cancellation and repeat selection', async () => {
  const onOpen = vi.fn();
  create.mockResolvedValue({ id: 'legacy-root' });
  importBundle.mockResolvedValue({ rootId: 'portable-root' });
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(
          MemoryRouter,
          {},
          h(WorkflowLibrary, {
            workflows: [],
            onOpen,
            refresh,
            act: async (fn: any) => {
              await fn();
            },
          }),
        ),
      ),
    ),
  );
  const picker = container.querySelector<HTMLInputElement>('input[type=file]')!;
  const pick = async (data: any) =>
    act(async () => {
      Object.defineProperty(picker, 'files', {
        configurable: true,
        value: data ? [{ text: async () => JSON.stringify(data) }] : [],
      });
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await pick(undefined);
  expect(create).not.toHaveBeenCalled();
  expect(importBundle).not.toHaveBeenCalled();
  await pick({ name: 'Legacy' });
  expect(create).toHaveBeenCalledWith({ name: 'Legacy' });
  expect(onOpen).toHaveBeenCalledWith('legacy-root');
  expect(picker.value).toBe('');
  await pick({ name: 'Legacy' });
  expect(create).toHaveBeenCalledTimes(2);
  await pick({ format: 'interlock-workflows' });
  expect(importBundle).toHaveBeenCalledWith({
    bundle: { format: 'interlock-workflows' },
  });
  expect(onOpen).toHaveBeenCalledWith('portable-root');
});
