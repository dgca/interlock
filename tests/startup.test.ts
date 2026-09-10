import { expect, it } from 'vitest';
import { createServer } from 'node:net';
import { checkPort, startupError } from '../packages/server/src/startup';
import { spawnSync } from 'node:child_process';

it('suppresses only the SQLite experimental diagnostic in the CLI', () => {
  const cli = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'packages/cli/src/bin.ts', '--version'],
    { encoding: 'utf8' },
  );
  expect(cli.status).toBe(0);
  expect(cli.stderr).not.toContain('SQLite is an experimental feature');
  const warning = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "import './packages/server/src/sqliteWarning.ts'; process.emitWarning('Keep this warning');",
    ],
    { encoding: 'utf8' },
  );
  expect(warning.stderr).toContain('Keep this warning');
});

it('identifies occupied ports with suspended-process recovery guidance', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    await expect(checkPort(address.port)).rejects.toThrow('kill -CONT');
    await expect(checkPort(address.port)).rejects.toThrow(
      `Port ${address.port} is already in use`,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('adds database ownership guidance while preserving the original failure', () => {
  const cause = new Error('database is locked');
  const error = startupError(cause, '/tmp/test.db');
  expect(error.message).toContain('/tmp/test.db');
  expect(error.message).toContain('Stop other Interlock');
  expect(error.cause).toBe(cause);
  const unrelated = new Error('permission denied');
  expect(startupError(unrelated, '/tmp/test.db')).toBe(unrelated);
});
