import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  type WorkflowDefinition,
} from '@interlock/core';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';

const engines: Engine[] = [],
  dirs: string[] = [];
const task = { system: 'github', id: 'issue-235' };
const worker = {
  workerId: 'admission-test',
  freshContext: false,
  tools: [],
  skills: [],
};
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
function publish(e: Engine, changes: Partial<WorkflowDefinition> = {}) {
  const w = e.create('Admission', '', { ...blankDefinition(), ...changes });
  e.publish(w.id);
  return w;
}
function finish(e: Engine, id: string) {
  const work = e.claim(e.available(id)[0].id, worker);
  e.submit(work.id, work.token!, {});
}
function state(e: Engine) {
  return JSON.stringify(
    Object.fromEntries(
      [
        'runs',
        'work',
        'events',
        'runStarts',
        'runBudgets',
        'runChains',
        'usageAttempts',
        'workResources',
      ].map((c) => [c, e.store.list(c)]),
    ),
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

it('admits by priority then FIFO, exposes queue position, and wakes scoped continuation', async () => {
  const e = setup(),
    w = publish(e, { maxActiveRuns: 1 });
  const a = e.start(w.id, {}).run;
  const b = e.start(w.id, {}, undefined, undefined, { priority: 1 }).run;
  const c = e.start(w.id, {}, undefined, undefined, { priority: 3 }).run;
  const d = e.start(w.id, {}, undefined, undefined, { priority: 1 }).run;
  expect(e.run(b.id)).toMatchObject({ status: 'queued', executions: [] });
  expect(e.inspect(b.id).run.waiting).toMatchObject({
    kind: 'admission_queue',
    detail: { position: 2, priority: 1 },
  });
  expect(e.available(b.id)).toEqual([]);
  const briefing = e.continuation.briefing({ id: c.id, limit: 20 });
  expect(briefing.progress.requested).toMatchObject({ queued: 1 });
  expect(briefing.blockers.items[0].reason).toBe('admission_queue');
  const wait = e.continuation.wait({
    id: c.id,
    cursor: briefing.cursor,
    timeoutMs: 1000,
    limit: 20,
  });
  finish(e, a.id);
  expect((await wait).changed).toBe(true);
  expect(e.run(c.id).status).toBe('waiting');
  expect(e.run(b.id).status).toBe('queued');
  finish(e, c.id);
  expect(e.run(b.id).status).toBe('waiting');
  finish(e, b.id);
  expect(e.run(d.id).status).toBe('waiting');
});

it('ignores projected excluded stages but lets already admitted work continue', () => {
  const e = setup(),
    definition = blankDefinition();
  definition.nodes[1].stage = 'Accept';
  const w = publish(e, {
    ...definition,
    maxActiveRuns: 1,
    excludeStages: ['Accept'],
  });
  const a = e.start(w.id, {}).run,
    b = e.start(w.id, {}).run;
  expect(e.inspect(a.id).run.stage).toBe('Accept');
  expect(b.status).toBe('waiting');
  expect(e.available()).toHaveLength(2);
});

it('retains captures and queue order across file-backed restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-admission-'));
  dirs.push(dir);
  const path = join(dir, 'state.db'),
    e = setup(path),
    w = publish(e, { maxActiveRuns: 1 });
  const a = e.start(w.id, {}).run;
  const b = e.start(w.id, { original: true }, undefined, undefined, {
    requestId: 'queued',
  }).run;
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  const reopened = setup(path);
  expect(
    reopened.start(w.id, { original: true }, undefined, undefined, {
      requestId: 'queued',
    }).run.id,
  ).toBe(b.id);
  expect(reopened.run(b.id).executions).toEqual([]);
  reopened.cancel(a.id);
  expect(reopened.run(b.id).status).toBe('waiting');
  expect(reopened.run(b.id).input).toEqual({ original: true });
});

it('queues paused starts and honors each independently released hold', () => {
  const e = setup(),
    w = publish(e, { maxActiveRuns: 1 });
  const h1 = e.pauses.create({
    target: { scope: 'workflow', workflowId: w.id },
    actor: 'test',
    reason: 'one',
  });
  const h2 = e.pauses.create({
    target: { scope: 'workflow', workflowId: w.id },
    actor: 'test',
    reason: 'two',
  });
  const run = e.start(w.id, {}).run;
  expect(run.status).toBe('queued');
  e.pauses.resume(h1.id);
  e.pump();
  expect(e.run(run.id).status).toBe('queued');
  e.pauses.resume(h2.id);
  e.pump();
  expect(e.run(run.id).status).toBe('waiting');
});

