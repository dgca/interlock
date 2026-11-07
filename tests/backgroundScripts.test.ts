import { afterEach, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, randomBytes } from 'node:crypto';
import { batchDefinition } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';
import { BackgroundScripts } from '../packages/runtime/src/backgroundScripts';
import { tmpdir } from 'node:os';
import { blankDefinition, nodeSchema, type Run } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store, BackgroundFiles, type BackgroundJob } from '@interlock/storage';

const roots: string[] = [];
const engines: Engine[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'interlock-background-'));
  roots.push(root);
  const path = join(root, 'db.sqlite');
  const open = () => {
    const engine = new Engine(
      new Store(path, { secretKeyFile: join(root, 'key') }),
      root,
    );
    engines.push(engine);
    return engine;
  };
  return { root, path, open };
}
function start(
  engine: Engine,
  command: string,
  extra: Record<string, unknown> = {},
) {
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Background',
    kind: 'script',
    executionMode: 'background',
    language: 'javascript',
    timeoutMs: 5000,
    command,
    ...extra,
  });
  if (extra.onFailure === 'route')
    definition.edges.push({
      id: 'failed',
      source: 'agent',
      target: 'exit',
      port: 'failed',
    });
  const workflow = engine.create('background', '', definition);
  engine.publish(workflow.id);
  return engine.start(workflow.id, null).run.id;
}
function step(engine: Engine, id: string) {
  return engine.run(id).executions.findLast((e) => e.kind === 'script')!;
}
async function state(
  engine: Engine,
  id: string,
  status: Run['status'] = 'completed',
) {
  return vi.waitFor(
    () => {
      engine.pump();
      const run = engine.run(id);
      expect(run.status, run.error).toBe(status);
      return run;
    },
    { timeout: 8000, interval: 50 },
  );
}
async function running(engine: Engine, id: string) {
  await vi.waitFor(
    () => expect(step(engine, id).background?.state).toBe('running'),
    { timeout: 5000 },
  );
}
afterEach(async () => {
  for (const engine of engines) {
    try {
      for (const run of engine.store.runs()) {
        const e = step(engine, run.id);
        if (
          e?.background &&
          ['running', 'launching'].includes(e.background.state)
        )
          engine.manageScript({
            action: 'stop',
            runId: run.id,
            executionId: e.id,
          });
      }
    } catch {}
    engine.stop();
    try {
      engine.store.close();
    } catch {}
  }
  engines.length = 0;
  // Let independently supervised children finish their stop request before deleting receipts.
  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it('reconnects the same live execution after server shutdown without replay', async () => {
  const { open, root } = setup();
  const first = open();
  const id = start(
    first,
    `require('node:fs').appendFileSync('effects', 'x'); console.log('started'); await new Promise(r=>setTimeout(r,1200)); return {done:true};`,
  );
  await running(first, id);
  const executionId = step(first, id).id;
  first.stop();
  first.store.close();
  const next = open();
  next.pump();
  await running(next, id);
  expect(step(next, id).id).toBe(executionId);
  const run = await state(next, id);
  expect(run.output).toEqual({ done: true });
  expect(readFileSync(join(root, 'effects'), 'utf8')).toBe('x');
  next.pump();
  next.pump();
  expect(next.run(id).executions.filter((e) => e.kind === 'exit')).toHaveLength(
    1,
  );
});
it('recovers completion while offline repeatedly without replay or duplicate advancement', async () => {
  const { open, root } = setup();
  const first = open();
  const id = start(
    first,
    `require('node:fs').appendFileSync('effects','x'); await new Promise(r=>setTimeout(r,300)); return 42;`,
  );
  await running(first, id);
  const executionId = step(first, id).id;
  first.stop();
  first.store.close();
  await vi.waitFor(() =>
    expect(
      existsSync(join(root, 'db.sqlite.scripts', executionId, 'result')),
    ).toBe(true),
  );
  const next = open();
  const run = await state(next, id);
  expect(run.output).toBe(42);
  next.stop();
  next.store.close();
  const third = open();
  third.pump();
  expect(third.run(id).output).toBe(42);
  expect(readFileSync(join(root, 'effects'), 'utf8')).toBe('x');
  expect(
    third.run(id).executions.filter((e) => e.kind === 'exit'),
  ).toHaveLength(1);
});
it('enforces a deadline while offline and keeps the durable failure', async () => {
  const { open, root } = setup();
  const first = open();
  const id = start(
    first,
    `await new Promise(r=>setTimeout(r,5000)); require('node:fs').writeFileSync('late','bad'); return 1;`,
    { timeoutMs: 500 },
  );
  await running(first, id);
  const executionId = step(first, id).id;
  first.stop();
  first.store.close();
  await vi.waitFor(() =>
    expect(
      existsSync(join(root, 'db.sqlite.scripts', executionId, 'result')),
    ).toBe(true),
  );
  const next = open();
  const run = await state(next, id, 'failed');
  expect(run.error).toContain('deadline');
  expect(existsSync(join(root, 'late'))).toBe(false);
});
it.each(['cancel', 'stop'])(
  '%s terminates the Script process group and never accepts its late result',
  async (action) => {
    const { open, root } = setup();
    const engine = open();
    const id = start(
      engine,
      `require('node:child_process').spawn('/bin/bash',['-c','sleep 1; echo bad > descendant'],{stdio:'inherit'}); await new Promise(r=>setTimeout(r,5000)); return 1;`,
    );
    await running(engine, id);
    if (action === 'cancel') engine.cancel(id);
    else
      engine.manageScript({
        action: 'stop',
        runId: id,
        executionId: step(engine, id).id,
      });
    await new Promise((r) => setTimeout(r, 1300));
    expect(engine.run(id).status).toBe('cancelled');
    expect(existsSync(join(root, 'descendant'))).toBe(false);
  },
);
it('treats a persisted launch without a supervisor as uncertain and blocks retry until explicit reconciliation', async () => {
  const { open, root } = setup();
  const engine = open();
  const launch = vi
    .spyOn(BackgroundScripts.prototype, 'launch')
    .mockImplementationOnce(() => {});
  const id = start(
    engine,
    `require('node:fs').appendFileSync('effects','x'); return 1;`,
  );
  launch.mockRestore();
  const e = step(engine, id);
  expect(e.background?.state).toBe('launching');
  const job = engine.store.get<BackgroundJob>('backgroundJobs', e.id)!;
  job.createdAt = new Date(0).toISOString();
  engine.store.put('backgroundJobs', job);
  engine.stop();
  engine.store.close();
  const next = open();
  await state(next, id, 'failed');
  expect(step(next, id).background?.state).toBe('uncertain');
  expect(() => next.retry(id)).toThrow('Reconcile');
  expect(existsSync(join(root, 'effects'))).toBe(false);
  next.manageScript({
    action: 'reconcile',
    runId: id,
    executionId: e.id,
    stopped: true,
    reason: 'Original process never started and effects checked in test',
  });
  expect(step(next, id).background?.state).toBe('reconciled');
  next.retry(id);
  await state(next, id);
  expect(readFileSync(join(root, 'effects'), 'utf8')).toBe('x');
});
it('preserves legacy Bash JSON results', async () => {
  const { open } = setup();
  const engine = open();
  const id = start(engine, 'printf \'{"bash":true}\'', { language: undefined });
  expect((await state(engine, id)).output).toEqual({ bash: true });
});

function receipt(
  files: BackgroundFiles,
  job: BackgroundJob,
  file: string,
  value: unknown,
) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(files.key(job), 'base64'),
    nonce,
  );
  cipher.setAAD(Buffer.from(files.aad(job, file)));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  writeFileSync(
    join(files.directory(job.id), file),
    JSON.stringify({
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    }),
  );
}
it('refuses identity mismatch on reconnect and stop without signalling an unrelated process', async () => {
  const { open, root } = setup();
  const engine = open();
  const id = start(
    engine,
    `await new Promise(r=>setTimeout(r,1500)); require('node:fs').writeFileSync('effects','x'); return 1;`,
  );
  await running(engine, id);
  const e = step(engine, id);
  const files = new BackgroundFiles(engine.store);
  const job = engine.store.get<BackgroundJob>('backgroundJobs', e.id)!;
  const original = files.read(job, 'identity')!;
  receipt(files, job, 'identity', { ...original, start: 'wrong-start' });
  engine.stop();
  engine.store.close();
  const next = open();
  await state(next, id, 'failed');
  expect(step(next, id).background?.state).toBe('uncertain');
  expect(() =>
    next.manageScript({ action: 'stop', runId: id, executionId: e.id }),
  ).toThrow('unverified');
  expect(existsSync(join(files.directory(job.id), 'stop'))).toBe(false);
  // The invalid identity was not signalled. Its real Script can still finish while this run remains failed.
  await vi.waitFor(() => expect(existsSync(join(root, 'effects'))).toBe(true), {
    timeout: 3000,
  });
  expect(next.run(id).status).toBe('failed');
  expect(() => next.retry(id)).toThrow('Reconcile');
});
it('fails closed on a corrupt offline result and does not follow Failed or replay', async () => {
  const { open, root } = setup();
  const engine = open();
  const id = start(
    engine,
    `require('node:fs').appendFileSync('effects','x'); await new Promise(r=>setTimeout(r,250)); return {ok:true};`,
    { onFailure: 'route' },
  );
  await running(engine, id);
  const e = step(engine, id);
  engine.stop();
  engine.store.close();
  const file = join(root, 'db.sqlite.scripts', e.id, 'result');
  await vi.waitFor(() => expect(existsSync(file)).toBe(true));
  writeFileSync(file, 'corrupt');
  const next = open();
  await state(next, id, 'failed');
  expect(step(next, id).port).not.toBe('failed');
  expect(step(next, id).background?.state).toBe('uncertain');
  expect(() => next.retry(id)).toThrow('Reconcile');
  expect(readFileSync(join(root, 'effects'), 'utf8')).toBe('x');
});
it.each([
  ["throw new Error('operation failed');", {}, 'execution'],
  ['return {wrong:true};', { outputSchema: { type: 'number' } }, 'output'],
  [
    'await new Promise(r=>setTimeout(r,5000)); return 1;',
    { timeoutMs: 300 },
    'execution',
  ],
])(
  'routes durable operation failures with the existing envelope: %s',
  async (command, extra, category) => {
    const { open } = setup();
    const engine = open();
    const id = start(engine, command, { ...extra, onFailure: 'route' });
    const run = await state(engine, id);
    expect(step(engine, id).status).toBe('failed');
    expect(step(engine, id).port).toBe('failed');
    expect(run.output).toMatchObject({
      error: { kind: 'script', category },
      input: null,
    });
  },
);
it('masks split secrets in live progress and durable outputs before exposing them', async () => {
  const { open, root } = setup();
  const engine = open();
  const secret = 'super-secret-value-224';
  const variable = engine.variables.mutate({
    action: 'create',
    name: 'token',
    kind: 'secret',
    value: secret,
  }) as { id: string };
  const id = start(
    engine,
    `process.stderr.write(process.env.TOKEN.slice(0,8)); await new Promise(r=>setTimeout(r,250)); process.stderr.write(process.env.TOKEN.slice(8)); await new Promise(r=>setTimeout(r,250)); return {token:process.env.TOKEN};`,
    { environment: [{ name: 'TOKEN', variableId: variable.id }] },
  );
  await running(engine, id);
  await new Promise((resolve) => setTimeout(resolve, 150));
  // Partial values are not exposed while a secret may span future writes.
  const progress = engine.manageScript({
    action: 'inspect',
    runId: id,
    executionId: step(engine, id).id,
  });
  expect(JSON.stringify(progress)).not.toContain('super-se');
  const run = await state(engine, id);
  expect(run.output).toEqual({ token: '[REDACTED]' });
  expect(step(engine, id).background?.progress).toBe('[REDACTED]');
  const dir = join(root, 'db.sqlite.scripts', step(engine, id).id);
  expect(readFileSync(join(dir, 'result'), 'utf8')).not.toContain(secret);
  expect(JSON.stringify(engine.inspect(id))).not.toContain(secret);
});

