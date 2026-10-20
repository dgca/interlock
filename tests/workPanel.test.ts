// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, type WorkRequest } from '@interlock/core';
import { WorkPanel } from '../packages/ui/src/features/runs/WorkPanel';

const rpc = vi.hoisted(() => ({
  claim: vi.fn(),
  renew: vi.fn(),
  submit: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    work: Object.fromEntries(
      Object.entries(rpc).map(([key, mutate]) => [key, { mutate }]),
    ),
  },
  errorMessage: (error: Error) => error.message,
}));
vi.mock('../packages/ui/src/components/JsonEditor/JsonEditor', () => ({
  JsonEditor: () => null,
}));

let root: Root, container: HTMLDivElement, store: Store, engine: Engine;
let work: WorkRequest;
function display() {
  root.render(
    h(
      MantineProvider,
      {},
      h(WorkPanel, {
        work: (({ token, ...rest }) => rest)(work),
        onRefresh: () => {
          work = engine.inspect(work.runId).work.find((w) => w.id === work.id)!;
          display();
        },
      }),
    ),
  );
}
async function render() {
  await act(async () => display());
}
async function click(name: string) {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === name,
  );
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  sessionStorage.clear();
  localStorage.clear();
  store = new Store(':memory:');
  engine = new Engine(store, process.cwd());
  const workflow = engine.create('Manual claim', '', blankDefinition());
  engine.publish(workflow.id);
  const { run } = engine.start(workflow.id, {});
  [work] = engine.available(run.id);
  rpc.claim
    .mockReset()
    .mockImplementation(async () =>
      engine.claim(
        work.id,
        { workerId: 'manual-ui', freshContext: false, tools: [], skills: [] },
        10,
      ),
    );
  rpc.renew
    .mockReset()
    .mockImplementation(async ({ token }) => engine.renew(work.id, token, 30));
  rpc.submit
    .mockReset()
    .mockImplementation(async ({ token, output }) =>
      engine.submit(work.id, token, output),
    );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  engine.stop();
  store.close();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('claims and submits without writing credentials or assignments to web storage', async () => {
  const write = vi.spyOn(Storage.prototype, 'setItem');
  await click('Claim for manual completion');
  expect(container.textContent).toContain('Submit result');
  expect(write.mock.calls.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(localStorage.length).toBe(0);
  await click('Submit result');
  expect(rpc.submit).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain('Submit result');
});

it('keeps a claim across navigation and uses its renewed deadline', async () => {
  await click('Claim for manual completion');
  await act(async () => root.render(null));
  await render();
  await click('Renew claim');
  await act(async () => vi.advanceTimersByTime(11_000));
  expect(container.textContent).toContain('Submit result');
  await click('Submit result');
  expect(rpc.submit).toHaveBeenCalledOnce();
});

it('keeps valid credentials after validation and transient network errors', async () => {
  await click('Claim for manual completion');
  rpc.submit.mockRejectedValueOnce(new Error('Invalid result'));
  await click('Submit result');
  expect(container.textContent).toContain('Invalid result');
  rpc.renew.mockRejectedValueOnce(new Error('Network unavailable'));
  await click('Renew claim');
  expect(container.textContent).toContain('Network unavailable');
  await click('Submit result');
  expect(rpc.submit).toHaveBeenCalledTimes(2);
});

it('uses the refreshed deadline when renewal succeeds but its response is lost', async () => {
  await click('Claim for manual completion');
  rpc.renew.mockImplementationOnce(async ({ token }) => {
    engine.renew(work.id, token, 30);
    throw new Error('Response lost');
  });
  await click('Renew claim');
  await act(async () => vi.advanceTimersByTime(11_000));
  await click('Submit result');
  expect(rpc.submit).toHaveBeenCalledOnce();
});

it('drops credentials when refresh observes cancellation after a failed request', async () => {
  await click('Claim for manual completion');
  engine.cancel(work.runId);
  await click('Renew claim');
  expect(container.textContent).not.toContain('Submit result');
  expect(container.textContent).not.toContain('Renew claim');
});

it('drops an expired claim while away and never restores it from session storage', async () => {
  await click('Claim for manual completion');
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTime(11_000));
  // Keep the old server snapshot to exercise client-side expiry independently.
  await render();
  expect(container.textContent).not.toContain('Submit result');
});

it('explains a manual claim with no token in this page instead of reclaiming it', async () => {
  work = engine.claim(
    work.id,
    { workerId: 'manual-ui', freshContext: false, tools: [], skills: [] },
    10,
  );
  sessionStorage.setItem(`claim:${work.id}`, JSON.stringify(work));
  await act(async () => root.render(null));
  await render();
  expect(container.textContent).not.toContain('Submit result');
  expect(container.textContent).toContain(
    'This page does not hold the claim token',
  );
  expect(container.textContent).not.toContain('Claim for manual completion');
});
