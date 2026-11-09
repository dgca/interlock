// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DesignSystemProvider } from '../packages/ui/src/design-system';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { batchDefinition } from './fixtures/batch';
import { blankDefinition, nodeSchema } from '@interlock/core';
import { workflowCall } from './fixtures/detached';
import { AgentHandoff } from '../packages/ui/src/features/runs/AgentHandoff';
import { RunInspector } from '../packages/ui/src/features/runs/RunInspector';
const graph = vi.hoisted(() => ({ props: undefined as any }));
const rpc = vi.hoisted(() => ({
  get: vi.fn(),
  work: vi.fn(),
  preview: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    runs: {
      get: { query: rpc.get },
      previewCancellation: { query: rpc.preview },
      cancelTree: { mutate: rpc.cancel },
    },
    work: { list: { query: rpc.work } },
  },
  errorMessage: (e: Error) => e.message,
  download: vi.fn(),
}));
vi.mock('../packages/ui/src/features/runs/RunGraph', () => ({
  RunGraph: (props: any) => {
    graph.props = props;
    return null;
  },
}));
vi.mock('../packages/ui/src/features/runs/WorkPanel', () => ({
  WorkPanel: () => null,
}));
vi.mock('../packages/ui/src/features/runs/RunUsage', () => ({
  RunUsage: () => null,
}));
vi.mock('../packages/ui/src/design-system/JsonEditor/JsonEditor', () => ({
  JsonEditor: ({ label, value }: any) =>
    h('pre', { 'data-json-label': label }, JSON.stringify(value)),
}));
let container: HTMLDivElement, root: Root, detail: any;
const onOpen = vi.fn();
const onConnect = vi.fn(),
  writeText = vi.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  writeText.mockReset().mockResolvedValue(undefined);
  onConnect.mockReset();
  onOpen.mockReset();
  rpc.preview.mockReset().mockResolvedValue({ total: 1 });
  rpc.cancel.mockReset();
  detail = {
    run: {
      id: 'root-run',
      workflowName: 'Demo',
      version: 1,
      status: 'waiting',
      executions: [],
      input: [],
    },
    definition: blankDefinition(),
    work: [],
    events: [],
    children: [],
  };
  rpc.get.mockReset().mockImplementation(async () => detail);
  rpc.work
    .mockReset()
    .mockResolvedValue([{ id: 'child-assignment', runId: 'child-run' }]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(tick = 0, id = 'root-run') {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(RunInspector, {
          id,
          tick,
          onBack: vi.fn(),
          onOpen,
          onConnect,
          act: vi.fn(),
        }),
      ),
    ),
  );
}
async function click(name: string) {
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === name)!
      .click(),
  );
}
it('keeps missing-definition history selectable and omits graph and retry', async () => {
  detail.definition = null;
  detail.definitionAvailable = false;
  detail.run.status = 'failed';
  detail.run.executions = [
    {
      id: 'saved-execution',
      nodeId: 'old-node',
      label: 'Recorded step',
      kind: 'agent',
      status: 'completed',
      input: { saved: 'input' },
      output: { saved: 'output' },
      childRunIds: [],
      startedAt: new Date().toISOString(),
    },
  ];
  detail.events = [
    {
      id: 'event',
      message: 'Recorded history event',
      at: new Date().toISOString(),
    },
  ];
  graph.props = undefined;
  rpc.work.mockResolvedValue([]);
  await render();
  expect(graph.props).toBeUndefined();
  expect(container.textContent).toContain(
    'Graph inspection and retry are unavailable',
  );
  expect(container.textContent).not.toContain('Retry failed step');
  const timeline = container.querySelector(
    'button[class*="step"]',
  ) as HTMLButtonElement;
  await act(async () => timeline.click());
  expect(container.querySelector('aside h2')?.textContent).toBe(
    'Recorded step',
  );
  expect(
    container.querySelector('[data-json-label="Input"]')?.textContent,
  ).toContain('saved');
  expect(
    container.querySelector('[data-json-label="Output"]')?.textContent,
  ).toContain('output');
  expect(container.textContent).toContain('Recorded history event');
});
it('shows descendant assignments at the root and copies instructions to continue that existing run', async () => {
  await render();
  expect(rpc.work).toHaveBeenCalledWith({ runId: 'root-run' });
  expect(container.textContent).toContain('Waiting for an agent');
  await click('Copy instructions for agent');
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining(
      'Continue existing Interlock run root-run. Do not start a new run.',
    ),
  );
  expect(writeText.mock.calls[0][0]).toContain('including child runs');
  expect(writeText.mock.calls[0][0]).toContain('resume continuity.session');
  expect(writeText.mock.calls[0][0]).toContain('handoff_context_group');
  for (const tool of [
    'get_run_briefing',
    'get_run_result',
    'wait_for_run_change',
  ])
    expect(writeText.mock.calls[0][0]).toContain(tool);
  expect(writeText.mock.calls[0][0]).toContain('get_run for full inspection');
  expect(container.textContent).toContain('Instructions copied');
  await click('Connect an agent');
  expect(onConnect).toHaveBeenCalledOnce();
});
it('shows a clipboard error and permits retry', async () => {
  writeText.mockRejectedValueOnce(new Error('Clipboard access denied'));
  await render();
  await click('Copy instructions for agent');
  expect(container.textContent).toContain('Clipboard access denied');
  await click('Copy instructions for agent');
  expect(container.textContent).not.toContain('Clipboard access denied');
  expect(container.textContent).toContain('Instructions copied');
});
it('removes the prompt after available assignments are claimed and hides it for finished runs', async () => {
  await render();
  rpc.work.mockResolvedValue([]);
  await render(1);
  expect(container.textContent).not.toContain('Waiting for an agent');
  rpc.work.mockResolvedValue([{ id: 'stale-assignment' }]);
  detail.run.status = 'completed';
  await render(2);
  expect(container.textContent).not.toContain('Waiting for an agent');
});
it('does not mistake a waiting script or child workflow for an available agent assignment', async () => {
  rpc.work.mockResolvedValue([]);
  await render();
  expect(container.textContent).not.toContain('Waiting for an agent');
  expect(container.textContent).not.toContain('Copy instructions for agent');
});

