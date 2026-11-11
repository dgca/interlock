import { expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Engine, type HarnessRun } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, definitionSchema } from '@interlock/core';
import { createClient } from '@interlock/client';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';

it.each(['http', 'stdio'])(
  'shares bounded transcript and message receipt semantics through MCP %s, CLI and API',
  async (mode) => {
    const e = new Engine(new Store(':memory:'), process.cwd());
    let input: HarnessRun | undefined;
    const sends: string[] = [];
    e.executors.saveProfile({
      id: 'codex',
      harness: 'codex',
      name: 'Fixture',
      enabled: true,
      expectedRevision: 0,
    });
    e.executors.start([
      {
        id: 'codex',
        detect: async () => ({ status: 'detected', command: '/fixture' }),
        run: async (i) => {
          input = i;
          i.onSession('fixture');
          i.onTranscript?.({
            kind: 'assistant',
            text: 'Inspecting dependencies',
          });
          i.onMessageChannel?.(async (message) => {
            sends.push(message);
          });
          return new Promise((_resolve, reject) =>
            i.signal.addEventListener(
              'abort',
              () => reject(new Error('Stopped')),
              { once: true },
            ),
          );
        },
      },
    ]);
    const d = blankDefinition();
    d.executor = 'codex';
    const w = e.create('Transport fixture', '', definitionSchema.parse(d));
    e.publish(w.id);
    e.start(w.id, {});
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
    const url = `http://127.0.0.1:${address.port}`;
    const prior = process.env.INTERLOCK_URL;
    process.env.INTERLOCK_URL = url;
    const client = new Client({ name: 'transcript-test', version: '1' });
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
                  (p): p is [string, string] => p[1] !== undefined,
                ),
              ),
              INTERLOCK_URL: url,
            },
            stderr: 'pipe',
          });
    try {
      await client.connect(transport);
      await vi.waitFor(() => expect(input).toBeDefined());
      const executionId = e.executors.inspect(input!.work.id).items[0].id;
      const discovery = await client.listTools();
      const tool = discovery.tools.find((t) => t.name === 'manage_executors')!;
      expect(JSON.stringify(tool.inputSchema)).toContain('transcript');
      expect(tool.description).toContain('unknown');
      const call = async (request: Record<string, unknown>) => {
        const result = await client.callTool({
          name: 'manage_executors',
          arguments: { request },
        });
        expect(result.isError).not.toBe(true);
        return JSON.parse((result.content as { text: string }[])[0].text);
      };
      const page = await call({ action: 'transcript', executionId });
      expect(
        page.items.some(
          (item: { text: string }) => item.text === 'Inspecting dependencies',
        ),
      ).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(256 * 1024);
      const q = {
        action: 'message',
        executionId,
        requestId: 'guidance',
        message: 'Use vendor',
      };
      const receipt = await call(q);
      expect(receipt.status).toBe('accepted');
      expect(receipt.source).toBe('mcp');
      const api = createClient(url);
      const recovered = await runCommand(['executors', JSON.stringify(q)]);
      expect(recovered).toEqual(receipt);
      expect(sends).toEqual(['Use vendor']);
      expect(
        (
          await api.executors.receipt.query({
            executionId,
            requestId: 'guidance',
          })
        ).receipt,
      ).toEqual(receipt);
      const invalid = await client.callTool({
        name: 'manage_executors',
        arguments: {
          request: { action: 'transcript', executionId, limit: 101 },
        },
      });
      expect(invalid.isError).toBe(true);
      const conflicting = await client.callTool({
        name: 'manage_executors',
        arguments: { request: { ...q, message: 'changed' } },
      });
      expect(conflicting.isError).toBe(true);
      expect(sends).toHaveLength(1);
    } finally {
      if (prior === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = prior;
      await client.close();
      await e.executors.stop();
      e.stop();
      e.store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
