import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  definitionSchema,
  assertContract,
  blankDefinition,
  nodeSchema,
} from '@interlock/core';
import { createApp } from '../packages/server/src/app';
import { batchDefinition } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';

let discoveredContracts: unknown;

it.each(['http', 'stdio'])(
  'keeps default mutation responses small through MCP %s as history grows',
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
          detail: { default: 'summary', enum: ['full', 'summary'] },
          limit: { default: 20, minimum: 1, maximum: 100 },
        });
      }
      expect(
        tools.find((t) => t.name === 'list_work')?.inputSchema.properties
          ?.fields,
      ).toMatchObject({ default: 'summary' });
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
      const reject = async (
        name: string,
        args: Record<string, unknown>,
        code?: string,
      ) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError).toBe(true);
        if (code)
          expect(response.structuredContent).toMatchObject({
            resultCheck: { code, accepted: false },
          });
        else expect(response.structuredContent).toBeUndefined();
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
      });
      compact(response);
      const startBytes = Buffer.byteLength(response.text);
      const runId = response.data.runId;
      expect(response.data.nextCall).toBeNull();
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
        if (fields !== 'full')
          expect(listed.data.items[0].prompt).toBeUndefined();
        else {
          expect(listed.data.items[0].prompt).toContain(
            'prompt-payload-marker',
          );
          expect(listed.data.items).toEqual(engine.available(runId));
        }
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
        await reject(
          'submit_result',
          {
            workId,
            token: claim.data.token,
            output: null,
            detail: 'summary',
          },
          'completed_conflict',
        );
        // Explicit full replay keeps the immediate-run inspection payload.
        const legacy = await call('submit_result', {
          workId,
          token: claim.data.token,
          output: payload,
          detail: 'full',
        });
        expect(legacy.data.run.id).toBe(runId);
        expect(legacy.data.definition.nodes).toHaveLength(34);
        expect(legacy.data).toEqual(engine.inspect(runId));
      }
      const full = await call('get_run', { id: runId });
      expect(Buffer.byteLength(full.text)).toBeGreaterThan(500_000);
      expect(full.data.run.executions.length).toBeGreaterThan(4);
      console.info(
        `${mode}: summary start ${startBytes} B, submit ${Buffer.byteLength(response.text)} B, full after four submissions ${Buffer.byteLength(full.text)} B`,
      );
      const legacy = await call('start_run', {
        workflowId: workflow.id,
        input: null,
        detail: 'full',
      });
      expect(legacy.data.run.status).toBe('waiting');
      expect(legacy.data.definition.nodes).toHaveLength(34);
      expect(legacy.data).toEqual(engine.inspect(legacy.data.run.id));
      const batch = engine.create(
        'Transport batch',
        '',
        batchDefinition(undefined, { concurrency: 3 }),
      );
      engine.publish(batch.id);
      const parallel = await call('start_run', {
        workflowId: batch.id,
        input: [1, 2, 3, 4],
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

      const startSmall = async (
        definition = blankDefinition(),
        input: unknown = null,
        options: Record<string, unknown> = {},
      ) => {
        const workflow = engine.create('Suggested calls', '', definition);
        engine.publish(workflow.id);
        return call('start_run', {
          workflowId: workflow.id,
          input,
          ...options,
        });
      };
      const follow = async (summary: any) => {
        const { tool, arguments: args } = summary.nextCall;
        assertContract(
          tools.find((t) => t.name === tool)!.inputSchema,
          args,
          'nextCall arguments',
        );
        return call(tool, args);
      };

      // The final persisted result can differ from the last Agent submission.
      const transformed = blankDefinition();
      transformed.nodes.splice(
        2,
        0,
        nodeSchema.parse({
          id: 'double',
          kind: 'script',
          label: 'Double',
          language: 'javascript',
          command: 'return input * 2;',
        }),
      );
      transformed.edges[1].target = 'double';
      transformed.edges.push({
        id: 'double-exit',
        source: 'double',
        target: 'exit',
        port: 'default',
      });
      const started = await startSmall(transformed, 1, { detail: 'summary' });
      const assignment = started.data.nextWork.items[0];
      const owned = await call('claim_work', {
        workId: assignment.id,
        workerId: 'result-reader',
      });
      const submission = {
        workId: assignment.id,
        token: owned.data.token,
        output: 21,
      };
      await call('submit_result', submission);
      await expect
        .poll(() => store.get<any>('runs', started.data.runId)?.status)
        .toBe('completed');
      const done = await call('submit_result', submission);
      expect(done.data).toMatchObject({
        runStatus: 'completed',
        next: 'inspect_result',
        nextCall: {
          tool: 'get_run_result',
          arguments: { id: started.data.runId },
        },
      });
      expect((await follow(done.data)).data.value).toBe(42);
      expect(
        (await call('submit_result', { ...submission, detail: 'summary' }))
          .data,
      ).toEqual(done.data);

      // Replaying an accepted submission observes claimed work, cancellation and failure.
      for (const terminal of ['cancelled', 'failed'] as const) {
        const pair = await startSmall(batchDefinition(), [1, 2]);
        const [first, second] = pair.data.nextWork.items;
        const one = await call('claim_work', {
          workId: first.id,
          workerId: 'first',
        });
        const args = { workId: first.id, token: one.data.token, output: 10 };
        await call('submit_result', args);
        const two = await call('claim_work', {
          workId: second.id,
          workerId: 'second',
        });
        const pending = await call('submit_result', args);
        expect(pending.data).toMatchObject({
          next: 'wait_for_worker',
          nextCall: {
            tool: 'wait_for_run_change',
            arguments: { id: pair.data.runId, cursor: pending.data.cursor },
          },
        });
        const change = follow(pending.data);
        if (terminal === 'cancelled') engine.cancel(pair.data.runId);
        else engine.reportFailure(second.id, two.data.token, 'Worker failed');
        expect((await change).data).toMatchObject({
          changed: true,
          run: { status: terminal },
        });
        const ended = await call('submit_result', args);
        expect(ended.data.nextCall).toEqual({
          tool: 'get_run_briefing',
          arguments: { id: pair.data.runId },
        });
        const inspected = await follow(ended.data);
        expect(inspected.data.run.status).toBe(terminal);
        if (terminal === 'failed')
          expect(inspected.data.failures.total).toBeGreaterThan(0);
      }

      const timer = blankDefinition();
      timer.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'wait',
        label: 'Wait',
        timing: { kind: 'duration', ms: 60000 },
      });
      const waiting = await startSmall(timer);
      expect(waiting.data).toMatchObject({
        next: 'wait_for_change',
        nextCall: {
          tool: 'wait_for_run_change',
          arguments: { id: waiting.data.runId, cursor: waiting.data.cursor },
        },
      });
      const timerChange = follow(waiting.data);
      engine.cancel(waiting.data.runId);
      expect((await timerChange).data.run.status).toBe('cancelled');

      const child = engine.create(
        'Independent executor',
        '',
        blankDefinition(),
      );
      engine.publish(child.id);
      const detached = await startSmall(workflowCall(child.id, 'detached'));
      expect(detached.data).toMatchObject({
        runStatus: 'completed',
        next: 'claim_work',
        nextCall: null,
      });
      const independent = detached.data.nextWork.items[0];
      expect(independent.lifecycleRunId).not.toBe(detached.data.runId);
      const independentClaim = await call('claim_work', {
        workId: independent.id,
        workerId: 'independent',
      });
      const independentDone = await call('submit_result', {
        workId: independent.id,
        token: independentClaim.data.token,
        output: 'child result',
      });
      expect(independentDone.data.nextCall.arguments.id).toBe(
        independent.lifecycleRunId,
      );
      expect((await follow(independentDone.data)).data.value).toBe(
        'child result',
      );
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
