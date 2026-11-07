import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Engine,
  type HarnessAdapter,
  type HarnessRun,
} from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  executorProfileSchema,
  withNextCall,
  type Json,
  type WorkRequest,
} from '@interlock/core';
import { usageDelta } from '../packages/runtime/src/executors/manager';
import { HarnessModelError } from '../packages/runtime/src/executors/contracts';
import { exportWorkflows } from '../packages/runtime/src/transfer';

const engines: Engine[] = [],
  dirs: string[] = [];
const start = (e: Engine, id: string, input: Json) => e.start(id, input).run;
const save = (e: Engine, input: any) => {
  const { revision: _revision, ...rest } = input;
  return e.executors.saveProfile(rest);
};
const create = (path = ':memory:') => {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
};
afterEach(async () => {
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const profile = (
  e: Engine,
  harness: 'codex' | 'claude-code' | 'pi' = 'codex',
  extra = {},
) =>
  save(e, {
    id: harness,
    harness,
    name: harness,
    enabled: true,
    expectedRevision: 0,
    ...extra,
  });
function workflow(
  e: Engine,
  executor?: string,
  extra: Record<string, unknown> = {},
) {
  const d = blankDefinition();
  d.executor = executor;
  const node = d.nodes.find((n) => n.kind === 'agent')!;
  Object.assign(node, extra);
  const w = e.create('Managed example', '', definitionSchema.parse(d));
  e.publish(w.id);
  return w;
}
function adapter(
  id: 'codex' | 'claude-code' | 'pi' = 'codex',
  run?: HarnessAdapter['run'],
): HarnessAdapter {
  return {
    id,
    detect: async () => ({
      command: '/fake/' + id,
      status: 'detected',
      version: 'test',
    }),
    run:
      run ??
      (async (i) => {
        i.onSession('session-' + i.work.id);
        return { output: i.work.input };
      }),
  };
}
async function settled(e: Engine, id: string) {
  await vi.waitFor(() => expect(e.run(id).status).toBe('completed'));
}
it('holds a model refusal without spending failures, releases resources and retries only after an explicit model choice', async () => {
  const e = create();
  profile(e, 'codex', { model: 'rejected', permissions: 'read-only' });
  const calls: HarnessRun[] = [];
  e.executors.start([
    adapter('codex', async (i) => {
      calls.push(i);
      if (i.profile.model === 'rejected') {
        void i
          .request({
            kind: 'question',
            title: 'Startup question',
            detail: '',
            questions: [{ id: 'startup', text: 'Continue?', allowOther: true }],
          })
          .catch(() => {});
        throw new HarnessModelError(
          'model_not_found' + ' provider details'.repeat(200),
        );
      }
      return { output: i.work.input };
    }),
  ]);
  const w = workflow(e, 'codex', {
    model: 'rejected',
    maxAttempts: 1,
    resources: [{ source: 'literal', value: 'project' }],
  });
  const run = start(e, w.id, { value: 1 });
  await vi.waitFor(() => expect(e.store.work()[0].status).toBe('held'));
  const work = e.store.work()[0];
  const record = e.executors.inspect(work.id).items[0];
  expect(record.state).toBe('needs_model');
  expect(record.requests[0].state).toBe('cancelled');
  expect(e.run(run.id).status).toBe('waiting');
  expect(e.store.list('workResources')).toHaveLength(0);
  expect(work.heldClaimCount).toBe(1);
  expect(work.hold!.reason.length).toBeLessThanOrEqual(1000);
  expect(work.failureCount ?? 0).toBe(0);
  expect(e.runAttention()).toEqual([
    {
      runId: run.id,
      reasons: ['model'],
      target: { runId: run.id, executionId: work.executionId },
    },
  ]);
  expect(e.continuation.briefing({ id: run.id, limit: 20 }).next).toBe(
    'inspect_executor',
  );
  expect(() =>
    e.manageWorkHold({
      action: 'resume',
      workId: work.id,
      expectedAttempt: 1,
      expectedRevision: work.holdRevision!,
      actor: 'test',
    }),
  ).toThrow('retry_model');
  expect(
    await e.executors.manage({
      action: 'retry_model',
      executionId: record.id,
      model: 'replacement',
    }),
  ).toEqual({ applied: true });
  expect(e.runAttention()).toEqual([]);
  expect(e.executors.retryModel(record.id, 'replacement')).toEqual({
    applied: false,
  });
  await settled(e, run.id);
  expect(calls).toHaveLength(2);
  expect(calls[1].profile).toMatchObject({
    model: 'replacement',
    effort: null,
    permissions: 'read-only',
  });
  expect(e.executors.profiles().find((p) => p.id === 'codex')?.model).toBe(
    'rejected',
  );
  expect(e.executors.inspect(work.id).items[0]).toMatchObject({
    modelSource: 'recovery',
    effortSource: 'recovery',
  });
  expect(e.store.get<any>('managedExecutions', record.id).profile.model).toBe(
    'rejected',
  );
});
it('restores a model hold after restart without uncertain-process recovery or an automatic retry', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async () => {
      throw new HarnessModelError('model_not_found');
    }),
  ]);
  const run = start(e, workflow(e, 'codex', { maxAttempts: 1 }).id, 1);
  await vi.waitFor(() => expect(e.store.work()[0].status).toBe('held'));
  const work = e.store.work()[0],
    record = e.executors.inspect(work.id).items[0];
  await e.executors.stop();
  e.stop();
  const next = new Engine(e.store, process.cwd());
  engines.push(next);
  engines.splice(engines.indexOf(e), 1);
  const invoke = vi.fn(async (i: HarnessRun) => ({ output: i.work.input }));
  next.executors.start([adapter('codex', invoke)]);
  expect(next.executors.inspect(work.id).items[0].state).toBe('needs_model');
  expect(invoke).not.toHaveBeenCalled();
  next.executors.retryModel(record.id, 'working');
  await settled(next, run.id);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it('preserves a continuity session and the requested model/effort intent through manual recovery', async () => {
  const e = create();
  profile(e, 'codex', { tools: ['git'], model: 'rejected' });
  const calls: HarnessRun[] = [];
  const native = adapter('codex', async (i) => {
    calls.push(i);
    i.onSession('same-native');
    if (i.profile.model === 'rejected')
      throw new HarnessModelError('model_not_found');
    return { output: i.work.input };
  });
  native.models = async () => ({
    models: [{ id: 'rejected', name: 'Rejected', effortLevels: ['high'] }],
  });
  e.executors.start([native]);
  const grouped = groupedWorkflow(e, 'codex', {
    agentModel: 'rejected',
    agentEffort: 'high',
  });
  const run = start(e, grouped.id, 1);
  await vi.waitFor(() => expect(e.store.work()[0].status).toBe('held'));
  e.executors.retryModel(
    e.executors.inspect(e.store.work()[0].id).items[0].id,
    'replacement',
  );
  await settled(e, run.id);
  expect(calls).toHaveLength(3);
  expect(calls[0].profile.effort).toBe('high');
  expect(calls.slice(1).every((i) => i.profile.effort === null)).toBe(true);
  expect(e.workflow(grouped.id).draft.agentModel).toBe('rejected');
  expect(calls.slice(1).map((i) => [i.profile.model, i.sessionId])).toEqual([
    ['replacement', 'same-native'],
    ['replacement', 'same-native'],
  ]);
});
it('rejects stale or cancelled model recovery and permits cleanup after cancellation', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async () => {
      throw new HarnessModelError('model_not_found');
    }),
  ]);
  const run = start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() => expect(e.store.work()[0].status).toBe('held'));
  const work = e.store.work()[0],
    record = e.executors.inspect(work.id).items[0];
  e.cancel(run.id);
  expect(e.runAttention()).toEqual([]);
  expect(() => e.executors.retryModel(record.id, 'working')).toThrow(
    'no longer active',
  );
  expect(() => e.executors.assertDelete(new Set([run.id]))).not.toThrow();
});
it('keeps unknown model-adjacent failures on the existing uncertain-execution path', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async () => {
      throw new Error('HTTP 401 or transport unavailable');
    }),
  ]);
  const run = start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('interrupted'),
  );
  const work = e.store.work()[0];
  expect(() =>
    e.executors.retryModel(e.executors.inspect(work.id).items[0].id, 'working'),
  ).toThrow('no longer active');
  expect(e.run(run.id).status).toBe('waiting');
});
it('cleans up settled managed execution and session history while preserving local profiles', async () => {
  const e = create();
  profile(e);
  e.executors.start([adapter()]);
  const run = start(e, workflow(e, 'codex').id, {
    private: 'managed-history-payload',
  });
  await settled(e, run.id);
  const preview = e.history.preview({ rootRunIds: [run.id] }).items[0];
  expect(preview).toMatchObject({
    canDelete: true,
    collections: { managedExecutions: 1, executorSessions: 1 },
  });
  expect(JSON.stringify(preview)).not.toContain('managed-history-payload');
  e.history.delete({
    roots: [{ runId: run.id, confirmation: preview.confirmation! }],
    acknowledgeHistoryLoss: true,
  });
  for (const collection of ['managedExecutions', 'executorSessions'])
    expect(e.store.forRuns(collection, new Set([run.id]))).toEqual([]);
  expect(e.executors.profiles().find((p) => p.id === 'codex')?.enabled).toBe(
    true,
  );
});

