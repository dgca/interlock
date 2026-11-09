// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import {
  definitionSchema,
  nodeSchema,
  validateDefinition,
  MAX_ACTIVE_CLOCK_MS,
  type WorkflowDefinition,
} from '@interlock/core';
import { SettingsDialog } from '../packages/ui/src/features/workflows/SettingsDialog';

vi.mock('../packages/ui/src/components/Modal/Modal', () => ({
  Modal: ({ children }: any) => h('div', {}, children),
}));
let root: Root, container: HTMLDivElement;
const scrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (scrollIntoView) HTMLElement.prototype.scrollIntoView = scrollIntoView;
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
});

async function render(
  config: Record<string, unknown>,
  graph?: WorkflowDefinition,
  onDelete?: () => void,
) {
  const node = nodeSchema.parse({ id: 'step', label: 'Step', ...config });
  const definition =
    graph ??
    definitionSchema.parse({
      nodes: [node, { id: 'exit', kind: 'exit', label: 'Exit' }],
      edges: [],
    });
  const onApply = vi.fn();
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(SettingsDialog, {
          name: 'Test',
          description: '',
          definition,
          node,
          workflows: [],
          onApply,
          onClose,
          onDelete,
        }),
      ),
    ),
  );
  return { node, onApply, onClose };
}
function field(label: string) {
  return Array.from(
    container.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('input,select,textarea'),
  ).find(
    (el) =>
      el.getAttribute('aria-label') === label ||
      container
        .querySelector(`label[for="${el.id}"]`)
        ?.textContent?.replace(/\s*\*$/, '') === label,
  )!;
}
async function fill(label: string, value: string) {
  const el = field(label);
  await act(async () => el.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function select(label: string, value: string) {
  await act(async () => {
    field(label).value = value;
    field(label).dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function chooseType(label: string, value: string) {
  if (!field(label)) await click('Show value types');
  const input = field(label) as HTMLInputElement;
  await act(async () => input.click());
  await act(async () =>
    document
      .getElementById(input.getAttribute('aria-controls')!)!
      .querySelector<HTMLElement>(`[role="option"][value="${value}"]`)!
      .click(),
  );
}
async function click(text: string) {
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === text)!
      .click(),
  );
}

it.each(['current', 'fresh'])(
  'saves and clears an advisory tier with %s context',
  async (mode) => {
    const { onApply } = await render({
      kind: 'agent',
      prompt: 'Work',
      context: {
        mode,
        continuityGroup: mode === 'current' ? 'author' : undefined,
      },
    });
    expect(field('Model tier').value).toBe('');
    await select('Model tier', 'fast');
    await click('Apply changes');
    const node = onApply.mock.calls[0][0].definition.nodes[0];
    expect(node.context).toMatchObject({ mode, tier: 'fast' });
    const reopened = await render(node);
    expect(field('Model tier').value).toBe('fast');
    await select('Model tier', '');
    await click('Apply changes');
    expect(
      reopened.onApply.mock.calls[0][0].definition.nodes[0].context,
    ).not.toHaveProperty('tier');
  },
);

it.each(['script', 'fetch'])(
  'removes only the disabled %s Failed route when applying settings',
  async (kind) => {
    const config =
      kind === 'script'
        ? { kind, command: 'exit 1' }
        : { kind, url: 'https://example.com' };
    const node = nodeSchema.parse({
      id: 'step',
      label: 'Step',
      ...config,
      onFailure: 'route',
    });
    const graph = definitionSchema.parse({
      nodes: [node, { id: 'exit', kind: 'exit', label: 'Exit' }],
      edges: [
        { id: 'normal', source: 'step', target: 'exit', port: 'default' },
        { id: 'failed', source: 'step', target: 'exit', port: 'failed' },
      ],
    });
    const { onApply } = await render({ ...config, onFailure: 'route' }, graph);
    expect((field('Route on failure') as HTMLInputElement).checked).toBe(true);
    await act(async () => field('Route on failure').click());
    await click('Apply changes');
    const result = onApply.mock.calls[0][0].definition;
    expect(result.nodes[0].onFailure).toBeUndefined();
    expect(result.edges.map((e: any) => e.id)).toEqual(['normal']);
  },
);
it.each(
  ['42', 42, false, null, { approved: true }, [1, 'a']].map((equals) => ({
    equals,
  })),
)(
  'preserves the Condition comparison $equals when applied without edits',
  async ({ equals }) => {
    const { node, onApply } = await render({
      kind: 'condition',
      path: 'status',
      equals,
    });
    await click('Apply changes');
    expect(onApply.mock.calls[0][0].definition.nodes[0]).toEqual(node);
  },
);
it('keeps text distinct from numbers and blocks invalid Condition JSON', async () => {
  const { onApply } = await render({ kind: 'condition', path: '', equals: '' });
  await fill('Case 1 match value', '42');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].equals).toBe('42');
  onApply.mockClear();
  await chooseType('Case 1 match value type', 'json');
  await fill('Case 1 match value, as JSON', '{');
  await click('Apply changes');
  expect(onApply).not.toHaveBeenCalled();
  await fill('Case 1 match value, as JSON', '42');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].equals).toBe(42);
});
it('suggests text and unknown fields for Wait while allowing another path', async () => {
  const { onApply } = await render({
    kind: 'wait',
    timing: { kind: 'until', path: '' },
    inputSchema: {
      type: 'object',
      properties: {
        dueAt: { type: 'string' },
        count: { type: 'integer' },
        details: {
          type: 'object',
          properties: { deadline: { type: 'string' } },
        },
        unknown: {},
      },
    },
  });
  await act(async () => field('Timestamp input path').focus());
  const suggestions = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).map((option) => option.textContent);
  expect(suggestions).toContain('dueAt');
  expect(suggestions).toContain('details.deadline');
  expect(suggestions).toContain('unknown');
  expect(suggestions).not.toContain('count');
  expect(suggestions).not.toContain('details');
  await fill('Timestamp input path', 'customDeadline');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].timing.path).toBe(
    'customDeadline',
  );
});
it.each([
  ['script', '3601'],
  ['fetch', '121'],
])(
  'edits %s timeouts in seconds and enforces its bounds',
  async (kind, aboveMaximum) => {
    const { onApply } = await render({
      kind,
      command: 'cat',
      url: 'https://example.com',
      timeoutMs: 30_000,
    });
    expect(field('Timeout').value).toBe('30');
    expect(field('Timeout unit').value).toBe('1000');
    await fill('Timeout', aboveMaximum);
    await click('Apply changes');
    expect(onApply).not.toHaveBeenCalled();
    await fill('Timeout', '0.05');
    await click('Apply changes');
    expect(onApply).not.toHaveBeenCalled();
    await fill('Timeout', '1.5');
    await click('Apply changes');
    expect(onApply.mock.calls[0][0].definition.nodes[0].timeoutMs).toBe(1500);
  },
);
it('keeps one delete action in the shared node settings footer', async () => {
  const onDelete = vi.fn();
  await render({ kind: 'agent', prompt: 'Do work' }, undefined, onDelete);
  const deleteButtons = () =>
    Array.from(container.querySelectorAll('button')).filter(
      (button) => button.textContent === 'Delete node',
    );
  const [deleteButton] = deleteButtons();
  expect(deleteButton?.closest('footer')).toBeTruthy();
  expect(deleteButtons()).toEqual([deleteButton]);
  for (const section of ['Input', 'Result', 'Execution']) {
    await click(section);
    expect(deleteButtons()).toEqual([deleteButton]);
    expect(deleteButton.closest('[hidden]')).toBeNull();
  }
  await click('Delete node');
  expect(onDelete).toHaveBeenCalledOnce();
});

