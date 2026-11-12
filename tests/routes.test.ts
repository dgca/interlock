// @vitest-environment jsdom
import { TRPCClientError } from '@interlock/client';
import { transferableAbortController } from 'node:util';
import { act, createElement as h, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceReadWarning } from '../packages/ui/src/components/WorkspaceReads';
import { routes } from '../packages/ui/src/routes';
import {
  blankDefinition,
  workflowCatalogEntry,
  type Workflow,
} from '@interlock/core';
import { trpc, useQueryClient } from '../packages/ui/src/lib/query';

let libraryClient: ReturnType<typeof useQueryClient>;
beforeAll(async () => {
  await import('../packages/ui/src/features/workflows/WorkflowLibrary');
  await import('../packages/ui/src/features/runs/RunList');
  await import('../packages/ui/src/features/diagnostics/Diagnostics');
  await import('../packages/ui/src/features/prompts/Prompts');
  await import('../packages/ui/src/features/automations/Automations');
});

const queries = vi.hoisted(() => ({
  workflows: vi.fn(),
  workflow: vi.fn(),
  createWorkflow: vi.fn(),
  cloneWorkflow: vi.fn(),
  realLibrary: false,
  summaries: vi.fn(),
  attention: vi.fn(),
  requestCount: vi.fn(),
  automationCount: vi.fn(),
  automationInspect: vi.fn(),
  prompts: vi.fn(),
  prompt: vi.fn(),
  connection: vi.fn(),
  doctor: vi.fn(),
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
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      system: { doctor: { query: queries.doctor } },
      triggers: {
        attention: { query: queries.automationCount },
        inspect: { query: queries.automationInspect },
        preview: { query: async () => ({ upcoming: [] }) },
        list: {
          query: async () => ({
            items: [],
            total: 0,
            nextOffset: null,
            counts: { all: 0, enabled: 0, disabled: 0, attention: 0 },
          }),
        },
      },
      pauses: {
        list: {
          query: () =>
            Promise.resolve({ items: [], total: 0, nextOffset: null }),
        },
      },
      connection: { query: queries.connection },
      workflows: {
        catalog: {
          query: async (input?: unknown) =>
            (await queries.workflows(input)).map((workflow: Workflow) =>
              workflow.draft ? workflowCatalogEntry(workflow) : workflow,
            ),
        },
        get: { query: queries.workflow },
        create: { mutate: queries.createWorkflow },
        clone: { mutate: queries.cloneWorkflow },
      },
      runs: {
        summaries: { query: queries.summaries },
        attention: { query: queries.attention },
      },
      requests: { list: { query: queries.requestCount } },
      prompts: {
        catalog: { query: queries.prompts },
        get: { query: queries.prompt },
      },
    }),
    errorMessage: (error: Error) => error.message,
  };
});
vi.mock(
  '../packages/ui/src/features/workflows/WorkflowLibrary',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../packages/ui/src/features/workflows/WorkflowLibrary')
      >();
    return {
      WorkflowLibrary: (props: any) => {
        const client = useQueryClient();
        libraryClient = client;
        if (queries.realLibrary) return h(actual.WorkflowLibrary, props);
        const { onOpen } = props;
        return h(
          'div',
          {},
          h('button', { onClick: () => onOpen('w1') }, 'Open workflow'),
          h(
            'button',
            {
              onClick: () =>
                void client.refetchQueries({
                  queryKey: trpc.workflows.catalog.queryKey(),
                }),
            },
            'Refresh library',
          ),
        );
      },
    };
  },
);
vi.mock('../packages/ui/src/features/executors/Harnesses', () => ({
  Harnesses: ({ onDirty }: any) =>
    h(
      'section',
      {},
      'AI settings content',
      h('button', { onClick: () => onDirty(true) }, 'Edit AI settings'),
      h('button', { onClick: () => onDirty(false) }, 'Save AI settings'),
    ),
}));
vi.mock('../packages/ui/src/features/workflows/WorkflowEditor', () => ({
  WorkflowEditor: ({
    workflow,
    onDirty,
    onBack,
    onRun,
    onPublicationChecked,
    section,
    onSectionChange,
    runsView,
    onDeleted,
    workflowsRead,
  }: any) => {
    libraryClient = useQueryClient();
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
      h(
        'button',
        { onClick: () => onPublicationChecked(workflow.id, 2) },
        'Acknowledge publication',
      ),
      section === 'runs' ? runsView : null,
      section === 'children' ? 'Child workflows content' : null,
      section === 'editor' && workflowsRead
        ? h(WorkspaceReadWarning, { reads: [workflowsRead] })
        : null,
      h('button', { onClick: () => onDirty(true) }, 'Edit draft'),
      h('button', { onClick: () => onDirty(false) }, 'Save draft'),
      h('button', { onClick: onBack }, 'Back to library'),
      h('button', { onClick: () => onRun(workflow) }, 'Start run'),
    );
  },
}));
vi.mock('../packages/ui/src/features/runs/RunInspector', () => ({
  RunInspector: ({
    id,
    onOpen,
    onBack,
    initialExecutionId,
    returnLabel,
  }: any) =>
    h(
      'section',
      {},
      `Run ${id}`,
      initialExecutionId && `Selected ${initialExecutionId}`,
      h('button', { onClick: () => onOpen('child') }, 'Child run'),
      h(
        'button',
        {
          onClick: () =>
            onOpen('child', 'child-step', {
              executionId: 'path-step',
              label: 'Run check',
            }),
        },
        'Invoke workflow',
      ),
      h(
        'button',
        { onClick: () => onBack(id === 'r1' ? 'completed' : 'waiting') },
        returnLabel ?? 'Back to runs',
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

function mockWorkflowDetails(items: (Partial<Workflow> & { id: string })[]) {
  queries.workflow.mockReset().mockImplementation(async ({ id }) => {
    const item = items.find((workflow) => workflow.id === id);
    if (!item) throw new Error('Workflow not found');
    return {
      name: id,
      description: '',
      archived: false,
      draft: blankDefinition(),
      draftRevision: 1,
      latestVersion: 0,
      layoutRevision: 0,
      draftMatchesLatest: null,
      ...item,
    };
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  queries.realLibrary = false;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
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
  queries.requestCount.mockReset().mockImplementation(async () => ({
    items: [],
    total: (await queries.attention()).length,
    nextOffset: null,
  }));
  queries.automationCount.mockReset().mockResolvedValue({
    items: [],
    total: 0,
    nextOffset: null,
  });
  queries.prompts.mockReset().mockResolvedValue([]);
  queries.prompt.mockReset();
  queries.connection
    .mockReset()
    .mockResolvedValue({ engineUrl: 'http://127.0.0.1:4310' });
  queries.doctor.mockResolvedValue({
    status: 'warn',
    checkedAt: '2026-11-09T00:00:00Z',
    summary: { total: 1, ok: 0, warn: 1, fail: 0 },
    checks: [
      {
        category: 'system',
        name: 'Storage check',
        status: 'warn',
        message: 'Low disk space',
        remediation: 'Free disk space',
      },
    ],
  });
  const workflows = [{ id: 'w1' }, { id: 'a b%?' }];
  queries.workflows.mockReset().mockResolvedValue(workflows);
  mockWorkflowDetails(workflows);
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
      h(DesignSystemProvider, { env: 'test' }, h(RouterProvider, { router })),
    ),
  );
}
async function click(label: string) {
  const button = [
    ...document.querySelectorAll<HTMLElement>('button, nav a'),
  ].find((b) => b.textContent === label)!;
  expect(button, label).toBeTruthy();
  await act(async () => button.click());
}

it('redirects legacy Harnesses links to AI Settings with their query and anchor', async () => {
  await mount('/settings/harnesses?source=workflow#concurrency');
  expect(window.location.pathname).toBe('/settings/ai');
  expect(window.location.search).toBe('?source=workflow');
  expect(window.location.hash).toBe('#concurrency');
  expect(container.textContent).toContain('AI settings content');
});

it('guards dirty AI Settings query tabs and anchor navigation', async () => {
  await mount('/settings/ai?tab=harnesses');
  await click('Edit AI settings');
  await act(async () => {
    void router.navigate('/settings/ai?tab=model-aliases');
  });
  expect(document.body.textContent).toContain('Discard unsaved changes?');
  await click('Keep editing');
  expect(window.location.search).toBe('?tab=harnesses');
  await act(async () => {
    void router.navigate('/settings/ai#concurrency');
  });
  expect(document.body.textContent).toContain('Discard unsaved changes?');
  await click('Discard changes');
  expect(window.location.hash).toBe('#concurrency');
});

it('guards dirty AI Settings browser Back and Forward', async () => {
  await mount('/settings/ai?tab=harnesses');
  await act(async () => {
    await router.navigate('/settings/ai?tab=model-aliases');
  });
  await click('Edit AI settings');
  await traverse('back');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(document.body.textContent).toContain('Discard unsaved changes?');
  await click('Discard changes');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(window.location.search).toBe('?tab=harnesses');
  await click('Edit AI settings');
  await traverse('forward');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(document.body.textContent).toContain('Discard unsaved changes?');
  await click('Discard changes');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(window.location.search).toBe('?tab=model-aliases');
});

it('keeps dirty protection when an AI task canonicalizes a legacy anchor without changing tasks', async () => {
  await mount('/settings/ai#concurrency');
  await click('Edit AI settings');
  await act(async () => {
    await router.navigate('/settings/ai?tab=execution');
  });
  expect(document.body.textContent).not.toContain('Discard unsaved changes?');
  await act(async () => {
    void router.navigate('/workflows');
  });
  expect(document.body.textContent).toContain('Discard unsaved changes?');
  await click('Keep editing');
  expect(window.location.pathname).toBe('/settings/ai');
});
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
    container.querySelector<HTMLAnchorElement>('.run-row a')!.click(),
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

it('returns from an invoked workflow to the exact step that opened it', async () => {
  await mount('/runs/r1?tab=history');
  await click('Invoke workflow');
  expect(window.location.pathname).toBe('/runs/child');
  expect(container.textContent).toContain('Selected child-step');
  await act(async () => {
    const popped = new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true }),
    );
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Back to Run check')!
      .click();
    await popped;
  });
  expect(window.location.pathname).toBe('/runs/r1');
  expect(container.textContent).toContain('Selected path-step');
  expect(new URLSearchParams(window.location.search).get('tab')).toBe(
    'history',
  );
  await traverse('forward');
  expect(container.textContent).toContain('Selected child-step');
  await traverse('back');
  expect(container.textContent).toContain('Selected path-step');
});

it('keeps a deep link while data loads and shows missing resources without redirecting', async () => {
  let reject!: (value: Error) => void;
  queries.workflow.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  await mount('/workflows/missing');
  expect(container.textContent).toContain('Loading workflow…');
  expect(container.textContent).not.toContain('Open workflow');
  const loading = container.querySelector('main section[aria-busy="true"]')!;
  expect(loading).not.toBeNull();
  const spinner = loading.querySelector('.mantine-Loader-root')!;
  expect(spinner).not.toBeNull();
  expect(
    spinner.parentElement?.querySelector('.mantine-Skeleton-root'),
  ).toBeNull();
  expect(loading.querySelector('[aria-current="page"]')?.textContent).toBe(
    'Editor',
  );
  expect(loading.textContent).toContain('Child workflows');
  expect(loading.querySelectorAll('button, input, a')).toHaveLength(0);
  expect(
    [...container.querySelectorAll('[role="status"]')].filter(
      (status) => status.textContent === 'Loading workflow…',
    ),
  ).toHaveLength(1);
  for (const [view, label] of [
    ['runs', 'Runs'],
    ['children', 'Child workflows'],
  ]) {
    await act(async () => {
      await router.navigate(`/workflows/missing?view=${view}`);
    });
    expect(loading.querySelector('[aria-current="page"]')?.textContent).toBe(
      label,
    );
  }
  await act(async () => reject(new Error('Workflow not found')));
  expect(container.textContent).toContain('Workflow not found');
  expect(window.location.pathname).toBe('/workflows/missing');
  await act(async () => {
    await router.navigate('/unrecognized/path');
  });
  expect(container.textContent).toContain('Page not found');
});

it('distinguishes a failed initial load from a missing workflow', async () => {
  queries.workflow.mockRejectedValue(new Error('Engine unavailable'));
  await mount('/workflows/w1');
  expect(container.textContent).toContain('Engine unavailable');
  expect(container.textContent).not.toContain('Workflow not found');
  expect(window.location.pathname).toBe('/workflows/w1');
});

it('opens a cold workflow editor while one sidebar count fails and the other is pending', async () => {
  queries.requestCount.mockRejectedValue(new Error('Request count failed'));
  let finish!: (value: unknown) => void;
  queries.automationCount.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await mount('/workflows/w1');
  expect(container.textContent).toContain('Editor w1');
  expect(container.textContent).toContain('Local engine connected');
  const runsLink = container.querySelector('nav a[href="/runs"]');
  expect(runsLink?.getAttribute('aria-label')).toBe(
    'Runs, attention count unavailable',
  );
  expect(runsLink?.textContent).toBe('Runs?');

  queries.requestCount.mockResolvedValue({ items: [], total: 2 });
  const retry = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Retry attention count for requests"]',
  );
  expect(retry).not.toBeNull();
  await act(async () => retry!.click());
  expect(queries.requestCount).toHaveBeenCalledTimes(2);
  expect(queries.automationCount).toHaveBeenCalledTimes(1);
  expect(queries.workflows).toHaveBeenCalledTimes(1);
  expect(queries.prompts).not.toHaveBeenCalled();
  expect(runsLink?.getAttribute('aria-label')).toBe(
    'Runs, loading attention count',
  );
  await act(async () => finish({ items: [], total: 1 }));
  expect(runsLink?.getAttribute('aria-label')).toBe(
    'Runs, 3 items need attention',
  );
});

it('opens the workflow library and exact draft without observing the prompt catalog', async () => {
  queries.prompts.mockRejectedValue(new Error('Prompt library unavailable'));
  await mount('/workflows');
  expect(container.textContent).toContain('Open workflow');
  expect(queries.workflow).not.toHaveBeenCalled();
  await click('Open workflow');
  expect(container.textContent).toContain('Editor w1');
  expect(container.textContent).not.toContain('Prompt library unavailable');
  expect(container.textContent).toContain('Local engine connected');
  expect(queries.workflow).toHaveBeenCalledWith({ id: 'w1' });
  expect(queries.prompts).not.toHaveBeenCalled();
});

it.each([
  ['runs', 'pending'],
  ['children', 'failed'],
])(
  'opens a direct workflow %s tab while prompts are %s',
  async (section, status) => {
    if (status === 'pending')
      queries.prompts.mockReturnValue(new Promise(() => {}));
    else
      queries.prompts.mockRejectedValue(
        new Error('Prompt library unavailable'),
      );
    await mount(`/workflows/w1?view=${section}`);
    expect(container.textContent).toContain('Editor w1');
    expect(container.textContent).not.toContain('Prompt library unavailable');
    if (section === 'runs') {
      expect(queries.summaries).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'w1' }),
      );
      expect(queries.workflows).not.toHaveBeenCalled();
    } else expect(container.textContent).toContain('Child workflows content');

    const editor = container.querySelector('main section');
    await click('Edit draft');
    await click('Workflow editor');
    expect(container.querySelector('main section')).toBe(editor);
    expect(container.textContent).toContain('Editor w1');
    expect(queries.prompts).not.toHaveBeenCalled();

    await click('Prompts');
    expect(document.body.textContent).toContain('Discard unsaved changes?');
    await click('Keep editing');
    await traverse('back');
    expect(window.location.search).toBe(`?view=${section}`);
    expect(container.querySelector('main section')).toBe(editor);
    expect(container.textContent).not.toContain('Could not load prompts.');
  },
);