it('protects cancelled managed history until the harness stops and its uncertain execution is reconciled', async () => {
  const e = create();
  profile(e);
  let release!: () => void;
  e.executors.start([
    adapter('codex', async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw new Error('stopped');
    }),
  ]);
  const run = start(e, workflow(e, 'codex').id, null);
  await vi.waitFor(() =>
    expect(e.executors.inspect(e.store.work()[0].id).items[0]?.state).toBe(
      'running',
    ),
  );
  const record = e.executors.inspect(e.store.work()[0].id).items[0];
  e.cancel(run.id);
  expect(e.history.preview({ rootRunIds: [run.id] }).items[0].canDelete).toBe(
    false,
  );
  e.executors.stopExecution(record.id);
  expect(() => e.executors.confirmStopped(record.id, true)).toThrow(
    'still stopping',
  );
  const preview = e.history.preview({ rootRunIds: [run.id] }).items[0];
  expect(preview.blockers.join(' ')).toContain('active or uncertain');
  release();
  await vi.waitFor(() =>
    expect(() => e.executors.confirmStopped(record.id, true)).not.toThrow(),
  );
  expect(e.history.preview({ rootRunIds: [run.id] }).items[0].canDelete).toBe(
    true,
  );
});
it('discovers models on disabled profiles, caches and refreshes without claiming work', async () => {
  const e = create();
  profile(e, 'codex', { enabled: false });
  const run = vi.fn(adapter().run);
  const models = vi.fn(async () => ({
    models: [{ id: 'native-model', name: 'Native Model' }],
  }));
  e.executors.start([{ ...adapter('codex', run), models }]);
  const r = start(e, workflow(e, 'codex').id, 1);
  const query = { profileId: 'codex' };
  const [a, b] = await Promise.all([
    e.executors.models(query),
    e.executors.models(query),
  ]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({
    status: 'ready',
    models: [{ id: 'native-model' }],
  });
  await e.executors.models(query);
  expect(models).toHaveBeenCalledTimes(1);
  await e.executors.manage({ action: 'models', ...query, refresh: true });
  expect(models).toHaveBeenCalledTimes(2);
  expect(run).not.toHaveBeenCalled();
  expect(e.run(r.id).status).not.toBe('completed');
  expect(e.store.work()[0].status).toBe('available');
});
it('uses unsaved discovery paths without changing the configuration and bounds catalogs', async () => {
  const e = create();
  const saved = profile(e, 'codex', { enabled: false, cwd: '/saved' });
  const models = vi.fn<NonNullable<HarnessAdapter['models']>>(async () => ({
    models: Array.from({ length: 150 }, (_, i) => ({
      id: `model-${i}`,
      name: 'N'.repeat(300),
    })),
  }));
  const detect = vi.fn(async (override) => ({
    status: 'detected' as const,
    command: override ?? '/native/codex',
  }));
  e.executors.start([{ ...adapter(), models, detect }]);
  const catalog = await e.executors.models({
    profileId: 'codex',
    paths: { cwd: '/unsaved', command: '/unsaved/codex' },
  });
  expect(models.mock.calls[0][0]).toMatchObject({
    cwd: '/unsaved',
    command: '/unsaved/codex',
  });
  expect(catalog.models).toHaveLength(100);
  expect(catalog.models[0].name).toHaveLength(120);
  expect(catalog.truncated).toBe(true);
  expect(e.executors.profiles().find((p) => p.id === 'codex')).toEqual(saved);
  await e.executors.models({ profileId: 'codex', paths: {} });
  expect(models.mock.calls[1][0]).toMatchObject({
    cwd: process.cwd(),
    command: '/native/codex',
  });
  await expect(
    e.executors.models({ profileId: 'codex', paths: { cwd: 'relative' } }),
  ).rejects.toThrow('absolute');
});
it('bounds stalled model discovery and cancels it at shutdown', async () => {
  vi.useFakeTimers();
  const e = create();
  e.executors.start([
    {
      ...adapter(),
      models: ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          }),
        ),
    },
  ]);
  const request = e.executors.models({ profileId: 'codex' });
  await vi.advanceTimersByTimeAsync(16000);
  expect(await request).toMatchObject({
    status: 'unavailable',
    message: 'Model discovery timed out',
    models: [],
  });
  const pending = e.executors.models({ profileId: 'codex', refresh: true });
  await vi.advanceTimersByTimeAsync(0);
  await e.executors.stop();
  expect(await pending).toMatchObject({
    status: 'unavailable',
    message: 'Interlock stopped',
  });
});
it.each([
  [undefined, undefined, undefined, 'cli'],
  ['default-model', undefined, 'default-model', 'harness'],
  ['default-model', 'custom-model', 'custom-model', 'workflow'],
] as const)(
  'captures default model %s and workflow override %s',
  async (defaultModel, override, effective, source) => {
    const e = create();
    profile(e, 'codex', { model: defaultModel });
    const calls: HarnessRun[] = [];
    e.executors.start([
      adapter('codex', async (input) => {
        calls.push(input);
        return { output: input.work.input };
      }),
    ]);
    const d = blankDefinition();
    d.executor = 'codex';
    d.agentModel = override;
    const w = e.create('Models', '', d);
    e.publish(w.id);
    const r = start(e, w.id, 1);
    await settled(e, r.id);
    expect(calls[0].profile.model).toBe(effective);
    expect(e.store.work()[0].executorModel).toBe(override);
    expect(e.executors.inspect(e.store.work()[0].id).items[0]).toMatchObject({
      modelSource: source,
    });
  },
);
it.each(['claude-code', 'codex', 'pi'] as const)(
  'automatically executes through %s without another worker process',
  async (harness) => {
    const e = create();
    profile(e, harness);
    const run = vi.fn(adapter(harness).run);
    e.executors.start([adapter(harness, run)]);
    const w = workflow(e, harness),
      r = start(e, w.id, { value: 3 });
    await settled(e, r.id);
    expect(e.run(r.id).output).toEqual({ value: 3 });
    expect(run).toHaveBeenCalledTimes(1);
    const work = e.store.work()[0];
    expect(e.executors.inspect(work.id).items[0]).toMatchObject({
      state: 'completed',
      attempt: 1,
      profile: { harness },
      sessionId: 'session-' + work.id,
    });
    expect(e.store.list<any>('usageAttempts')[0].snapshot).toBeUndefined();
  },
);
it('leaves legacy definitions and explicit connected-agent overrides available to external workers', async () => {
  const e = create();
  profile(e);
  const run = vi.fn(adapter().run);
  e.executors.start([adapter('codex', run)]);
  const old = start(e, workflow(e).id, 1),
    optedOut = start(e, workflow(e, 'codex', { executor: null }).id, 2);
  await new Promise((r) => setTimeout(r, 25));
  expect(run).not.toHaveBeenCalled();
  for (const r of [old, optedOut]) {
    const [w] = e.available(r.id);
    const claim = e.claim(w.id, {
      workerId: 'external',
      freshContext: false,
      tools: [],
      skills: [],
    });
    e.submit(w.id, claim.token!, 3);
    expect(e.run(r.id).output).toBe(3);
  }
});
it('allows a node override, discovers separately started roots, and preserves exclusive claims', async () => {
  const e = create();
  profile(e);
  profile(e, 'claude-code');
  const codex = vi.fn(adapter().run),
    claude = vi.fn(adapter('claude-code').run);
  e.executors.start([adapter('codex', codex), adapter('claude-code', claude)]);
  const r1 = start(e, workflow(e, 'codex', { executor: 'claude-code' }).id, 1);
  const r2 = start(e, workflow(e, 'codex').id, 2);
  await Promise.all([settled(e, r1.id), settled(e, r2.id)]);
  expect(claude).toHaveBeenCalledTimes(1);
  expect(codex).toHaveBeenCalledTimes(1);
  expect(() =>
    e.claim(e.store.work()[0].id, {
      workerId: 'other',
      freshContext: true,
      tools: [],
      skills: [],
    }),
  ).toThrow(/not available/);
});
it('checks capabilities and disabled or missing local profiles even with Unlimited', async () => {
  const e = create();
  e.executors.saveSettings({ expectedRevision: 0, concurrency: null });
  const run = vi.fn(adapter().run);
  e.executors.start([adapter('codex', run)]);
  profile(e, 'codex', { enabled: false });
  const r = start(
    e,
    workflow(e, 'codex', {
      context: { tools: ['browser'], skills: ['review'] },
    }).id,
    1,
  );
  await new Promise((r) => setTimeout(r, 20));
  let [work] = e.available(r.id);
  expect(work.attempt).toBe(0);
  expect(work.managedExecution?.state).toBe('blocked');
  save(e, {
    ...executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      enabled: true,
    }),
    expectedRevision: 1,
  });
  await new Promise((r) => setTimeout(r, 20));
  expect(run).not.toHaveBeenCalled();
  save(e, {
    ...executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      enabled: true,
      tools: ['browser'],
      skills: ['review'],
    }),
    expectedRevision: 2,
  });
  await settled(e, r.id);
  expect(run).toHaveBeenCalledTimes(1);
  const missing = start(e, workflow(e, 'not-installed').id, 2);
  expect(e.available(missing.id)[0].managedExecution?.reason).toMatch(
    /Configure/,
  );
});
it('retains an explicit permission request and requires its exact active identity', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      const a = await i.request({
        kind: 'permission',
        title: 'Write a file',
        detail: 'touch example.txt',
      });
      return { output: a.allow ?? false };
    }),
  ]);
  const r = start(e, workflow(e, 'codex').id, 0);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  const work = e.store.work()[0],
    record = e.executors.inspect(work.id).items[0],
    request = record.requests[0];
  const briefing = e.continuation.briefing({ id: r.id, limit: 20 });
  expect(briefing.next).toBe('inspect_executor');
  expect(withNextCall(e.continuation.summary(r.id, 20)).nextCall).toEqual({
    tool: 'manage_executors',
    arguments: { request: { action: 'inspect', workId: work.id } },
  });
  expect(() =>
    e.executors.respond({
      executionId: record.id,
      requestId: 'old',
      answer: { allow: true },
    }),
  ).toThrow(/not found/);
  const q = {
    executionId: record.id,
    requestId: request.id,
    answer: { allow: false },
  };
  expect(e.executors.respond(q)).toEqual({ applied: true });
  expect(e.executors.respond(q)).toEqual({ applied: false });
  await settled(e, r.id);
  expect(e.run(r.id).output).toBe(false);
});
it('surfaces questions and accepts a full explicit answer without granting tool permissions', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      const a = await i.request({
        kind: 'question',
        title: 'Choose',
        detail: '',
        questions: [
          {
            id: 'database',
            text: 'Which database?',
            options: ['SQLite', 'Postgres'],
          },
        ],
      });
      return { output: a.answers!.database[0] };
    }),
  ]);
  const r = start(e, workflow(e, 'codex').id, 0);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  const record = e.executors.inspect(e.store.work()[0].id).items[0],
    requestId = record.requests[0].id;
  expect(() =>
    e.executors.respond({
      executionId: record.id,
      requestId,
      answer: { allow: true },
    }),
  ).toThrow(/every question/);
  await e.executors.manage({
    action: 'respond',
    executionId: record.id,
    requestId,
    answer: { answers: { database: ['SQLite'] } },
  });
  await settled(e, r.id);
  expect(e.run(r.id).output).toBe('SQLite');
});
it('keeps the captured profile stable through retries and applies bounded invalid-result failure', async () => {
  const e = create();
  profile(e, 'codex', { model: 'old' });
  const calls: HarnessRun[] = [];
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  e.executors.start([
    adapter('codex', async (i) => {
      calls.push(i);
      if (calls.length === 1)
        await Promise.race([
          wait,
          new Promise<void>((r) =>
            i.signal.addEventListener('abort', () => r(), { once: true }),
          ),
        ]);
      return { output: 'invalid' };
    }),
  ]);
  const r = start(
    e,
    workflow(e, 'codex', { outputSchema: { type: 'number' }, maxAttempts: 2 })
      .id,
    1,
  );
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  save(e, {
    ...e.executors.profiles().find((p) => p.id === 'codex')!,
    model: 'new',
    expectedRevision: 1,
  });
  release();
  await vi.waitFor(() => expect(e.run(r.id).status).toBe('failed'));
  expect(calls).toHaveLength(2);
  expect(calls.map((c) => c.profile.model)).toEqual(['old', 'old']);
});
it('reuses a managed continuity session while fresh reviewers start independently', async () => {
  const e = create();
  profile(e);
  const received: (string | undefined)[] = [];
  e.executors.start([
    adapter('codex', async (i) => {
      received.push(i.sessionId);
      i.onSession(i.sessionId ?? 'native-session');
      return { output: i.work.input };
    }),
  ]);
  const d = blankDefinition();
  d.executor = 'codex';
  const a = d.nodes.find((n) => n.kind === 'agent')!;
  if (a.kind !== 'agent') throw Error();
  a.context.continuityGroup = 'author';
  const second = { ...structuredClone(a), id: 'second' },
    reviewer = {
      ...structuredClone(a),
      id: 'reviewer',
      context: {
        ...a.context,
        mode: 'fresh' as const,
        continuityGroup: undefined,
      },
    };
  d.nodes.push(second, reviewer);
  const outgoing = d.edges.find((edge) => edge.source === a.id)!;
  const exit = outgoing.target;
  outgoing.target = second.id;
  d.edges.push(
    { id: 'b', source: second.id, target: reviewer.id, port: 'default' },
    { id: 'c', source: reviewer.id, target: exit, port: 'default' },
  );
  const w = e.create('Continuity', '', d);
  e.publish(w.id);
  const r = start(e, w.id, 1);
  await settled(e, r.id);
  expect(received).toEqual([undefined, 'native-session', undefined]);
});
it('limits concurrency and observes cancellation without accepting a late result', async () => {
  const e = create();
  e.executors.saveSettings({ expectedRevision: 0, concurrency: 1 });
  profile(e);
  const inputs: HarnessRun[] = [];
  e.executors.start([
    adapter('codex', async (i) => {
      inputs.push(i);
      return new Promise((resolve) =>
        i.signal.addEventListener('abort', () => resolve({ output: 'late' }), {
          once: true,
        }),
      );
    }),
  ]);
  const w = workflow(e, 'codex');
  const first = start(e, w.id, 1),
    second = start(e, w.id, 2);
  await vi.waitFor(() => expect(inputs).toHaveLength(1));
  e.cancel(first.id);
  await vi.waitFor(() => expect(inputs[0].signal.aborted).toBe(true));
  await vi.waitFor(() => expect(inputs).toHaveLength(2));
  expect(e.run(first.id).status).toBe('cancelled');
  expect(e.run(first.id).output).toBeUndefined();
  e.cancel(second.id);
});
it('recovers interrupted attempts conservatively and requires stop confirmation before another claim', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-managed-'));
  dirs.push(dir);
  const path = join(dir, 'state.db');
  const e = create(path);
  profile(e);
  let entered = false;
  e.executors.start([
    adapter('codex', async (i) => {
      entered = true;
      await new Promise<void>((r) =>
        i.signal.addEventListener('abort', () => r(), { once: true }),
      );
      throw Error('stopped');
    }),
  ]);
  const w = workflow(e, 'codex'),
    r = start(e, w.id, 1);
  await vi.waitFor(() => expect(entered).toBe(true));
  const work = e.store.work()[0];
  await e.executors.stop();
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  const next = create(path),
    execute = vi.fn(adapter().run);
  next.executors.start([adapter('codex', execute)]);
  const record = next.executors.inspect(work.id).items[0];
  expect(record.state).toBe('interrupted');
  expect(next.store.get<WorkRequest>('work', work.id)?.status).toBe('held');
  expect(() => next.executors.confirmStopped(record.id, false as true)).toThrow(
    /confirmation/,
  );
  await new Promise((r) => setTimeout(r, 20));
  expect(execute).not.toHaveBeenCalled();
  next.executors.confirmStopped(record.id, true);
  await settled(next, r.id);
  expect(execute).toHaveBeenCalledTimes(1);
});
it('retains configuration locally and keeps provenance out of portable definitions', async () => {
  const e = create();
  profile(e);
  e.executors.start([adapter()]);
  const w = workflow(e, 'codex'),
    r = start(e, w.id, null);
  await settled(e, r.id);
  const exported = exportWorkflows(e.store, w.id);
  expect(JSON.stringify(exported)).toContain('"executor":"codex"');
  expect(JSON.stringify(exported)).not.toContain('/fake/codex');
  expect(JSON.stringify(exported)).not.toContain('managedExecutions');
  expect(() =>
    save(e, {
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      expectedRevision: 0,
    }),
  ).toThrow(/changed/);
});
it('differences reported cumulative usage and keeps unknown resumed history unknown', () => {
  const values = [
    {
      provider: 'openai',
      model: 'test',
      inputTokens: 150,
      outputTokens: 30,
      cachedInputTokens: 20,
    },
  ];
  expect(
    usageDelta(values, [
      {
        provider: 'openai',
        model: 'test',
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: 10,
      },
    ]),
  ).toEqual([
    {
      provider: 'openai',
      model: 'test',
      inputTokens: 50,
      outputTokens: 20,
      cachedInputTokens: 10,
    },
  ]);
  expect(usageDelta(values, null)).toBeUndefined();
});

