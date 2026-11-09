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
vi.mock('../packages/ui/src/features/workflows/WorkflowEditor', () => ({
  WorkflowEditor: ({ onReport }: { onReport: () => void }) =>
    h('button', { onClick: onReport }, 'Open workflow report'),
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
      transientRecoveries: 0,
      stalls: 0,
    },
    usage: {
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
      },
      costs: [
        {
          currency: 'USD',
          amountMicros: totalRuns * 1_000_000,
          formatted: `${totalRuns}.0000 USD`,
        },
      ],
      coverage: {
        measuredPercentage: 100,
        unknownPercentage: 0,
        measuredAttempts: totalRuns,
        unknownAttempts: 0,
        totalAttempts: totalRuns,
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
  await click('Filter by tags');
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
    expect(container.textContent).toContain('Performance & cost report');
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ workflowId: undefined, limit: 1000 }),
    );
    expect(
      container.querySelector('nav a[aria-current="page"]')?.textContent,
    ).toBe('Report');
    await act(async () => {
      await router.navigate('/workflows/w1/report');
    });
    expect(container.textContent).toContain('Performance & cost report');
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
  expect(
    container.querySelector('button[aria-controls]')!.textContent,
  ).toContain('(2)');
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

function pendingReport() {
  let resolve!: (value: WorkflowReport) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<WorkflowReport>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function expectNoMetrics() {
  expect(container.textContent).not.toContain('Total Runs');
  expect(container.textContent).not.toContain('Attributed Spend');
  expect(container.textContent).not.toMatch(/[14]\.0000 USD/);
}
async function addRepoFilter() {
  await openTags();
  await click('Add tag');
  await input('Matching tags key 1', 'repo');
  await input('Matching tags value 1', 'private/repo');
}
it('hides earlier totals and spend while Apply loads or fails, then retries the current tags', async () => {
  await mount();
  expect(runCount()).toContain('4');
  expect(container.textContent).toContain('4.0000 USD');
  await addRepoFilter();
  const pending = pendingReport();
  query.mockReturnValueOnce(pending.promise);
  await click('Apply filters');
  expect(
    container.querySelector('button[aria-controls]')!.textContent,
  ).toContain('(1)');
  expect(query).toHaveBeenLastCalledWith(
    expect.objectContaining({ tags: { repo: 'private/repo' } }),
  );
  expect(container.textContent).toContain('Loading report');
  expectNoMetrics();
  await act(async () =>
    pending.reject(new Error('Filtered report unavailable')),
  );
  expect(container.textContent).toContain('Filtered report unavailable');
  expectNoMetrics();
  await click('Refresh');
  expect(query).toHaveBeenLastCalledWith(
    expect.objectContaining({ tags: { repo: 'private/repo' } }),
  );
  expect(container.textContent).not.toContain('Filtered report unavailable');
  expect(runCount()).toContain('1');
  expect(container.textContent).toContain('1.0000 USD');
});
it('hides filtered totals and spend when Clear fails, then retries the unfiltered scope', async () => {
  await mount();
  await addRepoFilter();
  await click('Apply filters');
  expect(runCount()).toContain('1');
  expect(container.textContent).toContain('1.0000 USD');
  const pending = pendingReport();
  query.mockReturnValueOnce(pending.promise);
  await click('Clear filters');
  expect(query.mock.lastCall![0]).not.toHaveProperty('tags');
  expect(
    container.querySelector('button[aria-controls]')!.textContent,
  ).not.toContain('(1)');
  expectNoMetrics();
  await act(async () =>
    pending.reject(new Error('Unfiltered report unavailable')),
  );
  expect(container.textContent).toContain('Unfiltered report unavailable');
  expectNoMetrics();
  await click('Refresh');
  expect(query.mock.lastCall![0]).not.toHaveProperty('tags');
  expect(runCount()).toContain('4');
  expect(container.textContent).toContain('4.0000 USD');
});
it.each(['resolve', 'reject'] as const)(
  'ignores an older request that later %ss after the current scope fails',
  async (outcome) => {
    const earlier = pendingReport();
    query.mockReturnValueOnce(earlier.promise);
    await mount();
    await addRepoFilter();
    query.mockRejectedValueOnce(new Error('Current tagged request failed'));
    await click('Apply filters');
    expectNoMetrics();
    await act(async () => {
      if (outcome === 'resolve') earlier.resolve(report(4));
      else earlier.reject(new Error('Obsolete request failed'));
    });
    expect(container.textContent).toContain('Current tagged request failed');
    expect(container.textContent).not.toContain('Obsolete request failed');
    expectNoMetrics();
  },
);
it('ignores an obsolete request error after a newer tagged result succeeds', async () => {
  const earlier = pendingReport();
  query.mockReturnValueOnce(earlier.promise);
  await mount();
  await addRepoFilter();
  await click('Apply filters');
  expect(runCount()).toContain('1');
  await act(async () => earlier.reject(new Error('Obsolete failure')));
  expect(container.textContent).not.toContain('Obsolete failure');
  expect(runCount()).toContain('1');
  expect(container.textContent).toContain('1.0000 USD');
});

function spend() {
  return container.querySelector('[aria-label="Attributed spend"]')!
    .textContent;
}
it.each([false, true])(
  'shows unmeasured spend with a zero total present: %s',
  async (hasTotal) => {
    const data = report();
    data.usage.costs = hasTotal
      ? [{ currency: 'USD', amountMicros: 0, formatted: '0 USD' }]
      : [];
    Object.assign(data.usage.coverage, {
      measuredPercentage: 0,
      unknownPercentage: 100,
      measuredAttempts: 0,
      unknownAttempts: 4,
    });
    query.mockResolvedValue(data);
    await mount();
    expect(spend()).toContain('Unmeasured');
    expect(spend()).not.toContain('0 USD');
    expect(spend()).toContain('0% of attempts measured');
  },
);
it('shows an explicitly measured zero cost and retains partial coverage', async () => {
  const data = report();
  data.usage.costs = [
    { currency: 'USD', amountMicros: 0, formatted: '0.0000 USD' },
  ];
  Object.assign(data.usage.coverage, {
    measuredPercentage: 50,
    unknownPercentage: 50,
    measuredAttempts: 2,
    unknownAttempts: 2,
  });
  query.mockResolvedValue(data);
  await mount();
  expect(spend()).toContain('0.0000 USD');
  expect(spend()).not.toContain('Unmeasured');
  expect(spend()).toContain('50% of attempts measured');
});
it('does not invent a currency total when measured usage omitted cost', async () => {
  const data = report();
  data.usage.costs = [];
  query.mockResolvedValue(data);
  await mount();
  expect(spend()).toContain('Unmeasured');
  expect(spend()).not.toContain('USD');
});
it('keeps scoped reports attached to their workflow and provides a return action', async () => {
  await mount('/workflows/w1');
  await click('Open workflow report');
  expect(router.state.location.pathname).toBe('/workflows/w1/report');
  expect(
    container.querySelector('input[aria-label="Filter by workflow"]'),
  ).toBeNull();
  expect(container.textContent).toContain('Tagged work');
  expect(query).toHaveBeenLastCalledWith(
    expect.objectContaining({ workflowId: 'w1' }),
  );
  await click('Back to workflow');
  expect(router.state.location.pathname).toBe('/workflows/w1');
  expect(container.textContent).toContain('Open workflow report');
});