it.each(['/prompts', '/prompts/prompt-id'])(
  'opens %s without workflows or a healthy automation attention count',
  async (path) => {
    queries.workflows.mockRejectedValue(
      new Error('Workflow library unavailable'),
    );
    queries.automationCount.mockRejectedValue(
      new Error('Automation count failed'),
    );
    const prompt = {
      id: 'prompt-id',
      name: 'Saved review prompt',
      description: '',
      content: 'Review the proposed change.',
      revision: 1,
      createdAt: '2026-11-11T00:00:00Z',
      updatedAt: '2026-11-11T00:00:00Z',
    };
    if (path === '/prompts') queries.prompts.mockResolvedValue([prompt]);
    else queries.prompts.mockRejectedValue(new Error('Prompts unavailable'));
    queries.prompt.mockResolvedValue({ ...prompt, usage: [] });
    await mount(path);
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain('Saved review prompt');
    });
    expect(container.textContent).toContain('Local engine connected');
    expect(container.textContent).not.toContain('Workflow library unavailable');
    expect(
      container.querySelector(
        'button[aria-label="Retry attention count for automations"]',
      ),
    ).not.toBeNull();
  },
);

it('distinguishes a missing prompt from a failed prompt read', async () => {
  queries.prompt.mockRejectedValueOnce(new Error('Prompt read unavailable'));
  queries.prompt.mockRejectedValueOnce(
    new Error('Saved prompt missing does not exist'),
  );
  await mount('/prompts/missing');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain('Could not load prompt.');
  });
  await click('Retry');
  expect(container.textContent).toContain('Prompt not found');
});

