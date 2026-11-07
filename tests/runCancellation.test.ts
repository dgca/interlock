import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blankDefinition,
  nodeSchema,
  type WorkflowDefinition,
  type WorkRequest,
} from '@interlock/core';
import { Engine, type HarnessRun } from '@interlock/runtime';
import { Store, BackgroundFiles, type BackgroundJob } from '@interlock/storage';
import { workflowCall } from './fixtures/detached';
import { batchDefinition } from './fixtures/batch';

const engines: Engine[] = [],
  dirs: string[] = [];
const worker = {
  workerId: 'tree-test',
  freshContext: false,
  tools: [],
  skills: [],
};
function setup(
  options: ConstructorParameters<typeof Engine>[2] = {},
  file = false,
) {
  const root = mkdtempSync(join(tmpdir(), 'interlock-cancel-tree-'));
  dirs.push(root);
  const e = new Engine(
    new Store(file ? join(root, 'db.sqlite') : ':memory:', {
      secretKeyFile: join(root, 'key'),
    }),
    root,
    options,
  );
  engines.push(e);
  return { e, root };
}
function publish(e: Engine, d: WorkflowDefinition = blankDefinition()) {
  const w = e.create('Tree test', '', d);
  e.publish(w.id);
  return w.id;
}
function cancel(e: Engine, id: string, includeDetached = true) {
  return e.cancelRunTree({
    id,
    includeDetached,
    reason: 'Abort runaway batch',
  });
}
function snapshot(e: Engine) {
  return (
    e.store as unknown as { db: { prepare(sql: string): { all(): unknown } } }
  ).db
    .prepare('SELECT * FROM documents ORDER BY collection,id')
    .all();
}
function finish(e: Engine, runId: string) {
  const c = e.claim(e.available(runId)[0].id, worker);
  e.submit(c.id, c.token!, null);
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

it('previews through terminal parents, preserves detached boundaries, and cancels only selected active descendants', () => {
  const { e } = setup();
  const leaf = publish(e),
    middle = publish(e, workflowCall(leaf, 'detached'));
  const root = e.start(publish(e, workflowCall(middle, 'detached')), {
    private: 'PAYLOAD',
  }).run;
  const members = e.store.sourceRunTree(root.id);
  expect(members.filter((r) => r.status === 'completed')).toHaveLength(2);
  const active = members.find((r) => r.status === 'waiting')!;
  const unrelatedId = e.start(leaf, null).run.id;
  const unrelated = e.run(unrelatedId);
  const before = snapshot(e);
  expect(e.previewRunCancellation({ id: root.id })).toMatchObject({
    total: 0,
    items: [],
  });
  const preview = e.previewRunCancellation({
    id: root.id,
    includeDetached: true,
  });
  expect(preview).toMatchObject({
    total: 1,
    items: [{ id: active.id }],
    truncated: false,
  });
  expect(JSON.stringify(preview)).not.toContain('PAYLOAD');
  expect(snapshot(e)).toEqual(before);
  const result = cancel(e, root.id);
  expect(result.cancelled).toMatchObject({
    total: 1,
    items: [{ id: active.id, status: 'cancelled' }],
  });
  expect(e.run(active.id).cancellationReason).toBe('Abort runaway batch');
  expect(
    e.inspect(active.id).events.find((x) => x.type === 'run.cancelled')
      ?.message,
  ).toContain('Abort runaway batch');
  for (const prior of members.filter((r) => r.status === 'completed'))
    expect(e.run(prior.id)).toEqual(prior);
  expect(e.run(unrelated.id)).toEqual(unrelated);
  expect(e.available(root.id)).toEqual([]);
  expect(cancel(e, root.id).cancelled.total).toBe(0);
});

it('selecting a nested ordinary child excludes parents, siblings and detached grandchildren by default', () => {
  const { e } = setup();
  const leaf = publish(e),
    root = e.start(
      publish(
        e,
        batchDefinition(
          nodeSchema.parse({
            id: 'work',
            kind: 'workflow',
            label: 'Call',
            workflowId: leaf,
            version: 1,
            mode: 'detached',
          }),
          { concurrency: 2 },
        ),
      ),
      [1, 2, 3],
    ).run;
  const children = e.store.runs().filter((r) => r.parentRunId === root.id);
  expect(children).toHaveLength(3);
  // The item parents complete after detached dispatch. Their detached children remain active.
  const selected = children[0];
  expect(e.previewRunCancellation({ id: selected.id }).total).toBe(0);
  const descendant = e.store.runs().find((r) => r.parentRunId === selected.id)!;
  const others = e.store.runs().filter((r) => r.id !== descendant.id);
  cancel(e, selected.id);
  expect(e.run(descendant.id).status).toBe('cancelled');
  for (const other of others) expect(e.run(other.id)).toEqual(other);
});

it('cancels queued Batch items without dispatching later work and keeps omitted detached work independent', () => {
  const { e } = setup();
  const root = e.start(publish(e, batchDefinition()), [1, 2, 3, 4, 5]).run;
  const ids = e.store.sourceRunTree(root.id).map((r) => r.id);
  expect(ids).toHaveLength(3);
  expect(e.previewRunCancellation({ id: root.id, limit: 1 })).toMatchObject({
    total: 3,
    truncated: true,
    nextOffset: 1,
    items: [{ id: root.id }],
  });
  const page = e.previewRunCancellation({ id: root.id, limit: 1, offset: 1 });
  expect(page.items).toHaveLength(1);
  expect(page.total).toBe(3);
  const result = e.cancelRunTree({
    id: root.id,
    reason: 'Stop Batch',
    limit: 1,
  });
  expect(result.cancelled).toMatchObject({ total: 3, truncated: true });
  e.pump();
  expect(e.store.sourceRunTree(root.id).map((r) => r.id)).toEqual(ids);
  expect(e.available(root.id)).toEqual([]);
  expect(
    e.store.sourceRunTree(root.id).every((r) => r.status === 'cancelled'),
  ).toBe(true);
  const independent = e.start(
    publish(e, workflowCall(publish(e), 'detached', true)),
    null,
  ).run;
  const child = e.store.runs().find((r) => r.parentRunId === independent.id)!;
  cancel(e, independent.id, false);
  expect(e.run(child.id).status).toBe('waiting');
});

it('includes forward chain successors from completed predecessors and prevents future rollover or retry', () => {
  const { e } = setup();
  const d = blankDefinition();
  d.nodes[d.nodes.length - 1] = nodeSchema.parse({
    ...d.nodes.at(-1)!,
    continueAsNew: { maxRuns: 4 },
  });
  const first = e.start(publish(e, d), null).run;
  finish(e, first.id);
  e.pump();
  const successor = e.run(first.id).chain!.nextRunId!;
  expect(
    e.previewRunCancellation({ id: first.id }).items.map((r) => r.id),
  ).toEqual([successor]);
  cancel(e, first.id, false);
  e.pump();
  expect(e.run(first.id).status).toBe('completed');
  expect(e.run(successor).status).toBe('cancelled');
  expect(e.inspect(first.id).chain?.cancelledAt).toBeTruthy();
  expect(e.store.runs()).toHaveLength(2);
  expect(() => e.retry(successor)).toThrow();
});

it.each(['available', 'claimed', 'held'] as const)(
  'ends %s work, closes holds and retains exact uncertain owners until stopped reconciliation',
  (state) => {
    const { e } = setup();
    const d = blankDefinition();
    d.nodes[1] = nodeSchema.parse({
      ...d.nodes[1],
      resources: [{ source: 'literal', value: 'exclusive' }],
    });
    const workflow = publish(e, d),
      root = e.start(workflow, null).run;
    let work = e.available(root.id)[0];
    let token: string | undefined;
    if (state !== 'available') {
      work = e.claim(work.id, worker);
      token = work.token;
    }
    if (state === 'held')
      e.manageWorkHold({
        action: 'hold',
        workId: work.id,
        expectedAttempt: work.attempt,
        expectedRevision: 0,
        actor: 'test',
        category: 'other',
        reason: 'Inspect external side effects',
        checkpointRef: 'test-checkpoint',
      });
    const competitor = e.start(workflow, null).run;
    cancel(e, root.id);
    expect(e.store.get<WorkRequest>('work', work.id)).toMatchObject({
      status: 'cancelled',
    });
    expect(e.store.get<WorkRequest>('work', work.id)?.token).toBeUndefined();
    expect(
      e.store
        .forWork<{ endedAt?: string }>('workHolds', work.id)
        .every((h) => h.endedAt),
    ).toBe(true);
    if (state !== 'available') {
      expect(() => e.submit(work.id, token!, null)).toThrow();
      expect(() => e.renew(work.id, token!, 60)).toThrow();
      expect(e.available(competitor.id)).toEqual([]);
      expect(e.quiescence(root.id).quiescent).toBe(false);
      expect(
        e.manageWorkResources({ action: 'inspect', workId: work.id }),
      ).toMatchObject({ reservations: [{ state: 'uncertain' }] });
      e.manageWorkResources({
        action: 'release',
        workId: work.id,
        expectedAttempt: work.attempt,
        actor: 'test',
        confirmStopped: true,
      });
      expect(e.available(competitor.id)).toHaveLength(1);
      expect(e.quiescence(root.id).quiescent).toBe(true);
    } else expect(e.available(competitor.id)).toHaveLength(1);
  },
);

it('rolls back all protected state and lifecycle receipts before requesting any external stop', () => {
  const { e } = setup({ substituteOperation: () => new Promise(() => {}) });
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Long operation',
    language: 'javascript',
    command: 'return input;',
    resources: [{ source: 'literal', value: 'workspace' }],
  });
  const root = e.start(
    publish(e, workflowCall(publish(e, d), 'detached', true)),
    null,
  ).run;
  const before = snapshot(e);
  const abort = vi.spyOn(AbortController.prototype, 'abort');
  const pump = vi.spyOn(e, 'pump');
  expect(
    e.previewRunCancellation({ id: root.id, includeDetached: true }).total,
  ).toBe(2);
  expect(pump).not.toHaveBeenCalled();
  expect(abort).not.toHaveBeenCalled();
  expect(snapshot(e)).toEqual(before);
  pump.mockRestore();
  const put = e.store.put.bind(e.store);
  let cancellationWrites = 0;
  const failure = vi
    .spyOn(e.store, 'put')
    .mockImplementation((collection, doc) => {
      if (
        collection === 'events' &&
        (doc as { type?: string }).type === 'run.cancelled' &&
        ++cancellationWrites === 2
      )
        throw new Error('Injected late write');
      return put(collection, doc);
    });
  expect(() => cancel(e, root.id)).toThrow('Injected late write');
  expect(snapshot(e)).toEqual(before);
  expect(abort).not.toHaveBeenCalled();
  failure.mockRestore();
  expect(cancel(e, root.id).cancelled.total).toBe(2);
  expect(abort).toHaveBeenCalledTimes(1);
});

