// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nodeSchema, type SavedPrompt } from '@interlock/core';
import type { Action } from '../packages/ui/src/lib/useActionFeedback';
import { PromptEditor } from '../packages/ui/src/features/prompts/Prompts';
import { PromptPicker } from '../packages/ui/src/features/prompts/PromptPicker';

const queries = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    prompts: {
      get: { query: queries.get },
      update: { mutate: queries.update },
      delete: { mutate: queries.delete },
    },
  },
  errorMessage: (error: Error) => error.message,
}));
let root: Root;
let container: HTMLDivElement;
const scrollIntoView = HTMLElement.prototype.scrollIntoView;
const dirty = vi.fn();
let error = '';
const prompt: SavedPrompt = {
  id: 'p1',
  name: 'Review',
  description: '',
  content: 'Original',
  revision: 1,
  createdAt: '',
  updatedAt: '',
};
const action: Action = async (fn) => {
  try {
    await fn();
  } catch (e) {
    error = (e as Error).message;
  }
};
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
  queries.get.mockResolvedValue({ ...prompt, usage: [] });
  queries.update.mockReset();
  queries.delete.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  dirty.mockReset();
  error = '';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (scrollIntoView) HTMLElement.prototype.scrollIntoView = scrollIntoView;
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
});

it('shows deletion failure inside the confirmation dialog', async () => {
  await render();
  queries.delete.mockRejectedValue(new Error('Referenced by Example workflow'));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Prompt actions"]')!
      .click(),
  );
  const remove = document.querySelector<HTMLElement>('[role="menuitem"]')!;
  await act(async () => remove.click());
  const confirm = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Delete',
  )!;
  await act(async () => confirm.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Referenced by Example workflow',
  );
});

it('clears picker search after selection, preserves order, and exposes missing references', async () => {
  const second = {
    ...prompt,
    id: 'p2',
    name: 'Style',
    content: 'Write clearly',
  };
  const changed = vi.fn();
  function Picker() {
    const [ids, setIds] = useState<string[]>([]);
    const node = nodeSchema.parse({
      id: 'a',
      kind: 'agent',
      label: 'Agent',
      prompt: 'Task',
      promptIds: ids,
    });
    if (node.kind !== 'agent') throw new Error('Agent');
    return h(PromptPicker, {
      node,
      prompts: [prompt, second],
      onChange: (value) => {
        setIds(value);
        changed(value);
      },
    });
  }
  await act(async () =>
    root.render(h(MantineProvider, { env: 'test' }, h(Picker))),
  );
  const search = container.querySelector<HTMLInputElement>(
    'input[role="combobox"]',
  )!;
  async function select(text: string) {
    await act(async () => {
      search.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(search, text);
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const option = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((el) => el.textContent?.startsWith(text))!;
    await act(async () => option.click());
    expect(search.value).toBe('');
  }
  await select('Review');
  await select('Style');
  expect(changed).toHaveBeenLastCalledWith(['p1', 'p2']);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Move prompt 2 up"]')!
      .click(),
  );
  expect(changed).toHaveBeenLastCalledWith(['p2', 'p1']);
  const node = nodeSchema.parse({
    id: 'a',
    kind: 'agent',
    label: 'Agent',
    prompt: 'Task',
    promptIds: ['gone'],
  });
  if (node.kind !== 'agent') throw new Error('Agent');
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        { env: 'test' },
        h(PromptPicker, { node, prompts: [], onChange: changed }),
      ),
    ),
  );
  expect(container.textContent).toContain('Missing prompt: gone');
});
async function render(value = prompt) {
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        { env: 'test' },
        h(
          MemoryRouter,
          {},
          h(PromptEditor, {
            prompt: value,
            act: action,
            onDirty: dirty,
            tick: value.revision,
          }),
        ),
      ),
    ),
  );
}
async function input(text: string) {
  const area = container.querySelectorAll('textarea')[1];
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(area, text);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === label,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it('preserves dirty text and its save revision across refresh and stale failure, then discards to latest', async () => {
  await render();
  await input('My unsaved instructions');
  expect(dirty).toHaveBeenLastCalledWith(true);
  const newer = { ...prompt, revision: 2, content: 'Changed elsewhere' };
  await render(newer);
  expect(container.querySelectorAll('textarea')[1].value).toBe(
    'My unsaved instructions',
  );
  expect(container.textContent).toContain('This prompt changed elsewhere');
  queries.update.mockRejectedValue(
    new Error('Prompt changed. Reload before saving.'),
  );
  await click('Save');
  expect(queries.update).toHaveBeenCalledWith(
    expect.objectContaining({
      revision: 1,
      content: 'My unsaved instructions',
    }),
  );
  expect(error).toContain('Reload before saving');
  expect(container.querySelectorAll('textarea')[1].value).toBe(
    'My unsaved instructions',
  );
  await click('Discard changes');
  expect(container.querySelectorAll('textarea')[1].value).toBe(
    'Changed elsewhere',
  );
  expect(dirty).toHaveBeenLastCalledWith(false);
});
it('loads external revisions when clean and becomes clean after a successful save', async () => {
  await render();
  await render({ ...prompt, revision: 2, content: 'Changed elsewhere' });
  expect(container.querySelectorAll('textarea')[1].value).toBe(
    'Changed elsewhere',
  );
  await input('Saved edit');
  queries.update.mockResolvedValue({
    ...prompt,
    revision: 3,
    content: 'Saved edit',
  });
  await click('Save');
  expect(queries.update).toHaveBeenCalledWith(
    expect.objectContaining({ revision: 2, content: 'Saved edit' }),
  );
  expect(dirty).toHaveBeenLastCalledWith(false);
  expect(container.textContent).toContain('Revision 3');
  await input('Another unsaved edit');
  await click('Discard changes');
  expect(container.querySelectorAll('textarea')[1].value).toBe('Saved edit');
  expect(container.textContent).toContain('Revision 3');
});

it('warns before reload or closure while dirty and removes the warning after discard and unmount', async () => {
  await render();
  function unload() {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }
  expect(unload()).toBe(false);
  await input('Unsaved instructions');
  expect(unload()).toBe(true);
  await click('Discard changes');
  expect(unload()).toBe(false);
  await input('Unsaved again');
  await act(async () => root.render(null));
  expect(unload()).toBe(false);
});
