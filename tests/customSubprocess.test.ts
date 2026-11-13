import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { blankDefinition } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { executeSubprocessTurn } from '../packages/runtime/src/executors/custom';
import { nativeAdapters } from '../packages/runtime/src/executors/native';
import * as processes from '../packages/runtime/src/executors/process';
import {
  HarnessCleanupError,
  classifyHarnessError,
} from '../packages/runtime/src/executors/contracts';

const directories: string[] = [];
const engines: Engine[] = [];
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'interlock-custom-process-'));
  directories.push(path);
  return path;
}
afterEach(async () => {
  for (const engine of engines.splice(0)) {
    await engine.executors.stop();
    engine.stop();
    engine.store.close();
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

it('passes shell token values as literal data using normal shell quoting', async () => {
  const literal =
    '$(printf evaluated) `printf evaluated` "quote" \'single\' ; newline\nvalue';
  const command = `node -e ${quote('process.stdin.resume(); process.stdout.write(JSON.stringify({output:process.argv.slice(1)}))')} "$INTERLOCK_INPUT" "${'${INTERLOCK_SESSION_NAME}'}" '$INTERLOCK_RUN_ID'`;
  const result = await executeSubprocessTurn({
    command,
    cwd: directory(),
    payload: {},
    tokens: {
      INTERLOCK_INPUT: literal,
      INTERLOCK_SESSION_NAME: literal,
      INTERLOCK_RUN_ID: 'run-id',
    },
    signal: new AbortController().signal,
  });
  expect(result.output).toEqual([literal, literal, '$INTERLOCK_RUN_ID']);
});

it('handles a broken stdin pipe without crashing the server process', async () => {
  const cwd = directory();
  const probe = join(cwd, 'probe.mts');
  writeFileSync(
    probe,
    `import { executeSubprocessTurn } from ${JSON.stringify(resolve('packages/runtime/src/executors/custom.ts'))};\ntry { await executeSubprocessTurn({ command:'exit 1', cwd:${JSON.stringify(cwd)}, payload:{input:'x'.repeat(1000000)}, tokens:{}, signal:new AbortController().signal }); process.exitCode=2; } catch (error) { if (!/exit code 1/.test(error.message)) process.exitCode=3; console.log('turn rejected safely'); }`,
  );
  const result = await promisify(execFile)(
    process.execPath,
    ['--import', resolve('node_modules/tsx/dist/loader.mjs'), probe],
    { timeout: 10000 },
  );
  expect(result.stdout.trim()).toBe('turn rejected safely');
  expect(result.stderr).not.toContain('Unhandled');
});

it.each(['timeout', 'abort'] as const)(
  'stops descendants before rejecting for %s',
  async (reason) => {
    const cwd = directory();
    const marker = join(cwd, 'child-finished');
    const ready = join(cwd, 'child-ready');
    const script = `require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); process.stdin.resume(); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'still running'), 1500);`;
    const controller = new AbortController();
    const pending = executeSubprocessTurn({
      command: `node -e ${quote(script)}; :`,
      cwd,
      payload: {},
      tokens: {},
      signal: controller.signal,
      timeoutSeconds: reason === 'timeout' ? 1 : undefined,
    });
    const verdict = expect(pending).rejects.toThrow(
      reason === 'timeout' ? /timed out/ : /aborted/i,
    );
    for (let i = 0; i < 100 && !existsSync(ready); i++) await delay(10);
    expect(existsSync(ready)).toBe(true);
    if (reason === 'abort') controller.abort();
    await verdict;
    await delay(1800);
    expect(existsSync(marker)).toBe(false);
  },
);

it('does not launch an already-aborted turn', async () => {
  const cwd = directory();
  const marker = join(cwd, 'launched');
  await expect(
    executeSubprocessTurn({
      command: `printf launched > ${quote(marker)}`,
      cwd,
      payload: {},
      tokens: {},
      signal: AbortSignal.abort(),
    }),
  ).rejects.toThrow(/aborted/i);
  await delay(100);
  expect(existsSync(marker)).toBe(false);
});

it('delivers large input through stdin without copying it into the environment', async () => {
  const input = 'x'.repeat(1_000_000);
  const script =
    "let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>process.stdout.write(JSON.stringify({output:JSON.parse(input).input.length})))";
  const result = await executeSubprocessTurn({
    command: `node -e ${quote(script)}`,
    cwd: directory(),
    payload: { input },
    tokens: { INTERLOCK_INPUT: input },
    signal: new AbortController().signal,
  });
  expect(result.output).toBe(input.length);
});

it('keeps session metadata available to scripts without command token references', async () => {
  const result = await executeSubprocessTurn({
    command: `node -e ${quote('process.stdin.resume(); process.stdout.write(JSON.stringify({output:process.env.INTERLOCK_SESSION_NAME}))')}`,
    cwd: directory(),
    payload: {},
    tokens: { INTERLOCK_SESSION_NAME: 'custom session' },
    signal: new AbortController().signal,
  });
  expect(result.output).toBe('custom session');
});

it('marks uncertain cleanup as non-retryable even when the original error looks transient', async () => {
  const original = processes.spawnManagedProcess;
  vi.spyOn(processes, 'spawnManagedProcess').mockImplementation((...args) => {
    const process = original(...args);
    return {
      ...process,
      close: async () => {
        await process.close();
        throw new Error('timed out while confirming stop');
      },
    };
  });
  const error = await executeSubprocessTurn({
    command: 'exit 1',
    cwd: directory(),
    payload: {},
    tokens: {},
    signal: new AbortController().signal,
  }).catch((error) => error);
  expect(error).toBeInstanceOf(HarnessCleanupError);
  expect(classifyHarnessError(error)).toMatchObject({
    errorClass: 'permanent',
    retryable: false,
  });
});

it('accepts a successful result when the command closes stdin without reading its payload', async () => {
  const result = await executeSubprocessTurn({
    command: `printf '{"output":{"ok":true}}'`,
    cwd: directory(),
    payload: { input: 'x'.repeat(1_000_000) },
    tokens: {},
    signal: new AbortController().signal,
  });
  expect(result.output).toEqual({ ok: true });
});

it('names a server variable withheld from a failed minimal custom command', async () => {
  vi.stubEnv('SERVER_ONLY_API_KEY', 'server-secret-value');
  const failure = executeSubprocessTurn({
    command: 'test -n "$SERVER_ONLY_API_KEY"',
    cwd: directory(),
    profile: { environmentMode: 'minimal' },
    payload: {},
    tokens: {},
    signal: new AbortController().signal,
  });
  await expect(failure).rejects.toThrow(
    /did not pass SERVER_ONLY_API_KEY .*environmentPassthrough/,
  );
  await failure.catch((error: Error) =>
    expect(error.message).not.toContain('server-secret-value'),
  );
});

it.each([
  ['direct', undefined, 'server-key:declared:profile:run'],
  ['direct', 'minimal', ':declared:profile:run'],
  ['launcher', 'inherit', 'server-key:declared:profile:run'],
  ['launcher', 'minimal', ':declared:profile:run'],
] as const)(
  'gives a %s custom executor in %s mode the expected server environment',
  async (mode, environmentMode, expected) => {
    vi.stubEnv('SERVER_ONLY_API_KEY', 'server-key');
    vi.stubEnv('DECLARED_KEY', 'declared');
    const marker = join(directory(), 'env');
    const command = `cat >/dev/null; printf '%s:%s:%s:%s' "\${SERVER_ONLY_API_KEY-}" "\${DECLARED_KEY-}" "\${PROFILE_KEY-}" "\${INTERLOCK_RUN_ID:+run}" > ${quote(marker)}; echo '{"output":{}}'`;
    const engine = new Engine(new Store(':memory:'), process.cwd());
    engines.push(engine);
    engine.executors.saveProfile({
      id: 'custom-env',
      harness: 'custom',
      name: 'Custom environment',
      enabled: true,
      expectedRevision: 0,
      mode,
      transport: 'subprocess',
      [mode === 'direct' ? 'turnCommand' : 'launchCommand']: command,
      env: { PROFILE_KEY: 'profile' },
      environmentMode,
      environmentPassthrough: ['DECLARED_KEY'],
    });
    engine.executors.start(nativeAdapters);
    const definition = blankDefinition();
    definition.executor = 'custom-env';
    const workflow = engine.create('Custom environment', '', definition);
    engine.publish(workflow.id);
    engine.start(workflow.id, {});
    await vi.waitFor(
      () => expect(readFileSync(marker, 'utf8')).toBe(expected),
      { timeout: 5000 },
    );
  },
);
