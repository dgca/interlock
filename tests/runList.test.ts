// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { expect, it, vi } from 'vitest';
import type { RunSummary } from '@interlock/core';
import { RunList } from '../packages/ui/src/features/runs/RunList';

const query = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    triggers: {
      attention: {
        query: () => Promise.resolve({ items: [], total: 0, nextOffset: null }),
      },
    },
    runs: { summaries: { query } },
  },
  errorMessage: (error: Error) => error.message,
}));

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
  query.mockImplementation(async ({ tab }) => ({
    items:
      tab === 'active'
        ? runs.filter(
            (run) => run.status === 'running' || run.status === 'waiting',
          )
        : runs.slice(2, 5),
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
      MantineProvider,
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
    const panel = () => container.querySelector('[role="tabpanel"]')!;
    expect(panel().textContent).toContain('running workflow');
    expect(panel().textContent).toContain('waiting workflow');
    expect(
      Array.from(panel().querySelectorAll('strong')).map(
        (name) => name.textContent,
      ),
    ).not.toContain('completed workflow');
    expect(panel().textContent).toContain('Independent investigation');
    expect(panel().textContent).toContain(
      'Started independently · from completed workflow',
    );
    expect(container.querySelector('[role="tab"]')?.textContent).toBe(
      'Active 3',
    );
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
          MantineProvider,
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
        MantineProvider,
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
      MantineProvider,
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
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((element) => element.textContent === label)!
        .click(),
    );
  const input = async (label: string, value: string) =>
    act(async () => {
      const field = container.querySelector<HTMLInputElement>(
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
    await click('Add tag');
    await input('Matching tags key 1', 'repo.name');
    await input('Matching tags value 1', 'org/repo');
    await click('Add tag');
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
    await click('Clear filters');
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ tags: undefined, offset: 0 }),
    );
    expect(container.querySelectorAll('button.run-row')).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
