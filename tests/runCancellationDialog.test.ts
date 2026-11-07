// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankDefinition } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { workflowCall } from './fixtures/detached';
import { RunCancellationDialog } from '../packages/ui/src/features/runs/RunCancellationDialog';

const calls = vi.hoisted(() => ({ preview: vi.fn(), cancel: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    runs: {
      previewCancellation: { query: calls.preview },
      cancelTree: { mutate: calls.cancel },
    },
  },
  errorMessage: (error: Error) => error.message,
}));
let root: Root,
  container: HTMLDivElement,
  engine: Engine,
  runId: string,
  childId: string;
const closed = vi.fn(),
  changed = vi.fn(),
  opened = vi.fn();

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
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
  for (const fn of [calls.preview, calls.cancel, closed, changed, opened])
    fn.mockReset();
  engine = new Engine(new Store(':memory:'), process.cwd());
  const child = engine.create('Independent task', '', blankDefinition());
  engine.publish(child.id);
  const parent = engine.create(
    'Completed supervisor',
    '',
    workflowCall(child.id, 'detached'),
  );
  engine.publish(parent.id);
  runId = engine.start(parent.id, null).run.id;
  childId = engine.store.runs().find((run) => run.parentRunId === runId)!.id;
  expect(engine.run(runId).status).toBe('completed');
  calls.preview.mockImplementation(async (input) =>
    engine.previewRunCancellation(input),
  );
  calls.cancel.mockImplementation(async (input) => engine.cancelRunTree(input));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  engine.stop();
  engine.store.close();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(RunCancellationDialog, {
          runId,
          onClose: closed,
          onCancelled: changed,
          onOpen: opened,
        }),
      ),
    ),
  );
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
function button(text: string) {
  const result = [
    ...dialog().querySelectorAll<HTMLButtonElement>('button'),
  ].find((item) => item.textContent === text);
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function toggleDetached() {
  await act(async () =>
    dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
}
async function reason(value: string) {
  await act(async () => {
    const field = dialog().querySelector<HTMLTextAreaElement>('textarea')!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('previews a terminal parent, explicitly selects detached work, and requires a reason before cancellation', async () => {
  await render();
  expect(calls.preview).toHaveBeenLastCalledWith({
    id: runId,
    includeDetached: false,
    limit: 20,
    offset: 0,
  });
  expect(dialog().textContent).toContain('No active runs in this selection.');
  expect(button('Cancel run tree').disabled).toBe(true);
  await toggleDetached();
  expect(dialog().textContent).toContain('1 active run will be cancelled.');
  expect(dialog().textContent).toContain('Independent task');
  expect(engine.run(childId).status).toBe('waiting');
  expect(button('Cancel run tree').disabled).toBe(true);
  await reason('   ');
  expect(button('Cancel run tree').disabled).toBe(true);
  await reason(' Stop runaway batch ');
  await click('Cancel run tree');
  expect(calls.cancel).toHaveBeenCalledExactlyOnceWith({
    id: runId,
    includeDetached: true,
    reason: 'Stop runaway batch',
  });
  expect(engine.run(runId).status).toBe('completed');
  expect(engine.run(childId)).toMatchObject({
    status: 'cancelled',
    cancellationReason: 'Stop runaway batch',
  });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledTimes(1);
});

it('disables submission while a changed scope loads and ignores stale preview responses', async () => {
  await render();
  let resolvePreview!: (value: unknown) => void;
  calls.preview.mockImplementationOnce(
    () => new Promise((resolve) => (resolvePreview = resolve)),
  );
  await toggleDetached();
  await reason('Stop work');
  expect(dialog().textContent).toContain('Loading affected runs');
  expect(button('Cancel run tree').disabled).toBe(true);
  await toggleDetached();
  expect(dialog().textContent).toContain('No active runs in this selection.');
  await act(async () =>
    resolvePreview(
      engine.previewRunCancellation({ id: runId, includeDetached: true }),
    ),
  );
  expect(dialog().textContent).toContain('No active runs in this selection.');
  expect(button('Cancel run tree').disabled).toBe(true);
  expect(calls.cancel).not.toHaveBeenCalled();
});

it('retains the reason after failure, reloads the preview, and prevents duplicate pending writes', async () => {
  await render();
  await toggleDetached();
  await reason('Stop runaway batch');
  calls.cancel.mockRejectedValueOnce(new Error('Cancellation write failed'));
  await click('Cancel run tree');
  expect(dialog().textContent).toContain('Cancellation write failed');
  expect(dialog().querySelector('textarea')!.value).toBe('Stop runaway batch');
  expect(button('Cancel run tree').disabled).toBe(true);
  expect(engine.run(childId).status).toBe('waiting');
  expect(closed).not.toHaveBeenCalled();
  await click('Reload affected runs');
  let resolveCancel!: () => void;
  calls.cancel.mockImplementationOnce(
    () => new Promise<void>((resolve) => (resolveCancel = resolve)),
  );
  await act(async () => {
    button('Cancel run tree').click();
    button('Cancel run tree').click();
  });
  expect(calls.cancel).toHaveBeenCalledTimes(2);
  expect(button('Cancelling…').disabled).toBe(true);
  expect(button('Close').disabled).toBe(true);
  expect(
    dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .disabled,
  ).toBe(true);
  await act(async () => resolveCancel());
  expect(changed).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledTimes(1);
});

it('shows read failures without enabling mutation and lets the operator inspect a selected run', async () => {
  calls.preview.mockRejectedValueOnce(new Error('Preview unavailable'));
  await render();
  expect(dialog().textContent).toContain('Preview unavailable');
  expect(button('Cancel run tree').disabled).toBe(true);
  await click('Reload affected runs');
  await toggleDetached();
  const runLink = [
    ...dialog().querySelectorAll<HTMLButtonElement>('button'),
  ].find((item) => item.textContent?.startsWith('Independent task · '))!;
  await act(async () => runLink.click());
  expect(opened).toHaveBeenCalledExactlyOnceWith(childId);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(calls.cancel).not.toHaveBeenCalled();
});

it('returns to an existing page when the live selection shrinks below the requested offset', async () => {
  const selected = engine.previewRunCancellation({
    id: runId,
    includeDetached: true,
  });
  let shrunk = false;
  calls.preview.mockImplementation(async (input) => {
    if (!input.includeDetached) return engine.previewRunCancellation(input);
    if (input.offset === 20) shrunk = true;
    const total = shrunk ? 1 : 21;
    return {
      ...selected,
      total,
      offset: input.offset,
      items: input.offset
        ? []
        : Array.from({ length: Math.min(20, total) }, (_, index) => ({
            ...selected.items[0],
            id: `${childId}-${index}`,
          })),
      nextOffset: total > 20 && input.offset === 0 ? 20 : null,
      truncated: total > 20 || input.offset > 0,
    };
  });
  await render();
  await toggleDetached();
  expect(dialog().textContent).toContain('21 active runs will be cancelled.');
  expect(dialog().querySelectorAll('li')).toHaveLength(20);
  await click('Next runs');
  expect(calls.preview).toHaveBeenLastCalledWith({
    id: runId,
    includeDetached: true,
    offset: 0,
    limit: 20,
  });
  expect(dialog().textContent).toContain('1 active run will be cancelled.');
  expect(dialog().querySelectorAll('li')).toHaveLength(1);
  expect(calls.cancel).not.toHaveBeenCalled();
});