it('defaults Script timeouts to one minute and accepts one hour', async () => {
  const { onApply } = await render({ kind: 'script', command: 'cat' });
  expect(field('Timeout').value).toBe('1');
  expect(field('Timeout unit').value).toBe('60000');
  await select('Timeout unit', '3600000');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].timeoutMs).toBe(
    3_600_000,
  );
});
it('preserves legacy Bash and exact millisecond durations', async () => {
  const { node, onApply } = await render({
    kind: 'script',
    command: 'cat',
    timeoutMs: 1501,
  });
  expect(field('Timeout').value).toBe('1501');
  expect(field('Timeout unit').value).toBe('1');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0]).toEqual(node);
  expect(onApply.mock.calls[0][0].definition.nodes[0].language).toBeUndefined();
});
it('keeps capability arrays intact, adds tags with Enter and accepts unfinished text on blur', async () => {
  const { onApply } = await render({
    kind: 'agent',
    prompt: 'Do work',
    context: { tools: ['Read', 'read'], skills: ['review'] },
  });
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].context.tools).toEqual([
    'Read',
    'read',
  ]);
  await fill('Required tools', 'search');
  await act(async () =>
    field('Required tools').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ),
  );
  await act(async () => field('Required skills').focus());
  await fill('Required skills', ' testing ');
  await act(async () => field('Required skills').blur());
  await click('Apply changes');
  const context = onApply.mock.lastCall![0].definition.nodes[0].context;
  expect(context.tools).toEqual(['Read', 'read', 'search']);
  expect(context.skills).toEqual(['review', 'testing']);
});
it('discards edited comparisons on Cancel', async () => {
  const { onApply, onClose, node } = await render({
    kind: 'condition',
    path: '',
    equals: 'before',
  });
  await fill('Case 1 match value', 'after');
  await click('Cancel');
  expect(onClose).toHaveBeenCalledOnce();
  expect(onApply).not.toHaveBeenCalled();
  expect(node).toHaveProperty('equals', 'before');
});

