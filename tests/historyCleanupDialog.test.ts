// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HistoryCleanupDialog } from '../packages/ui/src/features/runs/HistoryCleanupDialog';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), remove: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    runs: {
      previewHistoryDeletion: { query: mocks.preview },
      deleteHistory: { mutate: mocks.remove },
    },
  },
  errorMessage: (error: Error) => error.message,
}));
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const item = {
  rootRunId: 'root',
  workflowId: 'workflow',
  workflowName: 'Research',
  status: 'completed',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  runCount: 3,
  documentBytes: 4096,
  canDelete: true,
  blockers: [],
  confirmation: 'a'.repeat(64),
};
beforeEach(async () => {
  vi.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  mocks.preview.mockResolvedValue({
    items: [
      item,
      {
        ...item,
        rootRunId: 'protected',
        canDelete: false,
        confirmation: null,
        blockers: ['Active descendant retains this tree.'],
      },
    ],
    total: 2,
    offset: 0,
    nextOffset: null,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        { env: 'test' },
        h(HistoryCleanupDialog, {
          workflows: [{ value: 'workflow', label: 'Research' }],
          onClose: vi.fn(),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (entry) => entry.textContent === name,
  )!;
const click = (element: HTMLElement) => act(async () => element.click());

it('requires an eligible selection and acknowledgment, submits exact reviewed confirmations and reports removed space', async () => {
  expect(mocks.remove).not.toHaveBeenCalled();
  await click(button('Preview history'));
  expect(document.body.textContent).toContain('Active descendant');
  const eligible = document.querySelector<HTMLInputElement>(
    '[aria-label="Select run tree root"]',
  )!;
  const protectedTree = document.querySelector<HTMLInputElement>(
    '[aria-label="Select run tree protected"]',
  )!;
  expect(protectedTree.disabled).toBe(true);
  expect(button('Delete selected history').disabled).toBe(true);
  await click(eligible);
  expect(button('Delete selected history').disabled).toBe(true);
  const acknowledgment = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].find((entry) => entry !== eligible && entry !== protectedTree)!;
  await click(acknowledgment);
  expect(button('Delete selected history').disabled).toBe(false);
  mocks.remove.mockResolvedValue({
    deletedRuns: 3,
    deletedRoots: 1,
    removedDocumentBytes: 4096,
    retainedStartReceipts: 1,
    storage: { databaseBytes: 8192, reusableBytes: 4096 },
  });
  await click(button('Delete selected history'));
  expect(mocks.remove).toHaveBeenCalledWith({
    roots: [{ runId: 'root', confirmation: item.confirmation }],
    acknowledgeHistoryLoss: true,
  });
  expect(document.body.textContent).toContain('Deleted 3 runs');
  expect(document.body.textContent).toContain('Reusable pages');
  expect(document.body.textContent).toContain('File size may not shrink');
});

it('rejects a stale selection visibly and requires a new preview before trying again', async () => {
  await click(button('Preview history'));
  await click(
    document.querySelector<HTMLInputElement>(
      '[aria-label="Select run tree root"]',
    )!,
  );
  const acknowledgment = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].at(-1)!;
  await click(acknowledgment);
  mocks.remove.mockRejectedValue(
    new Error('History changed. Nothing deleted; preview again.'),
  );
  await click(button('Delete selected history'));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Nothing deleted',
  );
  expect(button('Delete selected history')).toBeUndefined();
  expect(button('Preview history')).toBeDefined();
});
