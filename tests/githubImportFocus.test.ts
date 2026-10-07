// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GithubImportDialog } from '../packages/ui/src/features/workflows/GithubImportDialog';

vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    workflows: {
      discoverGithubFolder: { query: vi.fn() },
      importGithubSelection: { mutate: vi.fn() },
    },
  },
  errorMessage: (e: Error) => e.message,
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi
    .fn()
    .mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('focuses the URL input after the real Modal transition and focus-trap lifecycle', async () => {
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(
          MemoryRouter,
          {},
          h(GithubImportDialog, { onClose: vi.fn(), refresh: async () => {} }),
        ),
      ),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  const input = document.querySelector<HTMLInputElement>(
    'input[data-autofocus]',
  );
  expect(input).not.toBeNull();
  expect(document.activeElement).toBe(input);
  expect(input!.closest('[role=dialog]')).not.toBeNull();
});
