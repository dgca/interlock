import { expect, it } from 'vitest';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import {
  checkPort,
  isDatabaseLocked,
  lockDatabase,
  probeHealthyServer,
  startupError,
} from '../packages/server/src/startup';
import { startServer } from '../packages/server/src/start';
import { spawn, spawnSync } from 'node:child_process';
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
    // Servers on an ephemeral port set engineUrl after creating the app.
    const connection = {
      command: 'interlock',
      args: ['mcp'],
      engineUrl: 'http://127.0.0.1:4310',
      development: false,
    };
    const app = createApp(engine, connection);
    connection.engineUrl = 'http://127.0.0.1:4999';
    expect(
      (
        await app.request('http://127.0.0.1:4999/health', {
          headers: { origin: 'http://127.0.0.1:4999' },
        })
      ).status,
    ).toBe(200);
  } finally {
    engine.stop();
    store.close();
  }
});

it('detects database locks accurately with isDatabaseLocked', () => {
  expect(isDatabaseLocked(':memory:')).toBe(false);
  const database = join(
    mkdtempSync(join(tmpdir(), 'interlock-lock-check-')),
    'db',
  );
  expect(isDatabaseLocked(database)).toBe(false);
  const unlock = lockDatabase(database);
  expect(isDatabaseLocked(database)).toBe(true);
  unlock();
  expect(isDatabaseLocked(database)).toBe(false);
});

it('probes server health endpoints accurately with probeHealthyServer', async () => {
  const probe = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => probe.once('listening', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  expect(await probeHealthyServer(`http://127.0.0.1:${port}`, 100)).toBe(false);

  const nonInterlock = createHttpServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'other' }));
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => nonInterlock.once('listening', resolve));
  const httpAddress = nonInterlock.address();
  if (!httpAddress || typeof httpAddress === 'string')
    throw new Error('No port');
  try {
    expect(
      await probeHealthyServer(`http://127.0.0.1:${httpAddress.port}`, 500),
    ).toBe(false);
  } finally {
    await new Promise<void>((resolve) => {
      nonInterlock.closeAllConnections();
      nonInterlock.close(() => resolve());
    });
  }
});

it('returns handle from startServer and stop cleanly releases database lock and port', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-start-server-'));
  const database = join(dir, 'test.db');
  const probe = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => probe.once('listening', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const port = address.port;
  const engineUrl = `http://127.0.0.1:${port}`;

  const handle = await startServer({
    database,
    workdir: dir,
    ui: join(dir, 'ui'),
    port,
    connection: {
      command: 'interlock',
      args: ['mcp'],
      development: false,
      engineUrl,
    },
    handleSignals: false,
  });

  expect(handle.engine).toBeDefined();
  expect(handle.store).toBeDefined();
  expect(handle.server).toBeDefined();
  expect(handle.connection).toBeDefined();
  expect(typeof handle.stop).toBe('function');
  expect(isDatabaseLocked(database)).toBe(true);
  expect(await probeHealthyServer(engineUrl)).toBe(true);

  await handle.stop();

  expect(isDatabaseLocked(database)).toBe(false);
  await expect(checkPort(port)).resolves.toBeUndefined();
  expect(await probeHealthyServer(engineUrl, 100)).toBe(false);
});

it('coexists cleanly when running bare bin.ts against an already running healthy server', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-coexist-'));
  const database = join(dir, 'test.db');
  const probe = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => probe.once('listening', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const port = address.port;
  const engineUrl = `http://127.0.0.1:${port}`;

  const handle = await startServer({
    database,
    workdir: dir,
    ui: join(dir, 'ui'),
    port,
    connection: {
      command: 'interlock',
      args: ['mcp'],
      development: false,
      engineUrl,
    },
    handleSignals: false,
  });

  const runCli = (args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', 'packages/cli/src/bin.ts', ...args],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (d) => {
          stdout += d;
        });
        child.stderr.on('data', (d) => {
          stderr += d;
        });
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      },
    );

  try {
    expect(await probeHealthyServer(engineUrl)).toBe(true);

    const sameDbCli = await runCli(['--port', String(port), '--db', database]);
    expect(sameDbCli.status).toBe(0);
    expect(sameDbCli.stdout).toContain(
      `Interlock is already running at ${engineUrl}`,
    );

    const noDbCli = await runCli(['--port', String(port)]);
    expect(noDbCli.status).toBe(0);
    expect(noDbCli.stdout).toContain(
      `Interlock is already running at ${engineUrl}`,
    );
  } finally {
    await handle.stop();
  }
});