it('stopping a completed Script does not cancel later work in the run', async () => {
  const { open } = setup();
  const engine = open();
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Done',
    executionMode: 'background',
    language: 'javascript',
    command: 'return 1;',
  });
  definition.nodes.push(
    nodeSchema.parse({
      id: 'later',
      kind: 'agent',
      label: 'Later work',
      prompt: 'Continue',
    }),
  );
  definition.edges = definition.edges.map((edge) =>
    edge.source === 'agent' ? { ...edge, target: 'later' } : edge,
  );
  definition.edges.push({
    id: 'later-exit',
    source: 'later',
    target: 'exit',
    port: 'default',
  });
  const workflow = engine.create('later', '', definition);
  engine.publish(workflow.id);
  const id = engine.start(workflow.id, null).run.id;
  await state(engine, id, 'waiting');
  const e = step(engine, id);
  expect(e.background?.state).toBe('completed');
  engine.manageScript({ action: 'stop', runId: id, executionId: e.id });
  expect(engine.run(id).status).toBe('waiting');
});
it('stops immediately after launch intent without running the command', async () => {
  const { open, root } = setup();
  const engine = open();
  const original = BackgroundScripts.prototype.launch;
  const launch = vi
    .spyOn(BackgroundScripts.prototype, 'launch')
    .mockImplementationOnce(function (this: BackgroundScripts, ...args) {
      // An authenticated cancellation request is persisted in the handshake window before the supervisor exists.
      this.stop(args[0].id, args[1].id);
      original.apply(this, args);
    });
  const id = start(
    engine,
    `require('node:fs').writeFileSync('effects','bad'); return 1;`,
  );
  launch.mockRestore();
  await state(engine, id, 'failed');
  expect(existsSync(join(root, 'effects'))).toBe(false);
  expect(step(engine, id).error).toContain('stopped');
});

