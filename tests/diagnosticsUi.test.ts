// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiTestProvider } from './uiTestProvider';
import { Diagnostics } from '../packages/ui/src/features/diagnostics/Diagnostics';
import { refreshQueries, useQueryClient } from '../packages/ui/src/lib/query';

const doctor = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({ system: { doctor: { query: doctor } } }),
    errorMessage: (error: Error) => error.message,
  };
});

const report = {
  status: 'ok',
  checkedAt: '2026-11-09T12:00:00Z',
  summary: { total: 1, ok: 1, warn: 0, fail: 0 },
  checks: [
    {
      category: 'system',
      name: 'Database',
      status: 'ok',
      message: 'Cached database check',
    },
  ],
};
let root: Root, container: HTMLDivElement;
let client: ReturnType<typeof useQueryClient>;
function Cache() {
  client = useQueryClient();
  return null;
}
async function show(visible = true) {
  await act(async () =>
    root.render(
      h(
        UiTestProvider,
        { env: 'test' },
        h(Cache),
        visible ? h(Diagnostics) : h('p', null, 'Other page'),
      ),
    ),
  );
}
beforeEach(() => {
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
  doctor.mockReset().mockResolvedValue(report);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('returns cached diagnostics immediately and retains them on a background failure', async () => {
  await show();
  expect(container.textContent).toContain('Cached database check');
  await show(false);
  let reject!: (error: Error) => void;
  doctor.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await show();
  expect(container.textContent).toContain('Cached database check');
  expect(container.textContent).not.toContain('Loading diagnostics');
  await act(async () => reject(new Error('Diagnostics refresh unavailable')));
  expect(container.textContent).toContain('Diagnostics refresh unavailable');
  expect(container.textContent).toContain(
    'Showing the last successful report.',
  );
  expect(container.textContent).toContain('Cached database check');
});

it('renders startup rows while a refresh is pending and after retry', async () => {
  const checks = [
    { name: 'Config file', message: 'Not found · /engine/config.json' },
    { name: 'requireToken', message: 'false (default)' },
    { name: 'allowedRoots', message: '[] (default)' },
    { name: 'logLevel', message: 'warn (INTERLOCK_LOG_LEVEL)' },
    { name: 'syncDir', message: 'Off (default)' },
  ].map((check) => ({ ...check, category: 'system', status: 'ok' }));
  const result = {
    ...report,
    checks,
    summary: { ...report.summary, total: checks.length, ok: checks.length },
  };
  let finish!: (reply: typeof result) => void;
  doctor.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await show();
  expect(container.textContent).toContain('Running diagnostics');
  await act(() => Promise.resolve().then(() => finish(result)));
  for (const row of checks)
    expect(container.textContent).toContain(row.message);

  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Run checks',
  )!;
  button.focus();
  let fail!: (error: Error) => void;
  doctor.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  await act(() => Promise.resolve().then(() => button.click()));
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(document.activeElement).toBe(button);
  expect(container.textContent).toContain(checks[0].message);
  await act(() => Promise.resolve().then(() => fail(new Error('Read failed'))));
  expect(container.textContent).toContain(
    'Showing the last successful report.',
  );
  doctor.mockResolvedValueOnce(result);
  await act(() => Promise.resolve().then(() => button.click()));
  expect(container.textContent).not.toContain(
    'Showing the last successful report.',
  );
  expect(container.textContent).toContain(checks[0].message);
  expect(document.activeElement).toBe(button);
});

it('runs live probes only as explicit actions and excludes doctor reads from engine invalidation', async () => {
  await show();
  expect(doctor).toHaveBeenLastCalledWith({ live: false });
  await act(async () =>
    container.querySelector<HTMLInputElement>('[role=switch]')!.click(),
  );
  expect(doctor).toHaveBeenLastCalledWith({ live: true });
  const calls = doctor.mock.calls.length;
  await act(async () => refreshQueries(client));
  expect(doctor).toHaveBeenCalledTimes(calls);
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Run checks')!
      .click(),
  );
  expect(doctor).toHaveBeenCalledTimes(calls + 1);
  expect(doctor).toHaveBeenLastCalledWith({ live: true });
});
