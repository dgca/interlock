// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { expect, it, vi } from 'vitest';
import type { Run } from '@interlock/core';
import { RunList } from '../packages/ui/src/features/runs/RunList';

it('separates active root executions from history and opens the selected execution', async () => {
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
        input: null,
        value: null,
        cursor: 'entry',
        updatedAt: new Date().toISOString(),
        workflowName: status + ' workflow',
        status,
        version: 1,
        createdAt: new Date().toISOString(),
        executions: [],
      }) as Run,
  );
  runs.push({
    ...runs[0],
    id: 'child',
    workflowName: 'Child item',
    parentRunId: 'running',
  });
  const open = vi.fn();
  function Harness() {
    const [tab, setTab] = useState<'active' | 'history'>('active');
    return h(
      MantineProvider,
      {},
      h(RunList, { runs, onOpen: open, tab, onTabChange: setTab }),
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
    expect(panel().textContent).not.toContain('completed workflow');
    expect(panel().textContent).not.toContain('Child item');
    expect(container.querySelector('[role="tab"]')?.textContent).toBe(
      'Active 2',
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

it('scopes runs to one workflow, including workflow invocations but excluding Batch items', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const base = {
    input: null,
    value: null,
    cursor: 'entry',
    updatedAt: new Date().toISOString(),
    workflowId: 'selected',
    status: 'completed',
    version: 1,
    createdAt: new Date().toISOString(),
    executions: [],
  };
  const runs = [
    { ...base, id: 'root', workflowName: 'Selected root' },
    {
      ...base,
      id: 'invocation',
      workflowName: 'Selected invocation',
      parentRunId: 'other',
    },
    {
      ...base,
      id: 'item',
      workflowName: 'Batch item',
      parentRunId: 'root',
      batchNodeId: 'batch',
    },
    {
      ...base,
      id: 'other',
      workflowName: 'Other workflow',
      workflowId: 'other',
    },
  ] as Run[];
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
            runs,
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
    expect(container.textContent).not.toContain('Batch item');
    expect(container.textContent).not.toContain('Other workflow');
    await act(async () => rows[1].click());
    expect(open).toHaveBeenCalledWith('invocation');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