it.each(['Required tools', 'Required skills'])(
  'keeps spaces while typing %s and uses commas to add tags',
  async (label) => {
    const { onApply } = await render({ kind: 'agent', prompt: 'Work' });
    await fill(label, 'web ');
    expect(field(label).value).toBe('web ');
    await fill(label, 'web search');
    await act(async () =>
      field(label).dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ',',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(field(label).value).toBe('');
    await fill(label, 'read');
    await act(async () => field(label).blur());
    await click('Apply changes');
    const key = label === 'Required tools' ? 'tools' : 'skills';
    expect(onApply.mock.lastCall![0].definition.nodes[0].context[key]).toEqual([
      'web search',
      'read',
    ]);
  },
);
it('switches a Wait to a polling check and applies its schedule, path, value and deadline', async () => {
  const { onApply } = await render({
    kind: 'wait',
    timing: { kind: 'duration', ms: 60_000 },
  });
  const resume = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).find((input) => input.value === 'poll')!;
  await act(async () => resume.click());
  const language = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).filter((input) => ['javascript', 'bash'].includes(input.value));
  expect(language.find((input) => input.checked)?.value).toBe('javascript');
  await fill('Check every', '2');
  expect(field('Check every unit').value).toBe('60000');
  await fill('Check output field', 'body.state');
  const deadline = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ).find((input) =>
    container
      .querySelector(`label[for="${input.id}"]`)
      ?.textContent?.includes('Give up after a deadline'),
  )!;
  await act(async () => deadline.click());
  await fill('Deadline', '1.5');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].timing).toMatchObject({
    kind: 'poll',
    everyMs: 120_000,
    timeoutMs: 90 * 60_000,
    check: { kind: 'script', language: 'javascript' },
    path: 'body.state',
    equals: true,
  });
});

