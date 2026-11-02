import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  runQuerySchema,
  type BudgetPolicy,
  type RunStartReceipt,
} from '@interlock/core';
import { fingerprint } from '../packages/runtime/src/versionIdentity';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { workflowCall } from './fixtures/detached';

const engines: Engine[] = [],
  dirs: string[] = [];
const worker = {
  workerId: 'fixture',
  freshContext: false,
  tools: [],
  skills: [],
};
const task = {
  system: 'github',
  id: 'dgca/interlock#181',
  url: 'https://github.com/dgca/interlock/issues/181',
};
const budget: BudgetPolicy = {
  scope: 'tree',
  unknownUsage: 'allow',
  limits: { claims: { max: 2 } },
};
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
function publish(e: Engine, d = blankDefinition()) {
  const w = e.create('Subject', '', d);
  e.publish(w.id);
  return w;
}
function finish(e: Engine, id: string) {
  const claim = e.claim(e.available(id)[0].id, worker);
  e.submit(claim.id, claim.token!, {});
}
function state(e: Engine) {
  return JSON.stringify(
    Object.fromEntries(
      [
        'runs',
        'work',
        'events',
        'runBudgets',
        'runStarts',
        'runChains',
        'usageAttempts',
      ].map((c) => [c, e.store.list(c)]),
    ),
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

it('recovers one original start across response modes with unchanged input and normalized metadata', () => {
  const e = setup(),
    w = publish(e),
    input = { secret: 'private-original', nested: { a: 1, b: 2 } },
    options = { requestId: 'attempt-1', externalTask: task };
  const a = e.startSummary(w.id, input, undefined, 1, budget, options),
    before = state(e);
  const b = e.start(
    w.id,
    { nested: { b: 2, a: 1 }, secret: 'private-original' },
    undefined,
    { limits: { claims: { max: 2 } }, unknownUsage: 'allow', scope: 'tree' },
    {
      requestId: 'attempt-1',
      externalTask: { ...task, system: ' github ', id: ' dgca/interlock#181 ' },
    },
  );
  expect(b.run.id).toBe(a.runId);
  expect(state(e)).toBe(before);
  expect(b.run.input).toEqual(input);
  expect(b.run.externalTask).toEqual(task);
  expect(a).toMatchObject({ startRequestId: 'attempt-1', externalTask: task });
  expect(e.store.list('runStarts')).toHaveLength(1);
  expect(JSON.stringify(e.store.list('runStarts'))).not.toContain(
    'private-original',
  );
  expect(JSON.stringify(e.store.list('runStarts'))).not.toContain(task.url);
});

it('keeps omitted-version intent and captured prompts after publication, prompt edits and archive', () => {
  const e = setup(),
    p = e.prompts.create({
      name: 'Rules',
      description: '',
      content: 'Original',
    }),
    d = blankDefinition();
  if (d.nodes[1].kind === 'agent') d.nodes[1].promptIds = [p.id];
  const w = publish(e, d),
    a = e.start(w.id, {}, undefined, undefined, { requestId: 'implicit' });
  e.prompts.update(p.id, p.revision, {
    name: p.name,
    description: p.description,
    content: 'Changed',
  });
  e.publish(w.id);
  e.update(w.id, { archived: true });
  const before = state(e),
    b = e.start(w.id, {}, undefined, undefined, { requestId: 'implicit' });
  expect(b.run.id).toBe(a.run.id);
  expect(b.run.version).toBe(1);
  expect(b.run.promptSnapshots![0].content).toBe('Original');
  expect(state(e)).toBe(before);
  expect(() =>
    e.start(w.id, {}, 1, undefined, { requestId: 'implicit' }),
  ).toThrow('different arguments');
  expect(() =>
    e.start(w.id, {}, undefined, undefined, { requestId: 'new-attempt' }),
  ).toThrow('Restore');
});

it.each(['input', 'budget', 'version', 'workflow', 'task'] as const)(
  'rejects conflicting %s without leaking input or creating state',
  (field) => {
    const e = setup(),
      w = publish(e),
      other = publish(e);
    e.publish(w.id);
    e.start(w.id, { secret: 'private-value' }, 1, budget, {
      requestId: 'conflict',
      externalTask: task,
    });
    const before = state(e);
    const call = () =>
      e.start(
        field === 'workflow' ? other.id : w.id,
        field === 'input'
          ? { secret: 'different-private-value' }
          : { secret: 'private-value' },
        field === 'version' ? 2 : 1,
        field === 'budget'
          ? { ...budget, limits: { claims: { max: 3 } } }
          : budget,
        {
          requestId: 'conflict',
          externalTask: field === 'task' ? { ...task, id: 'other-task' } : task,
        },
      );
    expect(call).toThrow('different arguments');
    try {
      call();
    } catch (error) {
      expect(String(error)).not.toContain('private-value');
    }
    expect(state(e)).toBe(before);
  },
);

it('keeps new-attempt semantics without keys and does not use external identity as a lock', () => {
  const e = setup(),
    w = publish(e),
    a = e.start(w.id, { a: 1 }, undefined, undefined, { externalTask: task }),
    b = e.start(w.id, { a: 1 }, undefined, undefined, { externalTask: task });
  expect(a.run.id).not.toBe(b.run.id);
  expect(e.store.list('runStarts')).toHaveLength(0);
  expect(
    e.store.findRuns(
      runQuerySchema.parse({
        externalTask: { system: task.system, id: task.id },
      }),
    ),
  ).toHaveLength(2);
  const c = e.start(w.id, { a: 1 }, undefined, undefined, {
    requestId: 'retry-new',
    externalTask: task,
  });
  expect(c.run.id).not.toBe(a.run.id);
});

it.each(['completed', 'failed', 'cancelled'] as const)(
  'reads a %s original run without retrying it',
  (status) => {
    const e = setup(),
      d = blankDefinition();
    if (d.nodes[1].kind === 'agent') d.nodes[1].maxAttempts = 1;
    const w = publish(e, d),
      a = e.start(w.id, {}, undefined, budget, { requestId: status });
    if (status === 'cancelled') e.cancel(a.run.id);
    else {
      const claim = e.claim(e.available(a.run.id)[0].id, worker);
      if (status === 'failed')
        e.reportFailure(claim.id, claim.token!, 'Known failure');
      else e.submit(claim.id, claim.token!, {});
    }
    const before = state(e),
      b = e.startSummary(w.id, {}, undefined, 100, budget, {
        requestId: status,
      });
    expect(b.runId).toBe(a.run.id);
    expect(b.runStatus).toBe(status);
    expect(state(e)).toBe(before);
  },
);

it('does not process overdue timers when a start is redelivered', () => {
  vi.useFakeTimers();
  const e = setup(),
    d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'wait',
    label: 'Pause',
    timing: { kind: 'duration', ms: 1000 },
  });
  const w = publish(e, d),
    a = e.start(w.id, {}, undefined, undefined, { requestId: 'timer' });
  vi.advanceTimersByTime(2000);
  const before = state(e);
  expect(
    e.startSummary(w.id, {}, undefined, 20, undefined, { requestId: 'timer' })
      .runStatus,
  ).toBe('waiting');
  expect(state(e)).toBe(before);
  e.pump();
  expect(e.run(a.run.id).status).toBe('completed');
});

