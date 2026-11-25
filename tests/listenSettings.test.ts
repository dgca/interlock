import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { createServer } from 'node:net';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  blankDefinition,
  definitionSchema,
  doctorReportSchema,
} from '@interlock/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@interlock/client';
import { DesktopEngineLifecycle } from '../packages/desktop/src/lifecycle';
import { developmentConnection } from '../packages/server/src/connection';
import { internalEngineUrl, startServer } from '../packages/server/src/start';
import { checkPort } from '../packages/server/src/startup';
import { createApp } from '../packages/server/src/app';

const exec = promisify(execFile);
let root: string;
let dataDir: string;
let config: string;
let server: Awaited<ReturnType<typeof startServer>> | undefined;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-operator-')));
  dataDir = join(root, 'data');
  config = join(root, 'operator.json');
  vi.stubEnv('HOME', root);
  vi.stubEnv('INTERLOCK_DATA_DIR', dataDir);
  for (const name of [
    'INTERLOCK_CONFIG',
    'INTERLOCK_HOST',
    'INTERLOCK_PUBLIC_URL',
    'INTERLOCK_REQUIRE_TOKEN',
    'INTERLOCK_ALLOWED_ROOTS',
    'INTERLOCK_LOG_LEVEL',
    'INTERLOCK_SYNC_DIR',
    'INTERLOCK_DB',
    'INTERLOCK_SECRET_KEY_FILE',
  ])
    vi.stubEnv(name, undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  try {
    await stop();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

async function stop() {
  await server?.stop();
  server = undefined;
}

async function start(options: Partial<Parameters<typeof startServer>[0]> = {}) {
  server = await startServer({
    workdir: root,
    ui: root,
    port: 0,
    connection: developmentConnection(),
    handleSignals: false,
    ...options,
  });
  if (!server.server.listening) await once(server.server, 'listening');
  const address = server.server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test listener');
  return { ...server, url: `http://127.0.0.1:${address.port}` };
}

function setConfig(value: unknown) {
  vi.stubEnv('INTERLOCK_CONFIG', config);
  writeFileSync(config, JSON.stringify(value));
}

function runCli(args: string[], env = process.env) {
  return exec(
    process.execPath,
    ['--import', 'tsx', 'packages/cli/src/bin.ts', ...args],
    {
      env,
      timeout: 8000,
    },
  );
}

it('forces authentication off loopback and reports the reason', async () => {
  setConfig({ host: '0.0.0.0', requireToken: false });
  const { engine, url, connection, server: listener } = await start();
  expect(listener.address()).toMatchObject({ address: '0.0.0.0' });
  expect(connection.engineUrl).toBe(url);
  await expect(checkPort(Number(new URL(url).port), '0.0.0.0')).rejects.toThrow(
    /already in use at 0\.0\.0\.0/,
  );
  const workflow = engine.create(
    'Check internal URL',
    '',
    definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'script',
          label: 'Health',
          kind: 'script',
          language: 'javascript',
          command:
            'const url = process.env.INTERLOCK_URL; return { url, ok: (await fetch(url + "/health")).ok };',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'first', source: 'entry', target: 'script' },
        { id: 'last', source: 'script', target: 'exit' },
      ],
    }),
  );
  engine.publish(workflow.id);
  const run = engine.start(workflow.id, {}).run;
  await vi.waitFor(() => {
    engine.pump();
    expect(engine.run(run.id).output).toEqual({ url, ok: true });
  });
  const unrelatedHost = await postMcp(url, {
    Host: 'unexpected.example.test',
    Authorization: `Bearer ${connection.token}`,
  });
  expect(unrelatedHost.status).toBe(403);
  expect(unrelatedHost.body).toContain('Set publicUrl');
  for (const path of [
    '/api/workflows',
    '/trpc/connection',
    '/mcp',
    '/events',
  ]) {
    expect((await fetch(`${url}${path}`)).status).toBe(401);
    const allowed = await fetch(`${url}${path}`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    });
    expect(allowed.status).toBe(path === '/mcp' ? 405 : 200);
    await allowed.body?.cancel();
  }
  const report = await engine.doctor();
  const auth = report.checks.find((row) => row.name === 'requireToken');
  expect(auth?.details).toEqual({
    value: true,
    source: 'non-loopback listener',
    forced: true,
  });
  expect(auth?.message).toContain('Required on non-loopback');
  expect(JSON.stringify(report)).not.toContain(connection.token);
  await stop();
  rmSync(join(dataDir, 'keys', 'api-token'));
  mkdirSync(join(dataDir, 'keys', 'api-token'));
  await expect(start({ hostname: '0.0.0.0' })).rejects.toThrow(
    'Cannot use the API token file',
  );
});

