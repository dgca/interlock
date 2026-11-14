import { afterEach, expect, it, vi } from 'vitest';
import {
  Engine,
  type HarnessAdapter,
  type HarnessRun,
} from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  type ManagedExecution,
  type Run,
} from '@interlock/core';
import { ManagedTranscripts } from '../packages/runtime/src/executors/transcripts';
import type { HarnessResult } from '../packages/runtime/src/executors/contracts';
import { nativeAdapters } from '../packages/runtime/src/executors/native';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const engines: Engine[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

it('delivers launcher messages through the existing command and never coalesces different operator requests', async () => {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  const dir = mkdtempSync(join(tmpdir(), 'interlock-launcher-message-'));
  dirs.push(dir);
  const script = join(dir, 'launcher.mjs'),
    launch = join(dir, 'launch.json'),
    log = join(dir, 'messages.txt');
  writeFileSync(
    script,
    `import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
    const input=JSON.parse(readFileSync(0,'utf8'));
    if(process.argv[2]==='launch'){writeFileSync(process.env.INTERLOCK_TEST_LAUNCH,JSON.stringify(input));console.log(JSON.stringify({sessionId:'launcher-session'}));}
    else{appendFileSync(process.env.INTERLOCK_TEST_MESSAGES,input.message+'\\n');setTimeout(()=>console.log('{}'),200);}`,
  );
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const command = `${quote(process.execPath)} ${quote(script)}`;
  e.executors.saveProfile({
    id: 'launcher',
    harness: 'custom',
    name: 'Launcher',
    enabled: true,
    expectedRevision: 0,
    mode: 'launcher',
    transport: 'subprocess',
    launchCommand: `${command} launch`,
    messageCommand: `${command} message`,
    env: { INTERLOCK_TEST_LAUNCH: launch, INTERLOCK_TEST_MESSAGES: log },
  });
  const d = blankDefinition();
  d.executor = 'launcher';
  const w = e.create('Launcher fixture', '', definitionSchema.parse(d));
  e.publish(w.id);
  e.executors.start(nativeAdapters);
  const run = e.start(w.id, {}).run;
  await vi.waitFor(() => expect(existsSync(launch)).toBe(true));
  const payload = JSON.parse(readFileSync(launch, 'utf8'));
  const work = e.store.work().find((w) => w.runId === run.id)!;
  await vi.waitFor(() =>
    expect(e.executors.inspect(work.id).items[0].sessionId).toBe(
      'launcher-session',
    ),
  );
  e.claim(work.id, {
    workerId: 'fixture',
    freshContext: false,
    tools: [],
    skills: [],
    claimTicket: payload.claimTicket,
  });
  const executionId = e.executors.inspect(work.id).items[0].id;
  const first = e.executors.message({
    executionId,
    requestId: 'one',
    message: 'first guidance',
  });
  const second = await e.executors.message({
    executionId,
    requestId: 'two',
    message: 'second guidance',
  });
  expect(second.status).toBe('failed');
  expect((await first).status).toBe('accepted');
  expect(readFileSync(log, 'utf8')).toBe('first guidance\n');
  expect(
    (
      await e.executors.message({
        executionId,
        requestId: 'three',
        message: 'third guidance',
      })
    ).status,
  ).toBe('accepted');
  expect(readFileSync(log, 'utf8')).toBe('first guidance\nthird guidance\n');
});
async function setup() {
  const e = new Engine(new Store(':memory:'), process.cwd());
  engines.push(e);
  e.executors.saveProfile({
    id: 'codex',
    harness: 'codex',
    name: 'Fixture',
    enabled: true,
    expectedRevision: 0,
  });
  const d = blankDefinition();
  d.executor = 'codex';
  const w = e.create('Transcript fixture', '', definitionSchema.parse(d));
  e.publish(w.id);
  let input: HarnessRun | undefined, finish!: (value: HarnessResult) => void;
  const send = vi.fn(async (_message: string) => {});
  const adapter: HarnessAdapter = {
    id: 'codex',
    detect: async () => ({ command: '/fixture/codex', status: 'detected' }),
    run: async (i) => {
      input = i;
      i.onSession('session');
      i.onMessageChannel?.(send);
      i.onTranscript?.({ kind: 'assistant', text: 'working', key: 'first' });
      return new Promise((resolve, reject) => {
        finish = resolve;
        i.signal.addEventListener(
          'abort',
          () => reject(new Error('Fixture stopped')),
          { once: true },
        );
      });
    },
  };
  e.executors.start([adapter]);
  const run = e.start(w.id, {}).run;
  await vi.waitFor(() => expect(input).toBeDefined());
  const record = e.executors.inspect(input!.work.id)
    .items[0] as ManagedExecution;
  return { e, run, input: input!, record, send, finish };
}
it('captures exact attempts and active credentials without inflating ordinary inspection', async () => {
  const { e, input, record } = await setup();
  input.onTranscript?.({
    kind: 'tool_call',
    text: `token ${input.work.token}`,
    tool: 'check',
    callId: 'call',
  });
  input.onTranscript?.({
    kind: 'tool_result',
    text: 'done',
    tool: 'check',
    callId: 'call',
  });
  const page = e.executors.transcript({ executionId: record.id });
  expect(page.items.map((i) => i.kind)).toContain('tool_result');
  expect(JSON.stringify(page)).not.toContain(input.work.token);
  expect(JSON.stringify(page)).toContain('[REDACTED]');
  expect(e.executors.inspect(input.work.id)).not.toHaveProperty('transcript');
  expect(() => e.executors.transcript({ executionId: 'absent' })).toThrow(
    'not found',
  );
  expect(() =>
    e.executors.transcript({ executionId: record.id, before: 2, after: 0 }),
  ).toThrow('Choose before or after');
});
it('redacts run-captured Secrets and encoded variants before persistence, and fails closed when locked', async () => {
  const { e, record } = await setup();
  const secret = 'secret-sentinel-long-value';
  const variable = e.variables.mutate({
    action: 'create',
    name: 'credential',
    kind: 'secret',
    value: secret,
  }) as { id: string };
  const run = e.store.get<Run>('runs', record.runId)!;
  run.variableCaptures = e.variables.captureIds([variable.id]);
  e.store.put('runs', run);
  const capture = new ManagedTranscripts(e);
  capture.capture(record, {
    kind: 'assistant',
    text: `${secret} ${encodeURIComponent(secret)} ${Buffer.from(secret).toString('base64')}`,
  });
  const page = e.executors.transcript({ executionId: record.id });
  expect(JSON.stringify(page)).not.toContain(secret);
  expect(JSON.stringify(page)).not.toContain(
    Buffer.from(secret).toString('base64'),
  );
  vi.spyOn(e.store.protectedValues, 'read').mockImplementation(() => {
    throw new Error(secret);
  });
  capture.capture(record, { kind: 'assistant', text: secret });
  expect(record.transcriptError).toContain('redaction unavailable');
  expect(
    e.executors.transcript({ executionId: record.id }).retainedEntries,
  ).toBe(page.retainedEntries);
});
it('reserves message identity before sending and recovers the same receipt without duplicate dispatch', async () => {
  const { e, record, send } = await setup();
  const request = {
    executionId: record.id,
    requestId: 'once',
    message: 'Use the vendored package',
    source: 'ui',
  };
  const receipt = await e.executors.message(request);
  expect(receipt.status).toBe('accepted');
  expect(await e.executors.message(request)).toEqual(receipt);
  expect(send).toHaveBeenCalledTimes(1);
  await expect(
    e.executors.message({ ...request, message: 'changed' }),
  ).rejects.toThrow('different content');
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    e.store
      .forRuns<{ type: string }>('events', new Set([record.runId]))
      .some((ev) => ev.type === 'managed.message'),
  ).toBe(true);
  expect(
    e.executors.messageReceipt({ executionId: record.id, requestId: 'once' })
      .receipt?.status,
  ).toBe('accepted');
});
it('never retries uncertain delivery, including simultaneous duplicate requests', async () => {
  const { e, record, send } = await setup();
  let reject!: (e: Error) => void;
  send.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const q = { executionId: record.id, requestId: 'lost', message: 'guidance' };
  const first = e.executors.message(q);
  expect((await e.executors.message(q)).status).toBe('pending');
  expect(send).toHaveBeenCalledTimes(1);
  reject(new Error('Provider failure containing secret-input'));
  const result = await first;
  expect(result.status).toBe('unknown');
  expect(result.reason).not.toContain('secret-input');
  expect((await e.executors.message(q)).status).toBe('unknown');
  expect(send).toHaveBeenCalledTimes(1);
});
it('keeps dispatch uncertain after a receipt-write failure instead of sending again', async () => {
  const { e, record, send } = await setup();
  const q = {
    executionId: record.id,
    requestId: 'write-lost',
    message: 'guidance',
  };
  const settle = vi
    .spyOn(e.store.transcripts, 'settle')
    .mockImplementation(() => {
      throw new Error('write failed');
    });
  await expect(e.executors.message(q)).rejects.toThrow('write failed');
  expect((await e.executors.message(q)).status).toBe('pending');
  expect(send).toHaveBeenCalledTimes(1);
  settle.mockRestore();
  e.store.transcripts.recover();
  expect((await e.executors.message(q)).status).toBe('unknown');
  expect(send).toHaveBeenCalledTimes(1);
});
it('rejects stale attempts and unavailable channels without reserving or dispatching', async () => {
  const { e, record, input, send, finish } = await setup();
  input.onMessageChannel?.(undefined);
  await expect(
    e.executors.message({
      executionId: record.id,
      requestId: 'unsupported',
      message: 'hello',
    }),
  ).rejects.toThrow('no supported');
  expect(e.store.transcripts.receipt(record.id, 'unsupported')).toBeUndefined();
  finish({ output: { ok: true } });
  await vi.waitFor(() => expect(e.run(record.runId).status).toBe('completed'));
  await expect(
    e.executors.message({
      executionId: record.id,
      requestId: 'late',
      message: 'hello',
    }),
  ).rejects.toThrow('no supported');
  expect(send).not.toHaveBeenCalled();
});
it('keeps execution successful when capture writes fail and does not preserve a live message channel', async () => {
  const { e, record, input, finish } = await setup();
  vi.spyOn(e.store.transcripts, 'append').mockImplementation(() => {
    throw new Error('disk full');
  });
  expect(() =>
    input.onTranscript?.({ kind: 'assistant', text: 'working' }),
  ).not.toThrow();
  finish({ output: { ok: true } });
  await vi.waitFor(() => expect(e.run(record.runId).status).toBe('completed'));
  expect(
    e.executors.transcript({ executionId: record.id }).messageAvailable,
  ).toBe(false);
});
it('does not dispatch when receipt persistence fails and prevents cleanup while a send is pending', async () => {
  const { e, record, send } = await setup();
  const begin = vi
    .spyOn(e.store.transcripts, 'begin')
    .mockImplementation(() => {
      throw new Error('write failed');
    });
  await expect(
    e.executors.message({
      executionId: record.id,
      requestId: 'failed',
      message: 'hello',
    }),
  ).rejects.toThrow('write failed');
  expect(send).not.toHaveBeenCalled();
  begin.mockRestore();
  let resolve!: () => void;
  send.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const promise = e.executors.message({
    executionId: record.id,
    requestId: 'pending',
    message: 'hello',
  });
  expect(() => e.executors.assertDelete(new Set([record.runId]))).toThrow(
    'messages are pending',
  );
  resolve();
  await promise;
});

