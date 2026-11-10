// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RunSummary } from '@interlock/core';
import { RunList } from '../packages/ui/src/features/runs/RunList';
import { RunListSkeleton } from '../packages/ui/src/features/runs/RunListSkeleton';
import { MemoryRouter } from 'react-router';

const query = vi.hoisted(() => vi.fn());
const retentionSettings = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      triggers: {
        attention: {
          query: () =>
            Promise.resolve({ items: [], total: 0, nextOffset: null }),
        },
      },
      runs: {
        summaries: { query },
        retentionSettings: { query: retentionSettings },
        retentionStatus: {
          query: async () => ({
            storage: { databaseBytes: 0, reusableBytes: 0 },
          }),
        },
      },
    }),
    errorMessage: (error: Error) => error.message,
  };
});

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

async function showOverview(container: HTMLElement) {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[value="overview"]')!
      .click(),
  );
}

it('defaults lazy and data loading to List and switches to Overview when selected', async () => {
  query.mockImplementation(() => new Promise(() => {}));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    for (const path of [
      '/runs',
      '/runs?tab=history',
      '/workflows/workflow?view=runs',
      '/workflows/workflow?view=runs&tab=history',
    ]) {
      const embedded = path.startsWith('/workflows/');
      await act(async () =>
        root.render(
          h(
            DesignSystemProvider,
            { env: 'test' },
            h(
              MemoryRouter,
              { initialEntries: [path], key: path },
              h(RunListSkeleton, { embedded }),
            ),
          ),
        ),
      );
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        'Loading runs…',
      );
      expect(container.textContent).toContain('Started');
      expect(container.textContent).not.toContain('Active runs');
      expect(container.querySelector('header') !== null).toBe(!embedded);
      expect(
        container.querySelector('[aria-current="page"]')?.textContent,
      ).toContain(path.includes('tab=history') ? 'History' : 'Active');
    }
    await act(async () =>
      root.render(
        h(
          DesignSystemProvider,
          { env: 'test' },
          h(RunList, {
            tick: 0,
            offset: 0,
            onOffsetChange: vi.fn(),
            workflows: [],
            tab: 'active',
            onTabChange: vi.fn(),
            onOpen: vi.fn(),
          }),
        ),
      ),
    );
    expect(
      [
        ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ].map((input) => input.value),
    ).toEqual(['list', 'overview']);
    expect(
      container.querySelector<HTMLInputElement>('input[value="list"]')?.checked,
    ).toBe(true);
    expect(
      container.querySelector('header [role="radiogroup"]'),
    ).not.toBeNull();
    expect(container.querySelector('header')?.textContent).toContain(
      'Filter by tags',
    );
    expect(container.textContent).toContain('Started');
    expect(container.textContent).not.toContain('Active runs');
    expect(query).not.toHaveBeenCalledWith(
      expect.objectContaining({ limit: 6 }),
    );
    await showOverview(container);
    expect(container.textContent).toContain('Active runs');
    expect(container.textContent).not.toContain('Started');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(
      [...container.querySelectorAll('h2')].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(['Active runs', 'Needs attention', 'Completed runs']);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('scopes empty board messages to exact tag filters and clears them through the existing reset action', async () => {
  query.mockImplementation(async ({ tab, tags, offset }) => {
    const items =
      tab === 'active' && !tags
        ? [
            {
              id: 'unfiltered',
              workflowId: 'workflow',
              workflowName: 'Available run',
              version: 1,
              status: 'waiting',
              createdAt: '2026-11-09T12:00:00Z',
              updatedAt: '2026-11-09T12:01:00Z',
              executionCount: 1,
            },
          ]
        : [];
    return {
      items,
      counts: { active: tags ? 0 : 1, attention: 0, history: 0 },
      total: items.length,
      offset,
      nextOffset: null,
    };
  });
  function Harness() {
    const [tags, setTags] = useState<Record<string, string> | undefined>({
      priority: 'High',
    });
    return h(RunList, {
      tick: 0,
      offset: 0,
      onOffsetChange: vi.fn(),
      workflows: [],
      tab: 'active',
      onTabChange: vi.fn(),
      onOpen: vi.fn(),
      tags,
      onTagsChange: setTags,
    });
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(h(DesignSystemProvider, { env: 'test' }, h(Harness))),
    );
    await showOverview(container);
    expect(container.textContent).toContain('No active runs match these tags.');
    expect(container.textContent).toContain(
      'No matching runs need your attention.',
    );
    expect(container.textContent).toContain(
      'No completed runs match these tags.',
    );
    const clear = [
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ].find(
      (button) =>
        button.textContent === 'Clear filters' && !button.closest('[hidden]'),
    )!;
    await act(async () => clear.click());
    expect(container.textContent).toContain('Available run');
    expect(container.textContent).not.toContain(
      'No active runs match these tags.',
    );
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'active', tags: undefined, offset: 0 }),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
afterEach(() => vi.unstubAllGlobals());

it('renders active and history pages and opens the selected run', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const runs = ['running', 'waiting', 'completed', 'failed', 'cancelled'].map(
    (status) =>
      ({
        id: status,
        workflowId: 'workflow',
        updatedAt: new Date().toISOString(),
        workflowName: status + ' workflow',
        status,
        version: 1,
        createdAt: new Date().toISOString(),
        executionCount: 0,
      }) as RunSummary,
  );
  runs.push({
    ...runs[0],
    id: 'detached',
    workflowName: 'Independent investigation',
    parentRunId: 'completed',
    parentWorkflowName: 'completed workflow',
    parentMode: 'detached',
  });
  query.mockImplementation(async ({ tab, status: selectedStatus }) => ({
    items:
      tab === 'active'
        ? runs.filter(
            (run) => run.status === 'running' || run.status === 'waiting',
          )
        : tab === 'attention'
          ? []
          : runs
              .slice(2, 5)
              .filter(
                (run) => !selectedStatus || run.status === selectedStatus,
              ),
    counts: { active: 3, attention: 0, history: 3 },
    offset: 0,
    nextOffset: null,
    total: 3,
  }));
  const open = vi.fn();
  function Harness() {
    const [tab, setTab] = useState<'active' | 'attention' | 'history'>(
      'active',
    );
    return h(
      DesignSystemProvider,
      {},
      h(RunList, {
        tick: 0,
        offset: 0,
        onOffsetChange: vi.fn(),
        workflows: [],
        onOpen: open,
        tab,
        onTabChange: setTab,
      }),
    );
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(Harness)));
    const panel = () =>
      container.querySelector('[role="tabpanel"]') ?? container;
    expect(panel().textContent).toContain('running workflow');
    expect(
      [...panel().querySelectorAll('strong')].map((title) => title.textContent),
    ).not.toContain('completed workflow');
    await showOverview(container);
    expect(panel().textContent).toContain('running workflow');
    expect(panel().textContent).toContain('waiting workflow');
    expect(panel().textContent).toContain('Completed runs');
    expect(panel().textContent).toContain('completed workflow');
    expect(panel().textContent).not.toContain('failed workflow');
    expect(panel().textContent).toContain('Independent investigation');
    expect(panel().textContent).toContain(
      'Started independently · from completed workflow',
    );
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[value="list"]')!.click(),
    );
    expect(panel().textContent).toContain('running workflow');
    expect(
      [...panel().querySelectorAll('strong')].map((title) => title.textContent),
    ).not.toContain('completed workflow');
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((tab) => tab.textContent?.startsWith('History'))!
        .click(),
    );
    expect(panel().textContent).not.toContain('running workflow');
    for (const status of ['completed', 'failed', 'cancelled'])
      expect(panel().textContent).toContain(status + ' workflow');
    await act(async () =>
      [...panel().querySelectorAll('button')]
        .find((button) => button.textContent?.includes('failed workflow'))!
        .click(),
    );
    expect(open).toHaveBeenCalledWith('failed');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('requests the selected workflow and opens its invocation', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const base = {
    updatedAt: new Date().toISOString(),
    workflowId: 'selected',
    status: 'completed',
    version: 1,
    createdAt: new Date().toISOString(),
    executionCount: 0,
  };
  const runs = [
    { ...base, id: 'root', workflowName: 'Selected root' },
    {
      ...base,
      id: 'invocation',
      workflowName: 'Selected invocation',
      parentRunId: 'other',
    },
  ] as RunSummary[];
  query.mockResolvedValue({
    items: runs,
    counts: { active: 0, attention: 0, history: 2 },
    offset: 0,
    nextOffset: null,
    total: 2,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const open = vi.fn();
  try {
    await act(async () =>
      root.render(
        h(
          DesignSystemProvider,
          { env: 'test' },
          h(RunList, {
            tick: 0,
            offset: 0,
            onOffsetChange: vi.fn(),
            workflows: [],
            workflowId: 'selected',
            tab: 'history',
            onTabChange: vi.fn(),
            onOpen: open,
          }),
        ),
      ),
    );
    const rows = [
      ...container.querySelectorAll<HTMLButtonElement>('button.run-row'),
    ];
    expect(rows).toHaveLength(2);
    expect(container.textContent).toContain('Selected root');
    expect(container.textContent).toContain('Selected invocation');
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ workflowId: 'selected', tab: 'history' }),
    );
    await act(async () => rows[1].click());
    expect(open).toHaveBeenCalledWith('invocation');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('29f3cb6-attention-row: preserves stage and actor with specific attention and opens the request', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const base = {
    id: 'attention',
    workflowId: 'workflow',
    workflowName: 'Review build',
    status: 'waiting',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    executionCount: 2,
    stage: 'Build',
    actor: 'person',
    waiting: {
      kind: 'human_request',
      since: new Date().toISOString(),
      detail: { runId: 'attention', nodeId: 'agent' },
    },
    attention: {
      runId: 'attention',
      reasons: ['approval'],
      target: { runId: 'child', executionId: 'request' },
    },
  };
  query.mockResolvedValue({
    items: [base],
    counts: { active: 1, attention: 1, history: 0 },
    offset: 0,
    nextOffset: null,
    total: 1,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    open = vi.fn();
  const render = (tick = 0) =>
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(RunList, {
          tick,
          offset: 0,
          onOffsetChange: vi.fn(),
          workflows: [],
          tab: 'attention',
          onTabChange: vi.fn(),
          onOpen: open,
        }),
      ),
    );
  try {
    await act(async () => render());
    let row = container.querySelector<HTMLButtonElement>('button.run-row')!;
    expect(row.textContent).toContain('Build · Approval requested · Person');
    expect(row.textContent!.match(/Approval requested/g)).toHaveLength(1);
    await act(async () => row.click());
    expect(open).toHaveBeenCalledWith('child', 'request');
    query.mockResolvedValue({
      items: [
        {
          ...base,
          actor: 'agent',
          waiting: { ...base.waiting, kind: 'claim_queue' },
        },
      ],
      counts: { active: 1, attention: 1, history: 0 },
      offset: 0,
      nextOffset: null,
      total: 1,
    });
    await act(async () => render(1));
    row = container.querySelector<HTMLButtonElement>('button.run-row')!;
    expect(row.textContent).toContain('Build · Waiting for an agent · Agent');
    expect(row.textContent).toContain('Approval requested');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('applies all exact tag pairs before paging and clears the filter', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const base = {
    workflowId: 'workflow',
    updatedAt: new Date().toISOString(),
    status: 'completed',
    version: 1,
    createdAt: new Date().toISOString(),
    executionCount: 0,
  };
  const runs = [
    {
      ...base,
      id: 'match',
      workflowName: 'Match',
      tags: { 'repo.name': 'org/repo', priority: 'High' },
    },
    {
      ...base,
      id: 'other',
      workflowName: 'Other',
      tags: { 'repo.name': 'org/repo', priority: 'low' },
    },
  ];
  query.mockImplementation(async ({ offset, tags }) => {
    const items = runs.filter((run) =>
      Object.entries(tags ?? {}).every(
        ([key, value]) => run.tags[key as keyof typeof run.tags] === value,
      ),
    );
    return {
      items,
      counts: { active: 0, attention: 0, history: items.length },
      offset,
      nextOffset: null,
      total: items.length,
    };
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    const [offset, setOffset] = useState(100);
    return h(
      DesignSystemProvider,
      { env: 'test' },
      h(RunList, {
        tick: 0,
        offset,
        onOffsetChange: setOffset,
        workflows: [],
        tab: 'history',
        onTabChange: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
  }
  const click = async (label: string) =>
    act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((element) => element.textContent === label)!
        .click(),
    );
  const input = async (label: string, value: string) =>
    act(async () => {
      const field = document.querySelector<HTMLInputElement>(
        `input[aria-label="${label}"]`,
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  try {
    await act(async () => root.render(h(Harness)));
    expect(container.textContent).toContain('repo.name=org/repo');
    await click('Filter by tags');
    await click('Add condition');
    await input('Matching tags key 1', 'repo.name');
    await input('Matching tags value 1', 'org/repo');
    await click('Add condition');
    await input('Matching tags key 2', 'priority');
    await input('Matching tags value 2', 'High');
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ tags: undefined, offset: 100 }),
    );
    await click('Apply filters');
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tags: { 'repo.name': 'org/repo', priority: 'High' },
        offset: 0,
      }),
    );
    expect(
      [...container.querySelectorAll('button.run-row strong')].map(
        (name) => name.textContent,
      ),
    ).toEqual(['Match']);
    await click('Clear all');
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ tags: undefined, offset: 0 }),
    );
    expect(container.querySelectorAll('button.run-row')).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('uses an independent bounded active preview and adds recovery and completed runs without duplicates', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  const base = {
    workflowId: 'selected',
    workflowName: 'Review',
    version: 2,
    createdAt: '2026-11-09T12:00:00Z',
    updatedAt: '2026-11-09T12:01:00Z',
    executionCount: 3,
  };
  const attention = {
    ...base,
    id: 'approval',
    status: 'waiting',
    attention: {
      runId: 'approval',
      reasons: ['approval'],
      target: { runId: 'approval-child', executionId: 'request' },
    },
  };
  const recovery = {
    ...base,
    id: 'recovery',
    workflowName: 'Recovery',
    status: 'cancelled',
    attention: {
      runId: 'recovery',
      reasons: ['recovery'],
      target: { runId: 'recovery-child', executionId: 'stopped' },
    },
  };
  const running = {
    ...base,
    id: 'running',
    workflowName: 'Active review',
    status: 'running',
  };
  const completed = {
    ...base,
    id: 'completed',
    workflowName: 'Finished review',
    status: 'completed',
  };
  const counts = { active: 300, attention: 2, history: 1 };
  query.mockImplementation(async ({ tab, offset }) => ({
    items:
      tab === 'active'
        ? [attention, running]
        : tab === 'attention'
          ? [attention, recovery]
          : [completed],
    counts,
    offset,
    nextOffset: tab === 'active' ? 200 : null,
    total: tab === 'active' ? 300 : tab === 'attention' ? 2 : 1,
  }));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    open = vi.fn(),
    changePage = vi.fn(),
    changeTab = vi.fn();
  try {
    await act(async () =>
      root.render(
        h(
          DesignSystemProvider,
          { env: 'test' },
          h(RunList, {
            tick: 0,
            offset: 100,
            onOffsetChange: changePage,
            workflows: [],
            workflowId: 'selected',
            tags: { repository: 'org/repo' },
            tab: 'active',
            onTabChange: changeTab,
            onOpen: open,
          }),
        ),
      ),
    );
    await showOverview(container);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: 'attention',
        offset: 0,
        limit: 6,
        workflowId: 'selected',
        tags: { repository: 'org/repo' },
      }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: 'history',
        status: 'completed',
        offset: 0,
        limit: 6,
        workflowId: 'selected',
        tags: { repository: 'org/repo' },
      }),
    );
    const cards = [
      ...container.querySelectorAll<HTMLButtonElement>('button.run-row'),
    ];
    expect(cards).toHaveLength(4);
    expect(
      cards.filter((card) => card.textContent?.includes('approval')),
    ).toHaveLength(1);
    expect(container.textContent).toContain('Active review');
    expect(container.textContent).toContain('Finished review');
    await act(async () =>
      cards
        .find((card) => card.textContent?.includes('Review recovery'))!
        .click(),
    );
    expect(open).toHaveBeenCalledWith('recovery-child', 'stopped');
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'View all active')!
        .click(),
    );
    expect(changeTab).toHaveBeenCalledWith('active');
    expect(changePage).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'active', offset: 0, limit: 100 }),
    );
    expect(container.querySelector('[role="tabpanel"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('does not let an old workflow preview replace the current board', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  const pending: (() => void)[] = [];
  query.mockImplementation(({ workflowId, tab }) => {
    const page = {
      items:
        tab === 'history'
          ? [
              {
                id: workflowId,
                workflowId,
                workflowName: `${workflowId} completed`,
                version: 1,
                status: 'completed',
                createdAt: '2026-11-09T12:00:00Z',
                updatedAt: '2026-11-09T12:01:00Z',
                executionCount: 1,
              },
            ]
          : [],
      counts: { active: 0, attention: 0, history: 1 },
      offset: 0,
      nextOffset: null,
      total: tab === 'history' ? 1 : 0,
    };
    if (workflowId === 'old' && tab !== 'active')
      return new Promise((resolve) => pending.push(() => resolve(page)));
    return Promise.resolve(page);
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (workflowId: string) =>
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(RunList, {
          tick: 0,
          offset: 0,
          onOffsetChange: vi.fn(),
          workflows: [],
          workflowId,
          tab: 'active',
          onTabChange: vi.fn(),
          onOpen: vi.fn(),
        }),
      ),
    );
  try {
    await act(async () => render('old'));
    await showOverview(container);
    await act(async () => render('new'));
    expect(container.textContent).toContain('new completed');
    await act(async () => pending.forEach((resolve) => resolve()));
    expect(container.textContent).toContain('new completed');
    expect(container.textContent).not.toContain('old completed');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('coalesces refreshes while a board preview is loading and accepts the in-flight response', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  const pending: (() => void)[] = [];
  const empty = {
    items: [],
    counts: { active: 0, attention: 0, history: 1 },
    offset: 0,
    nextOffset: null,
    total: 0,
  };
  query.mockImplementation(({ tab }) => {
    if (tab === 'active') return Promise.resolve(empty);
    const page =
      tab === 'attention'
        ? empty
        : {
            ...empty,
            total: 1,
            items: [
              {
                id: 'completed',
                workflowId: 'w',
                workflowName: 'Completed during refresh',
                version: 1,
                status: 'completed',
                createdAt: '2026-11-09T12:00:00Z',
                updatedAt: '2026-11-09T12:01:00Z',
                executionCount: 1,
              },
            ],
          };
    return new Promise((resolve) => pending.push(() => resolve(page)));
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (tick: number) =>
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(RunList, {
          tick,
          offset: 0,
          onOffsetChange: vi.fn(),
          workflows: [],
          tab: 'active',
          onTabChange: vi.fn(),
          onOpen: vi.fn(),
        }),
      ),
    );
  try {
    await act(async () => render(0));
    await showOverview(container);
    await act(async () => render(1));
    await act(async () => render(2));
    expect(pending).toHaveLength(2);
    await act(async () => pending.slice(0, 2).forEach((resolve) => resolve()));
    expect(container.textContent).toContain('Completed during refresh');
    expect(pending).toHaveLength(4);
    await act(async () => pending.slice(2).forEach((resolve) => resolve()));
    expect(pending).toHaveLength(4);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('renders Overview loading without a List status strip for global and embedded deep links', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    for (const embedded of [false, true]) {
      await act(async () =>
        root.render(
          h(
            DesignSystemProvider,
            { env: 'test' },
            h(
              MemoryRouter,
              {
                initialEntries: [
                  embedded
                    ? '/workflows/w1?view=runs&mode=overview&tab=history'
                    : '/runs?mode=overview&tab=history',
                ],
                key: String(embedded),
              },
              h(RunListSkeleton, { embedded }),
            ),
          ),
        ),
      );
      expect(container.querySelector('[aria-current="page"]')).toBeNull();
      expect(container.textContent).not.toContain('Started');
      expect(
        [...container.querySelectorAll('h2')].map(
          (heading) => heading.textContent,
        ),
      ).toEqual(['Active runs', 'Needs attention', 'Completed runs']);
    }
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('keeps automation attention visible in Overview even when exact tags match no runs', async () => {
  query.mockImplementation(async ({ offset }) => ({
    items: [],
    counts: { active: 0, attention: 0, history: 0 },
    scheduleAttentionCount: 2,
    offset,
    total: 0,
    nextOffset: null,
  }));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const changeTab = vi.fn();
  try {
    await act(async () =>
      root.render(
        h(
          DesignSystemProvider,
          { env: 'test' },
          h(RunList, {
            tick: 0,
            offset: 100,
            onOffsetChange: vi.fn(),
            workflows: [],
            tab: 'history',
            mode: 'overview',
            tags: { repo: 'missing' },
            onTabChange: changeTab,
            onOpen: vi.fn(),
          }),
        ),
      ),
    );
    const attention = [...container.querySelectorAll('section')].find(
      (section) =>
        section.querySelector('h2')?.textContent === 'Needs attention',
    )!;
    expect(attention.textContent).toContain('Needs attention2');
    expect(attention.textContent).toContain('2 automation alerts.');
    await act(async () =>
      [...attention.querySelectorAll('button')]
        .find((button) => button.textContent === 'View all attention')!
        .click(),
    );
    expect(changeTab).toHaveBeenCalledWith('attention');
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: 'active',
        offset: 0,
        tags: { repo: 'missing' },
      }),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('offers one History menu across List tabs and Overview in global and workflow scopes, and hides it without act', async () => {
  query.mockImplementation(() => new Promise(() => {}));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    for (const workflowId of [undefined, 'selected']) {
      for (const [mode, tab] of [
        ['list', 'active'],
        ['list', 'attention'],
        ['list', 'history'],
        ['overview', 'history'],
      ] as const) {
        await act(async () =>
          root.render(
            h(
              DesignSystemProvider,
              { env: 'test' },
              h(RunList, {
                tick: 0,
                offset: 0,
                onOffsetChange: vi.fn(),
                workflows: [],
                tab,
                mode,
                workflowId,
                act: vi.fn(),
                onTabChange: vi.fn(),
                onOpen: vi.fn(),
              }),
            ),
          ),
        );
        const triggers = [
          ...container.querySelectorAll<HTMLButtonElement>('button'),
        ].filter((button) => button.getAttribute('aria-haspopup') === 'menu');
        expect(triggers).toHaveLength(1);
        expect(triggers[0].textContent).toBe('History');
        await act(async () => triggers[0].click());
        expect(
          [...document.querySelectorAll('[role="menuitem"]')].map(
            (item) => item.textContent,
          ),
        ).toEqual(['Retention settings', 'Clean up history']);
        await act(async () =>
          document
            .querySelector<HTMLElement>('[role="menu"]')!
            .dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            ),
        );
      }
    }
    await act(async () =>
      root.render(
        h(
          DesignSystemProvider,
          { env: 'test' },
          h(RunList, {
            tick: 0,
            offset: 0,
            onOffsetChange: vi.fn(),
            workflows: [],
            tab: 'history',
            mode: 'overview',
            onTabChange: vi.fn(),
            onOpen: vi.fn(),
          }),
        ),
      ),
    );
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each(['Retention settings', 'Clean up history'])(
  'opens %s from a focused menu item and returns focus to History after closing',
  async (label) => {
    query.mockImplementation(() => new Promise(() => {}));
    retentionSettings.mockResolvedValue({
      scope: 'workflow',
      revision: 0,
      policy: null,
      effectivePolicy: null,
      inherited: false,
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          h(
            DesignSystemProvider,
            { env: 'test' },
            h(RunList, {
              tick: 0,
              offset: 0,
              onOffsetChange: vi.fn(),
              workflows: [{ id: 'selected', name: 'Selected workflow' }],
              tab: 'active',
              mode: 'overview',
              workflowId: 'selected',
              act: vi.fn(),
              onTabChange: vi.fn(),
              onOpen: vi.fn(),
            }),
          ),
        ),
      );
      const trigger = container.querySelector<HTMLButtonElement>(
        '[aria-haspopup="menu"]',
      )!;
      await act(async () => {
        trigger.focus();
        trigger.click();
      });
      const item = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((item) => item.textContent === label)!;
      await act(async () => {
        item.focus();
        item.click();
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      if (label === 'Retention settings')
        expect(retentionSettings).toHaveBeenLastCalledWith({
          workflowId: 'selected',
        });
      else
        expect(
          document.querySelector<HTMLInputElement>(
            'input[aria-label="Root workflow"]',
          )?.disabled ??
            document.querySelector<HTMLInputElement>(
              'input[value="Selected workflow"]',
            )?.disabled,
        ).toBe(true);
      const close = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Close dialog"]',
      )!;
      await act(async () => {
        close.focus();
        close.click();
        await new Promise(requestAnimationFrame);
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => new Promise(requestAnimationFrame));
      expect(document.activeElement).toBe(trigger);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it('reuses the exact cached Runs page on remount while refreshing, retaining it after a refresh failure', async () => {
  const run = {
    id: 'cached-run',
    workflowId: 'selected',
    workflowName: 'Cached workflow',
    version: 1,
    status: 'waiting',
    createdAt: '2026-11-09T12:00:00Z',
    updatedAt: '2026-11-09T12:01:00Z',
    executionCount: 1,
  };
  query.mockResolvedValue({
    items: [run],
    counts: { active: 1, attention: 0, history: 0 },
    total: 1,
    offset: 0,
    nextOffset: null,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const view = (visible: boolean, workflowId = 'selected') =>
    h(
      DesignSystemProvider,
      { env: 'test' },
      visible
        ? h(RunList, {
            tick: 0,
            offset: 0,
            tab: 'active',
            workflowId,
            workflows: [],
            onOffsetChange: vi.fn(),
            onTabChange: vi.fn(),
            onOpen: vi.fn(),
          })
        : h('div'),
    );
  try {
    await act(async () => root.render(view(true)));
    expect(container.textContent).toContain('Cached workflow');
    await act(async () => root.render(view(false)));
    let reject!: (error: Error) => void;
    query.mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    await act(async () => root.render(view(true)));
    expect(container.textContent).toContain('Cached workflow');
    expect(container.textContent).not.toContain('Loading runs…');
    await act(async () => reject(new Error('Refresh unavailable')));
    expect(container.textContent).toContain('Cached workflow');
    expect(container.textContent).toContain('Runs may be out of date');
    await act(async () => root.render(view(true, 'another-workflow')));
    expect(container.textContent).not.toContain('Cached workflow');
    expect(container.textContent).toContain('Loading runs…');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