it('keeps the event loop responsive while an ordinary script runs beside managed dispatch', () => {
  expect(() =>
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./fixtures/managed-pump.mjs', import.meta.url)),
      ],
      { timeout: 2500, stdio: 'pipe' },
    ),
  ).not.toThrow();
});

it('blocks external reclaim of expired managed work before the old harness is reconciled', async () => {
  const e = create();
  profile(e);
  let entered = false;
  e.executors.start([
    adapter('codex', async (i) => {
      entered = true;
      await new Promise<void>((r) =>
        i.signal.addEventListener('abort', () => r(), { once: true }),
      );
      throw Error('stopped');
    }),
  ]);
  const r = start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() => expect(entered).toBe(true));
  const work = e.store.work()[0];
  e.store.put('work', {
    ...work,
    leaseUntil: new Date(Date.now() - 1).toISOString(),
  });
  e.pump();
  expect(() =>
    e.claim(work.id, {
      workerId: 'external',
      freshContext: true,
      tools: [],
      skills: [],
    }),
  ).toThrow(/managed|uncertain|reconcil/i);
});
it('holds unexpected harness failures instead of repeating unknown external effects', async () => {
  const e = create();
  profile(e);
  const run = vi.fn(async () => {
    throw Error('Harness process ended (signal)');
  });
  e.executors.start([adapter('codex', run)]);
  const r = start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.executors.inspect(e.store.work()[0].id).items[0].state).toBe(
      'interrupted',
    ),
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(e.store.work()[0].status).toBe('held');
  expect(e.run(r.id).status).toBe('waiting');
});
it('records per-attempt Pi usage on every assignment in a continuing session', async () => {
  const e = create();
  profile(e, 'pi', { tools: ['git'] });
  e.executors.start([
    adapter('pi', async (i) => {
      i.onSession('pi-native');
      return {
        output: i.work.input,
        usageScope: 'attempt',
        usage: [
          {
            provider: 'fixture',
            model: 'model',
            inputTokens: 100,
            outputTokens: 10,
          },
        ],
      };
    }),
  ]);
  const run = start(e, groupedWorkflow(e, 'pi').id, 1);
  await settled(e, run.id);
  const receipts = e.store.list<any>('usageAttempts').filter((u) => u.snapshot);
  expect(receipts).toHaveLength(2);
  for (const receipt of receipts)
    expect(receipt.snapshot.models).toEqual([
      {
        provider: 'fixture',
        model: 'model',
        inputTokens: 100,
        outputTokens: 10,
      },
    ]);
});
function groupedWorkflow(
  e: Engine,
  executor = 'codex',
  defaults: { agentModel?: string; agentEffort?: string } = {},
) {
  const d = blankDefinition();
  d.executor = executor;
  Object.assign(d, defaults);
  const a = d.nodes.find((n) => n.kind === 'agent')!;
  if (a.kind !== 'agent') throw Error();
  a.context = { ...a.context, continuityGroup: 'author', tools: ['git'] };
  const second = { ...structuredClone(a), id: 'second' };
  d.nodes.push(second);
  const edge = d.edges.find((edge) => edge.source === a.id)!;
  const exit = edge.target;
  edge.target = second.id;
  d.edges.push({
    id: 'second-exit',
    source: second.id,
    target: exit,
    port: 'default',
  });
  const w = e.create('Pinned continuity', '', d);
  e.publish(w.id);
  return w;
}
it('uses the captured continuity capabilities after local profile edits', async () => {
  const e = create();
  profile(e, 'codex', { tools: ['git'] });
  let calls = 0;
  e.executors.start([
    adapter('codex', async (i) => {
      calls++;
      i.onSession('native');
      if (calls === 1)
        save(e, {
          ...e.executors.profiles().find((p) => p.id === 'codex')!,
          tools: [],
          expectedRevision: 1,
        });
      return { output: i.work.input };
    }),
  ]);
  const r = start(e, groupedWorkflow(e).id, 1);
  await settled(e, r.id);
  expect(calls).toBe(2);
});
it('invalidates a resumed usage baseline after an ungraceful restart', async () => {
  const e = create();
  profile(e, 'codex', { tools: ['git'] });
  let calls = 0;
  e.executors.start([
    adapter('codex', async (i) => {
      calls++;
      i.onSession('native');
      if (calls === 2) {
        await new Promise<void>((r) =>
          i.signal.addEventListener('abort', () => r(), { once: true }),
        );
        throw Error('stopped');
      }
      return {
        output: i.work.input,
        usage: [
          {
            provider: 'openai',
            model: 'test',
            inputTokens: 100,
            outputTokens: 10,
          },
        ],
      };
    }),
  ]);
  const r = start(e, groupedWorkflow(e).id, 1);
  await vi.waitFor(() => expect(calls).toBe(2));
  const work = e.store.work().find((w) => w.nodeId === 'second')!,
    activeRecord = e.executors.inspect(work.id).items[0];
  const session = e.store.list<any>('executorSessions')[0];
  await e.executors.stop();
  // Preserve the exact running records that an abrupt process loss would leave.
  e.store.put('managedExecutions', activeRecord);
  e.store.put('executorSessions', session);
  const next = new Engine(e.store, process.cwd());
  engines.push(next);
  engines.splice(engines.indexOf(e), 1);
  e.stop();
  next.executors.start([
    adapter('codex', async (i) => ({
      output: i.work.input,
      usage: [
        {
          provider: 'openai',
          model: 'test',
          inputTokens: 150,
          outputTokens: 20,
        },
      ],
    })),
  ]);
  next.executors.confirmStopped(activeRecord.id, true);
  await settled(next, r.id);
  expect(
    next.store
      .list<any>('usageAttempts')
      .filter((u) => u.workId === work.id && u.snapshot),
  ).toHaveLength(0);
});

