// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import {
  DesignSystemProvider,
  PageHeader,
} from '../packages/ui/src/design-system';

it('keeps filter controls before actions and preserves focused edits across header updates', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onBack = vi.fn();
  const create = vi.fn();
  const render = (busy: boolean) =>
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(PageHeader, {
          title: 'Records',
          subtitle: '12 records',
          status: busy ? 'Saving' : 'Ready',
          onBack,
          busy,
          controls: h('input', {
            'aria-label': 'Search records',
            defaultValue: 'unfinished query',
          }),
          actions: h('button', { onClick: create }, 'New record'),
        }),
      ),
    );
  try {
    await act(async () => render(false));
    const input = container.querySelector('input')!;
    const action = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'New record',
    )!;
    const back = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Back"]',
    )!;
    expect(container.querySelector('h1')?.textContent).toBe('Records');
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Ready',
    );
    expect(
      input.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await act(async () => back.click());
    expect(onBack).toHaveBeenCalledOnce();
    input.focus();
    input.setSelectionRange(3, 7);
    await act(async () => render(true));
    expect(container.querySelectorAll('input')).toHaveLength(1);
    expect(container.querySelector('input')).toBe(input);
    expect(input.value).toBe('unfinished query');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7]);
    expect(back.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Saving',
    );
    await act(async () => action.click());
    expect(create).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
