// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  PauseProvider,
  LibraryPauseBar,
} from '../packages/ui/src/features/pauses/PauseControls';
const rpc = vi.hoisted(() => ({
  list: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    pauses: {
      list: { query: rpc.list },
      pause: { mutate: rpc.pause },
      resume: { mutate: rpc.resume },
    },
  },
  errorMessage: (e: Error) => e.message,
}));
let root: Root, container: HTMLDivElement, e: Engine, readFails: boolean;
const button = (name: string) =>
  [
    ...(
      document.querySelector('[role=dialog]') ?? document
    ).querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent === name)!;
const text = () => document.body.textContent!;
async function click(name: string) {
  expect(button(name), name).toBeDefined();
  await act(async () => button(name).click());
}
async function enter(label: string, value: string) {
  const input = [
    ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input,textarea',
    ),
  ].find((el) =>
    document
      .querySelector(`label[for="${el.id}"]`)
      ?.textContent?.startsWith(label),
  )!;
  expect(input, label).toBeDefined();
  await act(async () => {
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  e = new Engine(new Store(':memory:'), process.cwd());
  readFails = false;
  rpc.list.mockReset().mockImplementation(async (q) => {
    if (readFails) throw Error('Status read unavailable');
    return e.pauses.list(q);
  });
  rpc.pause.mockReset().mockImplementation(async (q) => e.pauses.create(q));
  rpc.resume.mockReset().mockImplementation(async (q) => e.pauses.resume(q.id));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(PauseProvider, { children: h(LibraryPauseBar) }),
      ),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  e.stop();
  e.store.close();
  vi.restoreAllMocks();
});
it('3a0f58d-add-ack-refresh-retry: completes an acknowledged create before read failure and refreshes without another write', async () => {
  let deliver!: () => void;
  const delivery = new Promise<void>((resolve) => (deliver = resolve));
  rpc.pause.mockImplementationOnce(async (q) => {
    await delivery;
    const hold = e.pauses.create(q);
    readFails = true;
    return hold;
  });
  await click('Pause library');
  await enter('Actor', 'operator');
  await enter('Reason', 'Acknowledged pause');
  await click('Pause library');
  expect(button('Done').disabled).toBe(true);
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!
      .disabled,
  ).toBe(true);
  await act(async () => deliver());
  expect(text()).toContain('Pause added.');
  expect(text()).toContain('Status read unavailable');
  expect(document.querySelector('form')).toBeNull();
  expect(button('Add another pause').disabled).toBe(true);
  expect(e.pauses.list().total).toBe(1);
  expect(rpc.pause).toHaveBeenCalledOnce();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(button('Retry refresh')),
  );
  readFails = false;
  await click('Retry refresh');
  expect(text()).toContain('1 applicable hold');
  expect(document.querySelector('form')).toBeNull();
  expect(rpc.pause).toHaveBeenCalledOnce();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(button('Release…')),
  );
  await click('Add another pause');
  expect(
    [...document.querySelectorAll('form input, form textarea')]
      .filter((el) => document.querySelector(`label[for="${el.id}"]`))
      .every((el) => (el as HTMLInputElement).value === ''),
  ).toBe(true);
  await enter('Actor', 'operator');
  await enter('Reason', 'Explicit second pause');
  await click('Pause library');
  expect(e.pauses.list().total).toBe(2);
  expect(rpc.pause).toHaveBeenCalledTimes(2);
});
it('retains entered values for a failed write and creates exactly one hold when the write is retried', async () => {
  rpc.pause.mockRejectedValueOnce(Error('Write unavailable'));
  await click('Pause library');
  await enter('Actor', 'operator');
  await enter('Reason', 'Keep my input');
  await click('Pause library');
  expect(text()).toContain('Write unavailable');
  expect(text()).not.toContain('Pause added.');
  expect(
    (document.querySelector('textarea') as HTMLTextAreaElement).value,
  ).toBe('Keep my input');
  expect(e.pauses.list().total).toBe(0);
  await click('Pause library');
  expect(e.pauses.list().total).toBe(1);
  expect(document.querySelector('form')).toBeNull();
});
it('keeps an acknowledged release completed when its read fails', async () => {
  e.pauses.create({
    target: { scope: 'library' },
    actor: 'operator',
    reason: 'Release me',
  });
  // Open through the existing clear-state trigger; the dialog loads current server state.
  await click('Pause library');
  await click('Cancel');
  await click('Release…');
  rpc.resume.mockImplementationOnce(async (q) => {
    const result = e.pauses.resume(q.id);
    readFails = true;
    return result;
  });
  await click('Release hold');
  expect(text()).toContain('Hold released.');
  expect(button('Release hold')).toBeUndefined();
  expect(e.pauses.list().total).toBe(0);
  readFails = false;
  await click('Retry refresh');
  expect(text()).toContain('0 applicable holds');
  expect(rpc.resume).toHaveBeenCalledOnce();
});
