import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createClient } from '@interlock/client';
import { blankDefinition } from '@interlock/core';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';

let discovery: unknown;
it.each(['http', 'stdio'])(
  'recovers concurrent ordinary starts across MCP %s, HTTP and CLI',
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'interlock-start-transport-')),
      store = new Store(join(root, 'state.db')),
      engine = new Engine(store, root);
    const w = engine.create('Subject', '', blankDefinition());
    engine.publish(w.id);
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
    const client = new Client({ name: 'idempotent-start-test', version: '1' }),
      transport =
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
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).not.toBe(true);
      const value = JSON.parse((r.content as { text: string }[])[0].text);
      expect(r.structuredContent).toEqual(
        Array.isArray(value) ? { items: value } : value,
      );
      return value;
    };
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(56);
      if (discovery) expect(tools).toEqual(discovery);
      else {
        discovery = tools;
        console.log(
          `MCP discovery: ${tools.length} tools, ${Buffer.byteLength(JSON.stringify(tools))} bytes`,
        );
      }
      const task = {
          system: 'github',
          id: 'dgca/interlock#181',
          url: 'https://github.com/dgca/interlock/issues/181',
        },
        budget = {
          scope: 'tree',
          unknownUsage: 'allow',
          limits: { claims: { max: 1 } },
        },
        q = {
          workflowId: w.id,
          input: { secret: 'private-start-input' },
          requestId: 'request-' + mode,
          externalTask: task,
          budget,
        };
      const starts = await Promise.all(
        Array.from({ length: 8 }, () => call('start_run', q)),
      );
      const id = starts[0].runId;
      expect(new Set(starts.map((s) => s.runId)).size).toBe(1);
      expect(store.runs()).toHaveLength(1);
      expect(store.work()).toHaveLength(1);
      expect(store.list('runStarts')).toHaveLength(1);
      expect(engine.budgets.read(id).revision).toBe(1);
      engine.publish(w.id);
      const before = JSON.stringify(store.runs()),
        full = await call('start_run', { ...q, detail: 'full', limit: 100 });
      expect(full.run.id).toBe(id);
      expect(full.run.version).toBe(1);
      expect(full.run.externalTask).toEqual(task);
      expect(JSON.stringify(store.runs())).toBe(before);
      const api = createClient(url);
      expect((await api.runs.start.mutate(q as any)).run.id).toBe(id);
      vi.stubEnv('INTERLOCK_URL', url);
      writeFileSync(join(root, 'task.json'), JSON.stringify(task));
      writeFileSync(join(root, 'budget.json'), JSON.stringify(budget));
      const cli: any = await runCommand([
        'start',
        w.id,
        JSON.stringify(q.input),
        '--summary',
        '--request-id',
        q.requestId,
        '--external-task',
        '@' + join(root, 'task.json'),
        '--budget',
        '@' + join(root, 'budget.json'),
      ]);
      expect(cli.runId).toBe(id);
      const matches = await call('list_runs', {
        requestId: q.requestId,
        externalTask: { system: task.system, id: task.id },
        rootOnly: true,
      });
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        id,
        startRequestId: q.requestId,
        externalTask: task,
      });
      const cliMatches: any = await runCommand([
        'runs',
        '--request-id',
        q.requestId,
        '--external-task',
        JSON.stringify({ system: task.system, id: task.id }),
        '--root-only',
      ]);
      expect(cliMatches.map((r: any) => r.id)).toEqual([id]);
      expect(await call('get_run_briefing', { id })).toMatchObject({
        run: { startRequestId: q.requestId, externalTask: task },
      });
      const conflict = await client.callTool({
        name: 'start_run',
        arguments: { ...q, input: { secret: 'conflicting-private-input' } },
      });
      expect(conflict.isError).toBe(true);
      expect(JSON.stringify(conflict.content)).toContain('different arguments');
      expect(JSON.stringify(conflict.content)).not.toContain('private-input');
      expect(store.runs()).toHaveLength(1);
      await call('cancel_run', { id });
      expect((await call('start_run', q)).runStatus).toBe('cancelled');
      expect(store.runs()).toHaveLength(1);
      await call('delete_workflow', { id: w.id });
      const deleted = await client.callTool({
        name: 'start_run',
        arguments: q,
      });
      expect(deleted.isError).toBe(true);
      expect(JSON.stringify(deleted.content)).toContain('deleted or missing');
      expect(store.runs()).toHaveLength(0);
      expect(store.list('runStarts')).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
      await client.close();
      await new Promise<void>((r) => server.close(() => r()));
      engine.stop();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000,
);
