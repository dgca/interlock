// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { StallSettings } from '../packages/ui/src/features/executors/StallSettings';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), configure: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    stalls: {
      settings: { query: mocks.settings },
      configure: { mutate: mocks.configure },
    },
  },
  errorMessage: (error: Error) => error.message,
}));
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
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
  vi.restoreAllMocks();
});
const input = () =>
  container.querySelector<HTMLInputElement>('input[type="number"]')!;
const unit = () =>
  container.querySelector<HTMLSelectElement>(
    'select[aria-label="Unclaimed threshold unit"]',
  )!;
const button = (name: string) =>
  [...container.querySelectorAll('button')].find(
    (button) => button.textContent === name,
  )!;
const fill = (value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });

it('Reload restores valid stall settings even when value and revision match an invalid rounded input', async () => {
  const saved = { revision: 7, policy: { unclaimedStallMs: 1 } };
  mocks.settings.mockResolvedValue(saved);
  mocks.configure.mockRejectedValueOnce(new Error('Save unavailable'));
  await act(async () =>
    root.render(h(MantineProvider, { env: 'test' }, h(StallSettings))),
  );
  await fill('2');
  await act(async () => button('Save stall settings').click());
  expect(container.textContent).toContain('Save unavailable');
  await act(async () => {
    unit().value = '86400000';
    unit().dispatchEvent(new Event('change', { bubbles: true }));
  });
  await fill('1.1574074074074074e-8');
  expect(input().validity.customError).toBe(true);
  expect(input().validationMessage).toBe('Use a whole number of milliseconds.');
  await act(async () => button('Reload stall settings').click());
  expect(mocks.settings).toHaveBeenCalledTimes(2);
  expect(input().value).toBe('1');
  expect(unit().value).toBe('1');
  expect(input().validity.valid).toBe(true);
  expect(input().validationMessage).toBe('');
  await fill('2');
  expect(button('Save stall settings').disabled).toBe(false);
  mocks.configure.mockResolvedValueOnce({
    revision: 8,
    policy: { unclaimedStallMs: 2 },
  });
  await act(async () => button('Save stall settings').click());
  expect(mocks.configure).toHaveBeenLastCalledWith({
    expectedRevision: 7,
    policy: { unclaimedStallMs: 2 },
  });
  expect(container.textContent).not.toContain('Save unavailable');
});