it('keeps a chosen Batch item selected across live updates without substituting other item output', async () => {
  const store = new Store(':memory:');
  try {
    const engine = new Engine(store, process.cwd());
    const w = engine.create('Batch', '', batchDefinition());
    engine.publish(w.id);
    const run = engine.start(w.id, ['first', 'second']).run;
    detail = engine.inspect(run.id);
    // The component's requested ID stays stable in this test harness.
    detail.run = { ...detail.run, id: 'root-run' };
    rpc.work.mockResolvedValue([]);
    await render();
    await act(async () => graph.props.onSelect('work'));
    expect(container.querySelector('[data-json-label="Input"]')).toBeNull();
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.startsWith('Item 1'))!
        .click(),
    );
    expect(
      container.querySelector('[data-json-label="Input"]')?.textContent,
    ).toBe('"first"');
    const work = engine.available(run.id)[1];
    const claim = engine.claim(work.id, {
      workerId: 'test',
      freshContext: false,
      tools: [],
      skills: [],
    });
    engine.submit(work.id, claim.token!, 'second result');
    detail = engine.inspect(run.id);
    detail.run = { ...detail.run, id: 'root-run' };
    await render(1);
    expect(graph.props.selected).toBe('work');
    expect(
      container.querySelector('[data-json-label="Input"]')?.textContent,
    ).toBe('"first"');
    expect(container.querySelector('[data-json-label="Output"]')).toBeNull();
  } finally {
    store.close();
  }
});

it('shows active detached work after parent completion without a parent handoff or waiting state', async () => {
  const store = new Store(':memory:');
  try {
    const engine = new Engine(store, process.cwd());
    const child = engine.create('Independent investigation');
    engine.publish(child.id);
    const parent = engine.create(
      'Supervisor',
      '',
      workflowCall(child.id, 'detached'),
    );
    engine.publish(parent.id);
    const result = engine.start(parent.id, null);
    detail = result;
    detail.run = { ...detail.run, id: 'root-run' };
    detail.children = detail.children.map((child: any) => ({
      ...child,
      parentRunId: 'root-run',
    }));
    detail.descendants = detail.children;
    rpc.work.mockResolvedValue(engine.available(result.run.id));
    await render();
    expect(container.textContent).toContain(
      'These independent runs are still active.',
    );
    expect(container.textContent).not.toContain('Waiting for an agent');
    expect(container.textContent).toContain('Started independently');
    expect(graph.props.progress.agent.state).toBe('completed');
    await act(async () => graph.props.onSelect('agent'));
    expect(container.textContent).toContain('Started run');
    expect(
      container.querySelector('[data-json-label="Output"]')?.textContent,
    ).toContain(result.children[0].id);
    detail.run.status = 'waiting';
    await render(1);
    expect(container.textContent).toContain(
      'will keep running if you cancel this run',
    );
  } finally {
    store.close();
  }
});

