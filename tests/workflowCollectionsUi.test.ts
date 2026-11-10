// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { DesignSystemProvider } from '../packages/ui/src/design-system';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blankDefinition, type Workflow } from '@interlock/core';
import { WorkflowLibrary } from '../packages/ui/src/features/workflows/WorkflowLibrary';
import { WorkflowChildren } from '../packages/ui/src/features/workflows/WorkflowChildren';
const rpc = vi.hoisted(() => ({ create: vi.fn(), delete: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    workflows: {
      create: { mutate: rpc.create },
      delete: { mutate: rpc.delete },
    },
  },
  download: vi.fn(),
  errorMessage: (e: Error) => e.message,
}));
function workflow(
  id: string,
  name: string,
  ownerWorkflowId: string | null = null,
  archived = false,
): Workflow {
  return {
    id,
    name,
    ownerWorkflowId,
    archived,
    description: '',
    draft: blankDefinition(),
    draftRevision: 1,
    latestVersion: 0,
    createdAt: '2026-11-08T12:00:00Z',
    updatedAt: '2026-11-08T12:00:00Z',
  };
}
const parent = workflow('parent', 'Parent workflow');
const workflows = [
  parent,
  workflow('archived', 'Archived parent', null, true),
  workflow('child', 'Active helper', 'parent'),
  workflow('old', 'Archived helper', 'parent', true),
  workflow('other', 'Other helper', 'archived'),
];
const perform = async (fn: () => Promise<unknown>) => {
  await fn();
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(element: ReturnType<typeof h>) {
  await act(async () =>
    root.render(
      h(DesignSystemProvider, { env: 'test' }, h(MemoryRouter, {}, element)),
    ),
  );
}
function button(text: string) {
  const element = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((el) => el.textContent?.trim() === text);
  expect(element, text).toBeTruthy();
  return element!;
}
async function search(label: string, text: string) {
  const input = container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
it('keeps child workflows out of library results and switches archive scope while searching', async () => {
  await render(
    h(WorkflowLibrary, { workflows, onOpen: vi.fn(), act: perform }),
  );
  expect(
    container.querySelector('header input[aria-label="Search workflows"]'),
  ).not.toBeNull();
  expect(
    [...container.querySelectorAll('header button')].at(-1)?.textContent,
  ).toContain('New workflow');
  expect(container.querySelectorAll('article')).toHaveLength(1);
  expect(container.textContent).toContain('Parent workflow');
  expect(container.textContent).not.toContain('Active helper');
  await search('Search workflows', 'Archived');
  expect(container.textContent).toContain('No matching workflows');
  await act(async () => button('Archived 1').click());
  expect(container.querySelector('article')?.textContent).toContain(
    'Archived parent',
  );
  const input = await search('Search workflows', 'not-found');
  await act(async () => button('Clear search').click());
  expect(input.value).toBe('');
  expect(document.activeElement).toBe(input);
  expect(container.querySelector('article')?.textContent).toContain(
    'Archived parent',
  );
});
it('keeps New workflow stable and prevents repeated pending creation', async () => {
  const onOpen = vi.fn();
  let resolve!: (value: unknown) => void;
  rpc.create.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render(h(WorkflowLibrary, { workflows, onOpen, act: perform }));
  const create = button('New workflow');
  await act(async () => {
    create.click();
    create.click();
  });
  expect(rpc.create).toHaveBeenCalledTimes(1);
  expect(create.disabled).toBe(true);
  expect(create.textContent).toBe('New workflow');
  await act(async () => resolve({ id: 'new' }));
  expect(onOpen).toHaveBeenCalledWith('new');
});
it('scopes child cards to their owner and preserves disabled navigation', async () => {
  const onOpen = vi.fn();
  const props = {
    workflow: parent,
    workflows: [...workflows, workflow('second', 'Second helper', 'parent')],
    onOpen,
    onCreate: vi.fn(),
    act: perform,
    disabled: false,
  };
  await render(h(WorkflowChildren, props));
  expect(container.querySelectorAll('article')).toHaveLength(2);
  expect(container.textContent).not.toContain('Other helper');
  const remove = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Delete Active helper"]',
  )!;
  expect(remove.textContent).toBe('Delete');
  await act(async () => {
    remove.focus();
    remove.click();
  });
  expect(onOpen).not.toHaveBeenCalled();
  expect(document.querySelector('[role=dialog]')?.textContent).toContain(
    'Active helper',
  );
  await act(async () => {
    const cancelButton = [
      ...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button'),
    ].find((button) => button.textContent === 'Cancel')!;
    cancelButton.focus();
    cancelButton.click();
    await new Promise(requestAnimationFrame);
  });
  await act(async () => new Promise(requestAnimationFrame));
  expect(document.activeElement).toBe(remove);
  await act(async () => {
    remove.focus();
    remove.click();
  });
  await act(async () => {
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button'),
    ].find((button) => button.textContent === 'Delete')!;
    confirm.focus();
    confirm.click();
    await new Promise(requestAnimationFrame);
  });
  await act(async () => new Promise(requestAnimationFrame));
  expect(rpc.delete).toHaveBeenCalledWith({ id: 'child' });
  expect(document.activeElement).toBe(
    container.querySelector('input[aria-label="Search child workflows"]'),
  );
  expect(onOpen).not.toHaveBeenCalled();

  await act(async () => button('Archived 1').click());
  const open = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Open Archived helper"]',
  )!;
  await act(async () => open.click());
  expect(onOpen).toHaveBeenCalledWith('old');
  await render(h(WorkflowChildren, { ...props, disabled: true }));
  const disabled = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Open Archived helper"]',
  )!;
  expect(disabled.disabled).toBe(true);
  expect(button('New child').disabled).toBe(true);
  expect(
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete Archived helper"]',
    )!.disabled,
  ).toBe(true);
  onOpen.mockClear();
  await act(async () => disabled.click());
  expect(onOpen).not.toHaveBeenCalled();
});
