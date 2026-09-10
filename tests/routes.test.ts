// @vitest-environment jsdom
import { transferableAbortController } from 'node:util';
import { act, createElement as h, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { routes } from '../packages/ui/src/routes';

const queries = vi.hoisted(() => ({ workflows: vi.fn(), runs: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    workflows: { list: { query: queries.workflows } },
    runs: { list: { query: queries.runs } },
  },
  errorMessage: (error: Error) => error.message,
}));
vi.mock('../packages/ui/src/features/workflows/WorkflowLibrary', () => ({
  WorkflowLibrary: ({ onOpen }: any) =>
    h('button', { onClick: () => onOpen('w1') }, 'Open workflow'),
}));
vi.mock('../packages/ui/src/features/workflows/WorkflowEditor', () => ({
  WorkflowEditor: ({
    workflow,
    onDirty,
    onBack,
    onRun,
    section,
    onSectionChange,
    runsView,
    onDeleted,
  }: any) => {
    useEffect(() => () => onDirty(false), [onDirty]);
    return h(
      'section',
      {},
      `Editor ${workflow.id}`,
      h('button', { onClick: () => onSectionChange('runs') }, 'Workflow runs'),
      h(
        'button',
        { onClick: () => onSectionChange('editor') },
        'Workflow editor',
      ),
      h('button', { onClick: onDeleted }, 'Confirm deletion'),
      section === 'runs' ? runsView : null,
      h('button', { onClick: () => onDirty(true) }, 'Edit draft'),
      h('button', { onClick: () => onDirty(false) }, 'Save draft'),
      h('button', { onClick: onBack }, 'Back to library'),
      h('button', { onClick: () => onRun(workflow) }, 'Start run'),
    );
  },
}));
vi.mock('../packages/ui/src/features/runs/RunInspector', () => ({
  RunInspector: ({ id, onOpen, onBack }: any) =>
    h(
      'section',
      {},
      `Run ${id}`,
      h('button', { onClick: () => onOpen('child') }, 'Child run'),
      h('button', { onClick: onBack }, 'Back to runs'),
    ),
}));
vi.mock('../packages/ui/src/features/runs/RunDialog', () => ({
  RunDialog: ({ onStarted }: any) =>
    h('button', { onClick: () => onStarted('new-run') }, 'Confirm run'),
}));
vi.mock('../packages/ui/src/components/ConnectDialog/ConnectDialog', () => ({
  ConnectDialog: () => null,
}));
let root: Root;
let container: HTMLDivElement;
let router: ReturnType<typeof createBrowserRouter>;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  // Use Node's signal with Node's Request; jsdom's signal is a different class.
  vi.stubGlobal(
    'AbortController',
    class {
      constructor() {
        return transferableAbortController();
      }
    },
  );
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      close() {}
    },
  );
  queries.workflows.mockResolvedValue([{ id: 'w1' }, { id: 'a b%?' }]);
  queries.runs.mockResolvedValue([
    {
      id: 'r1',
      workflowId: 'w1',
      status: 'completed',
      workflowName: 'Completed workflow',
      version: 1,
      createdAt: new Date().toISOString(),
      executions: [],
    },
  ]);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  router?.dispose();
  container?.remove();
  vi.unstubAllGlobals();
});
async function mount(path?: string) {
  if (path) window.history.replaceState(null, '', path);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  router = createBrowserRouter(routes);
  await act(async () =>
    root.render(
      h(MantineProvider, { env: 'test' }, h(RouterProvider, { router })),
    ),
  );
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === label,
  )!;
  expect(button, label).toBeTruthy();
  await act(async () => button.click());
}
async function traverse(direction: 'back' | 'forward') {
  await act(async () => {
    const popped = new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true }),
    );
    window.history[direction]();
    await popped;
  });
}

it('redirects home, opens a workflow, and restores it from the URL on reload', async () => {
  await mount('/');
  expect(window.location.pathname).toBe('/workflows');
  await click('Open workflow');
  expect(window.location.pathname).toBe('/workflows/w1');
  await act(async () => root.unmount());
  router.dispose();
  container.remove();
  await mount();
  expect(container.textContent).toContain('Editor w1');
  await traverse('back');
  expect(container.textContent).toContain('Open workflow');
  await traverse('forward');
  expect(container.textContent).toContain('Editor w1');
});

