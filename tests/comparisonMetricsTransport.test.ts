import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { blankDefinition } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createApp } from '../packages/server/src/app';

it.each(['http', 'stdio'])(
  'discovers and executes comparison measurement pages over %s',
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
    const url = `http://127.0.0.1:${address.port}`;
    const client = new Client({
      name: 'comparison-metrics-fixture',
      version: '1.0.0',
    });
    try {
      await client.connect(
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
            }),
      );
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(49);
      const schema = JSON.stringify(
        tools.find((t) => t.name === 'read_workflow_comparisons')?.inputSchema,
      );
      for (const field of ['caseOffset', 'caseLimit', 'currency'])
        expect(schema).toContain(field);
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).not.toBe(true);
        const data = JSON.parse((result.content as { text: string }[])[0].text);
        expect(result.structuredContent).toEqual(data);
        return data;
      };
      const w = e.create('Comparison fixture', '', blankDefinition());
      e.publish(w.id);
      e.publish(w.id);
      const suite = await call('save_test_suite', {
        request: {
          action: 'create',
          workflowId: w.id,
          content: {
            name: 'Fixture',
            cases: [
              { id: 'a', name: 'A', input: {} },
              { id: 'b', name: 'B', input: {} },
            ],
          },
        },
      });
      const selection = {
        suiteId: suite.id,
        suiteRevision: 1,
        baselineVersion: 1,
        candidateVersion: 2,
      };
      const preview = await call('preview_workflow_comparison', selection);
      const c = await call('start_workflow_comparison', {
        ...selection,
        confirmation: preview.confirmation,
        requestId: 'transport-metrics',
      });
      const tokens: string[] = [];
      for (let n = 0; e.available().length && n < 10; n++) {
        const claim = await call('claim_work', {
          workId: e.available()[0].id,
          workerId: 'fixture',
        });
        tokens.push(claim.token);
        await call('report_usage', {
          workId: claim.id,
          attempt: claim.attempt,
          token: claim.token,
          snapshot: {
            sequence: 1,
            final: true,
            models: [
              {
                provider: 'synthetic',
                model: 'fixture',
                inputTokens: 10,
                cost: {
                  amountMicros: 100,
                  currency: 'USD',
                  source: 'test fixture',
                },
              },
            ],
          },
        });
        await call('submit_result', {
          workId: claim.id,
          token: claim.token,
          output: { ok: true },
        });
      }
      const report = (extra = {}) =>
        call('read_workflow_comparisons', {
          request: { action: 'report', id: c.id, ...extra },
        });
      const complete = await report({ limit: 25 });
      expect(complete.status).toBe('completed');
      expect(complete.metrics.availability.reasons).toContain(
        'quality_unjudged',
      );
      for (const s of complete.samples)
        await call('update_workflow_comparison', {
          request: {
            action: 'record_quality',
            id: c.id,
            sampleId: s.id,
            reviewer: 'Fixture',
            reviewerKind: 'agent',
            rubric: 'Fixture rubric',
            score: 3,
          },
        });
      const first = await report({ limit: 1, caseLimit: 1, currency: 'USD' });
      const second = await report({
        offset: 1,
        limit: 1,
        caseOffset: 1,
        caseLimit: 1,
        currency: 'USD',
      });
      expect(first.metrics.sides).toEqual(second.metrics.sides);
      expect(first.metrics.sides.baseline.usage).toMatchObject({
        attempts: 2,
        costs: [
          {
            currency: 'USD',
            amountMicros: { value: 200, coverage: 'complete' },
          },
        ],
      });
      expect(first.metrics.availability.state).toBe('descriptive');
      expect(first.metrics.cases.nextOffset).toBe(1);
      expect(second.metrics.cases.nextOffset).toBeNull();
      expect(first.samples).toHaveLength(1);
      expect(first.metrics.detail).toBe('summary');
      expect(first.samples[0].metrics.timing).toBeUndefined();
      expect(first.metrics.cases.items[0].baseline.usage).toBeUndefined();
      const full = await report({
        limit: 1,
        caseLimit: 1,
        metricsDetail: 'full',
      });
      expect(full.samples[0].metrics.timing.rootElapsedMs).toBeTypeOf('number');
      expect(full.metrics.cases.items[0].baseline.usage.attempts).toBe(1);
      expect(JSON.stringify(first)).not.toContain('tokenHash');
      expect(JSON.stringify(first)).not.toContain('runIds');
      for (const token of tokens)
        expect(JSON.stringify(first)).not.toContain(token);
      expect(
        (
          await client.callTool({
            name: 'read_workflow_comparisons',
            arguments: {
              request: { action: 'report', id: c.id, caseLimit: 26 },
            },
          })
        ).isError,
      ).toBe(true);
    } finally {
      await client.close();
      e.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      e.store.close();
    }
  },
);
