// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankDefinition } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  RunUsage,
  usageMetricText,
} from '../packages/ui/src/features/runs/RunUsage';

const query = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', () => ({
  api: { runs: { usage: { query } } },
  errorMessage: (error: Error) => error.message,
}));
let root: Root,
  container: HTMLDivElement,
  store: Store,
  engine: Engine,
  id: string;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  store = new Store(':memory:');
  engine = new Engine(store, process.cwd());
  const workflow = engine.create('Usage', '', blankDefinition());
  engine.publish(workflow.id);
  id = engine.start(workflow.id, {}).run.id;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  query
    .mockReset()
    .mockImplementation(async (input) => engine.usage.read(input));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  engine.stop();
  store.close();
});
async function render(tick = 0) {
  await act(async () =>
    root.render(h(MantineProvider, {}, h(RunUsage, { id, tick }))),
  );
}
it('shows unknown usage and makes descendant inclusion an explicit choice', async () => {
  await render();
  expect(container.textContent).toContain('Input tokens: Unknown');
  expect(container.textContent).toContain('Cost: Unknown');
  expect(container.textContent).toContain('Missing figures do not mean zero');
  expect(query).toHaveBeenLastCalledWith(
    expect.objectContaining({ includeDescendants: false }),
  );
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  expect(query).toHaveBeenLastCalledWith(
    expect.objectContaining({ includeDescendants: true }),
  );
  expect(container.textContent).toContain('detached runs included');
});
it('renders measured zero, partial totals, model costs and node attribution', async () => {
  const work = engine.claim(engine.available(id)[0].id, {
    workerId: 'author',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.usage.report({
    workId: work.id,
    attempt: 1,
    token: work.token!,
    snapshot: {
      sequence: 1,
      models: [
        {
          provider: 'test',
          model: 'a',
          inputTokens: 0,
          outputTokens: 20,
          cost: { amountMicros: 1250, currency: 'USD', source: 'test' },
        },
      ],
    },
  });
  await render();
  expect(container.textContent).toContain('Input tokens: 0 · partial');
  expect(container.textContent).toContain('Output tokens: 20 · partial');
  expect(container.textContent).toContain('0.00125 · partial USD');
  expect(container.textContent).toContain('1 of 1 claim attempts reported');
  expect(container.querySelector('tbody')?.textContent).toContain(work.label);
});
it('reports read errors and never formats overflow as zero', async () => {
  query.mockRejectedValue(new Error('Usage unavailable'));
  await render();
  expect(container.textContent).toContain('Usage unavailable');
  expect(
    usageMetricText({ value: null, coverage: 'partial', overflow: true }),
  ).toBe('Too large to total');
});

it('separates requested tiers, declared selections and usage-reported models', async () => {
  const work = engine.available(id)[0];
  work.context.tier = 'max';
  store.put('work', work);
  const claimed = engine.claim(work.id, {
    workerId: 'author',
    freshContext: false,
    tools: [],
    skills: [],
    modelSelection: {
      tier: 'fast',
      provider: 'declared-provider',
      model: 'declared-model',
    },
  });
  await render();
  await act(async () => {
    container.querySelector('summary')!.click();
    const select = container.querySelector('select')!;
    select.value = 'attempt';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(query).toHaveBeenLastCalledWith(
    expect.objectContaining({ groupBy: 'attempt' }),
  );
  const cells = () =>
    Array.from(container.querySelectorAll('tbody td')).map(
      (td) => td.textContent,
    );
  expect(cells()).toEqual(
    expect.arrayContaining([
      'max',
      'Tier: fast; provider: declared-provider; model: declared-model',
      'Unknown',
    ]),
  );
  expect(container.textContent).toContain('Input tokens: Unknown');
  engine.usage.report({
    workId: claimed.id,
    attempt: 1,
    token: claimed.token!,
    snapshot: {
      sequence: 1,
      models: [{ provider: 'used-provider', model: 'used-model' }],
    },
  });
  await render(1);
  expect(cells()).toContain('used-provider / used-model');
  expect(cells()).toContain(
    'Tier: fast; provider: declared-provider; model: declared-model',
  );
});