function postMcp(url: string, headers: Record<string, string>) {
  return new Promise<{ status: number | undefined; body: string }>(
    (resolve, reject) => {
      const post = request(
        `${url}/mcp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...headers,
          },
        },
        (response) => {
          response.setEncoding('utf8');
          let body = '';
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.once('error', reject);
          response.once('end', () =>
            resolve({ status: response.statusCode, body }),
          );
        },
      );
      post.once('error', reject);
      post.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'fixture', version: '1' },
          },
        }),
      );
    },
  );
}

it('accepts both origins on a custom port and forces a token for a public hostname on loopback', async () => {
  const publicUrl = 'https://public.example.test:8443';
  setConfig({ publicUrl, requireToken: false });
  const { engine, url, connection } = await start();
  expect(new URL(url).port).not.toBe('4310');
  const Host = 'PUBLIC.example.test:8443';
  const Authorization = `Bearer ${connection.token}`;
  for (const Origin of [url, publicUrl]) {
    expect(await postMcp(url, { Host, Origin, Authorization })).toMatchObject({
      status: 200,
    });
  }
  expect(await postMcp(url, { Origin: publicUrl })).toMatchObject({
    status: 401,
  });
  expect(
    await postMcp(url, {
      Host,
      Origin: publicUrl,
      Authorization: 'Bearer wrong',
    }),
  ).toMatchObject({ status: 401 });
  expect(
    await postMcp(url, {
      Host: 'wrong.example.test',
      'X-Forwarded-Host': Host,
      Authorization,
    }),
  ).toMatchObject({ status: 403 });
  for (const Origin of [
    'https://public.example.test',
    'http://public.example.test:8443',
  ]) {
    const mismatchedOrigin = await postMcp(url, {
      Host,
      Origin,
      'X-Forwarded-Proto': 'https',
      Authorization,
    });
    expect(mismatchedOrigin.status).toBe(403);
    expect(mismatchedOrigin.body).toContain('Untrusted origin');
  }
  expect(
    await createClient(url, { token: connection.token }).connection.query(),
  ).toMatchObject({
    engineUrl: publicUrl,
    mcpUrl: `${publicUrl}/mcp`,
    publicUrlConfigured: true,
    env: { INTERLOCK_URL: url },
  });
  expect(engine.executors.mcpUrl).toBe(`${url}/mcp/execute`);
  expect(engine.executors.publicMcpUrl).toBe(`${publicUrl}/mcp/execute`);
  const capture = join(root, 'launch.json');
  const launcher = join(root, 'launcher.mjs');
  writeFileSync(
    launcher,
    `
    import { readFileSync, writeFileSync } from 'node:fs';
    const payload = JSON.parse(readFileSync(0, 'utf8'));
    writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ url: process.argv[2], mcpUrl: payload.mcpUrl }));
    console.log(JSON.stringify({ sessionId: 'fixture-session' }));
  `,
  );
  const profile = engine.executors.saveProfile({
    id: 'fixture',
    name: 'URL fixture',
    harness: 'custom',
    mode: 'launcher',
    expectedRevision: 0,
    enabled: true,
    transport: 'subprocess',
    launchCommand: `node '${launcher}' $INTERLOCK_MCP_URL`,
  });
  const workflow = engine.create('Launch fixture', '', {
    ...blankDefinition(),
    executor: profile.id,
  });
  engine.publish(workflow.id);
  const work = engine.start(workflow.id, {}).work[0];
  await vi.waitFor(() => {
    expect(engine.executors.inspect(work.id).items[0]?.state).toBe('running');
  });
  expect(JSON.parse(readFileSync(capture, 'utf8'))).toEqual({
    url: `${url}/mcp/execute`,
    mcpUrl: `${url}/mcp/execute`,
  });
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining(`Interlock is running at ${url}/?token=`),
  );
  expect(
    (await engine.doctor()).checks.find(({ name }) => name === 'requireToken'),
  ).toMatchObject({
    details: { value: true, source: 'public URL', forced: true },
    message:
      'true (public URL). Required when the public URL has a non-loopback hostname.',
  });
  await stop();
  rmSync(join(dataDir, 'keys', 'api-token'));
  mkdirSync(join(dataDir, 'keys', 'api-token'));
  await expect(start()).rejects.toThrow('Cannot use the API token file');
});

it.each([
  ['0.0.0.0', '127.0.0.1'],
  ['::', '[::1]'],
  ['192.0.2.1', '192.0.2.1'],
  ['2001:0db8::1', '[2001:db8::1]'],
  ['localhost', 'localhost'],
])(
  'uses the internal URL and checks specific hosts for %s',
  async (host, address) => {
    const internalOrigin = `http://${address}:5000`;
    expect(internalEngineUrl(host, 5000)).toBe(internalOrigin);
    const { engine } = await start();
    const app = createApp(engine, undefined, {
      host,
      internalOrigin,
      publicUrl: null,
    });
    expect((await app.request(`${internalOrigin}/health`)).status).toBe(200);
    expect(
      (
        await app.request(`${internalOrigin}/health`, {
          headers: { Host: 'wrong.example.test' },
        })
      ).status,
    ).toBe(403);
  },
);

