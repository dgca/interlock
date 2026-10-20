// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkRequest } from '@interlock/core';
import {
  manualClaims,
  removeLegacyManualClaims,
} from '../packages/ui/src/features/runs/manualClaims';

const claim = (overrides: Partial<WorkRequest> = {}): WorkRequest => ({
  id: 'work',
  runId: 'run',
  executionId: 'execution',
  nodeId: 'agent',
  label: 'Assignment',
  prompt: 'Private composed prompt',
  input: { private: true },
  context: { mode: 'current', instructions: '', tools: [], skills: [] },
  outputSchema: {},
  status: 'claimed',
  attempt: 1,
  maxAttempts: 2,
  createdAt: new Date().toISOString(),
  workerId: 'manual-ui',
  token: 'test-token',
  leaseUntil: new Date(Date.now() + 10_000).toISOString(),
  ...overrides,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('retains only credentials and lease identity and expires without any subscriber', () => {
  manualClaims.remember(claim());
  expect(Object.keys(manualClaims.get('work')!).sort()).toEqual([
    'attempt',
    'leaseUntil',
    'token',
    'workerId',
  ]);
  vi.advanceTimersByTime(10_000);
  expect(manualClaims.get('work')).toBeUndefined();
});
it('renewal replaces the cleanup deadline and notifies mounted views', () => {
  const listener = vi.fn(),
    unsubscribe = manualClaims.subscribe(listener);
  manualClaims.remember(claim());
  vi.advanceTimersByTime(5_000);
  manualClaims.remember(claim());
  vi.advanceTimersByTime(5_000);
  expect(manualClaims.get('work')).toBeDefined();
  vi.advanceTimersByTime(5_000);
  expect(manualClaims.get('work')).toBeUndefined();
  expect(listener).toHaveBeenCalledTimes(3);
  unsubscribe();
});
it.each([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'available',
] as const)('forgets observed %s work', (status) => {
  manualClaims.remember(claim());
  manualClaims.observe(claim({ status }));
  expect(manualClaims.get('work')).toBeUndefined();
});
it('forgets a replaced claim even when the same worker reclaimed it', () => {
  manualClaims.remember(claim());
  manualClaims.observe(claim({ attempt: 2 }));
  expect(manualClaims.get('work')).toBeUndefined();
});
it('ignores older snapshots and late responses after a newer claim', () => {
  manualClaims.remember(claim({ attempt: 2 }));
  manualClaims.observe(claim({ status: 'available' }));
  manualClaims.remember(claim({ token: 'older-token' }));
  expect(manualClaims.get('work')?.attempt).toBe(2);
});
it('accepts server confirmation of renewal after a lost response', () => {
  manualClaims.remember(claim());
  vi.advanceTimersByTime(5_000);
  const { token, ...observed } = claim();
  manualClaims.observe(observed);
  vi.advanceTimersByTime(6_000);
  expect(manualClaims.get('work')).toBeDefined();
});
it('rejects an expired credential even if browser cleanup timers were delayed', () => {
  manualClaims.remember(claim());
  vi.setSystemTime(Date.now() + 11_000);
  expect(() => manualClaims.token('work')).toThrow('active claim');
  expect(manualClaims.get('work')).toBeUndefined();
});
it('removes recognizable legacy claims without restoring them or clearing other data', () => {
  sessionStorage.setItem('claim:work', JSON.stringify(claim()));
  sessionStorage.setItem(
    'claim:old',
    JSON.stringify(claim({ id: 'old', leaseUntil: '2000-01-01T00:00:00Z' })),
  );
  sessionStorage.setItem(
    'claim:other-plugin',
    JSON.stringify({ id: 'other-plugin', token: 'unrelated' }),
  );
  sessionStorage.setItem('claim:malformed', '{');
  sessionStorage.setItem('theme', 'dark');
  localStorage.setItem('theme', 'dark');
  removeLegacyManualClaims();
  expect(sessionStorage.getItem('claim:work')).toBeNull();
  expect(sessionStorage.getItem('claim:old')).toBeNull();
  expect(manualClaims.get('work')).toBeUndefined();
  expect(sessionStorage.getItem('claim:other-plugin')).not.toBeNull();
  expect(sessionStorage.getItem('claim:malformed')).toBe('{');
  expect(sessionStorage.getItem('theme')).toBe('dark');
  expect(localStorage.getItem('theme')).toBe('dark');
});
it('works when storage access is denied', () => {
  vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
    throw new Error('Denied');
  });
  expect(() => removeLegacyManualClaims()).not.toThrow();
  manualClaims.remember(claim());
  expect(manualClaims.get('work')).toBeDefined();
});
