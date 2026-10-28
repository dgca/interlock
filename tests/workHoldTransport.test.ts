import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { blankDefinition, assertContract } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';
it.each(['http', 'stdio'])(
  'holds, inspects and resumes through %s and CLI with bounded discovery',
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
    const url = `http://127.0.0.1:${address.port}`,
      client = new Client({ name: 'holds', version: '1' });
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
      const definition = JSON.stringify(
        tools.find((t) => t.name === 'manage_work_hold')?.inputSchema,
      );
      for (const field of [
        'expectedAttempt',
        'expectedRevision',
        'checkpointRef',
        'provider_limit',
        'history',
      ])
        expect(definition).toContain(field);
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = await client.callTool({ name, arguments: args });
        expect(r.isError).not.toBe(true);
        const d = JSON.parse((r.content as { text: string }[])[0].text);
        const structured = Array.isArray(d) ? { items: d } : d;
        expect(r.structuredContent).toEqual(structured);
        const schema = tools.find((t) => t.name === name)?.outputSchema;
        if (schema) assertContract(schema, structured, name);
        return d;
      };
      const d = blankDefinition(),
        agent = d.nodes.find((n) => n.kind === 'agent')!;
      agent.resultRules = [
        {
          id: 'candidate',
          kind: 'equalsInput',
          inputPath: 'candidate',
          outputPath: 'candidate',
        },
      ];
      const w = await call('create_workflow', {
        name: 'Transport holds',
        definition: d,
      });
      await call('publish_workflow', { id: w.id });
      const run = await call('start_run', {
          workflowId: w.id,
          input: { candidate: 1 },
        }),
        workId = run.nextWork.items[0].id;
      const claim = await call('claim_work', { workId, workerId: 'test' });
      const request = {
        action: 'hold',
        workId,
        expectedAttempt: claim.attempt,
        expectedRevision: 0,
        actor: 'worker',
        category: 'provider_limit',
        reason: 'PRIVATE_REASON',
        checkpointRef: 'private://checkpoint',
        token: claim.token,
      };
      const collections = [
        'runs',
        'work',
        'events',
        'workHolds',
        'usageAttempts',
      ];
      const state = () => collections.map((c) => store.list(c));
      const before = state();
      const bad = await client.callTool({
        name: 'manage_work_hold',
        arguments: { request: { ...request, token: 'invalid' } },
      });
      expect(bad.isError).toBe(true);
      expect(state()).toEqual(before);
      const held = await call('manage_work_hold', { request });
      expect(held).toMatchObject({
        applied: true,
        status: 'held',
        holdRevision: 1,
      });
      expect((await call('manage_work_hold', { request })).applied).toBe(false);
      const empty = await call('list_work', { runId: run.runId });
      expect(empty).toEqual([]);
      const brief = await call('get_run_briefing', { id: run.runId, limit: 1 });
      expect(brief).toMatchObject({ next: 'inspect_hold', held: { total: 1 } });
      expect(JSON.stringify(brief)).not.toMatch(/PRIVATE_REASON|private:\/\//);
      const summary = engine.continuation.summary(run.runId, 20);
      expect(summary).toMatchObject({
        next: 'inspect_hold',
        heldWork: { total: 1 },
      });
      expect(
        (
          await call('preflight_result', {
            workId,
            token: claim.token,
            output: { candidate: 1 },
          })
        ).code,
      ).toBe('held');
      const inspection = await call('get_run', { id: run.runId });
      expect(inspection.work[0].holdHistory.total).toBe(1);
      expect(JSON.stringify(inspection)).not.toContain(claim.token);
      expect(inspection.work[0]).not.toHaveProperty('holdReceipt');
      const invalid = await client.callTool({
        name: 'manage_work_hold',
        arguments: { request: { ...request, unexpected: true } },
      });
      expect(invalid.isError).toBe(true);
      const current = state();
      const history = await call('manage_work_hold', {
        request: { action: 'history', workId, limit: 1 },
      });
      expect(history).toMatchObject({ total: 1, nextOffset: null });
      expect(state()).toEqual(current);
      process.env.INTERLOCK_URL = url;
      const resumed = await runCommand([
        'work-hold',
        JSON.stringify({
          action: 'resume',
          workId,
          expectedAttempt: claim.attempt,
          expectedRevision: 1,
          actor: 'cli',
        }),
      ]);
      expect(resumed).toMatchObject({
        applied: true,
        status: 'available',
        holdRevision: 2,
      });
      const reclaimed = await call('claim_work', { workId, workerId: 'test' });
      expect(reclaimed.attempt).toBe(2);
      expect(reclaimed.holdRevision).toBe(2);
      expect(reclaimed.heldClaimCount).toBe(1);
      const stale = await client.callTool({
        name: 'submit_result',
        arguments: { workId, token: claim.token, output: { candidate: 1 } },
      });
      expect(stale.isError).toBe(true);
      await call('submit_result', {
        workId,
        token: reclaimed.token,
        output: { candidate: 1 },
      });
      const closed = (await runCommand([
        'work-hold',
        JSON.stringify({ action: 'history', workId, limit: 1 }),
      ])) as any;
      expect(closed.items[0].endReason).toBe('resumed');
      expect(engine.run(run.runId).status).toBe('completed');
      console.log(
        `${mode}: ${tools.length} MCP tools, ${Buffer.byteLength(JSON.stringify(tools))} B definitions`,
      );
    } finally {
      if (prior === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = prior;
      await client.close();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      engine.stop();
      store.close();
    }
  },
);