it('resumes the original receipt after reopening SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-starts-'));
  dirs.push(dir);
  const path = join(dir, 'state.db'),
    e = setup(path),
    w = publish(e),
    a = e.start(w.id, {}, undefined, budget, {
      requestId: 'durable',
      externalTask: task,
    });
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  const resumed = setup(path);
  const before = state(resumed);
  expect(
    resumed.start(w.id, {}, undefined, budget, {
      requestId: 'durable',
      externalTask: task,
    }).run.id,
  ).toBe(a.run.id);
  expect(state(resumed)).toBe(before);
});

it('retains tombstones across workflow deletion and restoration', () => {
  const e = setup(),
    w = publish(e),
    a = e.start(w.id, {}, undefined, undefined, { requestId: 'deleted' });
  finish(e, a.run.id);
  const bundle = exportWorkflows(e.store, w.id);
  e.deleteWorkflow(w.id);
  expect(e.store.list<RunStartReceipt>('runStarts')[0].deletedAt).toBeDefined();
  expect(() =>
    e.start(w.id, {}, undefined, undefined, { requestId: 'deleted' }),
  ).toThrow('deleted or missing');
  importWorkflows(e.store, bundle);
  expect(() =>
    e.start(w.id, {}, undefined, undefined, { requestId: 'deleted' }),
  ).toThrow('deleted or missing');
  expect(e.store.runs()).toHaveLength(0);
  expect(
    e.start(w.id, {}, undefined, undefined, { requestId: 'deliberate-new' }).run
      .id,
  ).not.toBe(a.run.id);
});

