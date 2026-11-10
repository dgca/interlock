// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  STARTED_RUN_SCHEMA,
  type Workflow,
  type WorkflowNode,
  type WorkflowVersion,
} from '@interlock/core';
import { SettingsDialog } from '../packages/ui/src/features/workflows/SettingsDialog';
import { workflowCall } from './fixtures/detached';
const versions = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    workflows: { versions: { query: versions } },
    [Symbol.for('trpc_untypedClient')]: {
      query: (_path: string, input: unknown) => versions(input),
    },
  },
  errorMessage: (error: Error) => error.message,
}));
vi.mock('../packages/ui/src/design-system/Modal/Modal', () => ({
  Modal: ({ children }: any) => h('div', {}, children),
}));
let container: HTMLDivElement, root: Root;
const published = (
  version: number,
  outputSchema: WorkflowVersion['definition']['outputSchema'],
  workflowId = 'child',
): WorkflowVersion => ({
  workflowId,
  version,
  definition: { ...blankDefinition(), outputSchema },
  createdAt: '2026-11-09T00:00:00.000Z',
});
beforeEach(() => {
  versions
    .mockReset()
    .mockResolvedValue([
      published(1, { type: 'string' }),
      published(2, { type: 'number' }),
    ]);
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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(
  mode?: 'wait' | 'detached',
  batchId?: string,
  onFailure?: 'route' | 'fail',
  resultSettings: Pick<WorkflowNode, 'routing' | 'outputBindings'> = {},
  version: number | null = 1,
) {
  const definition = workflowCall('child', mode);
  const node = definition.nodes[1];
  if (node.kind === 'workflow') node.version = version;
  node.batchId = batchId;
  Object.assign(node, resultSettings);
  if (node.kind === 'workflow') node.onFailure = onFailure;
  if (onFailure === 'route')
    definition.edges.push({
      id: 'failed',
      source: node.id,
      target: 'exit',
      port: 'failed',
    });
  node.outputSchema =
    mode === 'detached'
      ? structuredClone(STARTED_RUN_SCHEMA)
      : { type: 'string' };
  const onApply = vi.fn();
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(SettingsDialog, {
          name: 'Supervisor',
          description: '',
          definition,
          node,
          workflows: ['child', 'other-child'].map(
            (id) =>
              ({
                id,
                name: 'Child',
                description: '',
                archived: false,
                latestVersion: 2,
                draftRevision: 1,
                createdAt: '2026-11-09T00:00:00.000Z',
                updatedAt: '2026-11-09T00:00:00.000Z',
                draft: {
                  ...blankDefinition(),
                  outputSchema: { type: 'boolean' },
                },
              }) satisfies Workflow,
          ),
          onClose: vi.fn(),
          onApply,
        }),
      ),
    ),
  );
  return { onApply, node };
}
async function choose(mode: string) {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>(`input[type="radio"][value="${mode}"]`)!
      .click(),
  );
}
async function apply() {
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'Apply changes')!
      .click(),
  );
}
async function pin(value: string) {
  const label = Array.from(container.querySelectorAll('label')).find(
    (label) => label.textContent === 'Pinned version',
  )!;
  const input = document.getElementById(label.htmlFor) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('preserves omitted mode and restores the wait contract when toggling before Apply', async () => {
  const { onApply } = await render();
  expect(
    container.querySelector<HTMLInputElement>('input[value="wait"]')!.checked,
  ).toBe(true);
  await choose('detached');
  expect(container.textContent).toContain('runId, workflowId, and version');
  const output = Array.from(container.querySelectorAll('span'))
    .find((s) => s.textContent === 'Output · Started run')!
    .closest('section')!;
  expect(output.querySelector('button')).toBeNull();
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1]).toMatchObject({
    mode: 'wait',
    outputSchema: { type: 'string' },
  });
});
it('saves detached mode with the fixed contract and explains Batch dispatch concurrency', async () => {
  const { onApply } = await render(undefined, 'batch');
  await choose('detached');
  expect(container.textContent).toContain('Batch concurrency limits dispatch');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1]).toMatchObject({
    mode: 'detached',
    outputSchema: STARTED_RUN_SCHEMA,
  });
});
it('restores the pinned published output when reopening detached mode, ignoring newer versions and draft edits', async () => {
  const { onApply } = await render('detached');
  expect(
    container.querySelector<HTMLInputElement>('input[value="detached"]')!
      .checked,
  ).toBe(true);
  await choose('wait');
  await apply();
  expect(versions).toHaveBeenCalledWith({ id: 'child' });
  expect(onApply.mock.calls[0][0].definition.nodes[1].outputSchema).toEqual({
    type: 'string',
  });
});

