import { expect, it } from 'vitest';
import { createServer } from 'node:net';
import {
  checkPort,
  lockDatabase,
  startupError,
} from '../packages/server/src/startup';
import { spawnSync } from 'node:child_process';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { createApp } from '../packages/server/src/app';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
it('refuses a second server on a locked database and releases the lock on close', async () => {
  const database = join(mkdtempSync(join(tmpdir(), 'interlock-lock-')), 'db');
  const unlock = lockDatabase(database);
  const probe = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => probe.once('listening', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  try {
    const second = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'packages/cli/src/bin.ts',
        '--port',
        String(address.port),
        '--db',
        database,
      ],
      { encoding: 'utf8', timeout: 20_000 },
    );
    expect(second.status).toBe(1);
    expect(second.stderr).toContain(
      `Another Interlock server is already using database ${database}`,
    );
  } finally {
    unlock();
  }
  lockDatabase(database)();
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

it('rejects removed hooks listener flags without creating a database', () => {
  const cli = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'packages/cli/src/bin.ts', '--hooks-port', '4311'],
    { encoding: 'utf8' },
  );
  expect(cli.status).toBe(1);
  expect(cli.stderr).toContain('--hooks-port');
  const help = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'packages/cli/src/bin.ts', '--help'],
    { encoding: 'utf8' },
  );
  expect(help.status).toBe(0);
  expect(help.stdout).not.toContain('--hooks-port');
});
it('accepts Vite development origins only from a development server', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  const status = async (development: boolean, origin: string) =>
    (
      await createApp(engine, {
        command: 'interlock',
        args: ['mcp'],
        engineUrl: 'http://127.0.0.1:4310',
        development,
      }).request('http://127.0.0.1:4310/health', { headers: { origin } })
    ).status;
  try {
    expect(await status(false, 'http://localhost:5173')).toBe(403);
    expect(await status(false, 'http://127.0.0.1:5173')).toBe(403);
    expect(await status(false, 'http://127.0.0.1:4310')).toBe(200);
    expect(await status(true, 'http://localhost:5173')).toBe(200);
  } finally {
    engine.stop();
    store.close();
  }
});