it.each(['IPv4', 'IPv6'] as const)(
  'binds a specific %s interface when available',
  async (family) => {
    const host = Object.values(networkInterfaces())
      .flat()
      .find(
        (entry) =>
          entry?.family === family &&
          (family === 'IPv4' ? !entry.internal : entry.internal),
      )?.address;
    if (!host) return;
    setConfig({ host });
    let handle;
    try {
      handle = await start();
    } catch (error) {
      if (
        error instanceof Error &&
        ['EACCES', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EPERM'].includes(
          (error.cause as NodeJS.ErrnoException | undefined)?.code ?? '',
        )
      )
        return;
      throw error;
    }
    expect(handle.server.address()).toMatchObject({ address: host });
    const cliUrl = handle.connection.engineUrl;
    expect((await fetch(`${cliUrl}/health`)).ok).toBe(true);
    const result = await runCli(['doctor', '--json'], {
      ...process.env,
      INTERLOCK_URL: cliUrl,
    });
    const report = doctorReportSchema.parse(JSON.parse(result.stdout));
    expect(report.checks.find(({ name }) => name === 'host')?.details).toEqual({
      value: host,
      source: 'config file',
    });
  },
);

it('pins the desktop listener while applying the configured public URL', async () => {
  const publicUrl = 'https://desktop.example.test';
  setConfig({ host: '192.0.2.1', publicUrl, requireToken: false });
  vi.stubEnv('INTERLOCK_HOST', '0.0.0.0');
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('Missing port');
  const desktop = new DesktopEngineLifecycle({
    port: address.port,
    workdir: root,
    ui: root,
    probeHealth: () => Promise.resolve(false),
    startServer: async (options) => (server = await startServer(options)),
  });
  try {
    const state = await desktop.start();
    expect(server?.server.address()).toMatchObject({ address: '127.0.0.1' });
    expect(new URL(state.uiUrl).origin).toBe(
      `http://127.0.0.1:${address.port}`,
    );
    expect(new URL(state.uiUrl).searchParams.has('token')).toBe(true);
    const client = createClient(state.engineUrl, {
      token: server?.connection.token,
    });
    expect(await client.connection.query()).toMatchObject({
      engineUrl: publicUrl,
      mcpUrl: `${publicUrl}/mcp`,
    });
    expect((await client.system.doctor.query({})).checks).toContainEqual(
      expect.objectContaining({
        name: 'host',
        details: { value: '127.0.0.1', source: 'startup option' },
      }),
    );
  } finally {
    await desktop.stop();
  }
});
