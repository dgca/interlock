// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { StallSettings } from '../packages/ui/src/features/executors/StallSettings';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), configure: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      stalls: {
        settings: { query: mocks.settings },
        configure: { mutate: mocks.configure },
      },
    }),
    errorMessage: (error: Error) => error.message,
  };
});
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
const fill = (value: string, control = input()) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });

it('Reload restores valid stall settings even when value and revision match an invalid rounded input', async () => {
  const saved = { revision: 7, policy: { unclaimedStallMs: 1 } };
  mocks.settings.mockResolvedValue(saved);
  mocks.configure.mockRejectedValueOnce(new Error('Save unavailable'));
  await act(async () =>
    root.render(h(DesignSystemProvider, { env: 'test' }, h(StallSettings))),
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

it('uses library switches to configure and disable thresholds and idle recovery', async () => {
  mocks.settings.mockResolvedValue({ revision: 2, policy: {} });
  mocks.configure.mockImplementation(async (request) => ({
    revision: request.expectedRevision + 1,
    policy: request.policy,
  }));
  await act(async () =>
    root.render(h(DesignSystemProvider, { env: 'test' }, h(StallSettings))),
  );
  const toggle = async (name: string) => {
    const label = [...container.querySelectorAll('label')].find((label) =>
      label.textContent?.includes(name),
    )!;
    await act(async () => document.getElementById(label.htmlFor)!.click());
  };
  expect(container.querySelectorAll('[role="switch"]')).toHaveLength(5);
  expect(container.querySelector('select')).toBeNull();
  await toggle('Claimed idle stall');
  await toggle('Managed idle recovery');
  await fill('7');
  await act(async () => button('Save stall settings').click());
  expect(mocks.configure).toHaveBeenLastCalledWith({
    expectedRevision: 2,
    policy: {
      claimedIdleStallMs: 420000,
      idleRecovery: { maxRecoveries: 1, message: expect.any(String) },
    },
  });
  await toggle('Managed idle recovery');
  await toggle('Claimed idle stall');
  expect(container.querySelector('input[type="number"]')).toBeNull();
  await act(async () => button('Save stall settings').click());
  expect(mocks.configure).toHaveBeenLastCalledWith({
    expectedRevision: 3,
    policy: { claimedIdleStallMs: undefined, idleRecovery: undefined },
  });
});

it('keeps zero-attempt recovery off until enabled and requires a positive count', async () => {
  mocks.settings.mockResolvedValue({
    revision: 4,
    policy: { idleRecovery: { maxRecoveries: 0, message: 'Existing nudge' } },
  });
  await act(async () =>
    root.render(h(DesignSystemProvider, { env: 'test' }, h(StallSettings))),
  );
  const label = [...container.querySelectorAll('label')].find((label) =>
    label.textContent?.includes('Managed idle recovery'),
  )!;
  const recovery = document.getElementById(label.htmlFor) as HTMLInputElement;
  expect(recovery.checked).toBe(false);
  expect(input()).toBeNull();
  expect(button('Save stall settings').disabled).toBe(true);
  expect(mocks.configure).not.toHaveBeenCalled();
  await act(async () => recovery.click());
  expect(recovery.checked).toBe(true);
  expect(input().value).toBe('1');
  expect(container.querySelector('textarea')!.value).toBe('Existing nudge');
  await fill('0');
  expect(recovery.checked).toBe(true);
  expect(input().validity.valid).toBe(false);
  await act(async () => button('Save stall settings').click());
  expect(mocks.configure).not.toHaveBeenCalled();
});
