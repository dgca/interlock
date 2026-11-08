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
      for (const name of ['start_run', 'list_runs', 'workflow_report'])
        expect(
          tools.find((tool) => tool.name === name)?.inputSchema.properties,
        ).toHaveProperty('tags');
      expect(
        JSON.stringify(
          tools.find((tool) => tool.name === 'manage_workflow_triggers')
            ?.inputSchema,
        ),
      ).toContain('tags');
      expect(Buffer.byteLength(JSON.stringify(tools))).toBeLessThanOrEqual(
        300_000,
      );
      const reportTool = tools.find((tool) => tool.name === 'workflow_report')!;
      expect(reportTool.inputSchema.properties?.limit).toMatchObject({
        default: 500,
        maximum: 5000,
      });
      expect(reportTool.description).toContain('before sampling');
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
      vi.stubEnv('INTERLOCK_URL', url);
      // Exercise the same exact creation instant written with an offset and
      // without milliseconds through every report caller and both MCP bridges.
      const createdAt = engine.run(id).createdAt;
      const offsetBound = new Date(Date.parse(createdAt) + 60 * 60 * 1000)
        .toISOString()
        .replace('Z', '+01:00');
      const noMillisBound = createdAt.replace(/\.\d{3}Z$/, 'Z');
      const noMillisRun = {
        ...store.get<import('@interlock/core').Run>('runs', id)!,
        id: 'date-boundary-' + mode,
        createdAt: new Date(noMillisBound).toISOString(),
        tags: { date: 'boundary' },
      };
      store.put('runs', noMillisRun);
      const dateCases: [string, Record<string, string>, string][] = [
        [id, { batch: tags.batch }, offsetBound],
        [noMillisRun.id, { date: 'boundary' }, noMillisBound],
      ];
      for (const [selectedId, dateTags, value] of dateCases) {
        const exactDate = {
          workflowId: workflow.id,
          tags: dateTags,
          since: value,
          until: value,
        };
        expect(
          (await call('workflow_report', exactDate)).usage.byRun.map(
            (run: { runId: string }) => run.runId,
          ),
        ).toEqual([selectedId]);
        for (const procedure of [api.report.summary, api.system.report])
          expect(
            (await procedure.query(exactDate)).usage.byRun.map(
              (run) => run.runId,
            ),
          ).toEqual([selectedId]);
        const cli = (await runCommand([
          'report',
          '--workflow',
          workflow.id,
          '--tag',
          Object.entries(dateTags)[0].join('='),
          '--since',
          value,
          '--until',
          value,
        ])) as import('@interlock/core').WorkflowReport;
        expect(cli.usage.byRun.map((run) => run.runId)).toEqual([selectedId]);
        expect(
          (
            await call('workflow_report', {
              ...exactDate,
              since: new Date(Date.parse(value) + 1).toISOString(),
            })
          ).summary.totalRuns,
        ).toBe(0);
        expect(
          (
            await call('workflow_report', {
              ...exactDate,
              until: new Date(Date.parse(value) - 1).toISOString(),
            })
          ).summary.totalRuns,
        ).toBe(0);
      }

      const reportFilter = {
        workflowId: workflow.id,
        tags: { repo: tags.repo, batch: tags.batch },
        limit: 1,
      };
      const report = await call('workflow_report', reportFilter);
      expect(report).toMatchObject({
        filter: reportFilter,
        summary: { totalRuns: 1 },
        usage: { byRun: [{ runId: id }] },
      });
      expect(
        (await api.report.summary.query(reportFilter)).usage.byRun.map(
          (run) => run.runId,
        ),
      ).toEqual([id]);
      expect(
        (await api.system.report.query(reportFilter)).summary.totalRuns,
      ).toBe(1);
      expect(
        (await call('workflow_report', { tags: { repo: 'DGCA/interlock' } }))
          .summary.totalRuns,
      ).toBe(0);
      const literalTags = JSON.parse(
        '{"__proto__":"literal","constructor":"metadata","a.b":"factory=7"}',
      );
      const literalStart = await call('start_run', {
        workflowId: workflow.id,
        input: {},
        tags: literalTags,
      });
      expect(
        (await call('workflow_report', { tags: literalTags })).usage.byRun.map(
          (run: { runId: string }) => run.runId,
        ),
      ).toEqual([literalStart.runId]);
      expect(
        (await call('workflow_report', { tags: {} })).summary.totalRuns,
      ).toBe(5);

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
      const cliReport = (await runCommand([
        'report',
        '--workflow',
        workflow.id,
        '--tag',
        'repo=' + tags.repo,
        '--tag',
        'batch=' + tags.batch,
        '--limit',
        '1',
      ])) as {
        summary: { totalRuns: number };
        usage: { byRun: { runId: string }[] };
      };
      expect(cliReport.summary.totalRuns).toBe(1);
      expect(cliReport.usage.byRun.map((run) => run.runId)).toEqual([id]);

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
        expect(
          (
            await client.callTool({
              name: 'workflow_report',
              arguments: { tags: badTags },
            })
          ).isError,
        ).toBe(true);
        await expect(
          api.report.summary.query({ tags: badTags as any }),
        ).rejects.toThrow();
        await expect(
          api.system.report.query({ tags: badTags as any }),
        ).rejects.toThrow();
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