it.each(['disable', 'duration', 'until'])(
  'removes the obsolete polling Timeout connection on Apply: %s',
  async (change) => {
    const config = {
      kind: 'wait',
      timing: {
        kind: 'poll',
        everyMs: 1000,
        timeoutMs: 1000,
        check: {
          kind: 'script',
          language: 'javascript',
          command: 'return false;',
        },
        path: '',
        equals: true,
      },
    };
    const graph = definitionSchema.parse({
      nodes: [
        { id: 'entry', kind: 'entry', label: 'Start' },
        { id: 'step', label: 'Step', ...config },
        { id: 'exit', kind: 'exit', label: 'End' },
      ],
      edges: [
        { id: 'in', source: 'entry', target: 'step' },
        { id: 'out', source: 'step', target: 'exit' },
        { id: 'late', source: 'step', port: 'timeout', target: 'exit' },
      ],
    });
    const { onApply } = await render(config, graph);
    if (change === 'disable')
      await act(async () =>
        container
          .querySelector<HTMLInputElement>('input[type=checkbox]')!
          .click(),
      );
    else
      await act(async () =>
        container
          .querySelector<HTMLInputElement>(`input[value="${change}"]`)!
          .click(),
      );
    await click('Apply changes');
    const saved = onApply.mock.lastCall![0].definition;
    expect(saved.edges.map((edge: any) => edge.id)).toEqual(['in', 'out']);
    expect(saved.nodes.some((node: any) => node.id === 'exit')).toBe(true);
    expect(() => validateDefinition(saved)).not.toThrow();
  },
);

it('preserves a valid subsecond polling deadline when settings are applied unchanged', async () => {
  const { node, onApply } = await render({
    kind: 'wait',
    timing: {
      kind: 'poll',
      everyMs: 1000,
      timeoutMs: 500,
      check: {
        kind: 'script',
        language: 'javascript',
        command: 'return true;',
      },
      path: '',
      equals: true,
    },
  });
  await click('Apply changes');
  expect(onApply).toHaveBeenCalled();
  expect(onApply.mock.lastCall![0].definition.nodes[0]).toEqual(node);
});

it('shows the fallback lease without adding it and applies a configured duration', async () => {
  const { onApply } = await render({ kind: 'agent', prompt: 'Work' });
  expect(field('Claim lease').value).toBe('5');
  expect(field('Claim lease unit').value).toBe('60000');
  expect(
    Array.from((field('Claim lease unit') as HTMLSelectElement).options).map(
      (o) => o.text,
    ),
  ).toEqual(['Seconds', 'Minutes', 'Hours']);
  await fill('Maximum attempts', '3');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0]).not.toHaveProperty(
    'leaseSeconds',
  );
  onApply.mockClear();
  await fill('Claim lease', '30');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0]).toMatchObject({
    leaseSeconds: 1800,
    maxAttempts: 3,
  });
});

it('preserves configured leases on reopen and rejects fractional or out-of-bound seconds', async () => {
  const { onApply } = await render({
    kind: 'agent',
    prompt: 'Work',
    leaseSeconds: 1800,
  });
  expect(field('Claim lease').value).toBe('30');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].leaseSeconds).toBe(1800);
  onApply.mockClear();
  await select('Claim lease unit', '1000');
  for (const value of ['9', '3601', '10.5']) {
    await fill('Claim lease', value);
    await click('Apply changes');
    expect(onApply).not.toHaveBeenCalled();
  }
  await fill('Claim lease', '10');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].leaseSeconds).toBe(10);
});

it('configures a separate expiry budget and rejects invalid counts', async () => {
  const { onApply } = await render({ kind: 'agent', prompt: 'Work' });
  await act(async () =>
    (field('Separate lease expiry budget') as HTMLInputElement).click(),
  );
  expect(field('Maximum lease expiries').value).toBe('3');
  expect(field('Maximum failures').value).toBe('2');
  for (const value of ['0', '11', '1.5']) {
    await fill('Maximum lease expiries', value);
    await click('Apply changes');
    expect(onApply).not.toHaveBeenCalled();
  }
  await fill('Maximum lease expiries', '4');
  await click('Apply changes');
  expect(onApply.mock.lastCall![0].definition.nodes[0]).toMatchObject({
    maxLeaseExpiries: 4,
    maxAttempts: 2,
  });
  await act(async () =>
    (field('Separate lease expiry budget') as HTMLInputElement).click(),
  );
  await click('Apply changes');
  expect(
    onApply.mock.lastCall![0].definition.nodes[0].maxLeaseExpiries,
  ).toBeUndefined();
  expect(field('Maximum attempts')).toBeDefined();
});

