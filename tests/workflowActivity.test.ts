// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { expect, it, vi } from 'vitest';
import type { Run } from '@interlock/core';
import { WorkflowActivity } from '../packages/ui/src/features/runs/WorkflowActivity';

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
      h(WorkflowActivity, { runs, onOpen: open, tab, onTabChange: setTab }),
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
