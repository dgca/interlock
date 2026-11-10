// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '../packages/ui/src/design-system';
import {
  RunTagFilter,
  AppliedRunTagFilters,
} from '../packages/ui/src/features/runs/RunTagFilter';

let root: Root;
let container: HTMLDivElement;
const change = vi.fn();
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
  change.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(value?: Record<string, string>) {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(RunTagFilter, { value, onChange: change, filterId: 'test-tags' }),
        h(AppliedRunTagFilters, {
          value,
          onChange: change,
          filterId: 'test-tags',
        }),
      ),
    ),
  );
}
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => (el.getAttribute('aria-label') ?? el.textContent) === label,
  )!;
async function click(label: string) {
  expect(button(label), label).toBeTruthy();
  await act(async () => button(label).click());
}
async function input(label: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  expect(field, label).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('opens an anchored manual builder with guidance and commits literal AND conditions only on Apply', async () => {
  await render();
  await click('Filter by tags');
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).toBeTruthy();
  // Mantine's test environment renders portals inline; browser QA checks placement.
  expect(dialog.textContent).toContain('Run dialog');
  expect(dialog.textContent).toContain('Example: repo = dgca/interlock');
  expect(dialog.querySelector('input')).toBeNull();
  await click('Add condition');
  expect(dialog.querySelector('label')!.textContent).toContain('Key');
  await input('Matching tags key 1', ' Repo ');
  await input('Matching tags value 1', ' Value ');
  await click('Add condition');
  await input('Matching tags key 2', '__proto__');
  expect(change).not.toHaveBeenCalled();
  await click('Apply filters');
  expect(change).toHaveBeenCalledExactlyOnceWith(
    JSON.parse('{" Repo ":" Value ","__proto__":""}'),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('discards Cancel, Escape and outside-click drafts, and reopens from the current filters', async () => {
  await render({ repo: 'current' });
  for (const close of ['cancel', 'escape', 'outside']) {
    await click('Filter by tags (1)');
    await input('Matching tags value 1', 'unsaved');
    if (close === 'cancel') await click('Cancel');
    else if (close === 'escape')
      await act(async () =>
        document
          .querySelector('input')!
          .dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
          ),
      );
    else
      await act(async () =>
        document.body.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true }),
        ),
      );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  }
  await click('Filter by tags (1)');
  expect(
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Matching tags value 1"]',
    )!.value,
  ).toBe('current');
});

it('invalidates an open draft when external filters change, including returning to the previous value', async () => {
  await render({ repo: 'first' });
  await click('Filter by tags (1)');
  await input('Matching tags value 1', 'unsaved');
  await render({ repo: 'second' });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render({ repo: 'first' });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('Filter by tags (1)');
  expect(
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Matching tags value 1"]',
    )!.value,
  ).toBe('first');
  expect(change).not.toHaveBeenCalled();
});

it('shows validation without applying, limits conditions, and removes exact applied pairs safely', async () => {
  const value = JSON.parse('{"__proto__":""," repo ":" X "}');
  await render(value);
  expect(container.textContent).toContain('__proto__ = ""');
  expect(container.textContent).toContain('" repo " = " X "');
  const remove = button('Remove condition __proto__ = ""');
  expect(remove.tabIndex).toBe(0);
  expect(remove.getAttribute('aria-hidden')).toBe('false');
  await click('Remove condition __proto__ = ""');
  expect(change).toHaveBeenLastCalledWith({ ' repo ': ' X ' });
  await click('Clear all');
  expect(change).toHaveBeenLastCalledWith(undefined);
  change.mockReset();
  await click('Filter by tags (2)');
  await input('Matching tags key 2', '__proto__');
  await click('Apply filters');
  expect(document.querySelector('[role="alert"]')!.textContent).toContain(
    'Each tag key must be unique',
  );
  expect(change).not.toHaveBeenCalled();
  await click('Cancel');
  await render(
    Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [`key${index}`, '']),
    ),
  );
  await click('Filter by tags (16)');
  expect(button('Add condition').disabled).toBe(true);
});

it('keeps keyboard focus on remaining conditions and returns it to the trigger after last removal or Clear all', async () => {
  await render({ one: '1', two: '2', three: '3' });
  button('Remove condition two = 2').focus();
  await click('Remove condition two = 2');
  await render({ one: '1', three: '3' });
  expect(document.activeElement).toBe(button('Remove condition three = 3'));
  await click('Remove condition three = 3');
  await render({ one: '1' });
  expect(document.activeElement).toBe(button('Remove condition one = 1'));
  await click('Remove condition one = 1');
  await render();
  expect(document.activeElement).toBe(button('Filter by tags'));
  await render({ one: '1', two: '2' });
  button('Clear all').focus();
  await click('Clear all');
  await render();
  expect(document.activeElement).toBe(button('Filter by tags'));
});
