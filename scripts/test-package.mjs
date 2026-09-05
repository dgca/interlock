import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const temp = await mkdtemp(join(tmpdir(), 'interlock-package-'));
let server;
let client;
let logs = '';
async function stop() {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
}
try {
  const [packed] = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', temp],
      { encoding: 'utf8' },
    ),
  );
  assert(packed.files.some((file) => file.path === 'dist/cli.js'));
  assert(
    !packed.files.some(
      (file) =>
        file.path.startsWith('.interlock/') ||
        file.path.startsWith('node_modules/'),
    ),
  );
  const prefix = join(temp, 'install');
  execFileSync(
    'npm',
    [
      'install',
      '--global',
      '--prefix',
      prefix,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(temp, packed.filename),
    ],
    { stdio: 'pipe' },
  );
  const bin = join(prefix, 'bin/interlock');
  const workdir = join(temp, 'work');
  await mkdir(workdir);
  const env = {
    ...process.env,
    PATH: `${join(prefix, 'bin')}:${process.env.PATH}`,
  };
  assert.equal(
    execFileSync(bin, ['--version'], {
      cwd: workdir,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
    '0.0.1',
  );
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  const start = async () => {
    server = spawn(
      bin,
      ['--port', String(port), '--db', join(temp, 'data/interlock.db')],
      { cwd: workdir, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    server.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    server.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(`Server exited: ${logs}`);
      if (
        await fetch(`${url}/health`)
          .then((r) => r.ok)
          .catch(() => false)
      )
        return;
      await delay(100);
    }
    throw new Error(`Server failed to start: ${logs}`);
  };
  await start();
  const html = await fetch(url).then((r) => r.text());
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert.match(
    await fetch(new URL(asset, url)).then((r) => r.text()),
    /Connect with MCP/,
  );
  const connection = (
    await fetch(`${url}/trpc/connection`).then((r) => r.json())
  ).result.data;
  assert.equal(connection.command, 'interlock');
  assert.deepEqual(connection.args, ['mcp']);
  assert.equal(connection.env.INTERLOCK_URL, url);
  assert.equal(connection.development, false);
  client = new Client({ name: 'package-smoke', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: bin,
      args: ['mcp'],
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      stderr: 'pipe',
    }),
  );
  assert.equal(client.getServerVersion().version, '0.0.1');
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert(!response.isError, JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  };
  const workflow = await call('create_workflow', {
    name: 'Packed install smoke',
    definition: {
      nodes: [
        {
          id: 'entry',
          kind: 'entry',
          label: 'Input',
          position: { x: 0, y: 0 },
        },
        {
          id: 'script',
          kind: 'script',
          label: 'Double',
          position: { x: 300, y: 0 },
          language: 'javascript',
          command:
            'return { number: await Promise.resolve(input * 2), cwd: process.cwd() };',
        },
        {
          id: 'exit',
          kind: 'exit',
          label: 'Output',
          position: { x: 600, y: 0 },
        },
      ],
      edges: [
        { id: 'a', source: 'entry', target: 'script' },
        { id: 'b', source: 'script', target: 'exit' },
      ],
    },
  });
  await call('publish_workflow', { id: workflow.id });
  const started = await call('start_run', {
    workflowId: workflow.id,
    input: 21,
  });
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    result = await call('get_run', { id: started.run.id });
    if (result.run.status === 'completed' || result.run.status === 'failed')
      break;
    await delay(100);
  }
  assert.equal(result.run.status, 'completed', JSON.stringify(result));
  assert.equal(result.run.output.number, 42);
  // macOS resolves /var to /private/var for the working directory.
  const { realpath } = await import('node:fs/promises');
  assert.equal(result.run.output.cwd, await realpath(workdir));
  await stop();
  await start();
  assert.equal(
    (await call('get_run', { id: started.run.id })).run.output.number,
    42,
  );
  console.log(
    'Packed global install passed: CLI, UI assets, connection config, MCP, JavaScript execution, and persistence.',
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await client?.close();
  await stop();
  await rm(temp, { recursive: true, force: true });
}
