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
  'selects, executes and inspects side configurations over %s',
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
    const url = `http://127.0.0.1:${address.port}`,
      client = new Client({ name: 'comparison-configurations', version: '1' });
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
      console.log(
        `${mode}: ${tools.length} tools, ${Buffer.byteLength(JSON.stringify(tools))} B definitions`,
      );
      for (const name of [
        'preview_workflow_comparison',
        'start_workflow_comparison',
      ]) {
        const metadata = JSON.stringify(
          tools.find((t) => t.name === name)!.inputSchema,
        );
        for (const field of [
          'configurations',
          'baseline',
          'candidate',
          'promptRevisions',
          'executor',
          'environment',
          'receipt',
        ])
          expect(metadata).toContain(field);
      }
      const readMetadata = JSON.stringify(
        tools.find((t) => t.name === 'get_prompt')!.inputSchema,
      );
      expect(readMetadata).toContain('history');
      expect(readMetadata).toContain('revision');
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = await client.callTool({ name, arguments: args });
        expect(r.isError, JSON.stringify(r.content)).not.toBe(true);
        const data = JSON.parse((r.content as { text: string }[])[0].text);
        expect(r.structuredContent).toEqual(
          Array.isArray(data) ? { items: data } : data,
        );
        return data;
      };
      const prompt = await call('create_prompt', {
        name: 'Transport',
        content: 'OLD-CAPTURE',
        description: '',
      });
      await call('update_prompt', {
        ...prompt,
        content: 'NEW-CAPTURE',
        id: prompt.id,
        revision: 1,
      });
      const old = await call('get_prompt', {
        id: prompt.id,
        revision: 1,
        history: { limit: 1 },
      });
      expect(old.content).toBe('OLD-CAPTURE');
      expect(old.history.total).toBe(2);
      const d = blankDefinition();
      if (d.nodes[1].kind !== 'agent') throw Error('Agent');
      d.nodes[1].promptIds = [prompt.id];
      const wf = e.create('Side configurations', '', d);
      e.publish(wf.id);
      const suite = await call('save_test_suite', {
        request: {
          action: 'create',
          workflowId: wf.id,
          content: {
            name: 'Transport cases',
            cases: [{ id: 'a', name: 'A', input: {} }],
          },
        },
      });
      const selection = {
        suiteId: suite.id,
        suiteRevision: 1,
        baselineVersion: 1,
        candidateVersion: 1,
        concurrency: 1,
        configurations: {
          baseline: { promptRevisions: [{ id: prompt.id, revision: 1 }] },
          candidate: {
            promptRevisions: [{ id: prompt.id, revision: 2 }],
            executor: { model: 'fixture' },
            environment: { identity: 'trial-set', receipt: 'local:receipt' },
          },
        },
      };
      const preview = await call('preview_workflow_comparison', selection);
      expect(preview.configurations.differences.prompts).toEqual([prompt.id]);
      expect(JSON.stringify(preview)).not.toContain('CAPTURE');
      const comparison = await call('start_workflow_comparison', {
        ...selection,
        confirmation: preview.confirmation,
        requestId: 'configuration-transport',
      });
      await call('update_prompt', {
        id: prompt.id,
        revision: 2,
        name: 'Transport',
        description: '',
        content: 'LATER-CAPTURE',
      });
      const seen: string[] = [],
        tokens: string[] = [];
      for (let i = 0; e.available().length && i < 3; i++) {
        const claim = await call('claim_work', {
          workId: e.available()[0].id,
          workerId: 'fixture',
          modelSelection: { model: 'fixture' },
        });
        seen.push(claim.savedPrompts[0].content);
        tokens.push(claim.token);
        await call('report_usage', {
          workId: claim.id,
          token: claim.token,
          attempt: claim.attempt,
          snapshot: {
            sequence: 1,
            final: true,
            models: [{ provider: 'test', model: 'fixture', inputTokens: 1 }],
          },
        });
        await call('submit_result', {
          workId: claim.id,
          token: claim.token,
          output: {},
        });
      }
      expect(seen).toEqual(['OLD-CAPTURE', 'NEW-CAPTURE']);
      const report = await call('read_workflow_comparisons', {
        request: { action: 'report', id: comparison.id, metricsDetail: 'full' },
      });
      expect(report.status).toBe('completed');
      expect(report.metrics.sides.candidate.executorConditions.matched).toBe(1);
      expect(report.configurations.candidate.environment).toEqual(
        selection.configurations.candidate.environment,
      );
      expect(report.metrics.availability.reasons).toContain(
        'environment_unverified',
      );
      for (const value of [...tokens, ...seen, 'LATER-CAPTURE'])
        expect(JSON.stringify(report)).not.toContain(value);
      const again = await call('start_workflow_comparison', {
        ...selection,
        confirmation: preview.confirmation,
        requestId: 'configuration-transport',
      });
      expect(again.id).toBe(comparison.id);
      expect(e.store.runs()).toHaveLength(2);
      const invalid = await client.callTool({
        name: 'preview_workflow_comparison',
        arguments: {
          ...selection,
          configurations: { baseline: { promptRevisions: [] } },
        },
      });
      expect(invalid.isError).toBe(true);
      // Complete manifests can exceed the HTTP request-line limit. The stdio
      // bridge and ordinary HTTP client must send this query in a POST body.
      const promptIds = Array.from({ length: 64 }, (_, i) =>
        `${i}`.padEnd(120, 'p'),
      );
      for (const id of promptIds)
        for (const revision of [1, 2])
          e.store.savePrompt({
            id,
            revision,
            name: 'Large manifest',
            description: '',
            content: `revision ${revision}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
      d.nodes[1].promptIds = promptIds;
      const large = e.create('Large manifest', '', d);
      e.publish(large.id);
      const largeSuite = e.testbench.createSuite({
        workflowId: large.id,
        content: { name: 'Large', cases: [{ id: 'a', name: 'A', input: {} }] },
      });
      const largeSelection = {
        suiteId: largeSuite.id,
        suiteRevision: 1,
        baselineVersion: 1,
        candidateVersion: 1,
        configurations: {
          baseline: {
            promptRevisions: promptIds.map((id) => ({ id, revision: 1 })),
          },
          candidate: {
            promptRevisions: promptIds.map((id) => ({ id, revision: 2 })),
          },
        },
      };
      expect(Buffer.byteLength(JSON.stringify(largeSelection))).toBeGreaterThan(
        16_384,
      );
      expect(
        (await call('preview_workflow_comparison', largeSelection)).canStart,
      ).toBe(true);
      const legacyGet = await fetch(
        `${url}/trpc/testbench.preview?${new URLSearchParams({ input: JSON.stringify(selection) })}`,
      );
      expect(legacyGet.status).toBe(200);
      expect((await legacyGet.json()).result.data.confirmation).toBe(
        preview.confirmation,
      );
    } finally {
      await client.close();
      e.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      e.store.close();
    }
  },
);
