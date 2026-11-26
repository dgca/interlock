import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blankDefinition,
  nodeSchema,
  validateDefinition,
  type Run,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';

const engines: Engine[] = [],
  roots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const engine of engines.splice(0)) {
    engine.stop();
    try {
      engine.store.close();
    } catch {
      /* Already closed by a restart test. */
    }
  }
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function root() {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-script-retry-'));
  roots.push(dir);
  return dir;
}
function setup(path = ':memory:', cwd = process.cwd()) {
  const engine = new Engine(new Store(path), cwd);
  engines.push(engine);
  return engine;
}
function reopen(dir: string) {
  const engine = new Engine(
    new Store(join(dir, 'db.sqlite'), { secretKeyFile: join(dir, 'key') }),
    dir,
  );
  engines.push(engine);
  return engine;
}
function forget(engine: Engine) {
  engine.stop();
  engine.store.close();
  engines.splice(engines.indexOf(engine), 1);
}
function publish(engine: Engine, definition: WorkflowDefinition) {
  const workflow = engine.create('Script retry', '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}
function definition(
  command: string,
  patch: Record<string, unknown> = {},
  routeFailure = false,
): WorkflowDefinition {
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Work',
    kind: 'script',
    language: 'javascript',
    command,
    ...patch,
  });
  if (routeFailure) {
    d.nodes[1] = nodeSchema.parse({ ...d.nodes[1], onFailure: 'route' });
    d.edges.push({
      id: 'recovery',
      source: 'agent',
      target: 'exit',
      port: 'failed',
    });
  }
  return d;
}
const retry = (patch: Record<string, unknown> = {}) => ({
  transientRetry: { maxRetries: 2, initialBackoffMs: 0, ...patch },
});
async function settle(
  engine: Engine,
  id: string,
  status: Run['status'] = 'completed',
) {
  return vi.waitFor(
    () => {
      engine.pump();
      const run = engine.run(id);
      expect(['completed', 'failed', 'cancelled']).toContain(run.status);
      expect(run.status, run.error).toBe(status);
      return run;
    },
    { timeout: 10_000 },
  );
}
function start(
  engine: Engine,
  command: string,
  patch: Record<string, unknown> = {},
  routeFailure = false,
) {
  const workflow = publish(engine, definition(command, patch, routeFailure));
  return { workflow, run: engine.start(workflow, null).run };
}
const attempts = (run: Run) =>
  run.executions.filter((execution) => execution.nodeId === 'agent');
const retryEvents = (engine: Engine, runId: string, type: string) =>
  engine.store.events(runId).filter((event) => event.type === type);

it('keeps one attempt when transient retry is omitted or explicitly zero', async () => {
  for (const transientRetry of [undefined, { maxRetries: 0 }]) {
    const engine = setup();
    const { run } = start(
      engine,
      'console.error("boom"); process.exit(7);',
      transientRetry ? { transientRetry } : {},
    );
    const failed = await settle(engine, run.id, 'failed');
    expect(failed.error).toMatch(/^Script exited 7: boom/);
    const [execution] = attempts(failed);
    expect(attempts(failed)).toHaveLength(1);
    expect(execution.attempt).toBeUndefined();
    expect(execution.scriptRetry).toBeUndefined();
    expect(retryEvents(engine, run.id, 'node.retry_scheduled')).toHaveLength(0);
    engine.stop();
    engine.store.close();
    engines.splice(engines.indexOf(engine), 1);
  }
});

it('retries a successful JSON result only when the exit is non-zero', async () => {
  const engine = setup();
  const { run } = start(
    engine,
    'return { retryable: true, transient: true };',
    retry(),
  );
  const completed = await settle(engine, run.id);
  expect(completed.output).toEqual({ retryable: true, transient: true });
  expect(attempts(completed)).toHaveLength(1);
  expect(attempts(completed)[0].scriptRetry).toBeUndefined();
});

it('rejects enabled transient retry on a background Script', () => {
  const background = definition('return {};', {
    executionMode: 'background',
    ...retry(),
  });
  expect(() => validateDefinition(background)).toThrow(
    /transient retry requires foreground execution/,
  );

  const foreground = definition('return {};', retry());
  expect(() => validateDefinition(foreground)).not.toThrow();

  const zero = definition('return {};', {
    executionMode: 'background',
    transientRetry: { maxRetries: 0 },
  });
  expect(() => validateDefinition(zero)).not.toThrow();
});