it('shows comparison context and navigates to the counterpart without changing normal run actions', async () => {
  detail.run.comparison = {
    comparisonId: '12345678-first',
    suiteId: 'suite',
    suiteName: 'Evidence checks',
    suiteRevision: 1,
    sampleId: 'sample',
    caseId: 'case',
    caseName: 'Uncertain request',
    side: 'baseline',
    repetition: 2,
  };
  detail.counterpartRunId = 'candidate-run';
  await render();
  expect(container.textContent).toContain('Evidence checks');
  expect(container.textContent).toContain('Comparison 12345678');
  expect(container.textContent).toContain('Uncertain request');
  expect(container.textContent).toContain('Baseline');
  expect(container.textContent).toContain('Repeat 2');
  await click('Candidate run');
  expect(onOpen).toHaveBeenCalledWith('candidate-run');
  detail.run.comparison.comparisonId = '87654321-second';
  await render(1);
  expect(container.textContent).toContain('Comparison 87654321');
  expect(container.textContent).not.toContain('Comparison 12345678');
  delete detail.run.comparison;
  delete detail.counterpartRunId;
  await render(2);
  expect(container.textContent).not.toContain('Evidence checks');
  expect(container.textContent).not.toContain('Candidate run');
});

it('keeps the copy handoff while omitting disabled connection controls and guidance', async () => {
  await act(async () =>
    root.render(
      h(DesignSystemProvider, {}, h(AgentHandoff, { runId: 'embedded-run' })),
    ),
  );
  expect(container.textContent).not.toContain('Connect an agent');
  expect(container.textContent).not.toContain('Connecting an agent');
  await click('Copy instructions for agent');
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining('Continue existing Interlock run embedded-run.'),
  );
  expect(onConnect).not.toHaveBeenCalled();
});

it('does not ask a connected agent to take over queued managed assignments', async () => {
  rpc.work.mockResolvedValue([
    { id: 'managed-work', runId: 'root-run', executor: 'codex' },
  ]);
  await render();
  expect(container.textContent).not.toContain('Copy instructions for agent');
});
it('lets a user return to a pending managed request after inspecting another step', async () => {
  const store = new Store(':memory:');
  try {
    const engine = new Engine(store, process.cwd());
    const workflow = engine.create('Review', '', blankDefinition());
    engine.publish(workflow.id);
    const run = engine.start(workflow.id, {}).run;
    detail = engine.inspect(run.id);
    detail.run.id = 'root-run';
    const assignment = detail.descendantWork[0];
    assignment.runId = 'root-run';
    assignment.managedExecution = {
      profileId: 'codex',
      state: 'needs_human',
      pendingRequests: 1,
    };
    rpc.work.mockResolvedValue([]);
    await render();
    const entryButton = container.querySelector(
      'button[class*="step"]',
    ) as HTMLButtonElement;
    await act(async () => entryButton.click());
    expect(container.querySelector('aside h2')?.textContent).toBe(
      'Workflow input',
    );
    await click('Review request');
    expect(container.querySelector('aside h2')?.textContent).toBe(
      assignment.label,
    );
    expect(document.activeElement).toBe(container.querySelector('aside'));
    engine.stop();
  } finally {
    store.close();
  }
});
it('opens an invoked workflow for its own pending request instead of selecting a same-named parent node', async () => {
  const store = new Store(':memory:');
  try {
    const engine = new Engine(store, process.cwd());
    const child = engine.create('Child review', '', blankDefinition());
    engine.publish(child.id);
    const parent = engine.create('Parent', '', workflowCall(child.id));
    engine.publish(parent.id);
    const run = engine.start(parent.id, {}).run;
    detail = engine.inspect(run.id);
    const originalId = detail.run.id;
    detail.run.id = 'root-run';
    for (const childRun of detail.descendants)
      if (childRun.parentRunId === originalId)
        childRun.parentRunId = 'root-run';
    const assignment = detail.descendantWork[0];
    assignment.managedExecution = {
      profileId: 'codex',
      state: 'needs_human',
      pendingRequests: 1,
    };
    rpc.work.mockResolvedValue([]);
    await render();
    await click('Review request');
    expect(onOpen).toHaveBeenCalledWith(
      assignment.runId,
      assignment.executionId,
    );
    engine.stop();
  } finally {
    store.close();
  }
});

