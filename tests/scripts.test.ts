import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const childSeesElectronVariable = `
  const { execFileSync } = require('node:child_process');
  const child = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.env.ELECTRON_RUN_AS_NODE))'], { encoding: 'utf8' });
  return [String(process.env.ELECTRON_RUN_AS_NODE), child];
`;

it('keeps ELECTRON_RUN_AS_NODE from JavaScript Scripts under plain Node', async () => {
  expect(nodeRuntimeEnv({ FOO: 'bar' })).toEqual({ FOO: 'bar' });
  await expect(
    executeScript(
      childSeesElectronVariable,
      null,
      5000,
      process.cwd(),
      undefined,
      'javascript',
    ),
  ).resolves.toEqual(['undefined', 'undefined']);
});

describe('inside an Electron engine', () => {
  beforeEach(() => {
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('starts the Script process with ELECTRON_RUN_AS_NODE', () => {
    expect(nodeRuntimeEnv({ FOO: 'bar' })).toEqual({
      FOO: 'bar',
      ELECTRON_RUN_AS_NODE: '1',
    });
  });

  it('removes ELECTRON_RUN_AS_NODE before Script code runs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'interlock-electron-'));
    const preload = join(directory, 'electron.cjs');
    // Reports an Electron version the way Electron's own Node mode does.
    writeFileSync(
      preload,
      "Object.defineProperty(process, 'versions', { value: { ...process.versions, electron: '0.0.0' } });",
    );
    try {
      await expect(
        executeScript(
          childSeesElectronVariable,
          null,
          5000,
          process.cwd(),
          undefined,
          'javascript',
          { ...process.env, NODE_OPTIONS: `--require ${preload}` },
        ),
      ).resolves.toEqual(['undefined', 'undefined']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
