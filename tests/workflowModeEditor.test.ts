// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { STARTED_RUN_SCHEMA } from '@interlock/core';
import { SettingsDialog } from '../packages/ui/src/features/workflows/SettingsDialog';
import { workflowCall } from './fixtures/detached';
vi.mock('../packages/ui/src/components/Modal/Modal', () => ({
  Modal: ({ children }: any) => h('div', {}, children),
}));
let container: HTMLDivElement, root: Root;
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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(mode?: 'wait' | 'detached', batchId?: string) {
  const definition = workflowCall('child', mode);
  const node = definition.nodes[1];
  node.batchId = batchId;
  node.outputSchema =
    mode === 'detached'
      ? structuredClone(STARTED_RUN_SCHEMA)
      : { type: 'string' };
  const onApply = vi.fn();
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(SettingsDialog, {
          name: 'Supervisor',
          description: '',
          definition,
          node,
          workflows: [],
          onClose: vi.fn(),
          onApply,
        }),
      ),
    ),
  );
  return { onApply, node };
}
async function choose(mode: string) {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>(`input[type="radio"][value="${mode}"]`)!
      .click(),
  );
}
async function apply() {
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'Apply changes')!
      .click(),
  );
}
it('preserves omitted mode and restores the wait contract when toggling before Apply', async () => {
  const { onApply } = await render();
  expect(
    container.querySelector<HTMLInputElement>('input[value="wait"]')!.checked,
  ).toBe(true);
  await choose('detached');
  expect(container.textContent).toContain('runId, workflowId, and version');
  const output = Array.from(container.querySelectorAll('section')).find((s) =>
    s.textContent?.includes('Output · Started run'),
  )!;
  expect(output.querySelector('button')).toBeNull();
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1]).toMatchObject({
    mode: 'wait',
    outputSchema: { type: 'string' },
  });
});
it('saves detached mode with the fixed contract and explains Batch dispatch concurrency', async () => {
  const { onApply } = await render(undefined, 'batch');
  await choose('detached');
  expect(container.textContent).toContain('Batch concurrency limits dispatch');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1]).toMatchObject({
    mode: 'detached',
    outputSchema: STARTED_RUN_SCHEMA,
  });
});
it('keeps saved detached mode selected and starts with Any when switching back', async () => {
  const { onApply } = await render('detached');
  expect(
    container.querySelector<HTMLInputElement>('input[value="detached"]')!
      .checked,
  ).toBe(true);
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1].outputSchema).toEqual({});
});