it('edits and clears an Agent continuity group without changing context mode', async () => {
  const { onApply } = await render({
    kind: 'agent',
    prompt: 'Implement',
    context: { mode: 'current' },
  });
  await fill('Continuity group', 'author');
  await click('Apply changes');
  expect(
    onApply.mock.calls[0][0].definition.nodes.find((n: any) => n.id === 'step')
      .context,
  ).toMatchObject({ mode: 'current', continuityGroup: 'author' });
  const next = await render({
    kind: 'agent',
    prompt: 'Implement',
    context: { mode: 'current', continuityGroup: 'author' },
  });
  await fill('Continuity group', '');
  await click('Apply changes');
  expect(
    next.onApply.mock.calls[0][0].definition.nodes.find(
      (n: any) => n.id === 'step',
    ).context.continuityGroup,
  ).toBeUndefined();
});

it('adds, edits, reopens and removes captured-input result checks', async () => {
  const { onApply } = await render({ kind: 'agent', prompt: 'Work' });
  await click('Add result check');
  await fill('Check ID', 'candidate');
  await fill('Output path', 'revision');
  await fill('Captured input path', 'candidate.revision');
  await click('Apply changes');
  const saved = onApply.mock.calls[0][0].definition.nodes[0];
  expect(saved.resultRules).toEqual([
    {
      id: 'candidate',
      kind: 'equalsInput',
      outputPath: 'revision',
      inputPath: 'candidate.revision',
    },
  ]);
  const reopened = await render(saved);
  expect(field('Captured input path').value).toBe('candidate.revision');
  await select('Check', 'exists');
  await click('Apply changes');
  expect(
    reopened.onApply.mock.calls[0][0].definition.nodes[0].resultRules,
  ).toEqual([{ id: 'candidate', kind: 'exists', outputPath: 'revision' }]);
  const again = await render(saved);
  await click('Remove check');
  await click('Apply changes');
  expect(
    again.onApply.mock.calls[0][0].definition.nodes[0].resultRules,
  ).toBeUndefined();
});

it('keeps Agent routing optional and prefers an enum result field when enabled', async () => {
  const { onApply } = await render({
    kind: 'agent',
    prompt: 'Review',
    outputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        verdict: { enum: ['approved', 'changes_requested'] },
      },
    },
  });
  await click('Result');
  expect((field('Branch on result') as HTMLInputElement).checked).toBe(false);
  await act(async () => field('Branch on result').click());
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0]).toMatchObject({
    kind: 'agent',
    routing: {
      path: 'verdict',
      cases: [{ port: 'match', equals: 'approved' }],
      default: 'otherwise',
    },
  });
});

it('preserves the configured Wait duration when returning from polling', async () => {
  const { onApply } = await render({
    kind: 'wait',
    timing: { kind: 'duration', ms: 1000 },
  });
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[value="poll"]')!.click(),
  );
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[value="duration"]')!
      .click(),
  );
  await click('Apply changes');
  expect(onApply).toHaveBeenCalledWith(
    expect.objectContaining({
      definition: expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            timing: { kind: 'duration', ms: 1000 },
          }),
        ]),
      }),
    }),
  );
});

const pollTiming = {
  kind: 'poll',
  everyMs: 1000,
  path: 'ready',
  equals: true,
  check: {
    kind: 'script',
    language: 'javascript',
    command: 'return { ready: true };',
  },
};
const resourceNodes = [
  { kind: 'agent', prompt: 'Work' },
  { kind: 'script', language: 'javascript', command: 'return input;' },
  { kind: 'fetch', url: 'https://example.test' },
  { kind: 'wait', timing: pollTiming },
];
const resourceBindings = [
  { source: 'literal', value: 'checkout:integration' },
  { source: 'runInput', path: 'browserResource' },
];

