// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DesignSystemProvider } from '../packages/ui/src/design-system';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankDefinition } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { RunVersionDialog } from '../packages/ui/src/features/runs/RunVersionDialog';

const calls = vi.hoisted(() => ({
  read: vi.fn(),
  versions: vi.fn(),
  policy: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    runs: {
      versionPolicy: { query: calls.read },
      setVersionPolicy: { mutate: calls.policy },
      previewVersionMove: { query: calls.preview },
      applyVersionMove: { mutate: calls.apply },
    },
    workflows: { versions: { query: calls.versions } },
  },
  errorMessage: (error: Error) => error.message,
}));
let root: Root,
  container: HTMLDivElement,
  engine: Engine,
  runId: string,
  workflowId: string;
const changed = vi.fn();
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
  for (const fn of Object.values(calls)) fn.mockReset();
  changed.mockReset();
  engine = new Engine(new Store(':memory:'), process.cwd());
  const workflow = engine.create('Upgrade', '', blankDefinition());
  workflowId = workflow.id;
  engine.publish(workflowId);
  engine.publish(workflowId);
  engine.pauses.create({
    target: { scope: 'library' },
    actor: 'test',
    reason: 'Boundary',
  });
  runId = engine.start(workflowId, {}, 1).run.id;
  calls.read.mockImplementation(async (input) =>
    engine.runVersions.read(input),
  );
  calls.versions.mockImplementation(async () =>
    engine.store
      .listVersions()
      .filter((item) => item.workflowId === workflowId),
  );
  calls.policy.mockImplementation(async (input) =>
    engine.runVersions.setPolicy(input),
  );
  calls.preview.mockImplementation(async (input) =>
    engine.runVersions.preview(input),
  );
  calls.apply.mockImplementation(async (input) =>
    engine.runVersions.apply(input),
  );
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
async function render(active = true) {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(RunVersionDialog, {
          runId,
          workflowId,
          active,
          onClose: vi.fn(),
          onChanged: changed,
        }),
      ),
    ),
  );
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
function button(text: string) {
  const found = [
    ...dialog().querySelectorAll<HTMLButtonElement>('button'),
  ].find((item) => item.textContent === text);
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function select(index: number, value: string) {
  await act(async () => {
    const field = dialog().querySelectorAll<HTMLSelectElement>('select')[index];
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
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
it('requires a compatible preview and reason before applying an exact version, then shows history', async () => {
  await render();
  expect(dialog().textContent).toContain('Bound to version 1');
  expect(calls.read).toHaveBeenLastCalledWith({ runId, offset: 0, limit: 20 });
  expect(button('Save policy').disabled).toBe(true);
  await select(0, 'latest-compatible');
  await click('Save policy');
  expect(engine.runVersions.read({ runId }).policy).toBe('latest-compatible');
  expect(dialog().textContent).toContain('Version policy saved.');
  await select(1, '2');
  await click('Preview move');
  expect(dialog().textContent).toContain('Compatible at this boundary.');
  expect(button('Apply version 2').disabled).toBe(true);
  await reason('Deploy the published fix');
  await click('Apply version 2');
  expect(engine.run(runId).version).toBe(2);
  expect(calls.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      version: 2,
      recapturePrompts: false,
      reason: 'Deploy the published fix',
      confirmation: expect.any(String),
    }),
  );
  expect(dialog().textContent).toContain('Run version changed.');
  expect(dialog().textContent).toContain('Version changes · 1');
  expect(dialog().textContent).toContain('Deploy the published fix');
  expect(changed).toHaveBeenCalledTimes(2);
});
it('shows active-execution blockers and invalidates a preview when capture choices change', async () => {
  await render();
  await select(1, '2');
  await click('Preview move');
  expect(button('Apply version 2')).toBeDefined();
  await act(async () =>
    dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  expect(
    [...dialog().querySelectorAll('button')].some(
      (item) => item.textContent === 'Apply version 2',
    ),
  ).toBe(false);
  expect(calls.apply).not.toHaveBeenCalled();
  const hold = engine.pauses.list({}).items[0];
  engine.pauses.resume(hold.id);
  engine.pump();
  await click('Preview move');
  expect(dialog().textContent).toContain('current execution must finish');
  expect(
    [...dialog().querySelectorAll('button')].some(
      (item) => item.textContent === 'Apply version 2',
    ),
  ).toBe(false);
});
it('reports stale preview rejection and reloads current state without applying another move', async () => {
  await render();
  await select(1, '2');
  await click('Preview move');
  await reason('Fix');
  engine.runVersions.setPolicy({
    runId,
    expectedRevision: 0,
    policy: 'latest-compatible',
  });
  await click('Apply version 2');
  expect(dialog().textContent).toContain('Version move preview changed');
  expect(engine.run(runId).version).toBe(1);
  await click('Reload run version');
  expect(dialog().querySelector('select')!.value).toBe('latest-compatible');
  expect(dialog().textContent).not.toContain('Version move preview changed');
});
it('keeps history readable on terminal runs and hides mutation controls', async () => {
  await render(false);
  expect(dialog().textContent).toContain('Version changes · 0');
  expect(button('Save policy').disabled).toBe(true);
  expect(dialog().querySelectorAll('select')).toHaveLength(1);
  expect(dialog().textContent).not.toContain('Preview move');
});
