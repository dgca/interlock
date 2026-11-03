import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition } from '@interlock/core';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';

it.each(['http', 'stdio'])(
  'previews and removes reviewed history through MCP %s, CLI and shared API without changing tool defaults',
  async (mode) => {
    const store = new Store(':memory:'),
      engine = new Engine(store, process.cwd());
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
    const client = new Client({ name: 'history-test', version: '1' });
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
      const tool = tools.find((entry) => entry.name === 'manage_run_history')!;
      const discovered = JSON.stringify(tool);
      console.log(
        `${mode}: manage_run_history definition ${Buffer.byteLength(discovered)} B, ${tools.length} tools total`,
      );
      for (const field of [
        'preview',
        'delete',
        'rootRunIds',
        'before',
        'workflowId',
        'offset',
        'limit',
        'confirmation',
        'acknowledgeHistoryLoss',
      ])
        expect(discovered).toContain(field);
      const call = async (name: string, input: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: input });
        expect(result.isError).not.toBe(true);
        const data = JSON.parse((result.content as { text: string }[])[0].text);
        expect(result.structuredContent).toEqual(data);
        return data;
      };
      const workflow = engine.create(
        'History transport',
        '',
        blankDefinition(),
      );
      engine.publish(workflow.id);
      const started = await call('start_run', {
        workflowId: workflow.id,
        input: { private: 'PRIVATE_VALUE' },
        requestId: `history-${mode}`,
      });
      expect(started).toHaveProperty('runId');
      const claimed = await call('claim_work', {
        workId: started.nextWork.items[0].id,
        workerId: 'history',
      });
      await call('submit_result', {
        workId: claimed.id,
        token: claimed.token,
        output: null,
      });
      const preview = await call('manage_run_history', {
        request: { action: 'preview', workflowId: workflow.id },
      });
      expect(preview).toMatchObject({ total: 1, offset: 0, nextOffset: null });
      expect(preview.items[0]).toMatchObject({
        rootRunId: started.runId,
        canDelete: true,
        runCount: 1,
      });
      expect(JSON.stringify(preview)).not.toContain('PRIVATE_VALUE');
      expect(JSON.stringify(preview)).not.toContain(claimed.token);
      const deletion = {
        action: 'delete',
        roots: [
          { runId: started.runId, confirmation: preview.items[0].confirmation },
        ],
        acknowledgeHistoryLoss: true,
      };
      const invalid = await client.callTool({
        name: 'manage_run_history',
        arguments: { request: { ...deletion, acknowledgeHistoryLoss: false } },
      });
      expect(invalid.isError).toBe(true);
      expect(engine.run(started.runId).status).toBe('completed');
      process.env.INTERLOCK_URL = url;
      const viaCli = (await runCommand([
        'run-history',
        JSON.stringify({ action: 'preview', rootRunIds: [started.runId] }),
      ])) as typeof preview;
      expect(viaCli.items[0].confirmation).toBe(preview.items[0].confirmation);
      const cliProcess = await promisify(execFile)(
        process.execPath,
        [
          '--import',
          'tsx',
          'packages/cli/src/bin.ts',
          'run-history',
          JSON.stringify({ action: 'preview', rootRunIds: [started.runId] }),
        ],
        { cwd: process.cwd(), env: { ...process.env, INTERLOCK_URL: url } },
      );
      expect(JSON.parse(cliProcess.stdout).items[0].confirmation).toBe(
        preview.items[0].confirmation,
      );
      const removed =
        mode === 'http'
          ? await call('manage_run_history', { request: deletion })
          : ((await runCommand([
              'run-history',
              JSON.stringify(deletion),
            ])) as any);
      expect(removed).toMatchObject({
        deletedRoots: 1,
        deletedRuns: 1,
        retainedStartReceipts: 1,
      });
      expect(removed.removedDocumentBytes).toBe(preview.items[0].documentBytes);
      expect(store.work()).toEqual([]);
      const missing = await client.callTool({
        name: 'get_run_briefing',
        arguments: { id: started.runId },
      });
      expect(missing.isError).toBe(true);
      const replay = await client.callTool({
        name: 'start_run',
        arguments: {
          workflowId: workflow.id,
          input: { private: 'PRIVATE_VALUE' },
          requestId: `history-${mode}`,
        },
      });
      expect(replay.isError).toBe(true);
      expect(engine.workflow(workflow.id).latestVersion).toBe(1);
      expect(
        (await call('manage_run_history', { request: { action: 'preview' } }))
          .items,
      ).toEqual([]);
    } finally {
      if (prior === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = prior;
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      engine.stop();
      store.close();
    }
  },
);
