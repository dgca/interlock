import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { blankDefinition, nodeSchema, assertContract } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';

it.each(['http', 'stdio'])(
  'continues and cancels run chains through %s and CLI',
  async (mode) => {
    const engine = new Engine(new Store(':memory:'), process.cwd());
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
    const url = `http://127.0.0.1:${address.port}`,
      client = new Client({ name: 'chains', version: '1' });
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
          tools.find((t) => t.name === 'create_workflow')?.inputSchema,
        ),
      ).toContain('continueAsNew');
      expect(
        tools.find((t) => t.name === 'cancel_run')?.inputSchema.properties
          ?.scope,
      ).toMatchObject({ default: 'run', enum: ['run', 'chain'] });
      expect(
        tools.find((t) => t.name === 'list_runs')?.inputSchema.properties,
      ).toHaveProperty('chainRootRunId');
      expect(
        tools.find((t) => t.name === 'get_run_usage')?.inputSchema.properties
          ?.includeChain,
      ).toMatchObject({ default: false });
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).not.toBe(true);
        const data = JSON.parse((result.content as { text: string }[])[0].text);
        const structured = Array.isArray(data) ? { items: data } : data;
        expect(result.structuredContent).toEqual(structured);
        const schema = tools.find((t) => t.name === name)?.outputSchema;
        if (schema) assertContract(schema, structured, name);
        return data;
      };
      const d = blankDefinition();
      d.nodes[2] = nodeSchema.parse({
        ...d.nodes[2],
        continueAsNew: { maxRuns: 3 },
      });
      const w = await call('create_workflow', { name: 'Chain', definition: d });
      await call('publish_workflow', { id: w.id });
      const first = await call('start_run', {
        workflowId: w.id,
        input: { cursor: 0 },
        budget: {
          scope: 'run',
          unknownUsage: 'allow',
          limits: { claims: { max: 1 } },
        },
      });
      const work = await call('claim_work', {
        workId: first.nextWork.items[0].id,
        workerId: 'test',
      });
      const submit = await call('submit_result', {
        workId: work.id,
        token: work.token,
        output: { cursor: 1 },
      });
      expect(submit).toMatchObject({
        next: 'continue_as_new',
        runStatus: 'completed',
        chain: { rootRunId: first.runId, index: 1 },
      });
      const next = submit.chain.nextRunId;
      expect(submit.nextCall).toEqual({
        tool: 'get_run_briefing',
        arguments: { id: next },
      });
      engine.pump();
      expect(await call('get_run_briefing', { id: next })).toMatchObject({
        next: 'adjust_budget',
        run: { chain: { rootRunId: first.runId, previousRunId: first.runId } },
      });
      expect(await call('get_run_budget', { runId: next })).toMatchObject({
        governing: [{ runId: first.runId, attempts: 1, state: 'blocked' }],
      });
      expect(
        await call('list_runs', { chainRootRunId: first.runId }),
      ).toHaveLength(2);
      process.env.INTERLOCK_URL = url;
      expect(await runCommand(['runs', '--chain', first.runId])).toHaveLength(
        2,
      );
      expect(
        await runCommand(['usage', next, '{"includeChain":true}']),
      ).toMatchObject({ includedRuns: 2, totals: { attempts: 1 } });
      expect(await call('cancel_run', { id: first.runId })).toMatchObject({
        run: { status: 'completed' },
      });
      expect(engine.run(next).status).toBe('waiting');
      expect(
        await runCommand(['cancel', first.runId, '--chain']),
      ).toMatchObject({ chain: { cancelledAt: expect.any(String) } });
      expect(engine.run(next).status).toBe('cancelled');
      expect(
        await call('cancel_run', { id: first.runId, scope: 'chain' }),
      ).toMatchObject({
        chain: { latestRunId: next, cancelledAt: expect.any(String) },
      });
    } finally {
      if (prior === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = prior;
      await client.close();
      engine.stop();
      engine.store.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
