import { mkdtempSync, rmSync } from 'node:fs';
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
  'starts, discovers and filters tagged runs through MCP %s, shared API and CLI',
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'interlock-tags-transport-'));
    const store = new Store(join(root, 'state.db'));
    const engine = new Engine(store, root);
    const workflow = engine.create('Tagged', '', blankDefinition());
    engine.publish(workflow.id);
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
    const client = new Client({ name: 'run-tags-test', version: '1' });
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
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse((result.content as { text: string }[])[0].text);
      expect(result.structuredContent).toEqual(
        Array.isArray(parsed) ? { items: parsed } : parsed,
      );
      return parsed;
    };
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      if (discovery) expect(tools).toEqual(discovery);
      else {
        discovery = tools;
        console.log(
          `Tagged MCP discovery: ${tools.length} tools, ${Buffer.byteLength(JSON.stringify(tools))} bytes`,
        );
      }
      for (const name of ['start_run', 'list_runs'])
        expect(
          tools.find((tool) => tool.name === name)?.inputSchema.properties,
        ).toHaveProperty('tags');
      expect(
        JSON.stringify(
          tools.find((tool) => tool.name === 'manage_workflow_triggers')
            ?.inputSchema,
        ),
      ).toContain('tags');
      const tags = { repo: 'dgca/interlock', batch: 'factory=7', empty: '' };
      const request = {
        workflowId: workflow.id,
        input: {},
        tags,
        requestId: 'tags-' + mode,
      };
      const started = await call('start_run', request);
      expect(started).toMatchObject({ tags });
      const id = started.runId;
      const api = createClient(url);
      expect((await api.runs.start.mutate(request)).run).toMatchObject({
        id,
        tags,
      });
      expect(
        (
          await call('start_run', {
            ...request,
            tags: { empty: '', batch: tags.batch, repo: tags.repo },
          })
        ).runId,
      ).toBe(id);
      for (const changed of [{ ...tags, repo: 'different' }, undefined]) {
        const conflict = await client.callTool({
          name: 'start_run',
          arguments: { ...request, tags: changed },
        });
        expect(conflict.isError).toBe(true);
        expect(JSON.stringify(conflict.content)).toContain(
          'different arguments',
        );
      }
      await api.runs.start.mutate({
        workflowId: workflow.id,
        input: {},
        tags: { repo: tags.repo, batch: 'other' },
      });
      await api.runs.start.mutate({ workflowId: workflow.id, input: {} });
      const matching = await call('list_runs', {
        tags: { repo: tags.repo, batch: tags.batch },
        workflowId: workflow.id,
      });
      expect(matching.map((run: { id: string }) => run.id)).toEqual([id]);
      expect(matching[0].tags).toEqual(tags);
      expect(
        await call('list_runs', { tags: { repo: 'DGCA/interlock' } }),
      ).toEqual([]);
      expect(
        await api.runs.summaries.query({
          tags: { batch: tags.batch },
          tab: 'active',
        }),
      ).toMatchObject({ total: 1, items: [{ id, tags }] });
      expect(await call('get_run_briefing', { id })).toMatchObject({
        run: { id, tags },
      });
      expect(await call('get_run', { id })).toMatchObject({
        run: { id, tags },
      });
      vi.stubEnv('INTERLOCK_URL', url);
      const cli = (await runCommand([
        'start',
        workflow.id,
        '{}',
        '--summary',
        '--request-id',
        request.requestId,
        '--tag',
        'repo=' + tags.repo,
        '--tag=batch=' + tags.batch,
        '--tag',
        'empty=',
      ])) as { runId: string };
      expect(cli.runId).toBe(id);
      const cliRuns = (await runCommand([
        'runs',
        '--tag',
        'repo=' + tags.repo,
        '--tag',
        'batch=' + tags.batch,
      ])) as { id: string }[];
      expect(cliRuns.map((run) => run.id)).toEqual([id]);
      await expect(
        runCommand(['runs', '--tag', 'missing-equals']),
      ).rejects.toThrow('KEY=VALUE');
      await expect(
        runCommand(['runs', '--tag', 'repo=a', '--tag', 'repo=b']),
      ).rejects.toThrow('each --tag key once');
      await expect(
        runCommand(['runs', '--tag', 'x=' + 'a'.repeat(65)]),
      ).rejects.toThrow();
      for (const badTags of [
        { '': 'value' },
        { key: 3 },
        Object.fromEntries(
          Array.from({ length: 17 }, (_, index) => ['key' + index, 'v']),
        ),
      ]) {
        const invalid = await client.callTool({
          name: 'start_run',
          arguments: { workflowId: workflow.id, input: {}, tags: badTags },
        });
        expect(invalid.isError).toBe(true);
      }
      const trigger = await call('manage_workflow_triggers', {
        request: {
          action: 'create',
          workflowId: workflow.id,
          config: {
            kind: 'schedule',
            name: 'Tagged trigger',
            timing: { type: 'interval', intervalMs: 30000 },
            tags,
          },
        },
      });
      expect(trigger.trigger.tags).toEqual(tags);
      const inspected = await call('read_workflow_triggers', {
        request: { action: 'inspect', id: trigger.trigger.id },
      });
      expect(inspected.trigger.tags).toEqual(tags);
      const replaced = await call('manage_workflow_triggers', {
        request: {
          action: 'update',
          id: trigger.trigger.id,
          expectedRevision: trigger.trigger.revision,
          config: {
            kind: 'schedule',
            name: 'Untagged trigger',
            timing: { type: 'interval', intervalMs: 30000 },
          },
        },
      });
      expect(replaced.trigger.tags).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      engine.stop();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000,
);
