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
import { blankDefinition, nodeSchema } from '@interlock/core';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';
let discovery: unknown;
it.each(['http', 'stdio'])(
  'coordinates racing claims and explicit recovery through %s MCP, shared API and CLI',
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'interlock-resource-transport-')),
      store = new Store(join(root, 'state.db')),
      e = new Engine(store, root);
    const d = blankDefinition();
    d.nodes[1] = nodeSchema.parse({
      ...d.nodes[1],
      resources: [{ source: 'literal', value: 'checkout:shared' }],
    });
    const w = e.create('Shared resource', '', d);
    e.publish(w.id);
    const ids = Array.from({ length: 6 }, () => e.start(w.id, {}).run.id);
    const assignments = e
      .available()
      .map((w) => ({ id: w.id, runId: w.runId }));
    const server = serve({
      fetch: createApp(e).fetch,
      hostname: '127.0.0.1',
      port: 0,
    });
    await new Promise<void>((r) =>
      server.listening ? r() : server.once('listening', r),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No listener');
    const url = `http://127.0.0.1:${address.port}`,
      client = new Client({ name: 'resources-test', version: '1' });
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
    const read = (r: any) => JSON.parse(r.content[0].text);
    const call = async (name: string, args: any) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).not.toBe(true);
      const data = read(r);
      expect(r.structuredContent).toEqual(
        Array.isArray(data) ? { items: data } : data,
      );
      return data;
    };
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      expect(tools.map((t) => t.name)).toContain('manage_work_resources');
      if (discovery) expect(tools).toEqual(discovery);
      else discovery = tools;
      const draft = await call('get_workflow', { id: w.id });
      await call('edit_workflow', {
        id: w.id,
        draftRevision: draft.draftRevision,
        edits: [
          {
            op: 'update_node',
            id: 'agent',
            set: {
              resources: [{ source: 'literal', value: 'checkout:shared' }],
            },
          },
        ],
      });
      const attempts = await Promise.all(
        assignments.map((w) =>
          client.callTool({
            name: 'claim_work',
            arguments: { workId: w.id, workerId: 'factory' },
          }),
        ),
      );
      const winners = attempts.filter((r) => !r.isError);
      expect(winners).toHaveLength(1);
      expect(attempts.filter((r) => r.isError)).toHaveLength(5);
      const winner = read(winners[0]);
      expect(winner).toMatchObject({
        attempt: 1,
        resources: ['checkout:shared'],
        resourceReservations: [{ workId: winner.id, state: 'claimed' }],
      });
      expect(store.list('usageAttempts')).toHaveLength(1);
      expect(store.work().filter((w) => w.attempt === 0)).toHaveLength(5);
      const target = assignments.find((w) => w.id !== winner.id)!;
      const brief = await call('get_run_briefing', {
        id: target.runId,
        limit: 1,
      });
      expect(brief.available.total).toBe(0);
      expect(brief.resourceBlocked.items[0].owners[0].workId).toBe(winner.id);
      await call('cancel_run', { id: winner.runId });
      const own = await call('manage_work_resources', {
        request: { action: 'inspect', workId: winner.id },
      });
      expect(own.reservations[0].state).toBe('uncertain');
      expect(JSON.stringify(own)).not.toContain('tokenHash');
      expect(JSON.stringify(own)).not.toContain(winner.token);
      const blocked = await call('get_run_briefing', { id: target.runId });
      expect(blocked.next).toBe('inspect_resources');
      const api = createClient(url);
      expect(
        (
          (await api.work.resources.mutate({
            action: 'inspect',
            workId: winner.id,
          })) as any
        ).reservations,
      ).toEqual(own.reservations);
      vi.stubEnv('INTERLOCK_URL', url);
      const released: any = await runCommand([
        'work-resources',
        JSON.stringify({
          action: 'release',
          workId: winner.id,
          expectedAttempt: 1,
          actor: 'coordinator',
          confirmStopped: true,
        }),
      ]);
      expect(released).toMatchObject({ applied: true, released: 1 });
      const next = await call('claim_work', {
        workId: target.id,
        workerId: 'factory',
      });
      expect(next.status).toBe('claimed');
      const repeat = await call('manage_work_resources', {
        request: {
          action: 'release',
          workId: winner.id,
          expectedAttempt: 1,
          actor: 'coordinator',
          confirmStopped: true,
        },
      });
      expect(repeat.released).toBe(0);
      await call('submit_result', {
        workId: target.id,
        token: next.token,
        output: {},
      });
      expect(
        e.manageWorkResources({ action: 'inspect', workId: target.id }),
      ).toMatchObject({ reservations: [] });
      expect(ids).toHaveLength(6);
    } finally {
      vi.unstubAllEnvs();
      await client.close();
      await new Promise<void>((r) => {
        server.close(() => r());
        if ('closeAllConnections' in server) server.closeAllConnections();
      });
      e.stop();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