it('rejects a permission answer after the claim expires even before the observer ticks', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      await i.request({
        kind: 'permission',
        title: 'Expired approval',
        detail: 'test command',
      });
      return { output: true };
    }),
  ]);
  start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  const work = e.store.work()[0],
    record = e.executors.inspect(work.id).items[0];
  e.store.put('work', {
    ...work,
    leaseUntil: new Date(Date.now() - 1).toISOString(),
  });
  expect(() =>
    e.executors.respond({
      executionId: record.id,
      requestId: record.requests[0].id,
      answer: { allow: true },
    }),
  ).toThrow(/no longer active|claim changed/);
});
it('pins the resolved executable and default directory across restart and retry', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    {
      ...adapter(),
      detect: async (override) => ({
        status: 'detected',
        command: override ?? '/fake/original',
      }),
      run: async (i) => {
        i.onSession('native');
        await new Promise<void>((resolve) =>
          i.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        throw Error('stopped');
      },
    },
  ]);
  const r = start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('running'),
  );
  const work = e.store.work()[0];
  await e.executors.stop();
  e.stop();
  const next = new Engine(e.store, '/different/server-directory');
  engines.splice(engines.indexOf(e), 1);
  engines.push(next);
  const run = vi.fn(async (i: HarnessRun) => ({ output: i.work.input }));
  next.executors.start([
    {
      ...adapter(),
      detect: async (override) => ({
        status: 'detected',
        command: override ?? '/fake/replacement',
      }),
      run,
    },
  ]);
  next.executors.confirmStopped(
    next.executors.inspect(work.id).items[0].id,
    true,
  );
  await settled(next, r.id);
  expect(run.mock.calls[0][0]).toMatchObject({
    command: '/fake/original',
    cwd: process.cwd(),
  });
});
it('renews a managed claim while a native question is pending', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      await i.request({
        kind: 'permission',
        title: 'Waiting',
        detail: 'test command',
      });
      return { output: true };
    }),
  ]);
  start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  const work = e.store.work()[0];
  e.store.put('work', {
    ...work,
    leaseUntil: new Date(Date.now() + 30000).toISOString(),
  });
  await vi.waitFor(
    () =>
      expect(
        Date.parse(e.store.work()[0].leaseUntil!) - Date.now(),
      ).toBeGreaterThan(240000),
    { timeout: 2000 },
  );
  expect(e.executors.inspect(work.id).items[0].state).toBe('needs_human');
});
it('stops active work when its local profile is disabled', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      await i.request({
        kind: 'permission',
        title: 'Waiting',
        detail: 'test command',
      });
      return { output: true };
    }),
  ]);
  start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  save(e, {
    ...e.executors.profiles().find((p) => p.id === 'codex')!,
    enabled: false,
    expectedRevision: 1,
  });
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('interrupted'),
  );
});

