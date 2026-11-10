// @vitest-environment jsdom
import { act, createElement as h, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Link } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Button, DesignSystemProvider } from '../packages/ui/src/design-system';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('retains native submit, disabled, and ref behavior with semantic variants', async () => {
  const submit = vi.fn((event: Event) => event.preventDefault());
  const ref = createRef<HTMLButtonElement>();
  await act(async () => {
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(
          'form',
          { onSubmit: submit },
          h(
            Button<'button'>,
            { ref, type: 'submit', variant: 'primary' },
            'Save',
          ),
          h(Button<'button'>, { disabled: true, variant: 'danger' }, 'Delete'),
        ),
      ),
    );
  });
  const [save, remove] = container.querySelectorAll('button');
  expect(ref.current).toBe(save);
  expect(save.dataset.variant).toBe('filled');
  expect(remove.dataset.variant).toBe('light');
  await act(async () => save.click());
  expect(submit).toHaveBeenCalledOnce();
  expect(remove.disabled).toBe(true);
});

it('retains router-link props and the loading state without duplicating a native button', async () => {
  await act(async () => {
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(
          MemoryRouter,
          {},
          h(
            Button<typeof Link>,
            { component: Link, to: '/next', variant: 'secondary' },
            'Next',
          ),
          h(Button<'button'>, { loading: true, variant: 'ghost' }, 'Working'),
        ),
      ),
    );
  });
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/next');
  expect(container.querySelectorAll('button')).toHaveLength(1);
  expect(container.querySelector('button')?.dataset.loading).toBe('true');
});