it.each([
  [{ kind: 'agent', prompt: 'Work' }, 'Task instructions', true],
  [{ kind: 'script', command: 'cat' }, 'Bash command', true],
  [{ kind: 'fetch', url: 'https://example.test' }, 'URL', true],
  [{ kind: 'wait', timing: pollTiming }, 'Check every', true],
  [{ kind: 'wait' }, 'Wait for', false],
  [{ kind: 'input' }, 'Stage', false],
] as const)(
  'keeps %j stall overrides after primary work and reachable',
  async (config, primaryLabel, execution) => {
    await render(config);
    const primary = field(primaryLabel);
    expect(primary).toBeTruthy();
    expect(primary.closest('[hidden]')).toBeNull();
    const toggle = field('Override stall detection') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(field('Run transition stall')).toBeUndefined();
    expect(
      primary.compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(!!toggle.closest('[hidden]')).toBe(execution);
    if (execution) await click('Execution');
    expect(toggle.closest('[hidden]')).toBeNull();
    await act(async () => toggle.click());
    expect(field('Run transition stall')).toBeTruthy();
  },
);

it('saves and reopens unit-based node stall thresholds without changing milliseconds', async () => {
  const { onApply } = await render({ kind: 'script', command: 'cat' });
  await click('Execution');
  await act(async () => field('Override stall detection').click());
  await select('Run transition stall', 'threshold');
  expect(field('Run transition threshold').value).toBe('5');
  expect(field('Run transition threshold unit').value).toBe('60000');
  await fill('Run transition threshold', '2.5');
  await select('Run transition threshold unit', '3600000');
  await click('Apply changes');
  const saved = onApply.mock.calls[0][0].definition.nodes[0];
  expect(saved.runStallMs).toBe(9_000_000);
  await act(async () => root.render(null));
  await render(saved);
  await click('Execution');
  expect((field('Override stall detection') as HTMLInputElement).checked).toBe(
    true,
  );
  expect(field('Run transition threshold').value).toBe('150');
  expect(field('Run transition threshold unit').value).toBe('60000');
});

it('enforces whole-millisecond stall bounds and preserves exact existing values', async () => {
  const { onApply } = await render({
    kind: 'script',
    command: 'cat',
    runStallMs: 1501,
  });
  await click('Execution');
  const threshold = field('Run transition threshold') as HTMLInputElement;
  expect(threshold.value).toBe('1501');
  expect(field('Run transition threshold unit').value).toBe('1');
  expect(threshold.min).toBe('1');
  expect(threshold.max).toBe(String(MAX_ACTIVE_CLOCK_MS));
  for (const invalid of ['0', '0.5', String(MAX_ACTIVE_CLOCK_MS + 1)]) {
    await fill('Run transition threshold', invalid);
    await click('Apply changes');
    expect(onApply).not.toHaveBeenCalled();
  }
  await fill('Run transition threshold', '1501');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].runStallMs).toBe(1501);
});

it.each([
  ['1000', '1.001', 1001],
  ['1000', '1001e-3', 1001],
  ['3600000', '0.00001', 36],
])(
  'saves fractional stall units %s × %s as exact milliseconds',
  async (unit, amount, ms) => {
    const { onApply } = await render({
      kind: 'script',
      command: 'cat',
      runStallMs: 1501,
    });
    await click('Execution');
    await select('Run transition threshold unit', String(unit));
    await fill('Run transition threshold', String(amount));
    await click('Apply changes');
    expect(onApply.mock.calls[0][0].definition.nodes[0].runStallMs).toBe(ms);
  },
);