it('publishes no background Script that enables transient retry', () => {
  const engine = setup();
  const workflow = engine.create(
    'Background retry',
    '',
    definition('return {};', {
      executionMode: 'background',
      ...retry(),
    }),
  );
  expect(() => engine.publish(workflow.id)).toThrow(
    /transient retry requires foreground execution/,
  );
});

it('retries exit 75 in the same execution and increments INTERLOCK_ATTEMPT', async () => {
  const engine = setup();
  const { run } = start(
    engine,
    `
      if (process.env.INTERLOCK_ATTEMPT === '1') process.exit(75);
      return {
        attempt: process.env.INTERLOCK_ATTEMPT,
        executionId: process.env.INTERLOCK_EXECUTION_ID,
        runId: process.env.INTERLOCK_RUN_ID,
      };
    `,
    retry(),
  );
  const completed = await settle(engine, run.id);
  const [execution] = attempts(completed);
  expect(attempts(completed)).toHaveLength(1);
  expect(execution.attempt).toBe(2);
  expect(completed.output).toEqual({
    attempt: '2',
    executionId: execution.id,
    runId: run.id,
  });
  expect(execution.scriptRetry).toMatchObject({
    retries: 1,
    receipts: [
      expect.objectContaining({
        attempt: 1,
        decision: 'retry',
        layer: 'signal',
        delayMs: 0,
      }),
    ],
  });
  expect(retryEvents(engine, run.id, 'node.retry_scheduled')).toHaveLength(1);
  expect(retryEvents(engine, run.id, 'node.failed')).toHaveLength(0);
});

it.each([
  [
    'complete stdout',
    'process.stdout.write(JSON.stringify({ retryable: true, reason: "warming" })); process.exit(3);',
    'warming',
  ],
  [
    'final stderr line',
    'console.error("starting"); console.error(JSON.stringify({ transient: true, reason: "backoff" })); process.exit(4);',
    'backoff',
  ],
])('retries an explicit JSON marker on %s', async (_label, failing, reason) => {
  const engine = setup();
  const { run } = start(
    engine,
    `
        if (process.env.INTERLOCK_ATTEMPT === '1') { ${failing} }
        return { attempt: process.env.INTERLOCK_ATTEMPT };
      `,
    retry(),
  );
  const completed = await settle(engine, run.id);
  expect(completed.output).toEqual({ attempt: '2' });
  expect(attempts(completed)[0].scriptRetry?.receipts?.[0]).toMatchObject({
    attempt: 1,
    decision: 'retry',
    layer: 'signal',
    reason,
  });
});

it.each([
  ['ECONNRESET while reading', 'ECONNRESET'],
  ['HTTP 503 from the dependency', 'upstream returned HTTP 503'],
  ['SQLITE_BUSY on the local queue', 'SQLITE_BUSY: database is locked'],
])('retries recognized transient text: %s', async (_label, text) => {
  const engine = setup();
  const { run } = start(
    engine,
    `
      if (process.env.INTERLOCK_ATTEMPT === '1') {
        console.error(${JSON.stringify(text)});
        process.exit(1);
      }
      return { attempt: process.env.INTERLOCK_ATTEMPT };
    `,
    retry(),
  );
  const completed = await settle(engine, run.id);
  expect(completed.output).toEqual({ attempt: '2' });
  expect(attempts(completed)[0].scriptRetry?.receipts?.[0]).toMatchObject({
    decision: 'retry',
    layer: 'classifier',
  });
});

it('stops immediately on recognized permanent text', async () => {
  const engine = setup();
  const { run } = start(
    engine,
    'console.error("HTTP 401 unauthorized"); process.exit(1);',
    retry({ maxRetries: 5 }),
  );
  const failed = await settle(engine, run.id, 'failed');
  const [execution] = attempts(failed);
  expect(execution.attempt).toBeUndefined();
  expect(execution.scriptRetry?.receipts).toEqual([
    expect.objectContaining({ decision: 'stop', layer: 'permanent' }),
  ]);
  expect(retryEvents(engine, run.id, 'node.retry_scheduled')).toHaveLength(0);
});