it('fails closed for missing runs or missing receipts with surviving original history', () => {
  const e = setup(),
    w = publish(e),
    a = e.start(w.id, {}, undefined, undefined, { requestId: 'missing-run' });
  e.store.remove('runs', a.run.id);
  expect(() =>
    e.start(w.id, {}, undefined, undefined, { requestId: 'missing-run' }),
  ).toThrow('deleted or missing');
  const b = e.start(w.id, {}, undefined, undefined, {
    requestId: 'missing-receipt',
  });
  e.store.remove('runStarts', fingerprint('missing-receipt'));
  const before = state(e);
  expect(() =>
    e.start(w.id, {}, undefined, undefined, { requestId: 'missing-receipt' }),
  ).toThrow('receipt is unavailable');
  expect(state(e)).toBe(before);
  expect(e.run(b.run.id).id).toBe(b.run.id);
});

it('rolls back receipt, prompts, chain, events and budget when startup fails', () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes[d.nodes.length - 1] = nodeSchema.parse({
    ...d.nodes.at(-1)!,
    continueAsNew: { maxRuns: 3 },
  });
  const w = publish(e, d),
    before = state(e),
    spy = vi.spyOn(e.budgets, 'set').mockImplementation(() => {
      throw Error('Injected budget failure');
    });
  expect(() =>
    e.start(w.id, {}, undefined, budget, { requestId: 'rollback' }),
  ).toThrow('Injected');
  expect(state(e)).toBe(before);
  spy.mockRestore();
  const r = e.start(w.id, {}, undefined, budget, { requestId: 'rollback' });
  expect(r.run.chain).toBeDefined();
  expect(e.store.list('runStarts')).toHaveLength(1);
  expect(e.budgets.read(r.run.id).revision).toBe(1);
});

it('retains external identity across continue-as-new but keeps the key on the original run', () => {
  const e = setup(),
    d = blankDefinition();
  d.nodes[d.nodes.length - 1] = nodeSchema.parse({
    ...d.nodes.at(-1)!,
    continueAsNew: { maxRuns: 3 },
  });
  const w = publish(e, d),
    a = e.start(w.id, {}, undefined, budget, {
      requestId: 'chain',
      externalTask: task,
    });
  finish(e, a.run.id);
  const successor = e.run(e.run(a.run.id).chain!.nextRunId!);
  expect(successor.externalTask).toEqual(task);
  expect(successor.startRequestId).toBeUndefined();
  const before = state(e);
  expect(
    e.startSummary(w.id, {}, undefined, 20, budget, {
      requestId: 'chain',
      externalTask: task,
    }).runId,
  ).toBe(a.run.id);
  expect(state(e)).toBe(before);
  expect(e.store.runs()).toHaveLength(2);
  expect(
    e.store
      .findRuns(runQuerySchema.parse({ requestId: 'chain' }))
      .map((r) => r.id),
  ).toEqual([a.run.id]);
});

it('preserves detached lifecycle and finds the correlated root without changing child input', () => {
  const e = setup(),
    child = publish(e),
    parent = publish(e, workflowCall(child.id, 'detached'));
  const r = e.start(parent.id, { task: 'input' }, undefined, undefined, {
    requestId: 'detached',
    externalTask: task,
  });
  expect(r.run.status).toBe('completed');
  expect(r.children[0].parentMode).toBe('detached');
  expect(r.children[0].input).toEqual({ task: 'input' });
  expect(r.children[0].externalTask).toBeUndefined();
  const before = state(e);
  e.start(parent.id, { task: 'input' }, undefined, undefined, {
    requestId: 'detached',
    externalTask: task,
  });
  expect(state(e)).toBe(before);
  expect(
    e.store
      .findRuns(
        runQuerySchema.parse({
          externalTask: { system: task.system, id: task.id },
          rootOnly: true,
        }),
      )
      .map((r) => r.id),
  ).toEqual([r.run.id]);
});