it('bounds multibyte progress and rejects oversized stdout', async () => {
  const { open } = setup();
  const engine = open();
  const id = start(
    engine,
    `console.error('🙂'.repeat(10000)); return {ok:true};`,
  );
  await state(engine, id);
  expect(
    Buffer.byteLength(step(engine, id).background?.progress ?? ''),
  ).toBeLessThanOrEqual(8192);
  expect(step(engine, id).background?.progress).toContain('🙂');
  const large = start(
    engine,
    `process.stdout.write('x'.repeat(1024*1024+1)); await new Promise(r=>setTimeout(r,5000)); return 1;`,
  );
  const run = await state(engine, large, 'failed');
  expect(run.error).toContain('exceeded 1 MiB');
  expect(step(engine, large).background?.state).toBe('completed');
});

it.each(['workflow', 'batch'] as const)(
  'blocks %s parent retries until every resumed uncertain Script is reconciled',
  async (kind) => {
    const { open, root } = setup();
    const first = open();
    const script = nodeSchema.parse({
      id: 'work',
      kind: 'script',
      label: 'Effect',
      language: 'javascript',
      executionMode: 'background',
      timeoutMs: 30000,
      command:
        "require('node:fs').appendFileSync('effects', String(input)); if (input === 1 && process.env.INTERLOCK_ATTEMPT === '1') await new Promise(resolve => setTimeout(resolve, 30000)); return input;",
    });
    const publish = (
      definition: import('@interlock/core').WorkflowDefinition,
    ) => {
      const workflow = first.create('Retry boundary', '', definition);
      first.publish(workflow.id);
      return workflow.id;
    };
    let parentWorkflowId: string;
    if (kind === 'batch') {
      parentWorkflowId = publish(batchDefinition(script, { concurrency: 1 }));
    } else {
      const leaf = blankDefinition();
      leaf.nodes[1] = { ...script, id: 'agent' };
      const leafId = publish(leaf);
      // Two waited callers exercise the full recursive retry selection, not just an immediate parent.
      parentWorkflowId = publish(workflowCall(publish(workflowCall(leafId))));
    }
    // Normal completion is the control for the same parent path.
    const control = first.start(parentWorkflowId, kind === 'batch' ? [0] : 0)
      .run.id;
    await state(first, control);
    expect(readFileSync(join(root, 'effects'), 'utf8')).toBe('0');
    const parentId = first.start(
      parentWorkflowId,
      kind === 'batch' ? [0, 1] : 1,
    ).run.id;
    let childId = '';
    await vi.waitFor(() => {
      first.pump();
      const child = first.store
        .runs()
        .find(
          (run) =>
            run.id !== control &&
            run.executions.some(
              (execution) =>
                execution.kind === 'script' &&
                execution.input === 1 &&
                execution.background?.state === 'running',
            ),
        );
      expect(child).toBeDefined();
      childId = child!.id;
      expect(readFileSync(join(root, 'effects'), 'utf8')).toBe(
        kind === 'batch' ? '001' : '01',
      );
    });
    const execution = step(first, childId);
    const files = new BackgroundFiles(first.store);
    const job = first.store.get<BackgroundJob>('backgroundJobs', execution.id)!;
    const identity = files.read(job, 'identity')!;
    receipt(files, job, 'identity', { ...identity, start: 'wrong-start' });
    first.stop();
    first.store.close();
    const next = open();
    await state(next, parentId, 'failed');
    expect(step(next, childId).background?.state).toBe('uncertain');
    const before = {
      runs: next.store.runs(),
      events: next.store.list('events'),
      work: next.store.work(),
      effects: readFileSync(join(root, 'effects'), 'utf8'),
    };
    expect(() => next.retry(childId)).toThrow('Reconcile');
    expect(() => next.retry(parentId)).toThrow('Reconcile');
    expect({
      runs: next.store.runs(),
      events: next.store.list('events'),
      work: next.store.work(),
      effects: readFileSync(join(root, 'effects'), 'utf8'),
    }).toEqual(before);
    // Restore the known original identity so its supervisor can be explicitly stopped and verified.
    receipt(new BackgroundFiles(next.store), job, 'identity', identity);
    next.manageScript({
      action: 'stop',
      runId: childId,
      executionId: execution.id,
    });
    await vi.waitFor(() =>
      expect(new BackgroundFiles(next.store).read(job, 'result')).toBeDefined(),
    );
    next.manageScript({
      action: 'reconcile',
      runId: childId,
      executionId: execution.id,
      stopped: true,
      reason: 'Original supervisor stopped; original external effect inspected',
    });
    next.retry(parentId);
    await state(next, parentId);
    expect(readFileSync(join(root, 'effects'), 'utf8')).toBe(
      kind === 'batch' ? '0011' : '011',
    );
    expect(
      next
        .run(childId)
        .executions.filter((execution) => execution.kind === 'script'),
    ).toHaveLength(2);
    if (kind === 'batch') {
      const children = next
        .run(parentId)
        .executions.find((execution) => execution.kind === 'batch')!
        .childRunIds.map((id) => next.run(id));
      expect(children[0].status).toBe('completed');
      expect(
        children[0].executions.filter(
          (execution) => execution.kind === 'script',
        ),
      ).toHaveLength(1);
    }
  },
);
