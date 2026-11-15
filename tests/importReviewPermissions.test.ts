// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  executorProfileSchema,
  importReview,
} from '@interlock/core';
import { UiTestProvider } from './uiTestProvider';
import { Details } from '../packages/ui/src/features/workflows/ImportDetails';

const rpc = vi.hoisted(() => ({ profiles: vi.fn(), settings: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({
      executors: {
        profiles: { query: rpc.profiles },
        settings: { query: rpc.settings },
      },
    }),
    errorMessage: (error: Error) => error.message,
  };
});
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  rpc.profiles.mockResolvedValue([
    {
      ...executorProfileSchema.parse({
        id: 'codex',
        harness: 'codex',
        name: 'Codex',
      }),
      detection: { status: 'detected' },
    },
  ]);
  rpc.settings.mockResolvedValue({ revision: 0, concurrency: 3 });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Import review states the level each imported workflow's Agents would run
// with here; a workflow without Agent steps adds nothing.
it('shows each imported workflow agent level and its source', async () => {
  const inherits = { ...blankDefinition(), executor: 'codex' };
  const readOnly = {
    ...blankDefinition(),
    executor: 'codex',
    agentPermissions: 'read-only' as const,
  };
  const noAgents = blankDefinition();
  noAgents.nodes = noAgents.nodes.filter((n) => n.kind !== 'agent');
  const review = importReview([
    { id: 'builder', name: 'Builder', draft: inherits },
    { name: 'Reviewer', draft: readOnly },
    { name: 'Notifier', draft: noAgents },
    // Owned helpers without a harness run on their owner's.
    { name: 'Helper', ownerWorkflowId: 'builder', draft: blankDefinition() },
    { name: 'Orphan', ownerWorkflowId: 'missing', draft: blankDefinition() },
  ]);
  expect(review.agentPermissions.map((a) => a.workflowName)).toEqual([
    'Builder',
    'Reviewer',
    'Helper',
    'Orphan',
  ]);
  await act(async () => {
    root.render(
      h(
        UiTestProvider,
        {},
        h(Details, { item: { workflows: [], prompts: [], ...review } }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve));
  });
  const lines = [...container.querySelectorAll('p')].map((p) => p.textContent);
  expect(lines).toContain(
    'Agent permissions · Builder: Full access · from AI Settings',
  );
  expect(lines).toContain(
    'Agent permissions · Reviewer: Read only · set in this workflow',
  );
  expect(lines).toContain(
    "Agent permissions · Helper: Full access · from AI Settings · uses Builder's agent",
  );
  expect(lines).toContain(
    'Agent permissions · Orphan: No harness selected · a connected agent uses its own permissions',
  );
  expect(lines.join('\n')).not.toContain('Notifier');
});
