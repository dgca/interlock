import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  Client as CurrentClient,
  StreamableHTTPClientTransport as CurrentHttpTransport,
} from '@modelcontextprotocol/client';
import { blankDefinition, nodeSchema } from '@interlock/core';
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

it('serves bounded tool profiles over MCP without changing the default tool set', async () => {
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
  const connect = async (profile?: string, mode = 'http') => {
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
    const text: Record<string, string> = {};
    for (const [profile, budget] of Object.entries(budgets)) {
      const client = await connect(profile === 'default' ? undefined : profile);
      connected[profile] = client;
      const discovery = await client.listTools();
      expect(
        Buffer.byteLength(JSON.stringify(discovery)),
        profile,
      ).toBeLessThan(budget);
      names[profile] = discovery.tools.map((tool) => tool.name).sort();
      text[profile] = [
        client.getInstructions() ?? '',
        ...discovery.tools.map((tool) => JSON.stringify(tool)),
      ].join('\n');
      if (profile !== 'execute') continue;
      // The execute profile completes the claim loop, including an assignment
      // tool call, and rejects other tools.
      const definition = blankDefinition();
      definition.nodes.push(
        nodeSchema.parse({
          id: 'checks',
          kind: 'script',
          label: 'Run checks',
          language: 'javascript',
          command: 'return { checked: input.target }',
        }),
      );
      definition.edges.push({
        id: 'tool',
        source: 'agent',
        target: 'checks',
        port: 'default',
        kind: 'tool',
      });
      const w = engine.create('Profiles', '', definition);
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
      const claimed = (
        await client.callTool({
          name: 'claim_work',
          arguments: { workId: (work as { id?: string }).id, workerId: 'w' },
        })
      ).structuredContent as {
        id: string;
        token: string;
        tools: { name: string }[];
        executionInstructions: string;
      };
      expect(claimed.tools.map((t) => t.name)).toEqual(['run_checks']);
      expect(claimed.executionInstructions).toContain('call_work_tool');
      const called = await client.callTool({
        name: 'call_work_tool',
        arguments: {
          workId: claimed.id,
          token: claimed.token,
          name: 'run_checks',
          arguments: { target: 'all' },
        },
      });
      expect(called.structuredContent).toMatchObject({
        status: 'completed',
        output: { checked: 'all' },
      });
      expect(
        (await client.callTool({ name: 'start_run', arguments: {} })).isError,
      ).toBe(true);
    }
    // Existing configurations keep every tool; each profile is a subset.
    expect(names.default).toEqual(names.all);
    expect(text.default).toBe(text.all);
    expect(
      [...new Set([...names.execute, ...names.author, ...names.operate])]
        .sort()
        .join(),
    ).toBe(names.all.join());
    // Bounded discovery (instructions, descriptions, input and output schemas
    // including enum values) never points agents at tools outside the profile.
    // Longer names first, so a name never matches as a prefix of another.
    const known = new RegExp(
      `\\b(?:${[...names.all].sort((a, b) => b.length - a.length).join('|')})\\b`,
      'g',
    );
    for (const profile of ['execute', 'author', 'operate'])
      expect(
        [...new Set(text[profile].match(known))].filter(
          (name) => !names[profile].includes(name),
        ),
        profile,
      ).toEqual([]);
    // The stdio bridge serves the same profiles.
    for (const profile of [undefined, 'execute'])
      expect(
        (await (await connect(profile, 'stdio')).listTools()).tools
          .map((tool) => tool.name)
          .sort(),
      ).toEqual(names[profile ?? 'default']);
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
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    server.close();
    engine.stop();
  }
});

// A 2026-07-28 client probes with server/discover and falls back to the
// initialize handshake when the server answers like a 2025-era server.
// The handshake is the SDK server's; the stdio bridge shares it.
it('serves a current dual-era MCP client through the legacy handshake', async () => {
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
      new CurrentHttpTransport(new URL(`${url}/mcp/execute`)),
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
});
