import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { blankDefinition, type Json } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createApp } from '../packages/server/src/app';
it.each(['http', 'stdio'])(
  'authors, runs and inspects mapped result branches over MCP %s',
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
      client = new Client({ name: 'node-results', version: '1' });
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
      expect(tools).toHaveLength(49);
      const metadata = JSON.stringify(
        tools.find((t) => t.name === 'create_workflow')!.inputSchema,
      );
      expect(metadata).toContain('outputBindings');
      expect(metadata).toContain('routing');
      expect(
        JSON.stringify(
          (
            tools.find((t) => t.name === 'get_run_result')!.inputSchema
              .properties as any
          ).field,
        ),
      ).toContain('"result"');
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError, JSON.stringify(response.content)).not.toBe(
          true,
        );
        const value = JSON.parse(
          (response.content as Array<{ text: string }>)[0].text,
        );
        expect(response.structuredContent).toEqual(
          Array.isArray(value) ? { items: value } : value,
        );
        return value;
      };
      const d = blankDefinition(),
        node = d.nodes[1];
      if (node.kind !== 'agent') throw new Error('Expected Agent');
      node.outputSchema = {
        type: 'object',
        properties: { ready: { type: 'boolean' }, payload: { type: 'string' } },
        required: ['payload'],
      };
      node.inputBindings = {
        request: { source: 'input', path: 'request' },
        project: {
          source: 'object',
          fields: { repoPath: { source: 'runInput', path: 'repoPath' } },
        },
        optional: { source: 'input', path: 'missing', default: null },
        policy: { source: 'literal', value: 'auto' },
      };
      const workflow = await call('create_workflow', {
        name: 'Mapped results',
        definition: d,
      });
      const routing = {
        path: 'ready',
        cases: [{ port: 'ready', equals: true }],
        default: 'blocked',
      };
      const outputBindings = {
        summary: { source: 'literal', value: 'done' },
        project: {
          source: 'object',
          fields: { repoPath: { source: 'runInput', path: 'repoPath' } },
        },
      };
      await call('edit_workflow', {
        id: workflow.id,
        draftRevision: workflow.draftRevision,
        edits: [
          { op: 'update_node', id: 'agent', set: { routing, outputBindings } },
          {
            op: 'remove_edge',
            id: d.edges.find((e) => e.source === 'agent')!.id,
          },
          ...['ready', 'blocked'].map((port) => ({
            op: 'add_edge',
            edge: {
              id: `route-${port}`,
              source: 'agent',
              port,
              target: 'exit',
            },
          })),
        ],
      });
      await call('validate_workflow', { id: workflow.id });
      const reread = await call('get_workflow', { id: workflow.id });
      expect(reread.draft.nodes[1]).toMatchObject({
        routing,
        outputBindings,
        inputBindings: node.inputBindings,
      });
      await call('publish_workflow', { id: workflow.id });
      const begun = await call('start_run', {
          workflowId: workflow.id,
          input: { request: 'go', repoPath: '/project', zero: 0 },
        }),
        runId = begun.runId;
      const work = (await call('list_work', { runId }))[0];
      const claim = await call('claim_work', {
        workId: work.id,
        workerId: 'local-test',
        freshContext: false,
        tools: [],
        skills: [],
      });
      expect(claim.input).toEqual({
        request: 'go',
        project: { repoPath: '/project' },
        optional: null,
        policy: 'auto',
      });
      const invalid = await call('preflight_result', {
        workId: work.id,
        token: claim.token,
        output: { payload: 'incomplete' },
      });
      expect(invalid).toMatchObject({
        code: 'invalid_result',
        claimUsable: true,
        diagnostics: { items: [{ schemaPath: '#/routing' }] },
      });
      const raw = {
        ready: true,
        payload: 'X'.repeat(80000),
        repoPath: 'worker replacement',
      };
      await call('submit_result', {
        workId: work.id,
        token: claim.token,
        output: raw,
      });
      const completed = engine.run(runId),
        step = completed.executions.find((e) => e.nodeId === 'agent')!;
      expect(completed).toMatchObject({
        status: 'completed',
        output: { summary: 'done', project: { repoPath: '/project' } },
      });
      expect(step.port).toBe('ready');
      expect(step.result).toEqual(raw);
      const briefing = await call('get_run_briefing', { id: runId });
      expect(JSON.stringify(briefing)).not.toContain('X'.repeat(100));
      const forwarded = await call('get_run_result', {
        id: runId,
        executionId: step.id,
      });
      expect(forwarded.value).toEqual(completed.output);
      const selected = await call('get_run_result', {
        id: runId,
        executionId: step.id,
        field: 'result',
        path: 'ready',
        includeHash: true,
      });
      expect(selected.value).toBe(true);
      expect(selected.sha256).toMatch(/^[a-f0-9]{64}$/);
      const oversized = await client.callTool({
        name: 'get_run_result',
        arguments: {
          id: runId,
          executionId: step.id,
          field: 'result',
          maxBytes: 1000,
        },
      });
      expect(oversized.isError).toBe(true);
      expect(JSON.stringify(oversized)).not.toContain('X'.repeat(100));
      const bundle = await call('export_workflow', { id: workflow.id });
      expect(JSON.stringify(bundle)).toContain('outputBindings');
      expect((await call('import_workflows', { bundle })).changed).toEqual([]);
      expect(engine.workflow(workflow.id).draft.nodes[1]).toMatchObject({
        routing,
        outputBindings,
      });
    } finally {
      await client.close();
      engine.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  },
);