function chainWithIndependentSuccessorWork(engine: Engine) {
  const publish = (d = blankDefinition()) => {
    const w = engine.create('Continuation scope', '', d);
    engine.publish(w.id);
    return w.id;
  };
  const finish = (id: string) => {
    const work = engine.available(id).find((w) => w.runId === id)!;
    const claimed = engine.claim(work.id, {
      workerId: 'regression',
      freshContext: false,
      tools: [],
      skills: [],
    });
    engine.submit(claimed.id, claimed.token!, null);
  };
  const leaf = publish();
  const d = workflowCall(leaf, 'detached', true);
  d.nodes[d.nodes.length - 1] = nodeSchema.parse({
    ...d.nodes.at(-1)!,
    continueAsNew: { maxRuns: 2 },
  });
  const first = engine.start(publish(d), null).run;
  finish(engine.store.runs().find((r) => r.parentRunId === first.id)!.id);
  finish(first.id);
  engine.pump();
  const successor = engine.run(first.id).chain!.nextRunId!;
  finish(successor);
  engine.pump();
  const child = engine.store.runs().find((r) => r.parentRunId === successor)!;
  expect(engine.run(first.id).status).toBe('completed');
  expect(engine.run(successor).status).toBe('failed');
  expect(
    engine.inspect(first.id).descendants.every((r) => r.status === 'completed'),
  ).toBe(true);
  expect(
    engine.previewRunCancellation({ id: first.id, includeDetached: true }),
  ).toMatchObject({ total: 1, items: [{ id: child.id, status: 'waiting' }] });
  rpc.get.mockImplementation(async ({ id }) => engine.inspect(id));
  rpc.work.mockImplementation(async ({ runId }) =>
    engine.available(runId, { advance: false }),
  );
  rpc.preview.mockImplementation(async (input) =>
    engine.previewRunCancellation(input),
  );
  rpc.cancel.mockImplementation(async (input) => engine.cancelRunTree(input));
  return { first: first.id, successor, child: child.id, finish };
}

it('opens tree cancellation from a completed predecessor whose terminal successor owns active detached work', async () => {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  try {
    const { first, successor, child } =
      chainWithIndependentSuccessorWork(engine);
    await render(0, first);
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.textContent === 'Cancel run tree',
      ),
    ).toBe(true);
    expect(rpc.preview).toHaveBeenCalledWith({
      id: first,
      includeDetached: true,
      limit: 1,
    });
    await click('Cancel run tree');
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('No active runs in this selection.');
    await act(async () =>
      dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    expect(dialog.textContent).toContain('1 active run will be cancelled.');
    await act(async () => {
      const reason = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(reason, 'Stop successor descendant');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      [...dialog.querySelectorAll('button')]
        .find((b) => b.textContent === 'Cancel run tree')!
        .click(),
    );
    expect(engine.run(child)).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'Stop successor descendant',
    });
    expect(engine.run(first).status).toBe('completed');
    expect(engine.run(successor).status).toBe('failed');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.textContent === 'Cancel run tree',
      ),
    ).toBe(false);
  } finally {
    engine.stop();
    engine.store.close();
  }
});

it('refreshes tree cancellation availability when detached work beneath a terminal successor completes', async () => {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  try {
    const { first, child, finish } = chainWithIndependentSuccessorWork(engine);
    await render(0, first);
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.textContent === 'Cancel run tree',
      ),
    ).toBe(true);
    const stalePreview = engine.previewRunCancellation({
      id: first,
      includeDetached: true,
      limit: 1,
    });
    let resolveStale!: (value: typeof stalePreview) => void;
    rpc.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
    );
    await render(1, first);
    finish(child);
    const before = engine.store.historyRuns();
    await render(2, first);
    expect(rpc.preview).toHaveBeenLastCalledWith({
      id: first,
      includeDetached: true,
      limit: 1,
    });
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.textContent === 'Cancel run tree',
      ),
    ).toBe(false);
    await act(async () => resolveStale(stalePreview));
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.textContent === 'Cancel run tree',
      ),
    ).toBe(false);
    expect(engine.store.historyRuns()).toEqual(before);
    expect(rpc.cancel).not.toHaveBeenCalled();
  } finally {
    engine.stop();
    engine.store.close();
  }
});

