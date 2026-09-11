import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const { version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

const temp = await mkdtemp(join(tmpdir(), 'interlock-package-'));
let server;
let client;
let logs = '';
async function stop() {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    process.kill(-server.pid, 'SIGTERM');
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
    version,
  );
  const futurePath = join(temp, 'future.db');
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const future = new DatabaseSync(futurePath);
  future.exec(
    'CREATE TABLE migrations (version INTEGER PRIMARY KEY); INSERT INTO migrations VALUES (999);',
  );
  future.close();
  const before = await readFile(futurePath);
  const refused = spawnSync(bin, ['--db', futurePath, '--port', String(port)], {
    cwd: workdir,
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /schema 999 is newer/);
  assert(!refused.stdout.includes('Interlock is running'));
  assert.deepEqual(await readFile(futurePath), before);
  const url = `http://127.0.0.1:${port}`;
  const start = async (launch = 'global') => {
    const args = [
      '--port',
      String(port),
      '--db',
      join(temp, 'data/interlock.db'),
    ];
    server = spawn(
      launch === 'global' ? bin : 'npx',
      launch === 'global'
        ? args
        : [
            '--yes',
            '--cache',
            join(temp, 'npm-cache'),
            '--package',
            join(temp, packed.filename),
            '--',
            'interlock',
            ...args,
          ],
      { cwd: workdir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
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
  for (const path of [
    '/workflows',
    '/workflows/example',
    '/runs?tab=history',
    '/runs/example',
  ]) {
    const response = await fetch(`${url}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(await response.text(), html);
  }
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert.match(
    await fetch(new URL(asset, url)).then((r) => r.text()),
    /Connect with MCP/,
  );
  const connection = (
    await fetch(`${url}/trpc/connection`).then((r) => r.json())
  ).result.data;
  assert.equal(connection.mcpUrl, `${url}/mcp`);
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
  assert.equal(client.getServerVersion().version, version);
  assert(
    (await client.listTools()).tools.some((tool) => tool.name === 'claim_work'),
  );
  const stdioWorkflows = await client.callTool({
    name: 'list_workflows',
    arguments: {},
  });
  assert(!stdioWorkflows.isError, JSON.stringify(stdioWorkflows));
  assert(Array.isArray(JSON.parse(stdioWorkflows.content[0].text)));
  await client.close();
  client = new Client({ name: 'package-http-smoke', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(connection.mcpUrl)),
  );
  assert.equal(client.getServerVersion().version, version);
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
  const agentWorkflow = await call('create_workflow', {
    name: 'HTTP restart assignment',
  });
  await call('publish_workflow', { id: agentWorkflow.id });
  const agentRun = await call('start_run', {
    workflowId: agentWorkflow.id,
    input: 21,
  });
  const [work] = await call('list_work', { runId: agentRun.run.id });
  const [summary] = JSON.parse(
    execFileSync(bin, ['work', agentRun.run.id, '--summary'], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
    }),
  );
  assert.equal(summary.rootRunId, agentRun.run.id);
  assert.equal(summary.rootWorkflowId, agentWorkflow.id);
  assert.equal(summary.workflowId, agentWorkflow.id);
  const claim = await call('claim_work', {
    workId: work.id,
    workerId: 'package-http-smoke',
    leaseSeconds: 3600,
  });
  await stop();
  await start('npx');
  const restartedConnection = (
    await fetch(`${url}/trpc/connection`).then((r) => r.json())
  ).result.data;
  assert.equal(restartedConnection.mcpUrl, connection.mcpUrl);
  assert(
    restartedConnection.fallback.args[0].startsWith(
      join(await realpath(temp), 'npm-cache', '_npx'),
    ),
    `Expected npx cached installation, got ${restartedConnection.fallback.args[0]}`,
  );
  // The installed CLI preserves the original lease duration after restart.
  const renewed = JSON.parse(
    execFileSync(bin, ['renew', work.id, claim.token], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
    }),
  );
  assert(Date.parse(renewed.leaseUntil) >= Date.parse(claim.leaseUntil));
  const overridden = JSON.parse(
    execFileSync(bin, ['renew', work.id, claim.token, '{"leaseSeconds":300}'], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
    }),
  );
  assert(Date.parse(overridden.leaseUntil) < Date.parse(renewed.leaseUntil));
  // The existing HTTP client and persisted claim still work after restart.
  const submitted = await call('submit_result', {
    workId: work.id,
    token: claim.token,
    output: 42,
  });
  assert.equal(submitted.run.status, 'completed');
  assert.equal(submitted.run.output, 42);
  await client.close();
  client = new Client({ name: 'package-http-reconnect', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(connection.mcpUrl)),
  );
  assert.equal(client.getServerVersion().version, version);
  assert(
    (await call('list_workflows')).some((item) => item.id === agentWorkflow.id),
  );
  assert.equal(
    (await call('get_run', { id: started.run.id })).run.output.number,
    42,
  );
  console.log(
    'Packed global and npx installs passed: CLI, UI assets, HTTP and stdio MCP, assignments across restart, JavaScript execution, and persistence.',
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await client?.close();
  await stop();
  await rm(temp, { recursive: true, force: true });
}
