import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { definitionSchema, assertContract } from '@interlock/core';
import { createApp } from '../packages/server/src/app';
import { batchDefinition } from './fixtures/batch';

let discoveredContracts: unknown;

it.each(['http', 'stdio'])(
  'keeps opted-in mutation responses small through MCP %s as history grows',
  async (mode) => {
    const store = new Store(':memory:');
    const engine = new Engine(store, process.cwd());
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
    const client = new Client({ name: 'compact-regression', version: '1' });
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
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      const contracts = tools.filter((t) =>
        ['start_run', 'submit_result', 'list_work'].includes(t.name),
      );
      expect(contracts).toHaveLength(3);
      for (const tool of contracts)
        expect(tool.outputSchema?.type).toBe('object');
      if (discoveredContracts) expect(contracts).toEqual(discoveredContracts);
      discoveredContracts = contracts;
      for (const name of ['start_run', 'submit_result']) {
        expect(
          tools.find((t) => t.name === name)?.inputSchema.properties,
        ).toMatchObject({
          detail: { default: 'full', enum: ['full', 'summary'] },
          limit: { default: 20, minimum: 1, maximum: 100 },
        });
      }
      expect(
        tools.find((t) => t.name === 'list_work')?.inputSchema.properties
          ?.fields,
      ).toMatchObject({ default: 'full' });
      const nodes = [
        { id: 'entry', label: 'Input', kind: 'entry' },
        ...Array.from({ length: 32 }, (_, i) => ({
          id: `agent-${i}`,
          label: `Stage ${i}`,
          kind: 'agent',
          prompt: 'prompt-payload-marker'.repeat(1000),
          context: { instructions: 'context-payload-marker'.repeat(1000) },
        })),
        { id: 'exit', label: 'Output', kind: 'exit' },
      ];
      const definition = definitionSchema.parse({
        nodes,
        edges: nodes.slice(1).map((node, i) => ({
          id: `edge-${i}`,
          source: nodes[i].id,
          target: node.id,
        })),
      });
      const workflow = engine.create('Large continuation', '', definition);
      engine.publish(workflow.id);
      const payload = { body: 'value-payload-marker'.repeat(5000) };
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError).not.toBe(true);
        const text = (response.content as { text: string }[])[0].text;
        const parsed = JSON.parse(text);
        expect(response.structuredContent).toEqual(
          Array.isArray(parsed) ? { items: parsed } : parsed,
        );
        const schema = tools.find((t) => t.name === name)?.outputSchema;
        if (schema)
          assertContract(
            schema,
            response.structuredContent as any,
            `${name} result`,
          );
        return { data: response.structuredContent as any, text };
      };
      const reject = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError).toBe(true);
        expect(response.structuredContent).toBeUndefined();
      };
      const beforeInvalidStart = store.runs();
      for (const options of [
        { detail: 'tiny' },
        { detail: 'summary', limit: 0 },
        { detail: 'summary', limit: 101 },
      ]) {
        await reject('start_run', {
          workflowId: workflow.id,
          input: payload,
          ...options,
        });
        expect(store.runs()).toEqual(beforeInvalidStart);
      }
      const compact = (response: { data: any; text: string }) => {
        expect(Buffer.byteLength(response.text)).toBeLessThan(4096);
        expect(Buffer.byteLength(JSON.stringify(response.data))).toBeLessThan(
          4096,
        );
        expect(response.text).not.toMatch(
          /payload-marker|"definition"|"executions"|"token"|"outputSchema"/,
        );
        expect(response.data.ok).toBe(true);
      };
      let response = await call('start_run', {
        workflowId: workflow.id,
        input: payload,
        detail: 'summary',
      });
      compact(response);
      const startBytes = Buffer.byteLength(response.text);
      const runId = response.data.runId;
      const unchanged = await call('wait_for_run_change', {
        id: runId,
        cursor: response.data.cursor,
        timeoutMs: 0,
      });
      expect(unchanged.data).toMatchObject({
        reset: false,
        changed: false,
        timedOut: true,
      });
      for (const fields of [undefined, 'full', 'summary']) {
        const listed = await call('list_work', {
          runId,
          ...(fields ? { fields } : {}),
        });
        expect(listed.data.items).toHaveLength(1);
        if (fields === 'summary')
          expect(listed.data.items[0].prompt).toBeUndefined();
        else
          expect(listed.data.items[0].prompt).toContain(
            'prompt-payload-marker',
          );
      }
      for (let i = 0; i < 4; i++) {
        const workId = response.data.nextWork.items[0].id;
        const claim = await call('claim_work', {
          workId,
          workerId: 'regression',
        });
        expect(claim.data.prompt).toContain('prompt-payload-marker');
        if (i === 0) {
          const protectedState = engine.inspect(runId);
          await reject('submit_result', {
            workId,
            token: claim.data.token,
            output: payload,
            detail: 'summary',
            limit: -1,
          });
          await reject('submit_result', {
            workId,
            token: claim.data.token,
            output: payload,
            detail: 'tiny',
          });
          expect(engine.inspect(runId)).toEqual(protectedState);
        }
        response = await call('submit_result', {
          workId,
          token: claim.data.token,
          output: payload,
          detail: 'summary',
        });
        compact(response);
        expect(response.data.runId).toBe(runId);
        const replay = await call('submit_result', {
          workId,
          token: claim.data.token,
          output: payload,
          detail: 'summary',
        });
        expect(replay.data).toEqual(response.data);
        await reject('submit_result', {
          workId,
          token: claim.data.token,
          output: null,
          detail: 'summary',
        });
        // Legacy replay keeps the original immediate-run inspection in both full modes.
        for (const detail of [undefined, 'full']) {
          const legacy = await call('submit_result', {
            workId,
            token: claim.data.token,
            output: payload,
            ...(detail ? { detail } : {}),
          });
          expect(legacy.data.run.id).toBe(runId);
          expect(legacy.data.definition.nodes).toHaveLength(34);
        }
      }
      const full = await call('get_run', { id: runId });
      expect(Buffer.byteLength(full.text)).toBeGreaterThan(500_000);
      expect(full.data.run.executions.length).toBeGreaterThan(4);
      console.info(
        `${mode}: summary start ${startBytes} B, submit ${Buffer.byteLength(response.text)} B, full after four submissions ${Buffer.byteLength(full.text)} B`,
      );
      for (const detail of [undefined, 'full']) {
        const legacy = await call('start_run', {
          workflowId: workflow.id,
          input: null,
          ...(detail ? { detail } : {}),
        });
        expect(legacy.data.run.status).toBe('waiting');
        expect(legacy.data.definition.nodes).toHaveLength(34);
      }
      const batch = engine.create(
        'Transport batch',
        '',
        batchDefinition(undefined, { concurrency: 3 }),
      );
      engine.publish(batch.id);
      const parallel = await call('start_run', {
        workflowId: batch.id,
        input: [1, 2, 3, 4],
        detail: 'summary',
        limit: 1,
      });
      expect(parallel.data.nextWork).toMatchObject({
        total: 3,
        truncated: true,
      });
      const work = parallel.data.nextWork.items[0];
      const claim = await call('claim_work', {
        workId: work.id,
        workerId: 'batch',
      });
      const continued = await call('submit_result', {
        workId: work.id,
        token: claim.data.token,
        output: 10,
        detail: 'summary',
        limit: 1,
      });
      expect(continued.data).toMatchObject({
        runId: parallel.data.runId,
        workRunId: work.runId,
        nextWork: { total: 3, truncated: true },
      });
      expect(continued.data.nextWork.items).toHaveLength(1);
      expect(continued.data.nextWork.items[0].id).not.toBe(work.id);
      const waited = await call('wait_for_run_change', {
        id: continued.data.runId,
        cursor: continued.data.cursor,
        timeoutMs: 0,
      });
      expect(waited.data).toMatchObject({ changed: false, reset: false });
    } finally {
      await client.close();
      engine.stop();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      store.close();
    }
  },
);