it('defaults to three slots and supports large limits, Unlimited and returning to Limited', async () => {
  const e = create();
  profile(e, 'codex');
  const inputs: HarnessRun[] = [];
  e.executors.start([
    adapter('codex', async (i) => {
      inputs.push(i);
      await new Promise<void>((resolve) =>
        i.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return { output: i.work.input };
    }),
  ]);
  const w = workflow(e, 'codex'),
    runs = Array.from({ length: 12 }, (_, i) => start(e, w.id, i));
  await vi.waitFor(() => expect(inputs).toHaveLength(3));
  expect(e.store.work().filter((w) => w.status === 'available')).toHaveLength(
    9,
  );
  for (const work of e.available(undefined, { advance: false }))
    expect(work.managedExecution).toMatchObject({
      state: 'queued',
      reason: 'Waiting for a shared Agent assignment slot',
    });
  e.executors.saveSettings({ expectedRevision: 0, concurrency: 10 });
  await vi.waitFor(() => expect(inputs).toHaveLength(10));
  e.executors.saveSettings({ expectedRevision: 1, concurrency: null });
  await vi.waitFor(() => expect(inputs).toHaveLength(12));
  e.executors.saveSettings({ expectedRevision: 2, concurrency: 2 });
  expect(inputs.every((i) => !i.signal.aborted)).toBe(true);
  const queued = start(e, w.id, 13);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(inputs).toHaveLength(12);
  expect(e.store.work().find((work) => work.runId === queued.id)?.status).toBe(
    'available',
  );
  e.cancel(queued.id);
  for (const run of runs) e.cancel(run.id);
});
it('shares capacity across harnesses and lowers it without interrupting active assignments', async () => {
  const e = create();
  e.executors.saveSettings({ expectedRevision: 0, concurrency: 2 });
  profile(e, 'codex');
  profile(e, 'claude-code');
  const calls: HarnessRun[] = [];
  const finish: (() => void)[] = [];
  const run: HarnessAdapter['run'] = async (input) => {
    calls.push(input);
    await new Promise<void>((resolve) => {
      finish.push(resolve);
      input.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return { output: input.work.input };
  };
  e.executors.start([adapter('codex', run), adapter('claude-code', run)]);
  const a = workflow(e, 'codex'),
    b = workflow(e, 'claude-code');
  const runs = [
    start(e, a.id, 1),
    start(e, b.id, 2),
    start(e, a.id, 3),
    start(e, b.id, 4),
  ];
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(new Set(calls.map((c) => c.profile.harness)).size).toBe(2);
  e.executors.saveSettings({ expectedRevision: 1, concurrency: 1 });
  expect(calls.every((c) => !c.signal.aborted)).toBe(true);
  finish[0]();
  await vi.waitFor(() =>
    expect(e.run(calls[0].work.runId).status).toBe('completed'),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(calls).toHaveLength(2);
  finish[1]();
  await vi.waitFor(() => expect(calls).toHaveLength(3));
  expect(calls[2].signal.aborted).toBe(false);
  for (const r of runs) if (e.run(r.id).status !== 'completed') e.cancel(r.id);
});
it('keeps exclusive resource coordination with Unlimited', async () => {
  const e = create();
  e.executors.saveSettings({ expectedRevision: 0, concurrency: null });
  profile(e);
  const calls: HarnessRun[] = [];
  const finish: (() => void)[] = [];
  e.executors.start([
    adapter('codex', async (input) => {
      calls.push(input);
      await new Promise<void>((resolve) => {
        finish.push(resolve);
        input.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return { output: input.work.input };
    }),
  ]);
  const w = workflow(e, 'codex', {
    resources: [{ source: 'literal', value: 'shared-project' }],
  });
  const a = start(e, w.id, 1),
    b = start(e, w.id, 2);
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(calls).toHaveLength(1);
  finish[0]();
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  finish[1]();
  await settled(e, a.id);
  await settled(e, b.id);
});
it('caps each profile without starving other profiles under the shared limit', async () => {
  const e = create();
  e.executors.saveSettings({ expectedRevision: 0, concurrency: 3 });
  profile(e, 'codex', { concurrency: 1 });
  profile(e, 'claude-code', { concurrency: 2 });
  const calls: HarnessRun[] = [],
    finish: (() => void)[] = [];
  const run: HarnessAdapter['run'] = async (input) => {
    calls.push(input);
    await new Promise<void>((resolve) => {
      finish.push(resolve);
      input.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return { output: input.work.input };
  };
  e.executors.start([adapter('codex', run), adapter('claude-code', run)]);
  const a = workflow(e, 'codex'),
    b = workflow(e, 'claude-code');
  const runs = [
    start(e, a.id, 1),
    start(e, a.id, 2),
    start(e, a.id, 3),
    start(e, b.id, 4),
    start(e, b.id, 5),
    start(e, b.id, 6),
  ];
  await vi.waitFor(() => expect(calls).toHaveLength(3));
  expect(calls.map((c) => c.profile.id)).toEqual([
    'codex',
    'claude-code',
    'claude-code',
  ]);
  expect(
    e.available().filter((w) => w.executor === 'codex')[0].managedExecution
      ?.reason,
  ).toContain('profile assignment slot');
  const current = e.executors.profiles().find((p) => p.id === 'codex')!;
  const { revision, ...fields } = current;
  e.executors.saveProfile({
    ...fields,
    expectedRevision: revision,
    concurrency: 2,
  });
  finish[1]();
  await vi.waitFor(() => expect(calls).toHaveLength(4));
  expect(calls[3].profile.id).toBe('codex');
  expect(calls[0].profile.concurrency).toBe(1);
  expect(calls[3].profile.concurrency).toBe(2);
  for (const r of runs) e.cancel(r.id);
});

it('persists revision-checked shared and profile concurrency settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-execution-settings-'));
  dirs.push(dir);
  const path = join(dir, 'state.db'),
    e = create(path);
  expect(e.executors.settings()).toEqual({ revision: 0, concurrency: 3 });
  expect(
    await e.executors.manage({
      action: 'save_settings',
      expectedRevision: 0,
      concurrency: 5,
    }),
  ).toEqual({ revision: 1, concurrency: 5 });
  expect(() =>
    e.executors.saveSettings({ expectedRevision: 0, concurrency: 2 }),
  ).toThrow('Reload');
  for (const concurrency of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() =>
      e.executors.saveSettings({ expectedRevision: 1, concurrency }),
    ).toThrow();
  e.store.put('executorProfiles', {
    ...executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Old draft configuration',
    }),
    concurrency: 1,
  });
  expect(e.executors.profiles().find((p) => p.id === 'codex')).toHaveProperty(
    'concurrency',
    1,
  );
  e.executors.saveSettings({
    expectedRevision: 1,
    concurrency: Number.MAX_SAFE_INTEGER,
  });
  expect(e.executors.settings().concurrency).toBe(Number.MAX_SAFE_INTEGER);
  e.executors.saveSettings({ expectedRevision: 2, concurrency: null });
  const reopened = create(path);
  expect(await reopened.executors.manage({ action: 'settings' })).toEqual({
    revision: 3,
    concurrency: null,
  });
});
it('rechecks shared capacity after asynchronous executable detection', async () => {
  const e = create();
  profile(e);
  profile(e, 'claude-code');
  const calls: HarnessRun[] = [];
  let release!: () => void;
  let detecting = false;
  const run: HarnessAdapter['run'] = async (input) => {
    calls.push(input);
    await new Promise<void>((resolve) =>
      input.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    return { output: input.work.input };
  };
  e.executors.start([
    adapter('codex', run),
    {
      ...adapter('claude-code', run),
      detect: async () => {
        detecting = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { status: 'detected', command: '/fake/claude-code' };
      },
    },
  ]);
  start(e, workflow(e, 'codex').id, 1);
  start(e, workflow(e, 'claude-code').id, 2);
  await vi.waitFor(() => expect(detecting).toBe(true));
  expect(calls).toHaveLength(1);
  e.executors.saveSettings({ expectedRevision: 0, concurrency: 1 });
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(calls).toHaveLength(1);
  expect(e.store.work().filter((w) => w.status === 'available')).toHaveLength(
    1,
  );
});
it('rejects unsupported or empty native question answers without consuming the pending request', async () => {
  const e = create();
  profile(e);
  e.executors.start([
    adapter('codex', async (i) => {
      await i.request({
        kind: 'question',
        title: 'Choose',
        detail: '',
        questions: [{ id: 'choice', text: 'Which?', options: ['A', 'B'] }],
      });
      return { output: true };
    }),
  ]);
  start(e, workflow(e, 'codex').id, 1);
  await vi.waitFor(() =>
    expect(e.store.work()[0].managedExecution?.state).toBe('needs_human'),
  );
  const record = e.executors.inspect(e.store.work()[0].id).items[0];
  for (const answer of ['C', ' '])
    expect(() =>
      e.executors.respond({
        executionId: record.id,
        requestId: record.requests[0].id,
        answer: { answers: { choice: [answer] } },
      }),
    ).toThrow(/supplied choices/);
  expect(e.executors.inspect(record.workId).items[0].requests[0].state).toBe(
    'pending',
  );
});

it.each([
  ['read-only', 'full-access', 'full-access', 'workflow'],
  ['full-access', 'standard', 'standard', 'workflow'],
  ['full-access', undefined, 'full-access', 'harness'],
] as const)(
  'resolves harness default %s and workflow override %s',
  async (defaultMode, override, effective, source) => {
    const e = create();
    profile(e, 'codex', { permissions: defaultMode });
    const calls: HarnessRun[] = [];
    e.executors.start([
      adapter('codex', async (input) => {
        calls.push(input);
        return { output: input.work.input };
      }),
    ]);
    const d = blankDefinition();
    d.executor = 'codex';
    d.agentPermissions = override;
    const w = e.create('Permissions', '', d);
    e.publish(w.id);
    const r = start(e, w.id, 1);
    await settled(e, r.id);
    expect(calls[0].profile.permissions).toBe(effective);
    expect(e.store.work()[0].executorPermissions).toBe(override);
    expect(e.executors.inspect(e.store.work()[0].id).items[0]).toMatchObject({
      profile: { permissions: effective },
      permissionSource: source,
    });
  },
);
it('normalizes existing ask defaults without changing their saved revision', () => {
  const e = create();
  e.store.put('executorProfiles', {
    ...executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
    }),
    permissions: 'ask',
    revision: 3,
  });
  expect(e.executors.profiles().find((p) => p.id === 'codex')).toMatchObject({
    permissions: 'standard',
    revision: 3,
  });
});
it('captures workflow permission overrides in the published assignment', async () => {
  const e = create();
  profile(e);
  const calls: HarnessRun[] = [];
  const d = blankDefinition();
  d.executor = 'codex';
  d.agentPermissions = 'read-only';
  const w = e.create('Captured permissions', '', d);
  e.publish(w.id);
  e.executors.start([
    adapter('codex', async (input) => {
      calls.push(input);
      return { output: input.work.input };
    }),
  ]);
  const first = start(e, w.id, 1);
  const current = e.workflow(w.id);
  e.update(w.id, {
    draft: { ...current.draft, agentPermissions: 'full-access' },
    draftRevision: current.draftRevision,
  });
  e.publish(w.id);
  await settled(e, first.id);
  const second = start(e, w.id, 2);
  await settled(e, second.id);
  expect(calls.map((c) => c.profile.permissions)).toEqual([
    'read-only',
    'full-access',
  ]);
});

it('keeps long assignments alive and renews claims without the retired runtime cutoff', async () => {
  vi.useFakeTimers();
  const e = create();
  e.store.put('executorProfiles', {
    ...executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      enabled: true,
    }),
    timeoutMs: 1000,
  });
  const run = vi.fn(async (input: HarnessRun) => {
    const answer = await input.request({
      kind: 'permission',
      title: 'Long assignment',
      detail: 'test command',
    });
    return { output: answer.allow ?? false };
  });
  e.executors.start([adapter('codex', run)]);
  const r = start(e, workflow(e, 'codex').id, 1);
  await vi.advanceTimersByTimeAsync(0);
  expect(e.store.work()[0].managedExecution?.state).toBe('needs_human');
  await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
  const work = e.store.work()[0],
    record = e.executors.inspect(work.id).items[0];
  expect(record.state).toBe('needs_human');
  expect(work.status).toBe('claimed');
  expect(Date.parse(work.leaseUntil!)).toBeGreaterThan(Date.now());
  expect(run).toHaveBeenCalledTimes(1);
  expect(record.profile).not.toHaveProperty('timeoutMs');
  e.executors.respond({
    executionId: record.id,
    requestId: record.requests[0].id,
    answer: { allow: false },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(e.run(r.id).status).toBe('completed');
}, 10000);
it('accepts older continuity snapshots while omitting retired timeout settings', async () => {
  const e = create();
  profile(e, 'codex', { tools: ['git'] });
  const calls: HarnessRun[] = [];
  e.executors.start([
    adapter('codex', async (input) => {
      calls.push(input);
      input.onSession('native');
      if (calls.length === 1) {
        const session = e.store.list<any>('executorSessions')[0];
        e.store.put('executorSessions', {
          ...session,
          profile: { ...session.profile, timeoutMs: 1000 },
        });
      }
      return { output: input.work.input };
    }),
  ]);
  const r = start(e, groupedWorkflow(e).id, 1);
  await settled(e, r.id);
  expect(calls).toHaveLength(2);
  for (const call of calls)
    expect(call.profile).not.toHaveProperty('timeoutMs');
  expect(calls[1].sessionId).toBe('native');
  expect(executorProfileSchema.shape).not.toHaveProperty('timeoutMs');
  expect(definitionSchema.shape).not.toHaveProperty('agentTimeoutMs');
});
it('pins the workflow model across retries and later published edits', async () => {
  const e = create();
  profile(e, 'codex', { model: 'harness-model' });
  const d = blankDefinition();
  d.executor = 'codex';
  d.agentModel = 'workflow-model';
  d.nodes.find((n) => n.kind === 'agent')!.outputSchema = { type: 'number' };
  const w = e.create('Pinned model', '', d);
  e.publish(w.id);
  const calls: string[] = [];
  e.executors.start([
    adapter('codex', async (input) => {
      calls.push(input.profile.model!);
      if (calls.length === 1) {
        const current = e.workflow(w.id);
        e.update(w.id, {
          draft: { ...current.draft, agentModel: 'later-model' },
          draftRevision: current.draftRevision,
        });
        e.publish(w.id);
        return { output: 'invalid number' };
      }
      return { output: input.work.input };
    }),
  ]);
  const first = start(e, w.id, 1);
  await settled(e, first.id);
  const next = start(e, w.id, 2);
  await settled(e, next.id);
  expect(calls).toEqual(['workflow-model', 'workflow-model', 'later-model']);
});
it('retains the native resolved model in a continuing session when defaults change', async () => {
  const e = create();
  profile(e, 'codex', { model: 'model-alias', tools: ['git'] });
  const calls: HarnessRun[] = [];
  e.executors.start([
    adapter('codex', async (input) => {
      calls.push(input);
      input.onSession('native', 'resolved-model');
      if (calls.length === 1)
        profile(e, 'codex', {
          model: 'new-default',
          tools: ['git'],
          expectedRevision: 1,
        });
      return { output: input.work.input };
    }),
  ]);
  const r = start(e, groupedWorkflow(e).id, 1);
  await settled(e, r.id);
  expect(calls.map((c) => c.profile.model)).toEqual([
    'model-alias',
    'resolved-model',
  ]);
  expect(calls[1].sessionId).toBe('native');
});

it.each([
  [undefined, undefined, undefined, 'high', 'harness'],
  ['low', undefined, undefined, 'low', 'workflow'],
  ['low', 'medium', 'node-model', 'medium', 'node'],
  ['low', null, 'node-model', null, 'node'],
  [null, undefined, undefined, null, 'workflow'],
] as const)(
  'resolves thinking effort %s / %s and node model %s',
  async (workflowEffort, nodeEffort, nodeModel, expectedEffort, source) => {
    const e = create();
    profile(e, 'codex', { model: 'harness-model', effort: 'high' });
    const run = vi.fn(adapter().run);
    e.executors.start([
      {
        ...adapter('codex', run),
        models: async () => ({
          models: ['harness-model', 'workflow-model', 'node-model'].map(
            (id) => ({ id, name: id, effortLevels: ['low', 'medium', 'high'] }),
          ),
        }),
      },
    ]);
    const d = blankDefinition();
    d.executor = 'codex';
    d.agentModel = 'workflow-model';
    d.agentEffort = workflowEffort;
    const node = d.nodes.find((n) => n.kind === 'agent')!;
    Object.assign(node, {
      model: nodeModel,
      effort: nodeEffort,
      context: { ...node.context, tier: 'fast' },
    });
    const w = e.create('Effort inheritance', '', definitionSchema.parse(d));
    e.publish(w.id);
    const r = start(e, w.id, 1);
    await settled(e, r.id);
    expect(run.mock.calls[0][0].profile).toMatchObject({
      model: nodeModel ?? 'workflow-model',
      effort: expectedEffort,
    });
    const work = e.store.work()[0];
    expect(e.executors.inspect(work.id).items[0]).toMatchObject({
      modelSource: nodeModel ? 'node' : 'workflow',
      effortSource: source,
    });
    expect(work).toMatchObject({
      executorModel: nodeModel ?? 'workflow-model',
      executorModelSource: nodeModel ? 'node' : 'workflow',
    });
  },
);

it.each([
  ['known', 'ultra', 'not supported'],
  ['unknown', 'high', 'does not report'],
  [undefined, 'high', 'Select a model'],
] as const)(
  'blocks unsupported effort for %s before claiming',
  async (model, effort, reason) => {
    const e = create();
    profile(e, 'codex', { model, effort });
    const run = vi.fn(adapter().run);
    e.executors.start([
      {
        ...adapter('codex', run),
        models: async () => ({
          models: [
            { id: 'known', name: 'Known', effortLevels: ['low', 'high'] },
          ],
        }),
      },
    ]);
    const r = start(e, workflow(e, 'codex').id, 1);
    await vi.waitFor(() =>
      expect(e.available(r.id)[0].managedExecution?.reason).toContain(reason),
    );
    expect(e.available(r.id)[0].attempt).toBe(0);
    expect(run).not.toHaveBeenCalled();
  },
);

it('keeps node overrides portable and ignores them for connected agents', async () => {
  const e = create();
  profile(e);
  const run = vi.fn(adapter().run);
  e.executors.start([adapter('codex', run)]);
  const w = workflow(e, 'codex', {
    executor: null,
    model: 'node-model',
    effort: 'high',
  });
  const r = start(e, w.id, 1);
  const work = e.available(r.id)[0];
  expect(work.executorModel).toBeUndefined();
  expect(work.executorEffort).toBeUndefined();
  expect(
    e.workflow(w.id).draft.nodes.find((n) => n.kind === 'agent'),
  ).toMatchObject({ model: 'node-model', effort: 'high' });
  expect(run).not.toHaveBeenCalled();
});

it.each(['model', 'effort'] as const)(
  'blocks conflicting node %s overrides within a pinned continuity group',
  async (setting) => {
    const e = create();
    profile(e, 'codex', {
      model: 'first-model',
      effort: 'high',
      tools: ['git'],
    });
    const calls: HarnessRun[] = [];
    e.executors.start([
      {
        ...adapter('codex', async (input) => {
          calls.push(input);
          input.onSession('native', 'resolved-first');
          return { output: input.work.input };
        }),
        models: async () => ({
          models: [
            { id: 'first-model', name: 'First', effortLevels: ['low', 'high'] },
          ],
        }),
      },
    ]);
    const w = groupedWorkflow(e);
    const draft = e.workflow(w.id);
    const agents = draft.draft.nodes.filter((n) => n.kind === 'agent');
    Object.assign(
      agents[1],
      setting === 'model' ? { model: 'other-model' } : { effort: 'low' },
    );
    e.update(w.id, { draftRevision: draft.draftRevision, draft: draft.draft });
    e.publish(w.id);
    const r = start(e, w.id, 1);
    await vi.waitFor(() =>
      expect(e.available(r.id)[0]?.managedExecution?.reason).toContain(
        `another ${setting === 'model' ? 'model' : 'thinking effort'}`,
      ),
    );
    expect(calls).toHaveLength(1);
    expect(e.available(r.id)[0].attempt).toBe(0);
  },
);

it('retains captured node effort across retries and later profile changes', async () => {
  const { HarnessResultError } =
    await import('../packages/runtime/src/executors/contracts');
  const e = create();
  profile(e, 'codex', { model: 'model', effort: 'low' });
  const efforts: (string | null | undefined)[] = [];
  e.executors.start([
    {
      ...adapter('codex', async (input) => {
        efforts.push(input.profile.effort);
        if (efforts.length === 1) {
          profile(e, 'codex', {
            model: 'later',
            effort: 'low',
            expectedRevision: 1,
          });
          throw new HarnessResultError('Completed failure');
        }
        return { output: input.work.input };
      }),
      models: async () => ({
        models: [{ id: 'model', name: 'Model', effortLevels: ['low', 'high'] }],
      }),
    },
  ]);
  const r = start(e, workflow(e, 'codex', { effort: 'high' }).id, 1);
  await settled(e, r.id);
  expect(efforts).toEqual(['high', 'high']);
  expect(e.executors.inspect(e.store.work()[0].id).items[0]).toMatchObject({
    effortSource: 'node',
    profile: { model: 'model', effort: 'high' },
  });
});

it.each(['model', 'effort'] as const)(
  'does not silently discard an inherited workflow %s after an earlier node override',
  async (setting) => {
    const e = create();
    profile(e, 'codex', {
      model: 'workflow-model',
      effort: 'high',
      tools: ['git'],
    });
    const w = groupedWorkflow(e),
      current = e.workflow(w.id);
    current.draft.agentModel = 'workflow-model';
    current.draft.agentEffort = 'high';
    const first = current.draft.nodes.find((n) => n.kind === 'agent')!;
    Object.assign(
      first,
      setting === 'model' ? { model: 'node-model' } : { effort: 'low' },
    );
    e.update(w.id, {
      draft: current.draft,
      draftRevision: current.draftRevision,
    });
    e.publish(w.id);
    const run = vi.fn(adapter().run);
    e.executors.start([
      {
        ...adapter('codex', run),
        models: async () => ({
          models: ['workflow-model', 'node-model'].map((id) => ({
            id,
            name: id,
            effortLevels: ['low', 'high'],
          })),
        }),
      },
    ]);
    const r = start(e, w.id, 1);
    await vi.waitFor(() =>
      expect(e.available(r.id)[0]?.managedExecution?.reason).toContain(
        `another ${setting === 'model' ? 'model' : 'thinking effort'}`,
      ),
    );
    expect(run).toHaveBeenCalledTimes(1);
  },
);