it('gives an unclassified failure one probe and stops on an identical repeat', async () => {
  const engine = setup();
  const { run } = start(
    engine,
    'console.error("mystery failure"); process.exit(9);',
    retry({ maxRetries: 5 }),
  );
  const failed = await settle(engine, run.id, 'failed');
  const [execution] = attempts(failed);
  expect(attempts(failed)).toHaveLength(1);
  expect(execution.attempt).toBe(2);
  expect(execution.scriptRetry?.receipts).toEqual([
    expect.objectContaining({ attempt: 1, decision: 'retry' }),
    expect.objectContaining({
      attempt: 2,
      decision: 'stop',
      layer: 'duplicate',
    }),
  ]);
  expect(retryEvents(engine, run.id, 'node.retry_scheduled')).toHaveLength(1);
});

it('does not let duplicate detection veto a repeated exit 75', async () => {
  const engine = setup();
  const { run } = start(
    engine,
    `
      const attempt = process.env.INTERLOCK_ATTEMPT;
      if (attempt === '1' || attempt === '2') process.exit(75);
      return { attempt };
    `,
    retry({ maxRetries: 5 }),
  );
  const completed = await settle(engine, run.id);
  const [execution] = attempts(completed);
  expect(completed.output).toEqual({ attempt: '3' });
  expect(execution.attempt).toBe(3);
  expect(execution.scriptRetry?.retries).toBe(2);
  expect(
    execution.scriptRetry?.receipts?.map((receipt) => receipt.decision),
  ).toEqual(['retry', 'retry']);
});

it('routes only the final exhausted failure', async () => {
  const engine = setup();
  const { run } = start(
    engine,
    `
      console.error('failure ' + process.env.INTERLOCK_ATTEMPT);
      process.exit(1);
    `,
    retry({ maxRetries: 1 }),
    true,
  );
  const routed = await settle(engine, run.id);
  const [execution] = attempts(routed);
  expect(routed.status).toBe('completed');
  expect(execution.status).toBe('failed');
  expect(execution.port).toBe('failed');
  expect(execution.attempt).toBe(2);
  expect(execution.scriptRetry?.receipts).toEqual([
    expect.objectContaining({ attempt: 1, decision: 'retry' }),
    expect.objectContaining({
      attempt: 2,
      decision: 'stop',
      layer: 'exhausted',
    }),
  ]);
  expect(retryEvents(engine, run.id, 'node.retry_scheduled')).toHaveLength(1);
  expect(retryEvents(engine, run.id, 'node.failure_routed')).toHaveLength(1);
  expect(retryEvents(engine, run.id, 'node.failed')).toHaveLength(1);
});

it('bounds retries with zero window and zero initial backoff', async () => {
  const engine = setup();
  const { run } = start(
    engine,
    `
      console.error('attempt ' + process.env.INTERLOCK_ATTEMPT);
      process.exit(1);
    `,
    retry({ maxRetries: 2, windowMs: 0, initialBackoffMs: 0 }),
  );
  const failed = await settle(engine, run.id, 'failed');
  const [execution] = attempts(failed);
  expect(attempts(failed)).toHaveLength(1);
  expect(execution.attempt).toBe(3);
  expect(execution.scriptRetry?.retries).toBe(2);
  expect(
    execution.scriptRetry?.receipts?.map((receipt) => receipt.delayMs),
  ).toEqual([0, 0, 0]);
  expect(retryEvents(engine, run.id, 'node.retry_scheduled')).toHaveLength(2);
});

it('cancels during backoff without launching another attempt', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  const engine = setup();
  const { run } = start(
    engine,
    'console.error("ECONNRESET"); process.exit(1);',
    retry({ maxRetries: 3, initialBackoffMs: 60_000 }),
  );
  const pending = await vi.waitFor(() => {
    engine.pump();
    const current = engine.run(run.id);
    expect(current.executions.at(-1)?.scriptRetry?.retryAt).toBeTruthy();
    return current;
  });
  expect(pending.status).toBe('running');
  engine.cancel(run.id);
  vi.setSystemTime(new Date('2026-11-20T12:05:00Z'));
  engine.pump();
  const cancelled = engine.run(run.id);
  expect(cancelled.status).toBe('cancelled');
  expect(attempts(cancelled)).toHaveLength(1);
  expect(attempts(cancelled)[0].attempt).toBeUndefined();
  expect(retryEvents(engine, run.id, 'node.retry_scheduled')).toHaveLength(1);
});