it('cancels detached timers without later creating work', () => {
  let at = Date.now();
  const { e } = setup({ clock: { now: () => at } });
  const d = blankDefinition();
  d.nodes.splice(
    1,
    0,
    nodeSchema.parse({
      id: 'timer',
      kind: 'wait',
      label: 'Delay',
      timing: { kind: 'duration', ms: 1000 },
    }),
  );
  d.edges[0].target = 'timer';
  d.edges.push({
    id: 'timer-agent',
    source: 'timer',
    target: 'agent',
    port: 'default',
  });
  const root = e.start(
    publish(e, workflowCall(publish(e, d), 'detached')),
    null,
  ).run;
  const child = e.store.sourceRunTree(root.id).find((r) => r.id !== root.id)!;
  cancel(e, root.id);
  const before = snapshot(e);
  at += 2000;
  e.pump();
  expect(e.run(child.id).status).toBe('cancelled');
  expect(e.available(root.id)).toEqual([]);
  expect(snapshot(e)).toEqual(before);
});

it('retains interrupted remote operation ownership even after local settlement', async () => {
  let settle!: (value: null) => void;
  const { e } = setup({
    substituteOperation: () =>
      new Promise<null>((resolve) => {
        settle = resolve;
      }),
  });
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'fetch',
    label: 'Remote write',
    url: 'https://example.test',
    resources: [{ source: 'literal', value: 'remote' }],
  });
  const root = e.start(
    publish(e, workflowCall(publish(e, d), 'detached')),
    null,
  ).run;
  const child = e.store.sourceRunTree(root.id).find((r) => r.id !== root.id)!;
  cancel(e, root.id);
  settle(null);
  await vi.waitFor(() =>
    expect(
      e
        .quiescence(root.id)
        .blockers.items.some((x) => x.kind === 'local_operation'),
    ).toBe(false),
  );
  const execution = e.run(child.id).executions.at(-1)!;
  expect(e.quiescence(root.id).quiescent).toBe(false);
  e.manageWorkResources({
    action: 'release',
    runId: child.id,
    executionId: execution.id,
    expectedAttempt: execution.resourceAttempt!,
    actor: 'test',
    confirmStopped: true,
  });
  expect(e.quiescence(root.id).quiescent).toBe(true);
});

