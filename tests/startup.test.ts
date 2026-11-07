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

it('starts the opt-in CLI hooks listener without exposing local interfaces', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const port = async () => {
    const listener = createServer().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => listener.once('listening', resolve));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    return address.port;
  };
  const directory = mkdtempSync(join(tmpdir(), 'interlock-hooks-cli-'));
  const primary = await port(),
    hooks = await port();
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'packages/cli/src/bin.ts',
      '--port',
      String(primary),
      '--hooks-port',
      String(hooks),
      '--db',
      join(directory, 'interlock.db'),
      '--workdir',
      directory,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const ended = new Promise((resolve) => child.once('exit', resolve));
  let output = '',
    errors = '';
  child.stderr.on('data', (chunk) => {
    errors += String(chunk);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`CLI did not start: ${output} ${errors}`)),
        8000,
      );
      child.stdout.on('data', (chunk) => {
        output += String(chunk);
        if (
          output.includes('Interlock is running') &&
          output.includes('Webhook ingress listening')
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`CLI exited ${code}: ${errors}`));
      });
    });
    expect((await fetch(`http://127.0.0.1:${primary}/health`)).status).toBe(
      200,
    );
    for (const path of [
      '/health',
      '/',
      '/events',
      '/mcp',
      '/trpc/workflows.list',
    ])
      expect(
        (await fetch(`http://127.0.0.1:${hooks}${path}`, { method: 'POST' }))
          .status,
      ).toBe(404);
    expect(
      (
        await fetch(`http://127.0.0.1:${hooks}/hooks/unknown`, {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(404);
    const invalid = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'packages/cli/src/bin.ts',
        '--port',
        String(primary),
        '--hooks-port',
        String(primary),
        '--db',
        join(directory, 'unused.db'),
      ],
      { encoding: 'utf8' },
    );
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Hooks port must be a different port');
  } finally {
    child.kill('SIGTERM');
    await ended;
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