it.each([
  ['/automations', 'input[aria-label="Filter by workflow"]'],
  ['/automations/new?type=schedule', 'input[role="combobox"]'],
])('opens %s without prompts or sidebar counts', async (path, readyControl) => {
  queries.workflows.mockResolvedValue([{ id: 'w1', name: 'Workflow one' }]);
  queries.prompts.mockRejectedValue(new Error('Prompts unavailable'));
  queries.requestCount.mockRejectedValue(new Error('Request count failed'));
  queries.automationCount.mockRejectedValue(
    new Error('Automation count failed'),
  );
  await mount(path);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.querySelector(readyControl)).not.toBeNull();
  });
  expect(container.textContent).not.toContain('Could not load automations');
  expect(container.textContent).toContain('Local engine connected');
});

it('opens the automation type picker without workflow data', async () => {
  queries.workflows.mockRejectedValue(
    new Error('Workflow library unavailable'),
  );
  await mount('/automations/new');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain('What should start the workflow?');
  });
  expect(container.textContent).not.toContain('Workflow library unavailable');
});

it('reports an automation detail read failure independently of workflow data', async () => {
  queries.workflows.mockRejectedValue(
    new Error('Workflow library unavailable'),
  );
  queries.automationInspect.mockRejectedValue(
    new Error('Automation inspection unavailable'),
  );
  await mount('/automations/schedule-id');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain(
      'Automation inspection unavailable',
    );
  });
  expect(container.textContent).not.toContain('Workflow library unavailable');
  await click('Reload automation');
  expect(queries.automationInspect).toHaveBeenCalledTimes(2);
  expect(queries.workflows).not.toHaveBeenCalled();
  expect(queries.requestCount).toHaveBeenCalledTimes(1);
  expect(queries.automationCount).toHaveBeenCalledTimes(1);
});