it('requests authenticated background Script stop only after committing detached tree cancellation', async () => {
  const { e, root: dir } = setup({}, true);
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Background',
    executionMode: 'background',
    language: 'javascript',
    command: 'await new Promise(r=>setTimeout(r,30000)); return null;',
    timeoutMs: 60000,
  });
  const root = e.start(
    publish(e, workflowCall(publish(e, d), 'detached')),
    null,
  ).run;
  const child = e.store.sourceRunTree(root.id).find((r) => r.id !== root.id)!;
  await vi.waitFor(
    () =>
      expect(e.run(child.id).executions.at(-1)?.background?.state).toBe(
        'running',
      ),
    { timeout: 5000 },
  );
  cancel(e, root.id);
  const execution = e.run(child.id).executions.at(-1)!;
  const job = e.store.get<BackgroundJob>('backgroundJobs', execution.id)!;
  const files = new BackgroundFiles(e.store);
  expect(existsSync(join(files.directory(job.id), 'stop'))).toBe(true);
  await vi.waitFor(
    () => {
      e.pump();
      expect(e.quiescence(root.id).quiescent).toBe(true);
    },
    { timeout: 5000 },
  );
  expect(e.run(child.id).status).toBe('cancelled');
});

it('stops a managed detached attempt, rejects its late result and preserves uncertainty until exact stop confirmation', async () => {
  const { e } = setup();
  const calls: HarnessRun[] = [];
  e.executors.saveProfile({
    id: 'codex',
    harness: 'codex',
    name: 'Test',
    enabled: true,
    expectedRevision: 0,
  });
  e.executors.start([
    {
      id: 'codex',
      detect: async () => ({ command: '/fake/codex', status: 'detected' }),
      run: async (i) => {
        calls.push(i);
        return new Promise((resolve) =>
          i.signal.addEventListener(
            'abort',
            () => resolve({ output: 'late' }),
            { once: true },
          ),
        );
      },
    },
  ]);
  const d = blankDefinition();
  d.executor = 'codex';
  const root = e.start(
    publish(e, workflowCall(publish(e, d), 'detached')),
    null,
  ).run;
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  const work = calls[0].work;
  cancel(e, root.id);
  await vi.waitFor(() => expect(calls[0].signal.aborted).toBe(true));
  expect(e.run(work.runId).status).toBe('cancelled');
  expect(e.run(work.runId).output).toBeUndefined();
  const record = e.executors.inspect(work.id).items[0];
  await vi.waitFor(() =>
    expect(() => e.executors.confirmStopped(record.id, true)).not.toThrow(),
  );
  expect(e.quiescence(root.id).quiescent).toBe(true);
});