it('rejects actual fractional milliseconds entered through larger units', async () => {
  const { onApply } = await render({
    kind: 'script',
    command: 'cat',
    runStallMs: 1501,
  });
  await click('Execution');
  await select('Run transition threshold unit', '1000');
  for (const invalid of ['0.0015', '1.001e-3', '1e-101']) {
    await fill('Run transition threshold', invalid);
    await click('Apply changes');
    expect(onApply).not.toHaveBeenCalled();
  }
});

it.each(['script', 'fetch'])(
  'preserves exact fractional seconds in existing %s timeouts',
  async (kind) => {
    const { onApply } = await render({
      kind,
      command: 'cat',
      url: 'https://example.test',
      timeoutMs: 30_000,
    });
    await fill('Timeout', '1.001');
    await click('Apply changes');
    expect(onApply.mock.calls[0][0].definition.nodes[0].timeoutMs).toBe(1001);
  },
);

it('accepts exact fractional-unit Wait durations without rounding actual fractions to zero', async () => {
  const { onApply } = await render({
    kind: 'wait',
    timing: { kind: 'duration', ms: 1000 },
  });
  await fill('Wait for', '1.001');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].timing.ms).toBe(1001);
  onApply.mockClear();
  for (const invalid of ['0.0005', '1e-101']) {
    await fill('Wait for', invalid);
    await click('Apply changes');
    expect(onApply).not.toHaveBeenCalled();
  }
  await fill('Wait for', '0');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].timing.ms).toBe(0);
});

it('opens disabled and recovery overrides, preserves them, and returns to inheritance when switched off', async () => {
  const policy = {
    unclaimedStallMs: null,
    claimedIdleStallMs: 60_000,
    runStallMs: null,
    idleRecovery: { maxRecoveries: 2, message: 'Continue carefully.' },
  };
  const { onApply } = await render({
    kind: 'agent',
    prompt: 'Work',
    ...policy,
  });
  await click('Execution');
  expect((field('Override stall detection') as HTMLInputElement).checked).toBe(
    true,
  );
  expect(field('Unclaimed stall').value).toBe('disabled');
  expect(field('Run transition stall').value).toBe('disabled');
  expect(field('Claimed idle threshold').value).toBe('1');
  expect(field('Idle nudge message').value).toBe(policy.idleRecovery.message);
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0]).toMatchObject(policy);
  onApply.mockClear();
  await act(async () => field('Override stall detection').click());
  expect(field('Unclaimed stall')).toBeUndefined();
  await click('Apply changes');
  const saved = onApply.mock.calls[0][0].definition.nodes[0];
  for (const key of Object.keys(policy)) expect(saved[key]).toBeUndefined();
});

it('edits shared workflow stall durations while preserving every threshold', async () => {
  const definition = definitionSchema.parse({
    nodes: [
      { id: 'entry', kind: 'entry', label: 'Entry' },
      { id: 'exit', kind: 'exit', label: 'Exit' },
    ],
    edges: [],
    unclaimedStallMs: 300_000,
    claimedIdleStallMs: 3_600_000,
    humanWaitStallMs: null,
    runStallMs: 1501,
  });
  const onApply = vi.fn();
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(SettingsDialog, {
          name: 'Workflow',
          description: '',
          definition,
          workflows: [],
          onApply,
          onClose: vi.fn(),
        }),
      ),
    ),
  );
  expect(field('Unclaimed threshold').value).toBe('5');
  expect(field('Claimed idle threshold unit').value).toBe('3600000');
  expect(field('External input stall').value).toBe('disabled');
  expect(field('Run transition threshold').value).toBe('1501');
  await fill('Unclaimed threshold', '7');
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition).toMatchObject({
    unclaimedStallMs: 420_000,
    claimedIdleStallMs: 3_600_000,
    humanWaitStallMs: null,
    runStallMs: 1501,
  });
});

