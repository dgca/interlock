// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createSuiteSchema, type TestSuite } from '@interlock/core';
import {
  sameSuiteDraft,
  suiteContent,
  suiteDraft,
} from '../packages/ui/src/features/testing/suiteDraft';

const mocks = vi.hoisted(() => ({ simulation: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      testbench: { simulation: { mutate: mocks.simulation } },
    }),
    errorMessage: (error: Error) => error.message,
  };
});
const { useSuiteRun } =
  await import('../packages/ui/src/features/testing/useSuiteRun');

const suite: TestSuite = {
  id: 'suite',
  workflowId: 'workflow',
  name: 'Answers',
  description: '',
  revision: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  cases: [
    {
      id: 'copied',
      name: 'Copied from a run',
      input: { question: 'Why?' },
      source: { runId: 'run', workflowId: 'workflow', version: 1 },
      assertions: [{ kind: 'route', nodeId: 'gate', visit: 1, port: 'yes' }],
      qualityGuidance: '',
    },
    {
      id: 'fixtures',
      name: 'With fixtures',
      input: null,
      fixtures: [{ nodeId: 'agent', kind: 'agent', output: { ok: true } }],
      assertions: [],
      qualityGuidance: 'Brief',
    },
  ],
};

afterEach(() => vi.clearAllMocks());

it('saves an opened suite back in the strict suite shape without changes', () => {
  const draft = suiteDraft(suite);
  // Read-only source metadata must not be sent back; the save schema is strict.
  const saved = createSuiteSchema.parse({
    workflowId: 'workflow',
    content: suiteContent(draft),
  });
  expect(saved.content.cases[0]).not.toHaveProperty('source');
  expect(saved.content.cases[1].fixtures).toEqual(suite.cases[1].fixtures);
  expect(sameSuiteDraft(draft, suiteDraft(suite))).toBe(true);
});

it('runs cases one at a time against the saved revision, waiting for a free slot', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  let active = 0;
  const started: { caseId: string; suiteRevision: number }[] = [];
  let full = true;
  type Request = {
    action: string;
    id?: string;
    requestId?: string;
    caseId: string;
    suiteRevision: number;
  };
  mocks.simulation.mockImplementation((request: Request) => {
    if (request.action === 'run') {
      if (full) {
        full = false;
        return Promise.reject(
          new Error('At most four simulations may be active'),
        );
      }
      expect(active).toBe(0);
      active++;
      started.push(request);
      return Promise.resolve({ id: request.requestId, state: 'running' });
    }
    active--;
    return Promise.resolve({ id: request.id, state: 'passed' });
  });
  const finished = vi.fn();
  let run!: ReturnType<typeof useSuiteRun>['run'];
  const root = createRoot(document.createElement('div'));
  act(() =>
    root.render(
      h(() => {
        run = useSuiteRun(finished).run;
        return null;
      }),
    ),
  );
  let done = false;
  act(() => {
    void run(suite, 2).then(() => (done = true));
  });
  for (let i = 0; i < 20 && !done; i++)
    await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(done).toBe(true);
  expect(started).toMatchObject([
    { caseId: 'copied', suiteRevision: 3, version: 2 },
    { caseId: 'fixtures', suiteRevision: 3, version: 2 },
  ]);
  expect(finished).toHaveBeenCalledTimes(2);
  act(() => root.unmount());
  vi.useRealTimers();
});