it('rejects invalid selections and blank reasons without mutation; legacy cancel still preserves detached work', () => {
  const { e } = setup();
  const root = e.start(
    publish(e, workflowCall(publish(e), 'detached', true)),
    null,
  ).run;
  const before = snapshot(e);
  expect(() => e.previewRunCancellation({ id: 'missing' })).toThrow(
    'Run not found',
  );
  expect(() => e.previewRunCancellation({ id: root.id, limit: 101 })).toThrow();
  expect(() => e.cancelRunTree({ id: root.id, reason: '  ' })).toThrow();
  expect(snapshot(e)).toEqual(before);
  e.cancel(root.id);
  expect(
    e.store.sourceRunTree(root.id).some((r) => r.status === 'waiting'),
  ).toBe(true);
});

it.each(['bash', 'javascript'] as const)(
  'stops a real detached %s Script before further side effects',
  async (language) => {
    const { e, root: dir } = setup();
    const d = blankDefinition();
    d.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'script',
      label: 'Foreground',
      language,
      command:
        language === 'bash'
          ? 'touch started; sleep 1; touch escaped; echo null'
          : "require('node:fs').writeFileSync('started','yes'); await new Promise(r=>setTimeout(r,1000)); require('node:fs').writeFileSync('escaped','yes'); return null;",
      timeoutMs: 5000,
    });
    const root = e.start(
      publish(e, workflowCall(publish(e, d), 'detached')),
      null,
    ).run;
    await vi.waitFor(() => expect(existsSync(join(dir, 'started'))).toBe(true));
    cancel(e, root.id);
    await vi.waitFor(() => expect(e.quiescence(root.id).quiescent).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 1050));
    expect(existsSync(join(dir, 'escaped'))).toBe(false);
    expect(e.available(root.id)).toEqual([]);
  },
);