it('does not retry a restart that interrupts a live attempt', async () => {
  const dir = root();
  const marker = join(dir, 'foreground-pid');
  const first = reopen(dir);
  const workflow = publish(
    first,
    definition(
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));
       await new Promise((resolve) => setTimeout(resolve, 60_000));
       return {};`,
      retry({ maxRetries: 3 }),
      true,
    ),
  );
  const { run } = first.start(workflow, null);
  await vi.waitFor(() => expect(existsSync(marker)).toBe(true));
  const pid = Number(readFileSync(marker, 'utf8'));
  forget(first);
  await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());

  const recovered = reopen(dir);
  recovered.pump();
  const failed = recovered.run(run.id);
  expect(failed.status).toBe('failed');
  expect(failed.error).toMatch(/Service interrupted during script execution/);
  expect(attempts(failed)).toHaveLength(1);
  expect(attempts(failed)[0].port).toBeUndefined();
  expect(attempts(failed)[0].scriptRetry).toBeUndefined();
});

it('resumes a committed backoff after restart when it is due', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  const dir = root();
  const first = reopen(dir);
  const workflow = publish(
    first,
    definition(
      `
        if (process.env.INTERLOCK_ATTEMPT === '1') {
          console.error('ECONNRESET');
          process.exit(1);
        }
        return { attempt: process.env.INTERLOCK_ATTEMPT };
      `,
      retry({ maxRetries: 2, initialBackoffMs: 30_000 }),
    ),
  );
  const { run } = first.start(workflow, null);
  await vi.waitFor(() => {
    first.pump();
    expect(
      first.run(run.id).executions.at(-1)?.scriptRetry?.retryAt,
    ).toBeTruthy();
  });
  forget(first);

  const recovered = reopen(dir);
  recovered.pump();
  expect(recovered.run(run.id).status).toBe('running');
  expect(attempts(recovered.run(run.id))[0].attempt).toBeUndefined();

  vi.setSystemTime(new Date('2026-11-20T12:01:00Z'));
  const completed = await settle(recovered, run.id);
  const [execution] = attempts(completed);
  expect(completed.output).toEqual({ attempt: '2' });
  expect(execution.attempt).toBe(2);
  expect(execution.scriptRetry?.retries).toBe(1);
});

it('excludes paused time from a retry backoff', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  const engine = setup();
  const workflow = publish(
    engine,
    definition(
      `
        if (process.env.INTERLOCK_ATTEMPT === '1') {
          console.error('ECONNRESET');
          process.exit(1);
        }
        return { attempt: process.env.INTERLOCK_ATTEMPT };
      `,
      retry({ maxRetries: 3, initialBackoffMs: 5_000 }),
    ),
  );
  const { run } = engine.start(workflow, null);
  const pending = await vi.waitFor(() => {
    engine.pump();
    const current = engine.run(run.id);
    expect(
      current.executions.at(-1)?.scriptRetry?.retryScheduledAt,
    ).toBeTruthy();
    return current;
  });
  const scheduled = Date.parse(
    pending.executions.at(-1)!.scriptRetry!.retryScheduledAt!,
  );

  vi.setSystemTime(new Date(scheduled + 1_000));
  const hold = engine.pauses.create({
    target: { scope: 'workflow', workflowId: workflow },
    actor: 'test',
    reason: 'maintenance',
  });
  vi.setSystemTime(new Date(scheduled + 40_000));
  engine.pump();
  expect(attempts(engine.run(run.id))[0].attempt).toBeUndefined();

  engine.pauses.resume(hold.id);
  engine.pump();
  expect(attempts(engine.run(run.id))[0].attempt).toBeUndefined();

  // 40s wall, 39s paused: 5s of active backoff needs 44s of wall time.
  vi.setSystemTime(new Date(scheduled + 44_000));
  const completed = await settle(engine, run.id);
  expect(completed.output).toEqual({ attempt: '2' });
  expect(attempts(completed)[0].attempt).toBe(2);
});
