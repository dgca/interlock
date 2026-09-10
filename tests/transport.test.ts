import { batchDefinition } from './fixtures/batch';
import { runCommand } from '../packages/cli/src/commands';
import { it, expect } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { createClient } from '@interlock/client';
import { createApp } from '../packages/server/src/app';
import { nodeSchema, blankDefinition } from '@interlock/core';

it.each(['stdio', 'http'])(
  'completes a workflow through MCP %s and the shared HTTP and SQLite interfaces',
  async (mode) => {
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
    const transport =
      mode === 'http'
        ? new StreamableHTTPClientTransport(new URL(`${url}/mcp`))
        : new StdioClientTransport({
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
      expect(
        (await call('list_workflows', {})).some(
          (item: { id: string }) => item.id === w.id,
        ),
      ).toBe(true);
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
      const dependentDefinition = blankDefinition();
      dependentDefinition.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'workflow',
        label: 'Shared',
        workflowId: w.id,
        version: 1,
      });
      const dependent = engine.create('Dependent', '', dependentDefinition);
      engine.publish(dependent.id);
      await call('publish_workflow', { id: w.id, cascade: true });
      expect(engine.workflow(dependent.id).latestVersion).toBe(2);
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
        await runCommand(['publish', w.id, '--cascade']);
        expect(engine.workflow(dependent.id).latestVersion).toBe(3);
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
      expect((await call('get_run', { id: failed.run.id })).run.output).toEqual(
        [10],
      );
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
      engine.stop();
      store.close();
    }
  },
);

it('validates HTTP MCP requests and preserves local-access and body limits', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  const app = createApp(engine);
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  const message = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'http-validation', version: '1.0.0' },
    },
  };
  const request = (body: unknown, extra: Record<string, string> = {}) =>
    app.request('http://127.0.0.1:4310/mcp', {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  try {
    const initialized = await request(message);
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get('content-type')).toContain(
      'application/json',
    );
    expect(initialized.headers.has('mcp-session-id')).toBe(false);
    expect(await initialized.json()).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'interlock' } },
    });
    expect(
      (await request({ jsonrpc: '2.0', method: 'notifications/initialized' }))
        .status,
    ).toBe(202);
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const response = await app.request('http://127.0.0.1:4310/mcp', {
        method,
      });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
    expect(
      (await request(message, { origin: 'https://untrusted.example' })).status,
    ).toBe(403);
    expect(
      (
        await app.request('http://untrusted.example/mcp', {
          method: 'POST',
          headers,
          body: JSON.stringify(message),
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(message, { origin: 'http://127.0.0.1:4310' })).status,
    ).toBe(200);
    expect((await request(message, { accept: 'text/html' })).status).toBe(406);
    expect(
      (await request(message, { 'content-type': 'text/plain' })).status,
    ).toBe(415);
    expect(
      (
        await app.request('http://127.0.0.1:4310/mcp', {
          method: 'POST',
          headers,
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
          {
            'mcp-protocol-version': 'unsupported',
          },
        )
      ).status,
    ).toBe(400);
    expect((await request('x'.repeat(2 * 1024 * 1024))).status).toBe(413);
    // Independent clients can reuse JSON-RPC IDs without sharing a transport.
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: 1,
        result: { tools: expect.any(Array) },
      });
    }
  } finally {
    engine.stop();
    store.close();
  }
});