it('marks a cached combined total stale and retries only the failing attention source', async () => {
  queries.requestCount.mockResolvedValue({ items: [], total: 2 });
  queries.automationCount.mockResolvedValue({ items: [], total: 3 });
  await mount('/workflows');
  const runsLink = container.querySelector('nav a[href="/runs"]');
  expect(runsLink?.textContent).toBe('Runs5');

  queries.automationCount.mockRejectedValueOnce(
    new Error('Automation count failed'),
  );
  await act(async () =>
    libraryClient.refetchQueries(
      trpc.triggers.attention.queryFilter({ limit: 1 }),
    ),
  );
  expect(runsLink?.textContent).toBe('Runs~5');
  expect(runsLink?.getAttribute('aria-label')).toBe(
    'Runs, attention count 5, includes stale data',
  );
  expect(container.textContent).toContain('Local engine connected');
  expect(container.textContent).toContain('Open workflow');

  queries.automationCount.mockResolvedValue({ items: [], total: 1 });
  const retry = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Retry attention count for automations"]',
  );
  expect(retry).not.toBeNull();
  await act(async () => retry!.click());
  expect(runsLink?.textContent).toBe('Runs3');
  expect(runsLink?.getAttribute('aria-label')).toBe(
    'Runs, 3 items need attention',
  );
  expect(queries.requestCount).toHaveBeenCalledTimes(1);
  expect(queries.automationCount).toHaveBeenCalledTimes(3);
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
    container.querySelector<HTMLAnchorElement>('.run-row a')!.click(),
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
  const workflows = [
    { id: 'parent', name: 'Parent' },
    { id: 'child', name: 'Child', ownerWorkflowId: 'parent' },
  ];
  queries.workflows.mockResolvedValue(workflows);
  mockWorkflowDetails(workflows);
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
    'a[aria-label="Runs, 1 item needs attention"]',
  );
  expect(badge?.textContent).toBe('Runs1');
  await act(async () => router.navigate('/runs?tab=attention'));
  expect(
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toBe('Needs attention 1');
  const row = container.querySelector('.run-row')!;
  expect(row.textContent).toContain('Recovery needed');
  const [title, review] = [...row.querySelectorAll('a')];
  expect(new URL(title.href).pathname).toBe('/runs/r1');
  expect(review.textContent).toBe('Review recovery');
  await act(async () => review.click());
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
    container.querySelector('a[aria-label="Runs, 1 item needs attention"]'),
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
  const next = [
    ...container.querySelectorAll<HTMLElement>('button, nav a'),
  ].find((button) => button.textContent === 'Next')!;
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
    container.querySelector<HTMLAnchorElement>('.run-row a')!.click(),
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

it('checks engine connectivity separately after the event stream drops', async () => {
  vi.useFakeTimers();
  await mount('/workflows');
  expect(container.textContent).toContain('Local engine connected');
  queries.connection.mockRejectedValueOnce(new Error('Engine unreachable'));
  await act(async () => streamListeners.get('error')!());
  expect(container.querySelector('aside footer')?.textContent).toContain(
    'Engine unavailable',
  );
  expect(container.textContent).toContain('Open workflow');

  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(container.textContent).toContain('Local engine connected');
  expect(queries.connection).toHaveBeenCalledTimes(3);
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
    new TRPCClientError('Temporary request failure'),
  );
  await act(async () => streamListeners.get('change')!());
  await advance(100);
  expect(queries.workflows).toHaveBeenCalledTimes(1);
  await advance(5_000);
  expect(queries.workflows).toHaveBeenCalledTimes(2);
  await advance(5_000);
  expect(queries.workflows).toHaveBeenCalledTimes(2);
});

