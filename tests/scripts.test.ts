import { expect, it } from 'vitest';
import { executeScript, nodeRuntimeEnv } from '../packages/runtime/src/scripts';

it('preserves dynamic imports and top-level await', async () => {
  await expect(
    executeScript(
      'const { basename } = await import("node:path"); return basename(input);',
      '/tmp/example.txt',
      5000,
      process.cwd(),
      undefined,
      'javascript',
    ),
  ).resolves.toBe('example.txt');
});

it.each([
  ['throw new Error("first");', 'script.js:1:7'],
  ['await Promise.resolve();\n\nthrow new Error("third");', 'script.js:3:7'],
  [
    'function fail() {\n  throw new Error("nested");\n}\nfail();',
    'script.js:2:9',
  ],
  ['const x = 1;\nconst y = ;', 'script.js:2\n'],
])('reports editor line numbers for %s', async (command, location) => {
  await expect(
    executeScript(command, null, 5000, process.cwd(), undefined, 'javascript'),
  ).rejects.toThrow(location);
});

it('sets ELECTRON_RUN_AS_NODE in nodeRuntimeEnv while preserving existing environment variables', () => {
  const custom = { FOO: 'bar', INTERLOCK_TEST: '1' };
  expect(nodeRuntimeEnv(custom)).toEqual({
    FOO: 'bar',
    INTERLOCK_TEST: '1',
    ELECTRON_RUN_AS_NODE: '1',
  });
  const fromProcess = nodeRuntimeEnv();
  expect(fromProcess.ELECTRON_RUN_AS_NODE).toBe('1');
  expect(fromProcess.PATH).toBe(process.env.PATH);
});

it('executes JavaScript scripts with ELECTRON_RUN_AS_NODE set', async () => {
  await expect(
    executeScript(
      'return process.env.ELECTRON_RUN_AS_NODE;',
      null,
      5000,
      process.cwd(),
      undefined,
      'javascript',
    ),
  ).resolves.toBe('1');
});
