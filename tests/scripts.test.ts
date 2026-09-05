import { expect, it } from 'vitest';
import { executeScript } from '../packages/runtime/src/scripts';

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
