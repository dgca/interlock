import { it, expect } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { createClient } from '@interlock/client';
import { createApp } from '../packages/server/src/app';
import { blankDefinition } from '@interlock/core';

it('completes a workflow through real MCP stdio, HTTP, and SQLite interfaces', async () => {
  const store = new Store(':memory:'),
    engine = new Engine(store, process.cwd());
  const w = engine.create('Transport smoke', '', blankDefinition());
  engine.publish(w.id);
  const server = serve({
    fetch: createApp(engine).fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const url = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'packages/mcp/src/index.ts'],
    cwd: process.cwd(),
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (pair): pair is [string, string] => pair[1] !== undefined,
        ),
      ),
      INTERLOCK_URL: url,
    },
    stderr: 'pipe',
  });
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError).not.toBe(true);
    const content = response.content as { type: string; text: string }[];
    return JSON.parse(content[0].text);
  };
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain(
      'claim_work',
    );
    const started = await call('start_run', {
      workflowId: w.id,
      input: { number: 21 },
    });
    const work = await call('list_work', { runId: started.run.id });
    const claim = await call('claim_work', {
      workId: work[0].id,
      workerId: 'mcp-test',
    });
    const result = await call('submit_result', {
      workId: claim.id,
      token: claim.token,
      output: { number: 42 },
    });
    expect(result.run.status).toBe('completed');
    const rpc = createClient(url);
    expect(
      (await rpc.runs.get.query({ id: started.run.id })).run.output,
    ).toEqual({ number: 42 });
    expect(
      (
        await fetch(`${url}/health`, {
          headers: { origin: 'https://untrusted.example' },
        })
      ).status,
    ).toBe(403);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
