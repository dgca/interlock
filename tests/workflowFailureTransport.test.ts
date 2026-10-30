import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  blankDefinition,
  nodeSchema,
  assertContract,
  WORKFLOW_FAILURE_ROUTE_SCHEMA,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';
import { workflowCall } from './fixtures/detached';

it.each(['http', 'stdio'])(
  'routes waited failures through %s discovery, execution and CLI inspection',
  async (mode) => {
    const e = new Engine(new Store(':memory:'), process.cwd());
    const server = serve({
      fetch: createApp(e).fetch,
      hostname: '127.0.0.1',
      port: 0,
    });
    await new Promise<void>((resolve) =>
      server.listening ? resolve() : server.once('listening', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const url = `http://127.0.0.1:${address.port}`,
      client = new Client({ name: 'workflow-failures', version: '1' });
    const transport =
      mode === 'http'
        ? new StreamableHTTPClientTransport(new URL(`${url}/mcp`))
        : new StdioClientTransport({
            command: process.execPath,
            args: ['--import', 'tsx', 'packages/mcp/src/index.ts'],
            cwd: process.cwd(),
            env: { ...process.env, INTERLOCK_URL: url } as Record<
              string,
              string
            >,
            stderr: 'pipe',
          });
    const prior = process.env.INTERLOCK_URL;
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(49);
      expect(
        JSON.stringify(
          tools.find((tool) => tool.name === 'create_workflow')?.inputSchema,
        ),
      ).toContain('Waited calls only');
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError).not.toBe(true);
        const data = JSON.parse(
          (response.content as { text: string }[])[0].text,
        );
        const structured = Array.isArray(data) ? { items: data } : data;
        expect(response.structuredContent).toEqual(structured);
        const schema = tools.find((tool) => tool.name === name)?.outputSchema;
        if (schema) assertContract(schema, structured, name);
        return data;
      };
      const childD = blankDefinition();
      childD.nodes[1] = nodeSchema.parse({
        ...childD.nodes[1],
        maxAttempts: 1,
      });
      const child = await call('create_workflow', {
        name: 'Child',
        definition: childD,
      });
      await call('publish_workflow', { id: child.id });
      const d = workflowCall(child.id);
      d.nodes[1] = nodeSchema.parse({
        ...d.nodes[1],
        onFailure: 'route',
        inputBindings: { topic: { source: 'input', path: 'request.topic' } },
      });
      d.edges.push({
        id: 'failed',
        source: 'agent',
        target: 'exit',
        port: 'failed',
      });
      const parent = await call('create_workflow', {
        name: 'Parent',
        definition: d,
      });
      await call('publish_workflow', { id: parent.id });
      const started = await call('start_run', {
        workflowId: parent.id,
        input: { request: { topic: 'test' } },
      });
      const claimed = await call('claim_work', {
        workId: started.nextWork.items[0].id,
        workerId: 'test',
      });
      await call('fail_work', {
        workId: claimed.id,
        token: claimed.token,
        error: 'Cannot finish',
      });
      const brief = await call('get_run_briefing', { id: started.runId });
      expect(brief).toMatchObject({
        run: { status: 'completed' },
        next: 'inspect_result',
      });
      const result = await call('get_run_result', { id: started.runId });
      expect(result.value).toMatchObject({
        input: { topic: 'test' },
        error: {
          kind: 'workflow',
          category: 'child',
          child: {
            runId: claimed.runId,
            workflowId: child.id,
            version: 1,
            executionId: claimed.executionId,
          },
        },
      });
      assertContract(
        WORKFLOW_FAILURE_ROUTE_SCHEMA,
        result.value,
        'routed Workflow',
      );
      expect(
        (await call('get_run', { id: claimed.runId })).handledFailure,
      ).toEqual({
        runId: started.runId,
        executionId: result.value.error.executionId,
      });
      expect(JSON.stringify(result)).not.toContain(claimed.token);
      expect(
        (
          await client.callTool({
            name: 'retry_run',
            arguments: { id: claimed.runId },
          })
        ).isError,
      ).toBe(true);
      process.env.INTERLOCK_URL = url;
      expect(await runCommand(['run', started.runId])).toMatchObject({
        run: { status: 'completed', output: result.value },
      });
      const next = await call('start_run', {
        workflowId: parent.id,
        input: { request: { topic: 'CLI' } },
      });
      const work = await call('claim_work', {
        workId: next.nextWork.items[0].id,
        workerId: 'cli-test',
      });
      await runCommand(['fail', work.id, work.token, 'CLI failure']);
      expect(await runCommand(['run', next.runId])).toMatchObject({
        run: { status: 'completed', output: { error: { category: 'child' } } },
      });
      const cancelled = await call('start_run', {
        workflowId: parent.id,
        input: { request: { topic: 'cancel' } },
      });
      await call('cancel_run', { id: cancelled.nextWork.items[0].runId });
      expect(await call('get_run', { id: cancelled.runId })).toMatchObject({
        run: {
          status: 'failed',
          executions: [
            expect.anything(),
            expect.not.objectContaining({ port: 'failed' }),
          ],
        },
      });
    } finally {
      if (prior === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = prior;
      await client.close();
      e.stop();
      e.store.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