it('rejects protected operator and request metadata before persistence, audit or dispatch', async () => {
  const { e, record, input, send } = await setup();
  const secret = 'sensitive-metadata-sentinel';
  const variable = e.variables.mutate({
    action: 'create',
    name: 'metadataSecret',
    kind: 'secret',
    value: secret,
  }) as { id: string };
  const run = e.store.get<Run>('runs', record.runId)!;
  run.variableCaptures = e.variables.captureIds([variable.id]);
  e.store.put('runs', run);
  for (const metadata of [
    { operator: secret, requestId: 'one' },
    { operator: 'local-user', requestId: secret },
    { operator: input.work.token!, requestId: 'three' },
  ]) {
    await expect(
      e.executors.message({
        executionId: record.id,
        message: 'Guidance',
        ...metadata,
      }),
    ).rejects.toThrow('contains protected data');
    expect(
      e.store.transcripts.receipt(record.id, metadata.requestId),
    ).toBeUndefined();
  }
  expect(send).not.toHaveBeenCalled();
  const safe = await e.executors.message({
    executionId: record.id,
    requestId: 'safe',
    message: secret,
  });
  expect(safe.status).toBe('accepted');
  expect(JSON.stringify(safe)).not.toContain(secret);
  expect(
    JSON.stringify(e.store.forRuns('events', new Set([record.runId]))),
  ).not.toContain(secret);
});
