import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { executeSubprocessTurn } from '../packages/runtime/src/executors/custom';
import * as processes from '../packages/runtime/src/executors/process';
import {
  HarnessCleanupError,
  classifyHarnessError,
} from '../packages/runtime/src/executors/contracts';

const directories: string[] = [];
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'interlock-custom-process-'));
  directories.push(path);
  return path;
}
afterEach(() => {
  vi.restoreAllMocks();
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
    `import { executeSubprocessTurn } from ${JSON.stringify(resolve('packages/runtime/src/executors/custom.ts'))};\ntry { await executeSubprocessTurn({ command:'exit 1', cwd:${JSON.stringify(cwd)}, payload:{input:'x'.repeat(1000000)}, tokens:{}, signal:new AbortController().signal }); process.exitCode=2; } catch { console.log('turn rejected safely'); }`,
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