const liveSummary = () =>
  container.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!;
function summaryFixture() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  const definition = blankDefinition();
  definition.nodes[1].label = 'Draft report';
  definition.nodes[1].stage = 'Draft report';
  const workflow = engine.create('Summary fixture', '', definition);
  engine.publish(workflow.id);
  const run = engine.start(workflow.id, {}).run;
  detail = engine.inspect(run.id);
  rpc.work.mockResolvedValue([]);
  return { engine, id: run.id };
}

it.each([
  ['claim_queue', 'Waiting for an agent', 'agent'],
  ['managed_launch', 'Waiting for managed launch', 'engine'],
  ['pause', 'Paused', 'person'],
  ['resource', 'Waiting for a shared resource', 'engine'],
  ['input_node', 'Waiting for external input', 'person'],
])('announces %s once and shows the stage once', async (kind, title, actor) => {
  const { engine, id } = summaryFixture();
  try {
    detail.run.waiting = {
      kind,
      detail: { runId: id, nodeId: 'agent' },
      since: new Date().toISOString(),
    };
    detail.run.actor = actor;
    await render(0, id);
    const summary = liveSummary();
    expect(summary.querySelector('strong')?.textContent).toBe(title);
    expect(summary.textContent?.split(title).length).toBe(2);
    expect(summary.textContent?.split('Draft report').length).toBe(2);
    expect(summary.textContent).toContain(
      actor[0].toUpperCase() + actor.slice(1),
    );
    expect(summary.getAttribute('aria-live')).toBe('polite');
  } finally {
    engine.stop();
    engine.store.close();
  }
});

it('keeps distinct step labels, recovery guidance and failed-run detail', async () => {
  const { engine, id } = summaryFixture();
  try {
    detail.run.stage = 'Investigation';
    detail.run.status = 'failed';
    detail.run.waiting = null;
    detail.run.actor = 'engine';
    detail.run.error = 'Tool failed\nPrivate stack';
    detail.handledFailure = true;
    await render(0, id);
    expect(liveSummary().querySelector('strong')?.textContent).toBe('Failed');
    expect(liveSummary().textContent).toContain('Investigation');
    expect(liveSummary().textContent).toContain('Draft report');
    expect(liveSummary().textContent).toContain('Tool failed');
    expect(liveSummary().textContent).toContain(
      'Failure handled by parent recovery.',
    );
    const assignment = (detail.descendantWork ?? detail.work)[0];
    assignment.status = 'held';
    assignment.managedExecution = {
      state: 'interrupted',
      profileId: 'profile',
      pendingRequests: 0,
    };
    detail.run.status = 'waiting';
    detail.run.waiting = {
      kind: 'human_request',
      detail: { runId: id, nodeId: 'agent' },
      since: new Date().toISOString(),
    };
    detail.run.actor = 'person';
    await render(1, id);
    expect(liveSummary().querySelector('strong')?.textContent).toBe(
      'Recovery needed',
    );
    expect(liveSummary().textContent?.split('Recovery needed').length).toBe(2);
  } finally {
    engine.stop();
    engine.store.close();
  }
});

it('keeps cancellation reasons and continuation context in the live summary', async () => {
  const { engine, id } = summaryFixture();
  try {
    detail.run.status = 'cancelled';
    detail.run.waiting = null;
    detail.run.actor = 'engine';
    detail.run.cancellationReason = 'Stopped by operator';
    await render(0, id);
    expect(liveSummary().querySelector('strong')?.textContent).toBe(
      'Cancelled',
    );
    expect(liveSummary().textContent).toContain(
      'Cancellation reason: Stopped by operator',
    );
    detail.run.status = 'completed';
    detail.run.chain = { index: 1, rootRunId: id, nextRunId: 'next-run' };
    detail.chain = { maxRuns: 3, latestStatus: 'completed' };
    await render(1, id);
    expect(liveSummary().querySelector('strong')?.textContent).toBe(
      'Continued as new',
    );
    expect(liveSummary().textContent).toContain('Chain run 1 · 3 run limit');
  } finally {
    engine.stop();
    engine.store.close();
  }
});
