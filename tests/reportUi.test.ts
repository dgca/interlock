// @vitest-environment jsdom
import { transferableAbortController } from 'node:util';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { calculateDistribution, type WorkflowReport } from '@interlock/core';
import { routes } from '../packages/ui/src/routes';

const query = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/engineEvents', () => ({
  subscribeToEngineEvents: () => () => {},
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    connection: { query: async () => ({ engineUrl: 'http://127.0.0.1:4310' }) },
    workflows: {
      list: { query: async () => [{ id: 'w1', name: 'Tagged work' }] },
    },
    prompts: { list: { query: async () => [] } },
    runs: { attention: { query: async () => [] } },
    triggers: { attention: { query: async () => ({ items: [], total: 0 }) } },
    pauses: { list: { query: async () => ({ items: [], total: 0 }) } },
    report: { summary: { query } },
  },
  errorMessage: (error: Error) => error.message,
}));
vi.mock('../packages/ui/src/features/runs/RunList', () => ({
  RunList: () => h('div', null, 'Runs route'),
}));
vi.mock('../packages/ui/src/components/ConnectDialog/ConnectDialog', () => ({
  ConnectDialog: () => null,
}));

function report(totalRuns = 4): WorkflowReport {
  const empty = calculateDistribution([]);
  return {
    filter: { limit: 1000 },
    generatedAt: '2026-11-07T00:00:00.000Z',
    window: { since: null, until: null },
    summary: {
      totalRuns,
      durationMs: empty,
      admissionQueueWaitMs: empty,
      humanWaitMs: empty,
    },
    stages: [],
    nodes: [],
    claims: {
      newSession: empty,
      continuingSession: empty,
      totalAttempts: 0,
      leaseExpiries: 0,
      failures: 0,
      h7Recoveries: 0,
      h12Stalls: 0,
    },
    usage: {
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
      },
      costs: [],
      coverage: {
        measuredPercentage: 0,
        unknownPercentage: 0,
        measuredAttempts: 0,
        unknownAttempts: 0,
        totalAttempts: 0,
      },
      byRun: [],
      byNode: [],
      byModel: [],
      byProvider: [],
    },
    terminalOutcomes: {
      totalRuns,
      completedRuns: totalRuns,
      failedRuns: 0,
      cancelledRuns: 0,
      activeRuns: 0,
      exitNodes: [],
      unattendedCompletionRate: 100,
      humanEscalationRate: 0,
    },
  };
}

let root: Root;
let container: HTMLDivElement;
let router: ReturnType<typeof createMemoryRouter>;
beforeAll(async () => {
  await import('../packages/ui/src/features/report/WorkflowReportView');
});
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'AbortController',
    class {
      constructor() {
        return transferableAbortController();
      }
    },
  );
  query
    .mockReset()
    .mockImplementation(async ({ tags }) => report(tags ? 1 : 4));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  router?.dispose();
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(path = '/report') {
  router = createMemoryRouter(routes, { initialEntries: [path] });
  await act(async () =>
    root.render(
      h(MantineProvider, { env: 'test' }, h(RouterProvider, { router })),
    ),
  );
}
async function click(label: string) {
  const control = [
    ...container.querySelectorAll<HTMLElement>('button, nav a'),
  ].find(
    (element) =>
      (element.getAttribute('aria-label') ?? element.textContent) === label,
  );
  expect(control, label).toBeTruthy();
  await act(async () => control!.click());
}
async function input(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  expect(field, label).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function openTags() {
  await act(async () => container.querySelector('summary')!.click());
}
const runCount = () =>
  [...container.querySelectorAll('p')].find(
    (element) => element.textContent === 'Total Runs',
  )!.parentElement!.parentElement!.textContent;

it('navigates the actual App from Runs to global and workflow Reports without changing hook order', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await mount('/runs');
    expect(container.textContent).toContain('Runs route');
    await click('Report');
    expect(router.state.location.pathname).toBe('/report');
    expect(container.textContent).toContain('Performance & Cost Report');
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ workflowId: undefined, limit: 1000 }),
    );
    expect(
      container.querySelector('nav a[aria-current="page"]')?.textContent,
    ).toBe('Report');
    await act(async () => {
      await router.navigate('/workflows/w1/report');
    });
    expect(container.textContent).toContain('Performance & Cost Report');
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ workflowId: 'w1' }),
    );
    await click('Runs');
    await click('Report');
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ workflowId: undefined }),
    );
    expect(container.textContent).not.toContain('Unexpected Application Error');
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(
      /change in the order of Hooks|Should have a queue|Rendered fewer hooks/,
    );
  } finally {
    errors.mockRestore();
  }
});

it('applies every literal tag only on Apply and clears back to the unfiltered report', async () => {
  await mount();
  expect(query.mock.calls[0][0]).not.toHaveProperty('tags');
  expect(runCount()).toContain('4');
  await openTags();
  await click('Add tag');
  await input('Matching tags key 1', 'repo.name');
  await input('Matching tags value 1', 'org/repo');
  await click('Add tag');
  await input('Matching tags key 2', '__proto__');
  await input('Matching tags value 2', 'batch=1');
  expect(query).toHaveBeenCalledTimes(1);
  await click('Apply filters');
  expect(query).toHaveBeenLastCalledWith(
    expect.objectContaining({
      tags: JSON.parse('{"repo.name":"org/repo","__proto__":"batch=1"}'),
    }),
  );
  expect(runCount()).toContain('1');
  expect(container.querySelector('summary')!.textContent).toContain('(2)');
  await click('Clear filters');
  expect(query.mock.lastCall![0]).not.toHaveProperty('tags');
  expect(runCount()).toContain('4');
  expect(
    container.querySelector('input[aria-label="Matching tags key 1"]'),
  ).toBeNull();
});

it('focuses duplicate-tag feedback and retains edits across a server error before clearing', async () => {
  await mount();
  await openTags();
  await click('Add tag');
  await input('Matching tags key 1', 'batch');
  await click('Add tag');
  await input('Matching tags key 2', 'batch');
  await click('Apply filters');
  expect(query).toHaveBeenCalledTimes(1);
  const error = container.querySelector('[role="alert"]')!;
  expect(error.textContent).toBe('Each tag key must be unique.');
  expect(document.activeElement).toBe(error);
  await input('Matching tags key 2', 'repo');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  query.mockRejectedValueOnce(new Error('Report unavailable'));
  await click('Apply filters');
  expect(container.textContent).toContain('Report unavailable');
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Matching tags key 2"]',
    )!.value,
  ).toBe('repo');
  await click('Clear filters');
  expect(container.textContent).not.toContain('Report unavailable');
  expect(runCount()).toContain('4');
});

it('keeps the current filtered report when an earlier request finishes later', async () => {
  let resolve!: (result: WorkflowReport) => void;
  query.mockReturnValueOnce(
    new Promise<WorkflowReport>((done) => {
      resolve = done;
    }),
  );
  await mount();
  await openTags();
  await click('Add tag');
  await input('Matching tags key 1', 'batch');
  await click('Apply filters');
  expect(runCount()).toContain('1');
  await act(async () => resolve(report(4)));
  expect(runCount()).toContain('1');
});