it.each(resourceNodes)(
  'edits, saves and reopens shared resource bindings on $kind steps',
  async (config) => {
    const { onApply } = await render(config);
    await click('Execution');
    expect(field('Exclusive resources')).toBeTruthy();
    const disclosure = field('Resource bindings').closest('details')!;
    await act(async () => disclosure.querySelector('summary')!.click());
    await fill('Resource bindings', JSON.stringify(resourceBindings));
    await click('Apply changes');
    const saved = onApply.mock.calls[0][0].definition.nodes[0];
    expect(saved.resources).toEqual(resourceBindings);
    const raw = nodeSchema.parse(JSON.parse(JSON.stringify(saved)));
    const reopened = await render(raw);
    await click('Execution');
    expect(JSON.parse(field('Resource bindings').value)).toEqual(
      resourceBindings,
    );
    await click(
      config.kind === 'agent'
        ? 'Assignment'
        : config.kind === 'script'
          ? 'Code'
          : config.kind === 'fetch'
            ? 'Request'
            : 'Wait',
    );
    await fill('Name', 'Edited step');
    await click('Apply changes');
    expect(reopened.onApply.mock.calls[0][0].definition.nodes[0]).toMatchObject(
      { label: 'Edited step', resources: resourceBindings },
    );
  },
);

it('rejects resource JSON above the shared eight-binding limit and accepts correction', async () => {
  const { onApply } = await render({
    kind: 'script',
    language: 'javascript',
    command: 'return input;',
  });
  await click('Execution');
  await act(async () =>
    field('Resource bindings')
      .closest('details')!
      .querySelector('summary')!
      .click(),
  );
  const bindings = Array.from({ length: 9 }, (_, i) => ({
    source: 'literal',
    value: `resource-${i}`,
  }));
  await fill('Resource bindings', JSON.stringify(bindings));
  await click('Apply changes');
  expect(onApply).not.toHaveBeenCalled();
  expect(field('Resource bindings').validationMessage).toContain('eight');
  await fill('Resource bindings', JSON.stringify(bindings.slice(0, 8)));
  await click('Apply changes');
  expect(onApply.mock.calls[0][0].definition.nodes[0].resources).toHaveLength(
    8,
  );
});

it('keeps polling resources while toggling modes and omits them when saving a timer', async () => {
  const { onApply } = await render({
    kind: 'wait',
    timing: pollTiming,
    resources: resourceBindings,
  });
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[value="duration"]')!
      .click(),
  );
  expect(field('Exclusive resources')).toBeUndefined();
  expect(
    [...container.querySelectorAll('nav button')].some(
      (button) => button.textContent === 'Execution',
    ),
  ).toBe(false);
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[value="poll"]')!.click(),
  );
  await click('Execution');
  expect(JSON.parse(field('Resource bindings').value)).toEqual(
    resourceBindings,
  );
  await click('Wait');
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[value="until"]')!.click(),
  );
  await fill('Timestamp input path', 'resumeAt');
  await click('Apply changes');
  const saved = onApply.mock.calls[0][0].definition.nodes[0];
  expect(saved.resources).toBeUndefined();
  expect(saved.timing.kind).toBe('until');
});
it('isolates invalid resource drafts when changing node type', async () => {
  const onApply = vi.fn();
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(SettingsDialog, {
          creating: true,
          name: 'Test',
          description: '',
          definition: definitionSchema.parse({
            nodes: [
              { id: 'entry', kind: 'entry', label: 'Entry' },
              { id: 'exit', kind: 'exit', label: 'Exit' },
            ],
            edges: [],
          }),
          workflows: [],
          onApply,
          onClose: vi.fn(),
        }),
      ),
    ),
  );
  await select('Node type', 'script');
  await click('Execution');
  await act(async () =>
    field('Resource bindings')
      .closest('details')!
      .querySelector('summary')!
      .click(),
  );
  await fill('Resource bindings', '{broken');
  expect(field('Resource bindings').validationMessage).toBeTruthy();
  await select('Node type', 'fetch');
  await click('Execution');
  expect(field('Resource bindings').value).toBe('[]');
  expect(field('Resource bindings').validationMessage).toBe('');
});