it('restores run history and nested run links, including browser Back', async () => {
  await mount('/runs?tab=history');
  expect(
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toContain('History');
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button.run-row')!.click(),
  );
  expect(window.location.pathname).toBe('/runs/r1');
  await click('Child run');
  expect(window.location.pathname).toBe('/runs/child');
  await traverse('back');
  expect(container.textContent).toContain('Run r1');
  await click('Back to runs');
  expect(window.location.search).toBe('?tab=history');
  await click('Active 0');
  expect(window.location.search).toBe('');
});

it('keeps a deep link while data loads and shows missing resources without redirecting', async () => {
  let resolve!: (value: unknown[]) => void;
  queries.workflows.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount('/workflows/missing');
  expect(container.textContent).toContain('Loading workflows');
  expect(container.textContent).not.toContain('Open workflow');
  await act(async () => resolve([]));
  expect(container.textContent).toContain('Workflow not found');
  expect(window.location.pathname).toBe('/workflows/missing');
  await act(async () => {
    await router.navigate('/unrecognized/path');
  });
  expect(container.textContent).toContain('Page not found');
});

it('distinguishes a failed initial load from a missing workflow', async () => {
  queries.workflows.mockRejectedValue(new Error('Engine unavailable'));
  await mount('/workflows/w1');
  expect(container.textContent).toContain('Engine unavailable');
  expect(container.textContent).not.toContain('Workflow not found');
  expect(window.location.pathname).toBe('/workflows/w1');
});

it('decodes resource IDs and gives newly started runs a URL', async () => {
  await mount('/workflows/a%20b%25%3F');
  expect(container.textContent).toContain('Editor a b%?');
  await click('Start run');
  await click('Confirm run');
  expect(window.location.pathname).toBe('/runs/new-run');
  expect(container.textContent).toContain('Run new-run');
});

it('guards unsaved edits on browser Back and app navigation, then allows navigation after saving', async () => {
  await mount('/workflows');
  await click('Open workflow');
  await click('Edit draft');
  await traverse('back');
  // The router restores the history entry while the user decides.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(document.body.textContent).toContain('Discard unsaved changes?');
  await click('Keep editing');
  expect(window.location.pathname).toBe('/workflows/w1');
  expect(container.textContent).toContain('Editor w1');
  await click('Back to library');
  await click('Discard changes');
  expect(window.location.pathname).toBe('/workflows');
  await click('Open workflow');
  await click('Edit draft');
  await click('Save draft');
  await click('Runs');
  expect(window.location.pathname).toBe('/runs');
});

it('restores workflow run history and returns from nested inspection to the scoped list', async () => {
  await mount('/workflows/w1?view=runs&tab=history');
  expect(
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toContain('History');
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button.run-row')!.click(),
  );
  expect(window.location.pathname).toBe('/runs/r1');
  expect(new URLSearchParams(window.location.search).get('workflow')).toBe(
    'w1',
  );
  await click('Child run');
  await click('Back to runs');
  expect(window.location.pathname).toBe('/workflows/w1');
  expect(window.location.search).toBe('?view=runs&tab=history');
});

it('allows workflow section changes with unsaved edits but still guards leaving the workflow', async () => {
  await mount('/workflows/w1');
  await click('Edit draft');
  await click('Workflow runs');
  expect(window.location.search).toBe('?view=runs');
  expect(document.body.textContent).not.toContain('Discard unsaved changes?');
  await traverse('back');
  expect(window.location.search).toBe('');
  await click('Back to library');
  expect(document.body.textContent).toContain('Discard unsaved changes?');
  await click('Keep editing');
  await click('Confirm deletion');
  expect(window.location.pathname).toBe('/workflows');
  expect(document.body.textContent).not.toContain('Discard unsaved changes?');
});

it('opens an owned child by direct URL and returns to its owner through the navigation guard', async () => {
  queries.workflows.mockResolvedValue([
    { id: 'parent', name: 'Parent' },
    { id: 'child', name: 'Child', ownerWorkflowId: 'parent' },
  ]);
  await mount('/workflows/child');
  expect(container.textContent).toContain('Editor child');
  await click('Edit draft');
  await click('Back to library');
  expect(document.body.textContent).toContain('Discard unsaved changes?');
  await click('Keep editing');
  expect(window.location.pathname).toBe('/workflows/child');
  await click('Save draft');
  await click('Back to library');
  expect(window.location.pathname).toBe('/workflows/parent');
});
