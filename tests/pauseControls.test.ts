// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createQueryClient,
  refreshQueries,
} from '../packages/ui/src/lib/query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition } from '@interlock/core';
import {
  PauseProvider,
  PauseBanner,
  WorkflowPauseButton,
} from '../packages/ui/src/features/pauses/PauseControls';
const rpc = vi.hoisted(() => ({
  list: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    pauses: {
      list: { query: rpc.list },
      pause: { mutate: rpc.pause },
      resume: { mutate: rpc.resume },
    },
  },
  errorMessage: (e: Error) => e.message,
}));
let root: Root, container: HTMLDivElement, engine: Engine, workflowId: string;
let readFails: boolean;
const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent === name,
  )!;
const text = () => container.textContent!;
async function click(name: string) {
  expect(button(name), name).toBeDefined();
  await act(async () => button(name).click());
}
async function render() {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test', client },
        h(PauseProvider, {
          children: [
            h(WorkflowPauseButton, { key: 'button', workflowId }),
            h(PauseBanner, { key: 'banner', workflowId }),
          ],
        }),
      ),
    ),
  );
}
function hold(scope: 'workflow' | 'library' = 'workflow') {
  return engine.pauses.create({
    target: scope === 'workflow' ? { scope, workflowId } : { scope },
    actor: 'operator',
    reason: scope === 'workflow' ? 'Workflow maintenance' : 'Deployment',
  });
}
let client: ReturnType<typeof createQueryClient>;
beforeEach(() => {
  client = createQueryClient();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  engine = new Engine(new Store(':memory:'), process.cwd());
  workflowId = engine.create('Pause test', '', blankDefinition()).id;
  readFails = false;
  rpc.list.mockReset().mockImplementation(async (query) => {
    if (readFails) throw Error('Status read unavailable');
    return engine.pauses.list(query);
  });
  rpc.pause
    .mockReset()
    .mockImplementation(async (query) => engine.pauses.create(query));
  rpc.resume
    .mockReset()
    .mockImplementation(async (query) => engine.pauses.resume(query.id));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  engine.stop();
  engine.store.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('pauses and resumes the workflow directly without a modal or library mutation', async () => {
  await render();
  expect(rpc.list).toHaveBeenCalledTimes(1);
  await click('Pause workflow');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(engine.pauses.list({ workflowId }).total).toBe(1);
  expect(rpc.pause).toHaveBeenCalledWith({
    target: { scope: 'workflow', workflowId },
    actor: 'Interlock UI',
    reason: 'Paused from the workflow editor',
  });
  expect(text()).toContain('Workflow paused');
  await click('Resume workflow');
  expect(engine.pauses.list({ workflowId }).total).toBe(0);
  expect(button('Pause workflow')).toBeDefined();
});
it('ignores duplicate clicks while a mutation is pending', async () => {
  let deliver!: () => void;
  const delivery = new Promise<void>((resolve) => (deliver = resolve));
  rpc.pause.mockImplementationOnce(async (query) => {
    await delivery;
    return engine.pauses.create(query);
  });
  await render();
  await act(async () => {
    button('Pause workflow').click();
    button('Pause workflow').click();
  });
  expect(rpc.pause).toHaveBeenCalledOnce();
  expect(button('Pause workflow').disabled).toBe(true);
  await act(async () => deliver());
  expect(engine.pauses.list({ workflowId }).total).toBe(1);
});
it('does not add or release a hold when a stale Pause click finds an existing pause', async () => {
  await render();
  const existing = hold();
  await click('Pause workflow');
  expect(rpc.pause).not.toHaveBeenCalled();
  expect(rpc.resume).not.toHaveBeenCalled();
  expect(engine.pauses.list({ workflowId }).items[0].id).toBe(existing.id);
  expect(button('Resume workflow')).toBeDefined();
});
it('does not recreate a pause when a stale Resume click finds it already released', async () => {
  const existing = hold();
  await render();
  engine.pauses.resume(existing.id);
  await click('Resume workflow');
  expect(rpc.pause).not.toHaveBeenCalled();
  expect(rpc.resume).not.toHaveBeenCalled();
  expect(button('Pause workflow')).toBeDefined();
});
it('preserves an acknowledged pause through failed refresh and retries only the read', async () => {
  rpc.pause.mockImplementationOnce(async (query) => {
    const result = engine.pauses.create(query);
    readFails = true;
    return result;
  });
  await render();
  await click('Pause workflow');
  expect(text()).toContain('Workflow paused');
  expect(text()).toContain('Status read unavailable');
  expect(engine.pauses.list({ workflowId }).total).toBe(1);
  readFails = false;
  await click('Retry pause status');
  expect(button('Resume workflow')).toBeDefined();
  expect(rpc.pause).toHaveBeenCalledOnce();
});
it('blocks mutations until a failed initial status read is retried', async () => {
  readFails = true;
  await render();
  expect(button('Pause workflow')).toBeUndefined();
  await click('Retry pause status');
  expect(rpc.pause).not.toHaveBeenCalled();
  readFails = false;
  await click('Retry pause status');
  expect(button('Pause workflow')).toBeDefined();
});
it('does not mutate when the preflight status read fails', async () => {
  await render();
  readFails = true;
  await click('Pause workflow');
  expect(rpc.pause).not.toHaveBeenCalled();
  expect(rpc.resume).not.toHaveBeenCalled();
  expect(text()).toContain('Status read unavailable');
});
it('keeps an acknowledged resume completed through failed refresh', async () => {
  hold();
  rpc.resume.mockImplementationOnce(async (query) => {
    const result = engine.pauses.resume(query.id);
    readFails = true;
    return result;
  });
  await render();
  await click('Resume workflow');
  expect(text()).not.toContain('Workflow paused');
  expect(text()).toContain('Status read unavailable');
  readFails = false;
  await click('Retry pause status');
  expect(button('Pause workflow')).toBeDefined();
  expect(rpc.resume).toHaveBeenCalledOnce();
  expect(rpc.pause).not.toHaveBeenCalled();
});
it('refreshes after uncertain creation and does not create a duplicate on retry', async () => {
  rpc.pause.mockImplementationOnce(async (query) => {
    engine.pauses.create(query);
    throw Error('Connection lost after write');
  });
  await render();
  await click('Pause workflow');
  expect(text()).toContain('Connection lost after write');
  expect(button('Resume workflow')).toBeDefined();
  expect(engine.pauses.list({ workflowId }).total).toBe(1);
  expect(rpc.pause).toHaveBeenCalledOnce();
});
it('resumes legacy workflow holds across all pages while preserving library holds', async () => {
  const library = hold('library');
  for (let i = 0; i < 101; i++) hold();
  await render();
  expect(rpc.list).toHaveBeenCalledWith(
    expect.objectContaining({ offset: 100 }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  await click('Resume workflow');
  expect(rpc.resume).toHaveBeenCalledTimes(101);
  expect(
    engine.pauses.list({ workflowId }).items.map((item) => item.id),
  ).toEqual([library.id]);
  expect(button('Paused by library').disabled).toBe(true);
  expect(text()).toContain('release its exact ID through the CLI or MCP');
});
it('retains paused status after a partial resume fails and retries only remaining holds', async () => {
  hold();
  hold();
  rpc.resume.mockImplementationOnce(async (query) =>
    engine.pauses.resume(query.id),
  );
  rpc.resume.mockRejectedValueOnce(Error('Release unavailable'));
  await render();
  await click('Resume workflow');
  expect(text()).toContain('Release unavailable');
  expect(engine.pauses.list({ workflowId }).total).toBe(1);
  expect(button('Resume workflow')).toBeDefined();
  await click('Resume workflow');
  expect(engine.pauses.list({ workflowId }).total).toBe(0);
  expect(rpc.resume).toHaveBeenCalledTimes(3);
});
it('does not poll inactive pauses and refreshes from the shared query cache', async () => {
  await render();
  rpc.list.mockClear();
  vi.useFakeTimers();
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(rpc.list).not.toHaveBeenCalled();
  hold();
  await act(async () => refreshQueries(client));
  expect(rpc.list).toHaveBeenCalledOnce();
  expect(button('Resume workflow')).toBeDefined();
});
