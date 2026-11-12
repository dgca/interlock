// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import {
  createQueryClient,
  refreshQueries,
} from '../packages/ui/src/lib/query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { RunList } from '../packages/ui/src/features/runs/RunList';
const rpc = vi.hoisted(() => ({ attention: vi.fn(), summaries: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      triggers: { attention: { query: rpc.attention } },
      runs: { summaries: { query: rpc.summaries } },
    }),
    errorMessage: (e: Error) => e.message,
  };
});
let root: Root, container: HTMLDivElement;
let client: ReturnType<typeof createQueryClient>;
beforeEach(() => {
  client = createQueryClient();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
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
  rpc.summaries.mockResolvedValue({
    items: [],
    counts: { active: 0, attention: 0, history: 0 },
    scheduleAttentionCount: 24,
    offset: 0,
    total: 0,
    nextOffset: null,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function button(name: string) {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  );
  expect(b, name).toBeTruthy();
  return b!;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
it('UI236-R1 retains attention offset across unrelated engine refreshes and clamps after the last page disappears', async () => {
  rpc.attention.mockImplementation(async ({ offset }: { offset: number }) => ({
    items: Array.from({ length: offset ? 4 : 20 }, (_, i) => ({
      triggerId: `t-${offset + i}`,
      workflowId: 'w',
      name: `Alert ${offset + i}`,
      reason: 'Failure',
      kind: 'automatic_pause',
      lagMs: 0,
    })),
    total: 24,
    nextOffset: offset ? null : 20,
  }));
  const render = async () =>
    act(async () =>
      root.render(
        h(
          DesignSystemProvider,
          { client },
          h(
            MemoryRouter,
            {},
            h(RunList, {
              offset: 0,
              onOffsetChange: vi.fn(),
              tab: 'attention',
              onTabChange: vi.fn(),
            }),
          ),
        ),
      ),
    );
  await render();
  await click('More automation alerts');
  expect(document.body.textContent).toContain('Alert 23');
  await act(async () => refreshQueries(client));
  expect(document.body.textContent).toContain('Alert 23');
  expect(button('Previous automation alerts')).toBeTruthy();
  expect(rpc.attention).toHaveBeenLastCalledWith(
    expect.objectContaining({ offset: 20 }),
  );
  rpc.attention.mockResolvedValue({ items: [], total: 2, nextOffset: null });
  await act(async () => refreshQueries(client));
  expect(rpc.attention).toHaveBeenLastCalledWith(
    expect.objectContaining({ offset: 0 }),
  );
});
