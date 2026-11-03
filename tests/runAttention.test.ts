import { afterEach, expect, it, vi } from 'vitest';
import { Engine, type HarnessAdapter } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition } from '@interlock/core';
import { batchDefinition } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';
import { appRouter } from '../packages/server/src/router';
const engines: Engine[] = [];
function setup() {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  e.executors.saveSettings({ expectedRevision: 0, concurrency: null });
  e.executors.saveProfile({
    id: 'codex',
    name: 'Codex',
    harness: 'codex',
    enabled: true,
    expectedRevision: 0,
  });
  const adapter: HarnessAdapter = {
    id: 'codex',
    detect: async () => ({ status: 'detected', command: '/fake/codex' }),
    run: async (i) => {
      const answer = await i.request(
        i.work.prompt === 'question'
          ? {
              kind: 'question',
              title: 'Choose a language',
              detail: '',
              questions: [
                {
                  id: 'language',
                  text: 'Language?',
                  options: ['TypeScript', 'Rust'],
                },
              ],
            }
          : {
              kind: 'permission',
              title: 'Request',
              detail: 'private task input must not leave this projection',
            },
      );
      return { output: answer.allow ?? answer.answers ?? {} };
    },
  };
  e.executors.start([adapter]);
  return e;
}
function workflow(e: Engine, definition = blankDefinition()) {
  definition.executor = 'codex';
  const w = e.create('Attention example', '', definition);
  e.publish(w.id);
  return w;
}
async function waiting(e: Engine, count = 1) {
  await vi.waitFor(() =>
    expect(
      e.store.work().filter((w) => w.managedExecution?.state === 'needs_human'),
    ).toHaveLength(count),
  );
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
});
it('reports exact human requests without advancing runs or exposing task data', async () => {
  const e = setup(),
    run = e.start(workflow(e).id, { secret: 'private' }).run;
  await waiting(e);
  const work = e.store.work()[0];
  const cursor = e.run(run.id).cursor;
  const caller = appRouter.createCaller({ engine: e });
  const result = await caller.runs.attention();
  expect(result).toEqual([
    {
      runId: run.id,
      reasons: ['approval'],
      target: { runId: run.id, executionId: work.executionId },
    },
  ]);
  expect(JSON.stringify(result)).not.toMatch(/private|token|prompt/);
  expect(e.run(run.id).cursor).toBe(cursor);
  const record = e.executors.inspect(work.id).items[0];
  e.executors.respond({
    executionId: record.id,
    requestId: record.requests[0].id,
    answer: { allow: true },
  });
  await vi.waitFor(() => expect(e.run(run.id).status).toBe('completed'));
  expect(e.runAttention()).toEqual([]);
});
it('counts questions and excludes ordinary queued work and non-human holds', async () => {
  const e = setup();
  const d = blankDefinition();
  d.nodes.find((n) => n.kind === 'agent')!.prompt = 'question';
  const run = e.start(workflow(e, d).id, {}).run;
  await waiting(e);
  expect(e.runAttention()[0]).toMatchObject({
    runId: run.id,
    reasons: ['question'],
  });
  const queued = blankDefinition();
  queued.executor = 'disabled';
  const w = e.create('Queued', '', queued);
  e.publish(w.id);
  e.start(w.id, {});
  const manual = e.create('Connected', '', blankDefinition());
  e.publish(manual.id);
  e.start(manual.id, {});
  expect(e.runAttention()).toHaveLength(1);
});
it('counts multiple owned Batch assignments once and clears only after the last answer', async () => {
  const e = setup(),
    run = e.start(workflow(e, batchDefinition()).id, [1, 2]).run;
  await waiting(e, 2);
  expect(e.runAttention()).toHaveLength(1);
  expect(e.runAttention()[0].runId).toBe(run.id);
  for (const [index, work] of e.store.work().entries()) {
    const record = e.executors.inspect(work.id).items[0];
    e.executors.respond({
      executionId: record.id,
      requestId: record.requests[0].id,
      answer: { allow: false },
    });
    await vi.waitFor(() =>
      expect(e.store.get<any>('work', work.id).status).toBe('completed'),
    );
    expect(e.runAttention()).toHaveLength(index === 0 ? 1 : 0);
  }
});
it('rolls up invoked workflows but stops at the nearest detached ancestor', async () => {
  const e = setup(),
    child = workflow(e);
  const root = workflow(e, workflowCall(child.id));
  const owned = e.start(root.id, {}).run;
  await waiting(e);
  expect(e.runAttention()[0].runId).toBe(owned.id);
  const detached = workflow(e, workflowCall(child.id, 'detached'));
  const detachedRoot = e.start(detached.id, {}).run;
  await waiting(e, 2);
  const childRun = e.inspect(detachedRoot.id).children[0];
  const work = e.store.work().find((w) => w.runId === childRun.id)!;
  const entries = e.runAttention();
  expect(entries.map((a) => a.runId)).toContain(work.runId);
  expect(entries.map((a) => a.runId)).not.toContain(detachedRoot.id);
});
it('keeps cancelled sessions visible for recovery until explicit reconciliation', async () => {
  const e = setup(),
    run = e.start(workflow(e).id, {}).run;
  await waiting(e);
  const work = e.store.work()[0],
    record = e.executors.inspect(work.id).items[0];
  e.cancel(run.id);
  await vi.waitFor(() =>
    expect(e.runAttention()[0]?.reasons).toEqual(['recovery']),
  );
  await vi.waitFor(() =>
    expect(() => e.executors.confirmStopped(record.id, true)).not.toThrow(),
  );
  expect(e.runAttention()).toEqual([]);
});
it('uses compact indexed reads and ignores a historical attempt after ownership changes', async () => {
  const e = setup();
  e.start(workflow(e).id, {});
  await waiting(e);
  const work = e.store.work()[0];
  vi.spyOn(e.store, 'runs').mockImplementation(() => {
    throw new Error('Full runs scan');
  });
  vi.spyOn(e.store, 'work').mockImplementation(() => {
    throw new Error('Full work scan');
  });
  expect(e.runAttention()).toHaveLength(1);
  e.store.put('work', { ...work, attempt: work.attempt + 1 });
  expect(e.runAttention()).toEqual([]);
  vi.restoreAllMocks();
});
