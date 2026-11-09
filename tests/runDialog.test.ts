// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DesignSystemProvider } from '../packages/ui/src/design-system';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  type Workflow,
  type WorkflowDefinition,
} from '@interlock/core';
import { RunDialog } from '../packages/ui/src/features/runs/RunDialog';

const calls = vi.hoisted(() => ({ versions: vi.fn(), start: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    workflows: { versions: { query: calls.versions } },
    runs: { start: { mutate: calls.start } },
  },
  errorMessage: (error: Error) => error.message,
}));
let root: Root, container: HTMLDivElement;
const started = vi.fn();
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
  calls.versions.mockReset();
  calls.start.mockReset().mockResolvedValue({ run: { id: 'new-run' } });
  started.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(...definitions: WorkflowDefinition[]) {
  calls.versions.mockResolvedValue(
    definitions.map((definition, i) => ({
      version: i + 1,
      definition,
    })),
  );
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(RunDialog, {
          workflow: {
            id: 'workflow',
            name: 'Example',
            latestVersion: definitions.length,
          } as Workflow,
          onClose: vi.fn(),
          onStarted: started,
        }),
      ),
    ),
  );
}
async function click(label: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((element) => element.textContent === label)!;
  await act(async () => button.click());
}
function agentDefinition(executor?: string, override?: string | null) {
  const definition = blankDefinition();
  definition.executor = executor;
  definition.nodes = [
    nodeSchema.parse({
      id: 'agent',
      kind: 'agent',
      prompt: 'Test assignment',
      label: 'Agent',
      executor: override,
    }),
  ];
  return definition;
}
const hasHint = () =>
  document.body.textContent!.includes('Connected Agent steps wait');
it.each([
  [undefined, undefined, true],
  ['managed', undefined, false],
  ['disabled-profile', undefined, false],
  [undefined, 'managed', false],
  ['managed', null, true],
  ['managed', 'other-managed', false],
] as const)(
  'shows connected guidance for workflow executor %s and node override %s: %s',
  async (executor, override, expected) => {
    await render(agentDefinition(executor, override));
    expect(hasHint()).toBe(expected);
    expect(document.body.textContent).not.toContain('does not launch an agent');
    // Executor configuration is optional context, never a prerequisite for starting.
    await click('Start run');
    expect(calls.start).toHaveBeenCalled();
    expect(started).toHaveBeenCalledWith('new-run');
  },
);
it.each(['node-model', 'workflow-model'] as const)(
  'omits uncertain connected guidance for %s selection unless explicitly opted out',
  async (selection) => {
    const definition = agentDefinition();
    const node = definition.nodes[0];
    if (node.kind !== 'agent') throw new Error('Expected Agent');
    if (selection === 'node-model') node.model = 'alias:builder';
    if (selection === 'workflow-model') definition.agentModel = 'alias:builder';
    await render(definition);
    expect(hasHint()).toBe(false);
    node.executor = null;
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(definition);
    expect(hasHint()).toBe(true);
  },
);
it('uses the selected published version for guidance and resets its input without changing the version policy', async () => {
  const connected = agentDefinition();
  connected.inputSchema = { type: 'string', examples: ['older'] };
  const managed = agentDefinition('managed');
  managed.inputSchema = { type: 'number', default: 7 };
  await render(connected, managed);
  expect(hasHint()).toBe(false);
  await act(async () => {
    const selectors = document.querySelectorAll('select');
    selectors[1].value = 'latest-compatible';
    selectors[1].dispatchEvent(new Event('change', { bubbles: true }));
    selectors[0].value = '1';
    selectors[0].dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(hasHint()).toBe(true);
  expect(document.querySelector('textarea')!.value).toBe('"older"');
  await click('Start run');
  expect(calls.start).toHaveBeenCalledWith(
    expect.objectContaining({
      version: 1,
      versionPolicy: 'latest-compatible',
      input: 'older',
    }),
  );
});
it('omits guidance for workflows without Agent steps, including managed defaults', async () => {
  const definition = blankDefinition();
  definition.executor = 'managed';
  definition.nodes = definition.nodes.filter((node) => node.kind !== 'agent');
  await render(definition);
  expect(hasHint()).toBe(false);
});
it('shows connected guidance for mixed managed and connected Agent steps', async () => {
  const definition = agentDefinition('managed');
  definition.nodes.push(
    nodeSchema.parse({
      id: 'connected',
      kind: 'agent',
      label: 'Connected',
      prompt: 'Test',
      executor: null,
    }),
  );
  await render(definition);
  expect(hasHint()).toBe(true);
});
it.each([
  [{ type: 'array', items: { type: 'string' } }, []],
  [{ type: 'array', items: { type: 'number' } }, []],
  [
    { type: 'object', properties: { score: { type: 'integer' } } },
    { score: 0 },
  ],
  [{ type: 'string' }, ''],
  [{ type: 'boolean' }, false],
  [{ type: 'null' }, null],
  [
    { type: 'array', default: ['default'], examples: [['example']] },
    ['default'],
  ],
  [{ type: 'array', enum: [['choice']], examples: [['example']] }, ['choice']],
  [{ type: 'array', examples: [[1, 2]] }, [1, 2]],
  [{ type: 'boolean', default: false, examples: [true] }, false],
  [{ type: 'number', default: 0, examples: [10] }, 0],
  [{ type: ['null', 'string'], default: null, examples: ['example'] }, null],
  [{ type: 'boolean', examples: [false] }, false],
  [{ type: 'number', examples: [0] }, 0],
  [{ type: ['null', 'string'], examples: [null] }, null],
] as const)(
  'generates candidates from its schema %j',
  async (schema, expected) => {
    const definition = blankDefinition();
    definition.inputSchema = {
      type: 'object',
      properties: { candidates: schema },
    };
    await render(definition);
    await click('Edit as JSON');
    expect(JSON.parse(document.querySelector('textarea')!.value)).toEqual({
      candidates: expected,
    });
    await click('Start run');
    expect(calls.start).toHaveBeenCalledWith(
      expect.objectContaining({ input: { candidates: expected } }),
    );
  },
);
it('honors examples on the complete input', async () => {
  const definition = blankDefinition();
  definition.inputSchema = {
    type: 'object',
    examples: [{ title: 'Supplied example' }],
    properties: { title: { type: 'string' } },
  };
  await render(definition);
  await click('Start run');
  expect(calls.start).toHaveBeenCalledWith(
    expect.objectContaining({ input: { title: 'Supplied example' } }),
  );
});
