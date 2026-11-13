import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { ensureApiToken } from '@interlock/core/apiToken';
import { createApp, serveUi } from '../packages/server/src/app';
import { developmentConnection } from '../packages/server/src/connection';

// Token-off behavior is the default in every other transport test.
it('requires the API token on HTTP, MCP and the event stream when enabled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-token-'));
  const token = ensureApiToken(join(dir, 'api-token'));
  expect(statSync(join(dir, 'api-token')).mode & 0o777).toBe(0o600);
  writeFileSync(join(dir, 'index.html'), '<html><head></head></html>');
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  const connection = {
    ...developmentConnection(),
    token,
    requireToken: true,
  };
  const app = createApp(engine, connection);
  serveUi(app, dir, connection);
  const initialize = (headers: Record<string, string> = {}) =>
    app.request('http://127.0.0.1:4310/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'token-check', version: '1.0.0' },
        },
      }),
    });
  const get = (path: string, headers: Record<string, string> = {}) =>
    app.request(`http://127.0.0.1:4310${path}`, { headers });
  const bearer = { authorization: `Bearer ${token}` };
  const wrong = { authorization: `Bearer ${token.slice(1)}x` };
  let server: ReturnType<typeof serve> | undefined;
  const client = new Client({ name: 'token-stdio', version: '1.0.0' });
  try {
    for (const headers of [{}, wrong]) {
      expect((await get('/trpc/connection', headers)).status).toBe(401);
      expect((await initialize(headers)).status).toBe(401);
      expect((await get('/events', headers)).status).toBe(401);
    }
    // Header tokens belong to clients that can send them; the query is for EventSource.
    expect((await get(`/trpc/connection?token=${token}`)).status).toBe(401);
    expect((await initialize(bearer)).status).toBe(200);
    const read = await get('/trpc/connection', bearer);
    expect(read.status).toBe(200);
    expect(
      ((await read.json()) as { result: { data: { token: string } } }).result
        .data.token,
    ).toBe(token);
    const stream = await get(`/events?token=${token}`);
    expect(stream.status).toBe(200);
    await stream.body?.cancel();
    // A required token reaches the page only through the startup link.
    expect(await (await get('/')).text()).not.toContain(token);
    expect(await (await get('/runs/x')).text()).not.toContain(token);
    expect(await (await get(`/?token=${token}`)).text()).toContain(
      `<meta name="interlock-api-token" content="${token}" />`,
    );

    // The stdio bridge reads the token beside the configured key file.
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'packages/mcp/src/index.ts'],
        cwd: process.cwd(),
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (pair): pair is [string, string] => pair[1] !== undefined,
            ),
          ),
          INTERLOCK_URL: `http://127.0.0.1:${address.port}`,
          INTERLOCK_SECRET_KEY_FILE: join(dir, 'secret.key'),
        },
        stderr: 'pipe',
      }),
    );
    const listed = await client.callTool({
      name: 'list_workflows',
      arguments: {},
    });
    expect(listed.isError).not.toBe(true);
  } finally {
    await client.close();
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    engine.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
