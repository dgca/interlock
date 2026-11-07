import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
it('contains failed idle nudge expiry under default Node unhandled-rejection behavior', async () => {
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--unhandled-rejections=strict',
      '--import',
      'tsx',
      'tests/fixtures/stall-nudge-deadline.mjs',
    ],
    { cwd: process.cwd(), timeout: 10000 },
  );
  expect(result.stdout).toContain('survived with recovery attention');
});
