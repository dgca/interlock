import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { blankDefinition } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createClient } from '@interlock/client';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';
it.each(['http', 'stdio'])(
  'discovers and executes pause lifecycle through %s, shared API and CLI',
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
    if (!address || typeof address === 'string') throw Error('No listener');
    const url = `http://127.0.0.1:${address.port}`,
      api = createClient(url),
      client = new Client({ name: 'pause-test', version: '1' });
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
      const discovered = await client.listTools();
      const tool = discovered.tools.find((t) => t.name === 'manage_pause')!;
      expect(tool).toBeDefined();
      expect(JSON.stringify(tool.inputSchema)).toContain('workflowId');
      expect(JSON.stringify(tool.inputSchema)).toContain('resume');
      expect(tool.description).toContain('exact');
      const call = async (request: Record<string, unknown>) => {
        const r = await client.callTool({
          name: 'manage_pause',
          arguments: { request },
        });
        expect(r.isError).not.toBe(true);
        return JSON.parse((r.content as { text: string }[])[0].text);
      };
      const w = e.create('Transport pause', '', blankDefinition());
      e.publish(w.id);
      const r = e.start(w.id, null).run,
        work = e.available(r.id)[0];
      const a = await call({
        action: 'pause',
        target: { scope: 'library' },
        actor: 'deploy',
        reason: 'Deploy',
      });
      process.env.INTERLOCK_URL = url;
      const b = await runCommand([
        'pause',
        JSON.stringify({
          target: { scope: 'workflow', workflowId: w.id },
          actor: 'incident',
          reason: 'Incident',
        }),
      ]);
      expect(
        await call({ action: 'list', workflowId: w.id, limit: 1 }),
      ).toMatchObject({ total: 2, nextOffset: 1 });
      expect(await api.work.summaries.query({ runId: r.id })).toEqual([]);
      expect(
        (await api.runs.briefing.query({ id: r.id })).run.waiting,
      ).toMatchObject({ kind: 'pause' });
      await expect(
        api.work.claim.mutate({ workId: work.id, workerId: 'test' }),
      ).rejects.toThrow(/paused/);
      await call({ action: 'resume', id: a.id });
      expect((await api.pauses.list.query({ workflowId: w.id })).total).toBe(1);
      expect(await runCommand(['resume', a.id])).toMatchObject({
        applied: false,
      });
      expect(
        (
          (await runCommand([
            'pause-holds',
            JSON.stringify({ workflowId: w.id }),
          ])) as any
        ).items[0].id,
      ).toBe((b as any).id);
      await api.pauses.resume.mutate({ id: (b as any).id });
      expect(await api.work.summaries.query({ runId: r.id })).toHaveLength(1);
      expect(JSON.stringify(await runCommand(['help']))).toContain(
        'resume <exact-hold-id>',
      );
    } finally {
      if (prior === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = prior;
      await client.close();
      await transport.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      e.stop();
      e.store.close();
    }
  },
);
