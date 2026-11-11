import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition } from '@interlock/core';
import { createClient } from '@interlock/client';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';
import { workflowCall } from './fixtures/detached';

let discovery: unknown;
it.each(['http', 'stdio'])(
  'previews and cancels selected trees via MCP %s, shared API and CLI with bounded discovery/results',
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
    const url = `http://127.0.0.1:${address.port}`;
    const client = new Client({ name: 'tree-test', version: '1' });
    const transport =
      mode === 'http'
        ? new StreamableHTTPClientTransport(new URL(url + '/mcp'))
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
    const publish = (d = blankDefinition()) => {
      const w = e.create('Tree transport', '', d);
      e.publish(w.id);
      return w.id;
    };
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(67);
      expect(Buffer.byteLength(JSON.stringify(tools))).toBeLessThanOrEqual(
        300000,
      );
      if (discovery) expect(tools).toEqual(discovery);
      else discovery = tools;
      const selected = tools.filter((t) =>
        ['preview_run_cancellation', 'cancel_run_tree'].includes(t.name),
      );
      expect(selected).toHaveLength(2);
      expect(JSON.stringify(selected)).toContain('includeDetached');
      expect(
        selected.find((t) => t.name === 'cancel_run_tree')!.inputSchema
          .required,
      ).toContain('reason');
      console.log(
        `${mode}: ${tools.length} tools, ${Buffer.byteLength(JSON.stringify(tools))} B; cancellation definitions ${Buffer.byteLength(JSON.stringify(selected))} B`,
      );
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = await client.callTool({ name, arguments: args });
        expect(r.isError).not.toBe(true);
        const data = JSON.parse((r.content as { text: string }[])[0].text);
        expect(r.structuredContent).toEqual(
          Array.isArray(data) ? { items: data } : data,
        );
        return data;
      };
      const root = e.start(publish(workflowCall(publish(), 'detached', true)), {
        private: 'SECRET_INPUT',
      }).run;
      const api = createClient(url);
      const preview = await call('preview_run_cancellation', {
        id: root.id,
        includeDetached: true,
        limit: 1,
      });
      expect(preview).toMatchObject({
        total: 2,
        truncated: true,
        nextOffset: 1,
      });
      expect(JSON.stringify(preview)).not.toContain('SECRET_INPUT');
      expect(
        await api.runs.previewCancellation.query({
          id: root.id,
          includeDetached: true,
          limit: 1,
        }),
      ).toEqual(preview);
      process.env.INTERLOCK_URL = url;
      expect(
        await runCommand([
          'cancel-tree',
          root.id,
          '--preview',
          '--include-detached',
          '--limit',
          '1',
        ]),
      ).toEqual(preview);
      const page = (await runCommand([
        'cancel-tree',
        root.id,
        '--preview',
        '--include-detached',
        '--offset',
        '1',
      ])) as { items: { id: string }[] };
      expect(page.items).toHaveLength(1);
      await expect(runCommand(['cancel-tree', root.id])).rejects.toThrow(
        'Usage',
      );
      const rejected = await client.callTool({
        name: 'cancel_run_tree',
        arguments: { id: root.id, includeDetached: true, reason: ' ' },
      });
      expect(rejected.isError).toBe(true);
      expect(e.run(root.id).status).toBe('waiting');
      const result = await call('cancel_run_tree', {
        id: root.id,
        includeDetached: true,
        reason: 'Bad batch',
        limit: 1,
      });
      expect(result.cancelled).toMatchObject({
        total: 2,
        truncated: true,
        items: [{ id: root.id, status: 'cancelled' }],
      });
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1000);
      expect(
        (await call('get_run', { id: root.id })).run.cancellationReason,
      ).toBe('Bad batch');
      expect((await call('get_run_briefing', { id: root.id })).run.status).toBe(
        'cancelled',
      );
      expect(await call('list_work', { runId: root.id })).toEqual([]);
      const next = e.start(publish(), null).run;
      expect(
        await runCommand(['cancel-tree', next.id, '--reason', 'CLI stop']),
      ).toMatchObject({ cancelled: { total: 1 } });
      expect(e.run(next.id).cancellationReason).toBe('CLI stop');
      const last = e.start(publish(), null).run;
      expect(
        await api.runs.cancelTree.mutate({ id: last.id, reason: 'API stop' }),
      ).toMatchObject({ cancelled: { total: 1 } });
    } finally {
      if (prior === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = prior;
      await client.close();
      e.stop();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      e.store.close();
    }
  },
);
