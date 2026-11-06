// @vitest-environment jsdom
import { transferableAbortController } from 'node:util';
import { act, createElement as h, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { routes } from '../packages/ui/src/routes';

const queries = vi.hoisted(() => ({
  workflows: vi.fn(),
  summaries: vi.fn(),
  attention: vi.fn(),
}));
const streamListeners = new Map<string, () => void>();
vi.mock('../packages/ui/src/lib/engineEvents', () => ({
  subscribeToEngineEvents: ({
    onChange,
    onConnect,
    onError,
  }: Record<'onChange' | 'onConnect' | 'onError', () => void>) => {
    streamListeners.set('change', onChange);
    streamListeners.set('connect', onConnect);
    streamListeners.set('error', onError);
    return () => streamListeners.clear();
  },
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    connection: {
      query: () => Promise.resolve({ engineUrl: 'http://127.0.0.1:4310' }),
    },
    workflows: { list: { query: queries.workflows } },
    runs: {
      summaries: { query: queries.summaries },
      attention: { query: queries.attention },
    },
    prompts: { list: { query: () => Promise.resolve([]) } },
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
      h(
        'button',
        { onClick: () => onBack(id === 'r1' ? 'completed' : 'waiting') },
        'Back to runs',
      ),
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
  vi.clearAllMocks();
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
  streamListeners.clear();
  queries.attention.mockResolvedValue([]);
  queries.workflows.mockResolvedValue([{ id: 'w1' }, { id: 'a b%?' }]);
  queries.summaries.mockImplementation(async ({ tab }) => {
    const [attention] = await queries.attention();
    const run = {
      id: 'r1',
      workflowId: 'w1',
      status: 'completed',
      workflowName: 'Completed workflow',
      version: 1,
      createdAt: new Date().toISOString(),
      executionCount: 0,
      attention,
    };
    const items =
      tab === 'history' || (tab === 'attention' && attention) ? [run] : [];
    return {
      items,
      counts: { active: 0, attention: attention ? 1 : 0, history: 1 },
      offset: 0,
      total: items.length,
      nextOffset: null,
    };
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  router?.dispose();
  container?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

it('shows global human attention, deep-links to its assignment, and preserves the filter on return', async () => {
  queries.attention.mockResolvedValue([
    {
      runId: 'r1',
      reasons: ['recovery'],
      target: { runId: 'child', executionId: 'child-execution' },
    },
  ]);
  await mount('/workflows');
  const badge = container.querySelector(
    'button[aria-label="Runs, 1 run needs attention"]',
  );
  expect(badge?.textContent).toBe('Runs1');
  await act(async () => router.navigate('/runs?tab=attention'));
  expect(
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toBe('Needs attention 1');
  const row = container.querySelector('button.run-row') as HTMLButtonElement;
  expect(row.textContent).toContain('Recovery needed');
  await act(async () => row.click());
  expect(window.location.pathname).toBe('/runs/child');
  expect(new URLSearchParams(window.location.search).get('execution')).toBe(
    'child-execution',
  );
  await click('Back to runs');
  expect(window.location.search).toBe('?tab=attention');
  queries.attention.mockResolvedValue([]);
  await act(async () => {
    streamListeners.get('change')!();
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  expect(
    container.querySelector('button[aria-label="Runs, 1 run needs attention"]'),
  ).toBeNull();
  expect(container.textContent).toContain('No runs need your attention.');
});

it('loads history only on the Runs view and restores the page after inspection', async () => {
  queries.summaries.mockImplementation(async ({ offset }) => ({
    items: [
      {
        id: 'r1',
        workflowId: 'w1',
        workflowName: 'Completed workflow',
        version: 1,
        status: 'completed',
        createdAt: '2026-01-01T00:00:00Z',
        executionCount: 3,
      },
    ],
    counts: { active: 0, attention: 0, history: 101 },
    offset,
    total: 101,
    nextOffset: offset === 0 ? 100 : null,
  }));
  await mount('/workflows/w1');
  expect(queries.summaries).not.toHaveBeenCalled();
  await act(async () => router.navigate('/runs?tab=history'));
  const next = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Next',
  )!;
  await act(async () => {
    next.focus();
    next.click();
  });
  expect(window.location.search).toBe('?tab=history&offset=100');
  expect(document.activeElement).toBe(next);
  expect(next.getAttribute('aria-disabled')).toBe('true');
  expect(queries.summaries).toHaveBeenLastCalledWith(
    expect.objectContaining({ tab: 'history', offset: 100 }),
  );
  expect(container.textContent).toContain('101 to 101 of 101');
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button.run-row')!.click(),
  );
  await click('Back to runs');
  expect(window.location.search).toBe('?tab=history&offset=100');
  await click('Previous');
  expect(window.location.search).toBe('?tab=history');
});

it('backs off with a healthy stream and refreshes on return to a visible tab', async () => {
  vi.useFakeTimers();
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility,
  );
  const advance = (ms: number) =>
    act(async () => vi.advanceTimersByTimeAsync(ms));
  try {
    await mount('/workflows');
    expect(queries.workflows).toHaveBeenCalledTimes(1);
    await advance(5_000);
    expect(queries.workflows).toHaveBeenCalledTimes(2);
    await act(async () => streamListeners.get('connect')!());
    await advance(100);
    queries.workflows.mockClear();
    await advance(10_000);
    expect(queries.workflows).not.toHaveBeenCalled();
    await advance(50_000);
    expect(queries.workflows).toHaveBeenCalledTimes(1);
    queries.workflows.mockClear();
    await act(async () => streamListeners.get('change')!());
    await advance(100);
    expect(queries.workflows).toHaveBeenCalledTimes(1);
    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      streamListeners.get('change')!();
      streamListeners.get('error')!();
    });
    await advance(20_000);
    expect(queries.workflows).toHaveBeenCalledTimes(1);
    visibility = 'visible';
    await act(async () =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    expect(queries.workflows).toHaveBeenCalledTimes(2);
    await advance(5_000);
    expect(queries.workflows).toHaveBeenCalledTimes(3);
  } finally {
    vi.restoreAllMocks();
  }
});

it('retries a failed refresh promptly even while the event stream is healthy', async () => {
  vi.useFakeTimers();
  const advance = (ms: number) =>
    act(async () => vi.advanceTimersByTimeAsync(ms));
  await mount('/workflows');
  await act(async () => streamListeners.get('connect')!());
  await advance(100);
  queries.workflows.mockClear();
  queries.workflows.mockRejectedValueOnce(
    new Error('Temporary request failure'),
  );
  await act(async () => streamListeners.get('change')!());
  await advance(100);
  expect(queries.workflows).toHaveBeenCalledTimes(1);
  await advance(5_000);
  expect(queries.workflows).toHaveBeenCalledTimes(2);
  await advance(5_000);
  expect(queries.workflows).toHaveBeenCalledTimes(2);
});

it('renders a slow summary and coalesces live updates into one follow-up request', async () => {
  vi.useFakeTimers();
  const page = {
    items: [
      {
        id: 'r1',
        workflowId: 'w1',
        workflowName: 'Completed workflow',
        version: 1,
        status: 'completed',
        createdAt: '2026-01-01T00:00:00Z',
        executionCount: 3,
      },
    ],
    counts: { active: 0, attention: 0, history: 1 },
    offset: 0,
    total: 1,
    nextOffset: null,
  };
  let complete!: (value: typeof page) => void;
  queries.summaries.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  queries.summaries.mockImplementationOnce(() => new Promise(() => {}));
  await mount('/runs?tab=history');
  for (let index = 0; index < 3; index++)
    await act(async () => {
      streamListeners.get('change')!();
      await vi.advanceTimersByTimeAsync(100);
    });
  expect(queries.summaries).toHaveBeenCalledTimes(1);
  await act(async () => complete(page));
  expect(queries.summaries).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('Completed workflow');
});