it('waits for the pinned contract before allowing a detached node to switch to wait', async () => {
  let resolve!: (value: WorkflowVersion[]) => void;
  versions.mockReturnValue(
    new Promise<WorkflowVersion[]>((done) => {
      resolve = done;
    }),
  );
  const { onApply } = await render('detached');
  const wait = () =>
    container.querySelector<HTMLInputElement>('input[value="wait"]')!;
  expect(wait().disabled).toBe(true);
  expect(container.textContent).toContain('Loading output contract');
  await act(async () => resolve([published(1, { type: 'string' })]));
  expect(wait().disabled).toBe(false);
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1].outputSchema).toEqual({
    type: 'string',
  });
});

it('starts with Any for an unpublished target and does not fetch versions', async () => {
  const { onApply } = await render('detached', undefined, undefined, {}, null);
  expect(container.textContent).toContain('No published version is selected');
  await choose('wait');
  await apply();
  expect(versions).not.toHaveBeenCalled();
  expect(onApply.mock.calls[0][0].definition.nodes[1].outputSchema).toEqual({});
});

it('explains a missing pinned version without substituting another contract', async () => {
  versions.mockResolvedValue([published(2, { type: 'number' })]);
  const { onApply } = await render('detached');
  expect(container.textContent).toContain('Pinned version 1 is unavailable');
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1].outputSchema).toEqual({});
});

it('keeps detached mode on a failed read and allows retrying the pinned contract', async () => {
  versions.mockRejectedValueOnce(new Error('Offline'));
  const { onApply } = await render('detached');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Offline',
  );
  expect(
    container.querySelector<HTMLInputElement>('input[value="wait"]')!.disabled,
  ).toBe(true);
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry output contract')!
      .click(),
  );
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1].outputSchema).toEqual({
    type: 'string',
  });
});

it('allows switching to Any after clearing a pin whose contract could not be loaded', async () => {
  versions.mockRejectedValueOnce(new Error('Offline'));
  const { onApply } = await render('detached');
  await pin('');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(
    container.querySelector<HTMLInputElement>('input[value="wait"]')!.disabled,
  ).toBe(false);
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1]).toMatchObject({
    version: null,
    outputSchema: {},
  });
});

it('loads the newly selected pin instead of restoring a remembered contract for another version', async () => {
  const { onApply } = await render();
  await choose('detached');
  await pin('2');
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1]).toMatchObject({
    version: 2,
    outputSchema: { type: 'number' },
  });
});

it('ignores an old target read that finishes after the workflow reference changes', async () => {
  let resolve!: (value: WorkflowVersion[]) => void;
  versions.mockImplementation(({ id }) =>
    id === 'child'
      ? new Promise<WorkflowVersion[]>((done) => {
          resolve = done;
        })
      : Promise.resolve([published(2, { type: 'boolean' }, 'other-child')]),
  );
  const { onApply } = await render('detached');
  const label = Array.from(container.querySelectorAll('label')).find(
    (label) => label.textContent === 'Referenced workflow',
  )!;
  const select = document.getElementById(label.htmlFor) as HTMLSelectElement;
  await act(async () => {
    select.value = 'other-child';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => resolve([published(1, { type: 'string' })]));
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1]).toMatchObject({
    workflowId: 'other-child',
    version: 2,
    outputSchema: { type: 'boolean' },
  });
});

it('removes failure routing and its edge when switching to detached mode', async () => {
  const { onApply } = await render(undefined, undefined, 'route');
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Route on failure"]',
    )!.checked,
  ).toBe(true);
  await choose('detached');
  expect(
    container.querySelector('input[aria-label="Route on failure"]'),
  ).toBeNull();
  await apply();
  const d = onApply.mock.calls[0][0].definition;
  expect(d.nodes[1].onFailure).toBeUndefined();
  expect(d.edges.some((edge: any) => edge.port === 'failed')).toBe(false);
});

it('restores the waited failure route when toggling modes before Apply', async () => {
  const { onApply } = await render(undefined, undefined, 'route');
  await choose('detached');
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1].onFailure).toBe('route');
  expect(
    onApply.mock.calls[0][0].definition.edges.some(
      (edge: any) => edge.port === 'failed',
    ),
  ).toBe(true);
});

it('removes the failed edge when disabling Workflow failure routing', async () => {
  const { onApply } = await render(undefined, undefined, 'route');
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[aria-label="Route on failure"]')!
      .click(),
  );
  await apply();
  expect(
    onApply.mock.calls[0][0].definition.nodes[1].onFailure,
  ).toBeUndefined();
  expect(
    onApply.mock.calls[0][0].definition.edges.some(
      (edge: any) => edge.port === 'failed',
    ),
  ).toBe(false);
});

it('restores result branches and output fields when a detached toggle is reversed before Apply', async () => {
  const routing = {
    path: 'ready',
    cases: [{ port: 'yes', equals: true }],
    default: 'no',
  };
  const outputBindings = {
    summary: { source: 'literal' as const, value: 'done' },
  };
  const { onApply } = await render(undefined, undefined, undefined, {
    routing,
    outputBindings,
  });
  await choose('detached');
  await choose('wait');
  await apply();
  expect(onApply.mock.calls[0][0].definition.nodes[1]).toMatchObject({
    routing,
    outputBindings,
  });
});
