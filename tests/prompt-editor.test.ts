// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nodeSchema, type SavedPrompt } from '@interlock/core';
import type { WorkspaceRead } from '../packages/ui/src/components/WorkspaceReads';
import type { Action } from '../packages/ui/src/lib/useActionFeedback';
import { PromptEditor } from '../packages/ui/src/features/prompts/Prompts';
import { PromptPicker } from '../packages/ui/src/features/prompts/PromptPicker';

const queries = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      prompts: {
        get: { query: queries.get },
        update: { mutate: queries.update },
        delete: { mutate: queries.delete },
      },
    }),
    errorMessage: (error: Error) => error.message,
  };
});
let root: Root;
let container: HTMLDivElement;
const scrollIntoView = HTMLElement.prototype.scrollIntoView;
const prompt: SavedPrompt = {
  id: 'p1',
  name: 'Review',
  description: '',
  content: 'Original',
  revision: 1,
  createdAt: '',
  updatedAt: '',
};
const action: Action = async (fn, _success, onError) => {
  try {
    await fn();
  } catch (e) {
    if (onError) onError((e as Error).message);
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
  const remove = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Delete prompt"]',
  )!;
  expect(remove.textContent).toBe('Delete');
  expect(remove.hasAttribute('aria-haspopup')).toBe(false);
  await act(async () => {
    remove.focus();
    remove.click();
  });
  const confirm = [
    ...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button'),
  ].find((b) => b.textContent === 'Delete')!;
  await act(async () => confirm.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Referenced by Example workflow',
  );
  await act(async () => {
    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent === 'Cancel')!;
    cancel.focus();
    cancel.click();
    await new Promise(requestAnimationFrame);
  });
  await act(async () => new Promise(requestAnimationFrame));
  expect(document.activeElement).toBe(remove);
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
    root.render(h(DesignSystemProvider, { env: 'test' }, h(Picker))),
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
        DesignSystemProvider,
        { env: 'test' },
        h(PromptPicker, { node, prompts: [], onChange: changed }),
      ),
    ),
  );
  expect(container.textContent).toContain('Missing prompt: gone');
});
it('waits for the prompt catalog without treating existing references as missing', async () => {
  const node = nodeSchema.parse({
    id: 'a',
    kind: 'agent',
    label: 'Agent',
    prompt: 'Task',
    promptIds: [prompt.id],
  });
  if (node.kind !== 'agent') throw new Error('Agent');
  const onChange = vi.fn();
  const retry = vi.fn();
  const read: WorkspaceRead = {
    resource: 'prompts',
    ready: false,
    error: '',
    fetching: true,
    retry,
  };
  const picker = async (promptsRead: WorkspaceRead) =>
    act(async () =>
      root.render(
        h(
          DesignSystemProvider,
          { env: 'test' },
          h(PromptPicker, {
            node,
            prompts: promptsRead.ready ? [prompt] : [],
            promptsRead,
            onChange,
          }),
        ),
      ),
    );
  await picker(read);
  expect(
    container.querySelector('[aria-label="Loading saved prompts"]'),
  ).not.toBeNull();
  expect(container.querySelector('[role="combobox"]')).toBeNull();
  expect(container.textContent).not.toContain('Missing prompt');

  await picker({ ...read, error: 'Catalog unavailable', fetching: false });
  expect(container.textContent).toContain('Could not load prompts.');
  await click('Retry prompts');
  expect(retry).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('Missing prompt');

  await picker({ ...read, ready: true, fetching: false });
  expect(container.querySelector('[role="combobox"]')).not.toBeNull();
  expect(container.textContent).toContain(prompt.name);
  expect(onChange).not.toHaveBeenCalled();
});

async function render(value = prompt) {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(
          MemoryRouter,
          {},
          h(PromptEditor, {
            prompt: value,
            usage: [],
            act: action,
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
async function click(label: string, within: ParentNode = container) {
  const button = [...within.querySelectorAll('button')].find(
    (b) => b.textContent === label,
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it('preserves dirty text across a refresh and confirms before loading the latest revision', async () => {
  await render();
  await input('My unsaved instructions');
  const newer = { ...prompt, revision: 2, content: 'Changed elsewhere' };
  await render(newer);
  expect(container.querySelectorAll('textarea')[1].value).toBe(
    'My unsaved instructions',
  );
  expect(container.textContent).toContain('This prompt changed elsewhere');
  const save = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save changes',
  );
  expect(save?.disabled).toBe(true);
  await click('Load latest');
  await click('Keep editing', document);
  expect(container.querySelectorAll('textarea')[1].value).toBe(
    'My unsaved instructions',
  );
  queries.get.mockResolvedValue({ ...newer, usage: [] });
  await click('Load latest');
  await click('Discard changes', document);
  expect(container.querySelectorAll('textarea')[1].value).toBe(
    'Changed elsewhere',
  );
  expect(queries.update).not.toHaveBeenCalled();
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
  await click('Save changes');
  expect(queries.update).toHaveBeenCalledWith(
    expect.objectContaining({ revision: 2, content: 'Saved edit' }),
  );
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
