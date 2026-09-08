// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeleteWorkflowDialog } from '../packages/ui/src/features/workflows/DeleteWorkflowDialog';
const remove = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', () => ({
  api: { workflows: { delete: { mutate: remove } } },
  errorMessage: (error: Error) => error.message,
}));
vi.mock('../packages/ui/src/components/Modal/Modal', () => ({
  Modal: ({ children }: any) => h('div', { role: 'dialog' }, children),
}));
vi.mock('../packages/ui/src/components/Button/Button', () => ({
  Button: ({ variant, ...props }: any) => h('button', props),
}));
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
const close = vi.fn(),
  deleted = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      h(DeleteWorkflowDialog, {
        workflow: { id: 'workflow', name: 'My workflow' },
        onClose: close,
        onDeleted: deleted,
        act: async (fn) => {
          try {
            await fn();
          } catch {}
        },
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const click = async (label: string) =>
  act(async () => {
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === label)!
      .click();
  });
it('requires Delete confirmation and leaves Cancel nondestructive', async () => {
  expect(container.textContent).toContain('My workflow');
  expect(container.textContent).toContain('cannot be undone');
  expect(remove).not.toHaveBeenCalled();
  await click('Cancel');
  expect(close).toHaveBeenCalledOnce();
  expect(remove).not.toHaveBeenCalled();
  await click('Delete');
  expect(remove).toHaveBeenCalledWith({ id: 'workflow' });
  expect(deleted).toHaveBeenCalledOnce();
});
it('shows deletion errors and keeps the workflow open', async () => {
  remove.mockRejectedValueOnce(
    new Error('Cancel or finish active runs first.'),
  );
  await click('Delete');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'active runs',
  );
  expect(deleted).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