it('keeps healthy stream polling when an active read is permanently rejected', async () => {
  vi.useFakeTimers();
  const message = 'The saved prompt no longer exists.';
  queries.prompt.mockRejectedValue(
    new TRPCClientError(message, {
      result: {
        error: {
          code: -32603,
          message,
          data: {
            code: 'INTERNAL_SERVER_ERROR',
            httpStatus: 500,
            domainRejection: true,
          },
        },
      },
    }),
  );
  await mount('/prompts/test-prompt');
  await act(async () => streamListeners.get('connect')!());
  await act(async () => vi.advanceTimersByTimeAsync(100));
  queries.workflows.mockClear();
  queries.connection.mockClear();
  await act(async () => {
    streamListeners.get('change')!();
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(container.textContent).toContain(message);
  const reads = queries.prompt.mock.calls.length;
  await click('Retry');
  expect(queries.prompt).toHaveBeenCalledTimes(reads + 1);
  expect(queries.workflows).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(queries.workflows).not.toHaveBeenCalled();
  expect(queries.connection).not.toHaveBeenCalled();
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

it('opens Diagnostics from utilities and keeps live verification opt-in', async () => {
  await mount('/workflows');
  expect(
    container.querySelector(
      'nav[aria-label="Main navigation"] a[aria-label="Diagnostics"]',
    ),
  ).toBeNull();
  const link = container.querySelector<HTMLAnchorElement>(
    'nav[aria-label="Utilities"] a[aria-label="Diagnostics"]',
  )!;
  expect(link).toBeTruthy();
  await click('Diagnostics');
  expect(window.location.pathname).toBe('/settings/diagnostics');
  expect(link.getAttribute('aria-current')).toBe('page');
  expect(queries.doctor).toHaveBeenLastCalledWith({ live: false });
  expect(container.textContent).toContain('Low disk space');
  expect(container.textContent).toContain('Free disk space');
  const live = container.querySelector<HTMLInputElement>(
    'input[aria-label="Include live harness model verification"]',
  )!;
  await act(async () => live.click());
  expect(queries.doctor).toHaveBeenLastCalledWith({ live: true });
  await click('Run checks');
  expect(queries.doctor).toHaveBeenLastCalledWith({ live: true });
});

it('shows a static diagnostics loading state and allows retry after failure', async () => {
  let reject!: (error: Error) => void;
  queries.doctor.mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  await mount('/settings/diagnostics');
  expect(container.textContent).toContain('Running diagnostics…');
  const run = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Run checks',
  )!;
  expect(run.disabled).toBe(true);
  await act(async () => reject(new Error('Diagnostics unavailable')));
  expect(container.textContent).toContain('Diagnostics unavailable');
  expect(run.disabled).toBe(false);
  await click('Run checks');
  expect(container.textContent).not.toContain('Diagnostics unavailable');
  expect(container.textContent).toContain('Storage check');
  expect(queries.doctor).toHaveBeenLastCalledWith({ live: false });
});

async function selectRunMode(mode: 'list' | 'overview') {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>(`input[value="${mode}"]`)!
      .click(),
  );
}

it('bookmarks Overview independently of the remembered List tab and offset, including Back and Forward', async () => {
  const tags = { repo: ' dgca/interlock ', priority: 'High' };
  const initial = new URLSearchParams({
    tab: 'history',
    offset: '100',
    tags: JSON.stringify(tags),
  });
  await mount(`/runs?${initial}`);
  await selectRunMode('overview');
  expect(new URLSearchParams(window.location.search).get('mode')).toBe(
    'overview',
  );
  expect(new URLSearchParams(window.location.search).get('offset')).toBe('100');
  expect(container.querySelector('[role="tablist"]')).toBeNull();
  expect(queries.summaries).toHaveBeenCalledWith(
    expect.objectContaining({ tab: 'active', offset: 0, limit: 100, tags }),
  );
  await selectRunMode('list');
  expect(window.location.search).toBe(`?${initial}`);
  expect(queries.summaries).toHaveBeenLastCalledWith(
    expect.objectContaining({ tab: 'history', offset: 100, tags }),
  );
  await traverse('back');
  expect(
    container.querySelector<HTMLInputElement>('input[value="overview"]')
      ?.checked,
  ).toBe(true);
  await traverse('forward');
  expect(
    container.querySelector<HTMLInputElement>('input[value="list"]')?.checked,
  ).toBe(true);
});

it('switches Overview shortcuts to List atomically and restores Overview with one Back', async () => {
  await mount('/runs?mode=overview&tab=history&offset=100');
  await click('View all attention');
  expect(window.location.search).toBe('?tab=attention');
  expect(
    container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toContain('Needs attention');
  await traverse('back');
  expect(window.location.search).toBe('?mode=overview&tab=history&offset=100');
  expect(container.querySelector('[role="tablist"]')).toBeNull();
  await click('View all active');
  expect(window.location.search).toBe('');
  await traverse('back');
  await click('View history');
  expect(window.location.search).toBe('?tab=history');
});

it('preserves scoped Overview and exact tags through inspector links and return navigation', async () => {
  const tags = { repo: ' dgca/interlock ', priority: 'High' };
  const initial = new URLSearchParams({
    view: 'runs',
    mode: 'overview',
    tab: 'history',
    offset: '100',
    tags: JSON.stringify(tags),
  });
  await mount(`/workflows/w1?${initial}`);
  expect(container.querySelector('[role="tablist"]')).toBeNull();
  expect(queries.summaries).toHaveBeenCalledWith(
    expect.objectContaining({
      tab: 'active',
      offset: 0,
      workflowId: 'w1',
      tags,
    }),
  );
  await act(async () =>
    container.querySelector<HTMLAnchorElement>('.run-row a')!.click(),
  );
  expect(window.location.pathname).toBe('/runs/r1');
  expect(new URLSearchParams(window.location.search).get('mode')).toBe(
    'overview',
  );
  await click('Child run');
  expect(new URLSearchParams(window.location.search).get('mode')).toBe(
    'overview',
  );
  await click('Back to runs');
  const returned = new URLSearchParams(window.location.search);
  expect(window.location.pathname).toBe('/workflows/w1');
  for (const [key, value] of initial) expect(returned.get(key)).toBe(value);
  expect(
    container.querySelector<HTMLInputElement>('input[value="overview"]')
      ?.checked,
  ).toBe(true);
});

it('names the exact scoped workflow in history cleanup without a catalog read', async () => {
  mockWorkflowDetails([{ id: 'w1', name: 'Repository review' }]);
  await mount('/workflows/w1?view=runs');
  await click('History settings');
  await click('Clean up history');
  const workflow = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[role="combobox"]',
  );
  expect(workflow?.value).toBe('Repository review');
  expect(workflow?.disabled).toBe(true);
  expect(queries.workflows).not.toHaveBeenCalled();
});

it('keeps an observed publication in complete catalogs through older reads and failed refresh', async () => {
  const workflow: Workflow = {
    id: 'w1',
    name: 'Workflow',
    description: '',
    archived: false,
    boardId: 'board',
    draft: blankDefinition(),
    draftRevision: 1,
    latestVersion: 1,
    createdAt: '',
    updatedAt: '',
  };
  const entry = workflowCatalogEntry(workflow);
  const other = { ...entry, id: 'other' };
  const defaultKey = trpc.workflows.catalog.queryKey();
  const boardKey = trpc.workflows.catalog.queryKey({ boardId: 'board' });
  const exactKey = trpc.workflows.catalog.queryKey({ id: workflow.id });
  mockWorkflowDetails([workflow]);
  queries.workflows.mockImplementation(async (scope) =>
    scope?.boardId ? [workflow] : [workflow, { ...workflow, id: other.id }],
  );
  await mount('/workflows/w1');
  await act(async () => {
    await Promise.all([
      libraryClient.fetchQuery(trpc.workflows.catalog.queryOptions()),
      libraryClient.fetchQuery(
        trpc.workflows.catalog.queryOptions({ boardId: 'board' }),
      ),
    ]);
  });
  let release!: (rows: Workflow[]) => void;
  const stale = new Promise<Workflow[]>((resolve) => {
    release = resolve;
  });
  queries.workflows
    .mockImplementationOnce(() => stale)
    .mockImplementationOnce(() => stale)
    .mockRejectedValue(new Error('Catalog unavailable'));
  await act(async () => {
    void libraryClient.refetchQueries({ queryKey: defaultKey, exact: true });
    void libraryClient.refetchQueries({ queryKey: boardKey, exact: true });
  });

  expect(libraryClient.getQueryState(defaultKey)?.fetchStatus).toBe('fetching');
  expect(libraryClient.getQueryState(boardKey)?.fetchStatus).toBe('fetching');
  await click('Acknowledge publication');
  await act(async () => release([workflow]));
  await vi.waitFor(() => {
    expect(libraryClient.getQueryState(defaultKey)?.status).toBe('error');
    expect(libraryClient.getQueryState(boardKey)?.status).toBe('error');
  });
  const published = { ...entry, latestVersion: 2 };
  expect(libraryClient.getQueryData(defaultKey)).toEqual([published, other]);
  expect(libraryClient.getQueryData(boardKey)).toEqual([published]);
  expect(libraryClient.getQueryData(exactKey)).toBeUndefined();
});

it('returns to the original List tab even when an inspected run has a different status', async () => {
  await mount('/runs?tab=history');
  await act(async () =>
    container.querySelector<HTMLAnchorElement>('.run-row a')!.click(),
  );
  await click('Child run');
  await click('Back to runs');
  expect(window.location.search).toBe('?tab=history');
});

it('reports a background workspace query failure even when refresh was initiated by another observer', async () => {
  await mount('/workflows');
  queries.workflows.mockRejectedValueOnce(
    new Error('Background read unavailable'),
  );
  await click('Refresh library');
  expect(container.textContent).toContain('Could not refresh workflows.');
  expect(container.textContent).toContain('Open workflow');
  expect(container.textContent).not.toContain('Loading workflows');
  expect(container.textContent).toContain('Local engine connected');
  const counterReads = queries.requestCount.mock.calls.length;
  const automationReads = queries.automationCount.mock.calls.length;
  await click('Retry workflows');
  expect(container.textContent).not.toContain('Could not refresh workflows.');
  expect(queries.requestCount).toHaveBeenCalledTimes(counterReads);
  expect(queries.automationCount).toHaveBeenCalledTimes(automationReads);
});

it('returns to cached Runs immediately while its revisit request is pending', async () => {
  await mount('/runs?tab=history');
  expect(container.querySelector('.run-row')).not.toBeNull();
  await act(async () => router.navigate('/workflows'));
  let finish!: (value: unknown) => void;
  const nextPage = {
    items: [],
    counts: { active: 0, attention: 0, history: 0 },
    total: 0,
    offset: 0,
    nextOffset: null,
  };
  queries.summaries.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => router.navigate('/runs?tab=history'));
  expect(container.querySelector('.run-row')).not.toBeNull();
  expect(container.textContent).not.toContain('Loading runs…');
  await act(async () => finish(nextPage));
  expect(container.querySelector('.run-row')).toBeNull();
});

it.each([
  { operation: 'create', priorRead: false },
  { operation: 'clone', priorRead: false },
  { operation: 'create', priorRead: true },
  { operation: 'clone', priorRead: true },
] as const)(
  'opens a library $operation without a not-found flash with delayed refresh and prior read $priorRead',
  async ({ operation, priorRead }) => {
    queries.realLibrary = true;
    const original: Workflow = {
      id: 'original',
      name: 'Original workflow',
      description: '',
      archived: false,
      ownerWorkflowId: null,
      draft: blankDefinition(),
      draftRevision: 1,
      latestVersion: 0,
      createdAt: '2026-11-09T00:00:00Z',
      updatedAt: '2026-11-09T00:00:00Z',
    };
    const created = { ...original, id: 'new-workflow', name: 'New workflow' };
    queries.workflows.mockResolvedValue([original]);
    mockWorkflowDetails([original, created]);
    queries.createWorkflow.mockResolvedValue(created);
    queries.cloneWorkflow.mockResolvedValue(created);
    await mount('/workflows');
    let finishOld: (() => void) | undefined;
    let finishRefresh!: () => void;
    if (priorRead) {
      queries.workflows.mockImplementationOnce(
        () =>
          new Promise<Workflow[]>((resolve) => {
            finishOld = () => resolve([original]);
          }),
      );
      await act(async () => {
        void libraryClient.refetchQueries(trpc.workflows.catalog.queryFilter());
      });
      // Another acknowledged write during that read must also survive cancellation.
      libraryClient.setQueryData(
        trpc.workflows.catalog.queryKey(),
        (all = []) =>
          all.map((workflow) =>
            workflow.id === original.id
              ? { ...workflow, description: 'Newer acknowledged description' }
              : workflow,
          ),
      );
    }
    queries.workflows.mockImplementation(
      () =>
        new Promise<Workflow[]>((resolve) => {
          finishRefresh = () => resolve([original, created]);
        }),
    );
    const seen: string[] = [];
    const observer = new MutationObserver(() =>
      seen.push(container.textContent ?? ''),
    );
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    try {
      if (operation === 'create') await click('New workflow');
      else {
        await act(async () =>
          document
            .querySelector<HTMLButtonElement>(
              'button[aria-label="Actions for Original workflow"]',
            )!
            .click(),
        );
        await click('Clone');
      }
      expect(window.location.pathname).toBe('/workflows/new-workflow');
      expect(container.textContent).toContain('Editor new-workflow');
      expect(seen.some((text) => text.includes('Workflow not found'))).toBe(
        false,
      );
      if (finishOld) {
        await act(async () => finishOld!());
        expect(container.textContent).toContain('Editor new-workflow');
        expect(
          libraryClient
            .getQueryData(trpc.workflows.catalog.queryKey())
            ?.find((workflow) => workflow.id === original.id)?.description,
        ).toBe('Newer acknowledged description');
      }
      expect(seen.some((text) => text.includes('Workflow not found'))).toBe(
        false,
      );
      await act(async () => finishRefresh());
      expect(container.textContent).toContain('Editor new-workflow');
    } finally {
      observer.disconnect();
    }
  },
);