it.each([
  'javascript:alert(1)',
  'https://user:password@example.invalid/task',
  'file:///secret',
  'not a URL',
])('rejects unsuitable external links %s before creating work', (url) => {
  const e = setup(),
    w = publish(e);
  expect(() =>
    e.start(w.id, {}, undefined, undefined, {
      requestId: 'bad-url',
      externalTask: { ...task, url },
    }),
  ).toThrow();
  expect(e.store.runs()).toHaveLength(0);
});

it('replays without restoring an authorized later budget adjustment', () => {
  const e = setup(),
    w = publish(e),
    a = e.start(w.id, {}, undefined, budget, { requestId: 'budget-adjusted' });
  e.budgets.set({
    runId: a.run.id,
    expectedRevision: 1,
    budget: { ...budget, limits: { claims: { max: 3 } } },
  });
  const before = state(e);
  e.start(w.id, {}, undefined, budget, { requestId: 'budget-adjusted' });
  expect(state(e)).toBe(before);
  expect(e.budgets.read(a.run.id).revision).toBe(2);
});

it('does not revalidate removed definitions or allocate a run when replaying retained history', () => {
  const e = setup(),
    w = publish(e),
    a = e.start(w.id, {}, undefined, undefined, {
      requestId: 'old-definition',
    });
  finish(e, a.run.id);
  e.publish(w.id);
  const versions = [{ workflowId: w.id, version: 1 }],
    preview = e.versions.preview({ versions });
  e.versions.delete({
    versions,
    confirmation: preview.confirmation,
    acknowledgeHistoryLoss: true,
  });
  const before = state(e);
  expect(
    e.start(w.id, {}, undefined, undefined, { requestId: 'old-definition' }),
  ).toMatchObject({
    run: { id: a.run.id, version: 1 },
    definition: null,
    definitionAvailable: false,
  });
  expect(
    e.startSummary(w.id, {}, undefined, 1, undefined, {
      requestId: 'old-definition',
    }).runId,
  ).toBe(a.run.id);
  expect(state(e)).toBe(before);
});

it('keeps external correlation and start receipts out of portable definitions', () => {
  const e = setup(),
    w = publish(e);
  e.start(w.id, {}, undefined, undefined, {
    requestId: 'outside-export',
    externalTask: task,
  });
  const text = JSON.stringify(exportWorkflows(e.store, w.id));
  expect(text).not.toContain('startRequestId');
  expect(text).not.toContain('externalTask');
  expect(text).not.toContain('runStarts');
});

it('leaves a key unused after rejected initial input', () => {
  const e = setup(),
    d = blankDefinition();
  d.inputSchema = { type: 'number' };
  const w = publish(e, d);
  expect(() =>
    e.start(w.id, 'invalid', undefined, undefined, { requestId: 'validation' }),
  ).toThrow();
  expect(e.store.list('runStarts')).toHaveLength(0);
  expect(e.store.runs()).toHaveLength(0);
  expect(
    e.start(w.id, 1, undefined, undefined, { requestId: 'validation' }).run
      .input,
  ).toBe(1);
});

it.each(['', '   ', 'x'.repeat(121)])(
  'rejects unsuitable request keys before execution',
  (requestId) => {
    const e = setup(),
      w = publish(e);
    expect(() =>
      e.start(w.id, {}, undefined, undefined, { requestId }),
    ).toThrow();
    expect(e.store.runs()).toHaveLength(0);
  },
);

it('recovers a committed start even if delivery fails before the first execution pump', () => {
  const e = setup(),
    w = publish(e),
    spy = vi.spyOn(e, 'pump').mockImplementationOnce(() => {
      throw Error('Lost response after commit');
    });
  expect(() =>
    e.start(w.id, {}, undefined, budget, { requestId: 'committed' }),
  ).toThrow('after commit');
  spy.mockRestore();
  expect(e.store.list('runStarts')).toHaveLength(1);
  expect(e.store.runs()).toHaveLength(1);
  expect(e.store.work()).toHaveLength(0);
  const before = state(e),
    result = e.startSummary(w.id, {}, undefined, 20, budget, {
      requestId: 'committed',
    });
  expect(result.runId).toBe(e.store.runs()[0].id);
  expect(state(e)).toBe(before);
  e.pump();
  expect(e.store.work()).toHaveLength(1);
});