it.each(['allow', 'reuse', 'reject', 'cancel_previous'] as const)(
  'applies atomic external-task policy %s, including queued matches',
  (policy) => {
    const e = setup(),
      w = publish(e, { maxActiveRuns: 1 });
    const first = e.start(w.id, {}, undefined, undefined, {
      externalTask: task,
      requestId: 'first',
    }).run;
    const options = {
      externalTask: task,
      requestId: 'second',
      onActiveExternalTask: policy,
    };
    if (policy === 'reject') {
      const before = state(e);
      expect(() => e.start(w.id, {}, undefined, undefined, options)).toThrow(
        'active run',
      );
      expect(state(e)).toBe(before);
      return;
    }
    const second = e.start(w.id, {}, undefined, undefined, options).run;
    expect(second.id === first.id).toBe(policy === 'reuse');
    expect(e.run(first.id).status).toBe(
      policy === 'cancel_previous' ? 'cancelled' : 'waiting',
    );
    if (policy === 'allow') expect(second.status).toBe('queued');
    const before = state(e);
    expect(e.start(w.id, {}, undefined, undefined, options).run.id).toBe(
      second.id,
    );
    expect(state(e)).toBe(before);
    if (policy === 'reuse') {
      const dependent = e.start(w.id, {}, undefined, undefined, {
        after: [{ requestId: 'second' }],
      }).run;
      expect(e.run(dependent.id).admission?.after[0].runId).toBe(first.id);
    }
  },
);

it('does not pump reused work when no request key is supplied', () => {
  const e = setup(),
    w = publish(e);
  const a = e.start(w.id, {}, undefined, undefined, { externalTask: task }).run;
  const before = state(e);
  expect(
    e.start(w.id, {}, undefined, undefined, {
      externalTask: task,
      onActiveExternalTask: 'reuse',
    }).run.id,
  ).toBe(a.id);
  expect(state(e)).toBe(before);
});

it('retains uncertain resource ownership when replacing a claimed task', () => {
  const e = setup(),
    d = blankDefinition();
  if (d.nodes[1].kind === 'agent')
    d.nodes[1].resources = [{ source: 'literal', value: 'deployment' }];
  const w = publish(e, d),
    first = e.start(w.id, {}, undefined, undefined, { externalTask: task }).run;
  const claim = e.claim(e.available(first.id)[0].id, worker);
  const replacement = e.start(w.id, {}, undefined, undefined, {
    externalTask: task,
    onActiveExternalTask: 'cancel_previous',
  }).run;
  expect(e.run(first.id).status).toBe('cancelled');
  expect(e.available(replacement.id)).toEqual([]);
  expect(
    e.inspect(replacement.id).work[0].resourceBlocked?.owners,
  ).toMatchObject([{ runId: first.id, state: 'uncertain' }]);
  expect(() => e.submit(claim.id, claim.token!, {})).toThrow();
});

it('validates a replacement before cancellation and rolls all protected state back on write failure', () => {
  const e = setup(),
    d = blankDefinition();
  d.inputSchema = { type: 'object' };
  const w = publish(e, d);
  e.start(w.id, {}, undefined, undefined, { externalTask: task });
  const before = state(e);
  expect(() =>
    e.start(w.id, 42, undefined, undefined, {
      externalTask: task,
      onActiveExternalTask: 'cancel_previous',
    }),
  ).toThrow('Workflow input');
  expect(state(e)).toBe(before);
  const put = e.store.put.bind(e.store);
  vi.spyOn(e.store, 'put').mockImplementation((collection, value) => {
    if (collection === 'runStarts')
      throw new Error('injected receipt write failure');
    return put(collection, value);
  });
  expect(() =>
    e.start(
      w.id,
      {},
      undefined,
      { scope: 'tree', unknownUsage: 'allow', limits: { claims: { max: 2 } } },
      {
        requestId: 'replace',
        externalTask: task,
        onActiveExternalTask: 'cancel_previous',
      },
    ),
  ).toThrow('injected');
  expect(state(e)).toBe(before);
});

it('waits for all dependencies, pins task matches and skips blocked higher-priority starts', () => {
  const e = setup(),
    w = publish(e, { maxActiveRuns: 1 }),
    unlimited = publish(e);
  const dep = e.start(unlimited.id, {}, undefined, undefined, {
    requestId: 'dep',
    externalTask: task,
  }).run;
  const waiting = e.start(w.id, {}, undefined, undefined, {
    priority: 9,
    after: [{ requestId: 'future' }, { externalTask: task }],
  }).run;
  const ready = e.start(w.id, {}).run;
  expect(ready.status).toBe('waiting');
  const future = e.start(unlimited.id, {}, undefined, undefined, {
    requestId: 'future',
  }).run;
  const newer = e.start(unlimited.id, {}, undefined, undefined, {
    externalTask: task,
  }).run;
  finish(e, dep.id);
  finish(e, future.id);
  expect(e.run(waiting.id).admission?.after[1].runId).toBe(dep.id);
  expect(e.run(newer.id).status).toBe('waiting');
  finish(e, ready.id);
  expect(e.run(waiting.id).status).toBe('waiting');
});

