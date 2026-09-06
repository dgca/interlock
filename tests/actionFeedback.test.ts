// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useActionFeedback } from '../packages/ui/src/lib/useActionFeedback';

let feedback: ReturnType<typeof useActionFeedback>;
let root: Root;
let container: HTMLDivElement;
const refresh = vi.fn();
function Harness() {
  feedback = useActionFeedback(refresh);
  return createElement('div', {}, feedback.feedback?.message);
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  refresh.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
it('uses the confirmed result and resets dismissal for repeated successes', async () => {
  await act(async () =>
    feedback.act(
      async () => ({ latestVersion: 4 }),
      (w) => `Published v${w.latestVersion}.`,
    ),
  );
  expect(container.textContent).toBe('Published v4.');
  expect(feedback.feedback?.kind).toBe('success');
  await act(async () => vi.advanceTimersByTime(5000));
  await act(async () => feedback.success('Draft saved.'));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(container.textContent).toBe('Draft saved.');
  await act(async () => vi.advanceTimersByTime(5000));
  expect(container.textContent).toBe('');
});
it('keeps failures visible and never reports success for a rejected action', async () => {
  await act(async () =>
    feedback.act(async () => {
      throw new Error('Invalid graph');
    }, 'Published.'),
  );
  expect(container.textContent).toBe('Invalid graph');
  expect(feedback.feedback?.kind).toBe('error');
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(10000));
  expect(container.textContent).toBe('Invalid graph');
  await act(async () => feedback.dismiss());
  expect(container.textContent).toBe('');
});
it('distinguishes refresh failure from a failed mutation', async () => {
  refresh.mockRejectedValueOnce(new Error('Offline'));
  await act(async () => feedback.act(async () => undefined, 'Published.'));
  expect(container.textContent).toBe(
    'Action completed, but the view could not refresh: Offline',
  );
});
