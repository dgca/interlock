// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { batchDefinition } from './fixtures/batch';
import { blankDefinition } from '@interlock/core';
import { RunInspector } from '../packages/ui/src/features/runs/RunInspector';
const graph = vi.hoisted(() => ({ props: undefined as any }));
const rpc = vi.hoisted(() => ({ get: vi.fn(), work: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    runs: { get: { query: rpc.get } },
    work: { list: { query: rpc.work } },
  },
  errorMessage: (e: Error) => e.message,
  download: vi.fn(),
}));
vi.mock('../packages/ui/src/features/runs/RunGraph', () => ({
  RunGraph: (props: any) => {
    graph.props = props;
    return null;
  },
}));
vi.mock('../packages/ui/src/features/runs/WorkPanel', () => ({
  WorkPanel: () => null,
}));
vi.mock('../packages/ui/src/components/JsonEditor/JsonEditor', () => ({
  JsonEditor: ({ label, value }: any) =>
    h('pre', { 'data-json-label': label }, JSON.stringify(value)),
}));
let container: HTMLDivElement, root: Root, detail: any;
const onConnect = vi.fn(),
  writeText = vi.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  writeText.mockReset().mockResolvedValue(undefined);
  onConnect.mockReset();
  detail = {
    run: {
      id: 'root-run',
      workflowName: 'Demo',
      version: 1,
      status: 'waiting',
      executions: [],
      input: [],
    },
    definition: blankDefinition(),
    work: [],
    events: [],
    children: [],
  };
  rpc.get.mockReset().mockImplementation(async () => detail);
  rpc.work
    .mockReset()
    .mockResolvedValue([{ id: 'child-assignment', runId: 'child-run' }]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(tick = 0) {
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(RunInspector, {
          id: 'root-run',
          tick,
          onBack: vi.fn(),
          onOpen: vi.fn(),
          onConnect,
          act: vi.fn(),
        }),
      ),
    ),
  );
}
async function click(name: string) {
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === name)!
      .click(),
  );
}
it('shows descendant assignments at the root and copies instructions to continue that existing run', async () => {
  await render();
  expect(rpc.work).toHaveBeenCalledWith({ runId: 'root-run' });
  expect(container.textContent).toContain('Waiting for an agent');
  await click('Copy instructions for agent');
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining(
      'Continue existing Interlock run root-run. Do not start a new run.',
    ),
  );
  expect(writeText.mock.calls[0][0]).toContain('including child runs');
  expect(container.textContent).toContain('Instructions copied');
  await click('Connect an agent');
  expect(onConnect).toHaveBeenCalledOnce();
});
it('shows a clipboard error and permits retry', async () => {
  writeText.mockRejectedValueOnce(new Error('Clipboard access denied'));
  await render();
  await click('Copy instructions for agent');
  expect(container.textContent).toContain('Clipboard access denied');
  await click('Copy instructions for agent');
  expect(container.textContent).not.toContain('Clipboard access denied');
  expect(container.textContent).toContain('Instructions copied');
});
it('removes the prompt after available assignments are claimed and hides it for finished runs', async () => {
  await render();
  rpc.work.mockResolvedValue([]);
  await render(1);
  expect(container.textContent).not.toContain('Waiting for an agent');
  rpc.work.mockResolvedValue([{ id: 'stale-assignment' }]);
  detail.run.status = 'completed';
  await render(2);
  expect(container.textContent).not.toContain('Waiting for an agent');
});
it('does not mistake a waiting script or child workflow for an available agent assignment', async () => {
  rpc.work.mockResolvedValue([]);
  await render();
  expect(container.textContent).not.toContain('Waiting for an agent');
  expect(container.textContent).not.toContain('Copy instructions for agent');
});

it('keeps a chosen Batch item selected across live updates without substituting other item output', async () => {
  const store = new Store(':memory:');
  try {
    const engine = new Engine(store, process.cwd());
    const w = engine.create('Batch', '', batchDefinition());
    engine.publish(w.id);
    const run = engine.start(w.id, ['first', 'second']).run;
    detail = engine.inspect(run.id);
    // The component's requested ID stays stable in this test harness.
    detail.run = { ...detail.run, id: 'root-run' };
    rpc.work.mockResolvedValue([]);
    await render();
    await act(async () => graph.props.onSelect('work'));
    expect(container.querySelector('[data-json-label="Input"]')).toBeNull();
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.startsWith('Item 1'))!
        .click(),
    );
    expect(
      container.querySelector('[data-json-label="Input"]')?.textContent,
    ).toBe('"first"');
    const work = engine.available(run.id)[1];
    const claim = engine.claim(work.id, {
      workerId: 'test',
      freshContext: false,
      tools: [],
      skills: [],
    });
    engine.submit(work.id, claim.token!, 'second result');
    detail = engine.inspect(run.id);
    detail.run = { ...detail.run, id: 'root-run' };
    await render(1);
    expect(graph.props.selected).toBe('work');
    expect(
      container.querySelector('[data-json-label="Input"]')?.textContent,
    ).toBe('"first"');
    expect(container.querySelector('[data-json-label="Output"]')).toBeNull();
  } finally {
    store.close();
  }
});
