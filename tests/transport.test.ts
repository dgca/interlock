import { batchDefinition } from './fixtures/batch';
import { runCommand } from '../packages/cli/src/commands';
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
    const definition = batchDefinition();
    const workflow = await call('create_workflow', {
      name: 'Batch transport',
      definition,
    });
    await call('publish_workflow', { id: workflow.id });
    const root = await call('start_run', {
      workflowId: workflow.id,
      input: [3, 4],
    });
    const items = await call('list_work', { runId: root.run.id });
    expect(items.map((item: any) => item.input)).toEqual([3, 4]);
    const previousUrl = process.env.INTERLOCK_URL;
    process.env.INTERLOCK_URL = url;
    try {
      expect(await runCommand(['work', root.run.id])).toMatchObject(items);
      const detail = await runCommand(['run', items[0].runId]);
      expect(detail).toMatchObject({
        definition,
        run: { batchNodeId: 'batch' },
      });
    } finally {
      if (previousUrl === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = previousUrl;
    }
    for (const item of items.reverse()) {
      const claimed = await call('claim_work', {
        workId: item.id,
        workerId: 'batch-mcp',
      });
      await call('submit_result', {
        workId: item.id,
        token: claimed.token,
        output: item.input * 2,
      });
    }
    expect((await call('get_run', { id: root.run.id })).run.output).toEqual([
      6, 8,
    ]);
    const failed = await call('start_run', {
      workflowId: workflow.id,
      input: [5],
    });
    const [assignment] = await call('list_work', { runId: failed.run.id });
    const failedClaim = await call('claim_work', {
      workId: assignment.id,
      workerId: 'retry-test',
    });
    await call('fail_work', {
      workId: assignment.id,
      token: failedClaim.token,
      error: 'Temporary executor failure',
    });
    expect((await call('get_run', { id: failed.run.id })).run.status).toBe(
      'failed',
    );
    await call('retry_run', { id: failed.run.id });
    const [retried] = await call('list_work', { runId: failed.run.id });
    const retriedClaim = await call('claim_work', {
      workId: retried.id,
      workerId: 'retry-test',
    });
    await call('submit_result', {
      workId: retried.id,
      token: retriedClaim.token,
      output: 10,
    });
    expect((await call('get_run', { id: failed.run.id })).run.output).toEqual([
      10,
    ]);
    const invalidRetry = await client.callTool({
      name: 'retry_run',
      arguments: { id: failed.run.id },
    });
    expect(invalidRetry.isError).toBe(true);
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
