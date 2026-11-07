// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { blankDefinition, type Workflow } from '@interlock/core';
import { RunDialog } from '../packages/ui/src/features/runs/RunDialog';
import { paths, runTagFilter } from '../packages/ui/src/routes/paths';

const start = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    workflows: {
      versions: {
        query: async () => [{ version: 1, definition: blankDefinition() }],
      },
    },
    runs: { start: { mutate: start } },
  },
  errorMessage: (error: Error) => error.message,
}));
let root: Root, container: HTMLDivElement;
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
  start.mockReset().mockResolvedValue({ run: { id: 'new-run' } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) =>
      (element.getAttribute('aria-label') ?? element.textContent) === label,
  )!;
async function click(label: string) {
  await act(async () => button(label).click());
}
async function input(label: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function render() {
  const started = vi.fn();
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        { env: 'test' },
        h(RunDialog, {
          workflow: {
            id: 'workflow',
            name: 'Tagged workflow',
            latestVersion: 1,
          } as Workflow,
          onClose: vi.fn(),
          onStarted: started,
        }),
      ),
    ),
  );
  return started;
}
async function toggleTags() {
  await act(async () => document.querySelector('summary')!.click());
}
const tagFields = () =>
  document.querySelector<HTMLFieldSetElement>('fieldset[aria-label="Tags"]')!;
it('starts with literal metadata and retains tag edits after a rejected start', async () => {
  const started = await render();
  await toggleTags();
  await click('Add tag');
  await input('Tags key 1', 'repo.name');
  await input('Tags value 1', 'org/repo');
  await click('Add tag');
  await input('Tags key 2', '__proto__');
  start.mockRejectedValueOnce(new Error('Start paused'));
  await click('Start run');
  expect(document.body.textContent).toContain('Start paused');
  expect(
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Tags value 1"]',
    )!.value,
  ).toBe('org/repo');
  expect(started).not.toHaveBeenCalled();
  await click('Start run');
  expect(start).toHaveBeenLastCalledWith(
    expect.objectContaining({
      tags: JSON.parse('{"repo.name":"org/repo","__proto__":""}'),
    }),
  );
  expect(started).toHaveBeenCalledWith('new-run');
});
it('reveals collapsed duplicate tags, focuses local feedback, and clears it on correction', async () => {
  await render();
  await toggleTags();
  await click('Add tag');
  await input('Tags key 1', 'batch');
  await click('Add tag');
  await input('Tags key 2', 'batch');
  await toggleTags();
  expect(tagFields().closest('details')!.open).toBe(false);
  await click('Start run');
  expect(start).not.toHaveBeenCalled();
  expect(tagFields().closest('details')!.open).toBe(true);
  const error = tagFields().querySelector('[role="alert"]')!;
  expect(error.textContent).toBe('Each tag key must be unique.');
  expect(document.activeElement).toBe(error);
  expect(tagFields().getAttribute('aria-describedby')).toBe(error.id);
  expect(document.querySelector('.error-text')).toBeNull();
  await input('Tags key 2', 'priority');
  expect(tagFields().querySelector('[role="alert"]')).toBeNull();
  expect(tagFields().hasAttribute('aria-invalid')).toBe(false);
  await click('Start run');
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ tags: { batch: '', priority: '' } }),
  );
});
it.each(['', 'x'.repeat(65)])(
  'shows local feedback for invalid key %j before native validity or an API call',
  async (key) => {
    await render();
    await toggleTags();
    await click('Add tag');
    await input('Tags key 1', key);
    await input('Tags value 1', 'Retained');
    await toggleTags();
    await click('Start run');
    expect(start).not.toHaveBeenCalled();
    expect(tagFields().closest('details')!.open).toBe(true);
    expect(tagFields().querySelector('[role="alert"]')!.textContent).toContain(
      'nonempty keys',
    );
    expect(document.querySelector('.error-text')).toBeNull();
    await input('Tags key 1', 'corrected');
    expect(tagFields().querySelector('[role="alert"]')).toBeNull();
    await click('Start run');
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ tags: { corrected: 'Retained' } }),
    );
  },
);
it('preserves exact tag filters through list and inspector URLs', () => {
  const tags = JSON.parse(
    '{"repo.name":"org/repo","__proto__":"","priority":"High"}',
  );
  for (const path of [
    paths.runs('history', 100, tags),
    paths.workflowRuns('workflow', 'history', 100, tags),
    paths.run('run', 'workflow', 'history', 'step', 100, tags),
  ]) {
    expect(
      runTagFilter(new URL(path, 'http://localhost').searchParams.get('tags')),
    ).toEqual(tags);
  }
  expect(runTagFilter('{')).toBeUndefined();
  expect(runTagFilter('{"repo":42}')).toBeUndefined();
});
