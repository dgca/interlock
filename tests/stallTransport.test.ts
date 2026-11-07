import { expect, it, vi } from 'vitest';
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
let discovery: unknown;
it.each(['http', 'stdio'])(
  'discovers and executes stall authoring/settings/inspection and deadline claims through %s',
  async (mode) => {
    const e = new Engine(new Store(':memory:'), process.cwd());
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
      api = createClient(url),
      client = new Client({ name: 'stalls', version: '1' });
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
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).not.toBe(true);
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      const selected = tools.filter((t) =>
        [
          'manage_stalls',
          'create_workflow',
          'update_workflow',
          'edit_workflow',
          'claim_work',
          'renew_claim',
          'get_run',
          'get_run_briefing',
          'manage_work_hold',
          'manage_pause',
          'manage_executors',
          'external_input',
          'preflight_result',
          'submit_result',
          'list_work',
        ].includes(t.name),
      );
      if (!discovery) discovery = selected;
      else expect(selected).toEqual(discovery);
      const tool = tools.find((t) => t.name === 'manage_stalls')!;
      expect(tool).toBeDefined();
      expect(JSON.stringify(tool.inputSchema)).toContain('maxRecoveries');
      expect(JSON.stringify(tool.inputSchema)).toContain('2592000000');
      expect(tool.description).toContain('needs_human');
      for (const name of ['create_workflow', 'update_workflow']) {
        const schema = JSON.stringify(
          tools.find((t) => t.name === name)!.inputSchema,
        );
        expect(schema).toContain('maxExecutionMs');
        expect(schema).toContain('humanWaitStallMs');
      }
      await call('manage_stalls', {
        request: {
          action: 'configure',
          expectedRevision: 0,
          policy: { unclaimedStallMs: 1000 },
        },
      });
      process.env.INTERLOCK_URL = url;
      expect(await runCommand(['stalls'])).toMatchObject({
        revision: 1,
        policy: { unclaimedStallMs: 1000 },
      });
      const d = blankDefinition();
      const n = d.nodes.find((n) => n.kind === 'agent')!;
      Object.assign(n, { maxExecutionMs: 5000, claimedIdleStallMs: 2000 });
      const w = await call('create_workflow', {
        name: 'Stall transport',
        definition: d,
        detail: 'summary',
      });
      const wf = await api.workflows.get.query({ id: w.id ?? w.workflowId });
      await call('edit_workflow', {
        id: wf.id,
        draftRevision: wf.draftRevision,
        edits: [
          {
            op: 'update_settings',
            set: {
              runStallMs: 3000,
              humanWaitStallMs: null,
              idleRecovery: { maxRecoveries: 0, message: 'Continue' },
            },
          },
        ],
        diagnostics: 'summary',
      });
      const saved = await api.workflows.get.query({ id: wf.id });
      expect(saved.draft).toMatchObject({
        runStallMs: 3000,
        humanWaitStallMs: null,
      });
      await call('publish_workflow', { id: wf.id, detail: 'summary' });
      const r = await call('start_run', { workflowId: wf.id, input: null });
      const work = e.available(r.runId)[0];
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 1001);
      e.pump();
      expect(
        await call('manage_stalls', {
          request: { action: 'inspect', runId: r.runId, limit: 1 },
        }),
      ).toMatchObject({
        total: 1,
        nextOffset: null,
        items: [{ kind: 'unclaimedStallMs' }],
      });
      const inspected = await call('get_run', { id: r.runId });
      expect(inspected.stalls.total).toBe(1);
      expect(JSON.stringify(inspected.stalls)).not.toContain('token');
      vi.restoreAllMocks();
      const claim = await call('claim_work', {
        workId: work.id,
        workerId: 'transport',
      });
      expect(claim).toMatchObject({
        maxExecutionMs: 5000,
        claimedAt: expect.any(String),
      });
      expect(
        (await call('get_run_briefing', { id: r.runId })).claimed.items[0]
          .maxExecutionMs,
      ).toBe(5000);
      await call('renew_claim', { workId: claim.id, token: claim.token });
      await call('submit_result', {
        workId: claim.id,
        token: claim.token,
        output: null,
      });
      expect(JSON.stringify(await runCommand(['help']))).toContain(
        'stalls [json|@file]',
      );
    } finally {
      vi.restoreAllMocks();
      if (prior === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = prior;
      await client.close();
      await transport.close();
      await new Promise<void>((r) => server.close(() => r()));
      e.stop();
      e.store.close();
    }
  },
);
