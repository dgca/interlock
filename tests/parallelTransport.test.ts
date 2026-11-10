import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createApp } from '../packages/server/src/app';
import { parallelDefinition } from './fixtures/parallel';

it.each(['http', 'stdio'])(
  'authors and recovers a Parallel group over MCP %s',
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
    const client = new Client({ name: 'parallel-test', version: '1' });
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
      const { tools } = await client.listTools();
      for (const name of ['create_workflow', 'update_workflow']) {
        const schema = JSON.stringify(
          tools.find((tool) => tool.name === name)?.inputSchema,
        );
        expect(schema).toContain('"parallelBranchId"');
        expect(schema).toContain('"join"');
      }
      expect(
        tools.find((tool) => tool.name === 'validate_workflow')?.description,
      ).toContain('Parallel scopes');
      expect(
        tools.find((tool) => tool.name === 'get_run_briefing')?.description,
      ).toContain('parallels');
      expect(
        tools.find((tool) => tool.name === 'retry_run')?.description,
      ).toContain('parent run');
      expect(
        tools.find((tool) => tool.name === 'workflow_simulation')?.description,
      ).toContain('Parallel');
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
      const definition = parallelDefinition();
      const workflow = await call('create_workflow', {
        name: 'Parallel review',
        definition,
      });
      const group = definition.nodes.find((n) => n.kind === 'parallel')!;
      await call('edit_workflow', {
        id: workflow.id,
        draftRevision: workflow.draftRevision,
        edits: [
          {
            op: 'update_node',
            id: group.id,
            set: {
              branches: [{ id: 'r0', key: '__proto__' }, group.branches[1]],
            },
          },
        ],
      });
      expect(
        await call('validate_workflow', { id: workflow.id }),
      ).toMatchObject({ saveable: true, publishable: true });
      await call('publish_workflow', { id: workflow.id });
      const run = await call('start_run', {
        workflowId: workflow.id,
        input: { commit: 'candidate' },
        limit: 1,
      });
      expect(run.nextWork).toMatchObject({ total: 2, truncated: true });
      expect(run.nextWork.items).toHaveLength(1);
      const brief = await call('get_run_briefing', { id: run.runId, limit: 1 });
      expect(brief.parallels.items[0]).toMatchObject({
        nodeId: group.id,
        total: 2,
        dispatched: 2,
        queued: 0,
      });
      expect(brief.descendants).toMatchObject({ total: 2, truncated: true });
      expect(brief.descendants.items[0]).toMatchObject({
        parallelBranch: { nodeId: group.id },
        parentExecutionId: brief.parallels.items[0].executionId,
      });
      const available = await call('list_work', { runId: run.runId });
      const claim = async (nodeId: string, list = available) =>
        call('claim_work', {
          workId: list.find((w: { nodeId: string }) => w.nodeId === nodeId).id,
          workerId: 'test',
        });
      const first = await claim('r0');
      expect(first.input).toEqual({ commit: 'candidate' });
      await call('submit_result', {
        workId: first.id,
        token: first.token,
        output: null,
      });
      const second = await claim('r1');
      await call('fail_work', {
        workId: second.id,
        token: second.token,
        error: 'retry this branch',
      });
      await call('retry_run', { id: run.runId });
      const pending = await call('list_work', { runId: run.runId });
      expect(pending.map((w: { nodeId: string }) => w.nodeId)).toEqual(['r1']);
      const recovered = await claim('r1', pending);
      const done = await call('submit_result', {
        workId: recovered.id,
        token: recovered.token,
        output: { ok: true },
      });
      expect(done).toMatchObject({
        runId: run.runId,
        runStatus: 'completed',
        workRunId: second.runId,
      });
      const result = await call('get_run_result', { id: run.runId });
      expect(result.value).toEqual(
        JSON.parse('{"__proto__":null,"code":{"ok":true}}'),
      );
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      engine.stop();
      store.close();
    }
  },
);
