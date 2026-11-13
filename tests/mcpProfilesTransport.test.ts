import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  Client as CurrentClient,
  StreamableHTTPClientTransport as CurrentHttpTransport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport as CurrentStdioTransport } from '@modelcontextprotocol/client/stdio';
import { blankDefinition } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createApp } from '../packages/server/src/app';

// tools/list byte budgets per profile; `default` selects no profile.
const budgets = {
  default: 200_000,
  all: 200_000,
  execute: 60_000,
  author: 120_000,
  operate: 120_000,
} as const;

it.each(['http', 'stdio'])(
  'serves bounded tool profiles over MCP %s without changing the default tool set',
  async (mode) => {
    const engine = new Engine(new Store(':memory:'), process.cwd());
    const server = serve({
      fetch: createApp(engine).fetch,
      hostname: '127.0.0.1',
      port: 0,
    });
    await new Promise<void>((r) =>
      server.listening ? r() : server.once('listening', r),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No listener');
    const url = `http://127.0.0.1:${address.port}`;
    const clients: Client[] = [];
    const connect = async (profile?: string) => {
      const client = new Client({ name: 'profiles', version: '1' });
      clients.push(client);
      await client.connect(
        mode === 'http'
          ? new StreamableHTTPClientTransport(
              new URL(`${url}/mcp${profile ? `/${profile}` : ''}`),
            )
          : new StdioClientTransport({
              command: process.execPath,
              args: ['--import', 'tsx', 'packages/mcp/src/index.ts'],
              cwd: process.cwd(),
              env: {
                ...(process.env as Record<string, string>),
                INTERLOCK_URL: url,
                INTERLOCK_MCP_PROFILE: profile ?? '',
              },
              stderr: 'pipe',
            }),
      );
      return client;
    };
    try {
      const names: Record<string, string[]> = {};
      const connected: Record<string, Client> = {};
      for (const [profile, budget] of Object.entries(budgets)) {
        const client = await connect(
          profile === 'default' ? undefined : profile,
        );
        connected[profile] = client;
        const discovery = await client.listTools();
        expect(
          Buffer.byteLength(JSON.stringify(discovery)),
          profile,
        ).toBeLessThan(budget);
        names[profile] = discovery.tools.map((tool) => tool.name).sort();
        if (profile !== 'execute') continue;
        // The execute profile completes the claim loop and rejects other tools.
        const w = engine.create('Profiles', '', blankDefinition());
        engine.publish(w.id);
        const run = engine.start(w.id, { task: 'profile' }).run;
        const listed = await client.callTool({
          name: 'list_work',
          arguments: {},
        });
        const [work] = (
          listed.structuredContent as { items: { runId: string }[] }
        ).items;
        expect(work.runId).toBe(run.id);
        expect(
          (await client.callTool({ name: 'start_run', arguments: {} })).isError,
        ).toBe(true);
      }
      // Existing configurations keep every tool; each profile is a subset.
      expect(names.default).toEqual(names.all);
      expect(
        [...new Set([...names.execute, ...names.author, ...names.operate])]
          .sort()
          .join(),
      ).toBe(names.all.join());
      // The shared workflow schema is published once as a resource.
      const author = connected.author;
      const create = (await author.listTools()).tools.find(
        (tool) => tool.name === 'create_workflow',
      )!;
      expect(JSON.stringify(create.inputSchema)).not.toContain('"nodes"');
      const resource = await author.readResource({
        uri: 'interlock://schemas/workflow-definition',
      });
      expect((resource.contents[0] as { text: string }).text).toContain(
        '"nodes"',
      );
      if (mode === 'http') {
        const post = (path: string, headers: Record<string, string> = {}) =>
          fetch(`${url}${path}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              ...headers,
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
            }),
          });
        const byHeader = await post('/mcp', {
          'x-interlock-mcp-profile': 'execute',
        });
        expect(
          (
            (await byHeader.json()) as { result: { tools: { name: string }[] } }
          ).result.tools
            .map((tool) => tool.name)
            .sort(),
        ).toEqual(names.execute);
        expect((await post('/mcp/unknown')).status).toBe(404);
        expect(
          (await post('/mcp', { 'x-interlock-mcp-profile': 'unknown' })).status,
        ).toBe(400);
        expect(
          (await post('/mcp/execute', { 'x-interlock-mcp-profile': 'author' }))
            .status,
        ).toBe(400);
      }
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      server.close();
      engine.stop();
    }
  },
);

// A 2026-07-28 client probes with server/discover and falls back to the
// initialize handshake when the server answers like a 2025-era server.
it.each(['http', 'stdio'])(
  'serves a current dual-era MCP client over %s through the legacy handshake',
  async (mode) => {
    const engine = new Engine(new Store(':memory:'), process.cwd());
    const server = serve({
      fetch: createApp(engine).fetch,
      hostname: '127.0.0.1',
      port: 0,
    });
    await new Promise<void>((r) =>
      server.listening ? r() : server.once('listening', r),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No listener');
    const url = `http://127.0.0.1:${address.port}`;
    const client = new CurrentClient(
      { name: 'conformance', version: '1' },
      { versionNegotiation: { mode: 'auto', probe: { timeoutMs: 10_000 } } },
    );
    try {
      await client.connect(
        mode === 'http'
          ? new CurrentHttpTransport(new URL(`${url}/mcp/execute`))
          : new CurrentStdioTransport({
              command: process.execPath,
              args: ['--import', 'tsx', 'packages/mcp/src/index.ts'],
              cwd: process.cwd(),
              env: {
                ...(process.env as Record<string, string>),
                INTERLOCK_URL: url,
                INTERLOCK_MCP_PROFILE: 'execute',
              },
              stderr: 'pipe',
            }),
      );
      expect(client.getProtocolEra()).toBe('legacy');
      expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
      expect(client.getServerVersion()?.name).toBe('interlock');
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain('list_work');
      const listed = await client.callTool({
        name: 'list_work',
        arguments: {},
      });
      expect(listed.isError).not.toBe(true);
      expect(listed.structuredContent).toEqual({ items: [] });
    } finally {
      await client.close();
      server.close();
      engine.stop();
    }
  },
);