it.each(['failed', 'cancelled'] as const)(
  'retains explicit %s dependency blockers',
  (status) => {
    const e = setup(),
      d = blankDefinition();
    if (d.nodes[1].kind === 'agent') d.nodes[1].maxAttempts = 1;
    const w = publish(e, d),
      dep = e.start(w.id, {}, undefined, undefined, { requestId: 'dep' }).run;
    if (status === 'cancelled') e.cancel(dep.id);
    else {
      const c = e.claim(e.available(dep.id)[0].id, worker);
      e.reportFailure(c.id, c.token!, 'test failure');
    }
    const run = e.start(w.id, {}, undefined, undefined, {
      after: [{ requestId: 'dep' }],
    }).run;
    expect(run.status).toBe('queued');
    expect(run.admission?.blockers.join()).toContain(status);
    expect(run.executions).toEqual([]);
  },
);

it('keeps queued runs active, cancellable and protected from history and definition removal', () => {
  const e = setup(),
    w = publish(e, { maxActiveRuns: 1 });
  e.start(w.id, {});
  const queued = e.start(w.id, {}).run;
  expect(
    e.store.runSummaries(
      { workflowId: w.id, tab: 'active', offset: 0, limit: 20 },
      [],
    ).total,
  ).toBe(2);
  const protectedWorkflow = publish(e);
  const protectedRun = e.start(protectedWorkflow.id, {}, undefined, undefined, {
    after: [{ requestId: 'never' }],
  }).run;
  expect(() => e.deleteWorkflow(protectedWorkflow.id)).toThrow(/active/i);
  e.cancel(protectedRun.id);
  expect(() => e.deleteWorkflow(protectedWorkflow.id)).not.toThrow();
  e.cancel(queued.id);
  expect(e.run(queued.id).status).toBe('cancelled');
  expect(e.available(queued.id)).toEqual([]);
});

it('shares Batch admission while waiting Workflow callers project and cancel queued children', () => {
  const e = setup(),
    batch = publish(e, { ...batchDefinition(), maxActiveRuns: 1 });
  const first = e.start(batch.id, [1, 2]).run,
    second = e.start(batch.id, [3]).run;
  expect(e.available(first.id)).toHaveLength(2);
  expect(second.status).toBe('queued');
  const child = publish(e, { maxActiveRuns: 1 });
  e.start(child.id, {});
  const parent = publish(e, workflowCall(child.id));
  const run = e.start(parent.id, {}).run;
  const nested = e.inspect(run.id).descendants[0];
  expect(nested.status).toBe('queued');
  expect(e.inspect(run.id).run.waiting?.kind).toBe('admission_queue');
  e.cancel(run.id);
  expect(e.run(nested.id).status).toBe('cancelled');
});

it('follows a dependency through queued continue-as-new successors to its final successful Exit', () => {
  const e = setup(),
    d = blankDefinition();
  d.maxActiveRuns = 1;
  d.nodes[d.nodes.length - 1] = nodeSchema.parse({
    ...d.nodes.at(-1)!,
    continueAsNew: { maxRuns: 3 },
  });
  d.nodes.push(
    nodeSchema.parse({
      id: 'choose',
      kind: 'switch',
      label: 'Choose',
      path: 'again',
      cases: [{ port: 'again', equals: true }],
      default: 'done',
    }),
    nodeSchema.parse({ id: 'done', kind: 'exit', label: 'Done' }),
  );
  d.edges = d.edges.filter((edge) => edge.source !== 'agent');
  d.edges.push(
    { id: 'choose', source: 'agent', target: 'choose', port: 'default' },
    { id: 'again', source: 'choose', target: 'exit', port: 'again' },
    { id: 'done', source: 'choose', target: 'done', port: 'done' },
  );
  const chain = publish(e, d),
    dependent = publish(e);
  const first = e.start(chain.id, {}, undefined, undefined, {
    requestId: 'chain',
  }).run;
  const after = e.start(dependent.id, {}, undefined, undefined, {
    after: [{ requestId: 'chain' }],
  }).run;
  const c = e.claim(e.available(first.id)[0].id, worker);
  e.submit(c.id, c.token!, { again: true });
  const next = e.run(first.id).chain!.nextRunId!;
  expect(e.run(after.id).status).toBe('queued');
  const last = e.claim(e.available(next)[0].id, worker);
  e.submit(last.id, last.token!, { again: false });
  expect(e.run(after.id).status).toBe('waiting');
});
