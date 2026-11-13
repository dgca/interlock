import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { blankDefinition, nodeSchema } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { expect, it } from 'vitest';
import { createApp } from '../packages/server/src/app';

it.each(['http', 'stdio'])(
  'discovers and manages workflow boards through MCP %s',
  async (mode) => {
    const engine = new Engine(new Store(':memory:'), process.cwd());
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
    const client = new Client({ name: 'workflow-boards-test', version: '1' });
    const readTool = 'read_workflow_boards';
    const manageTool = 'manage_workflow_boards';
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

      const { tools } = await client.listTools();
      const readSchema = JSON.stringify(
        tools.find((tool) => tool.name === readTool)?.inputSchema,
      );
      const manageSchema = JSON.stringify(
        tools.find((tool) => tool.name === manageTool)?.inputSchema,
      );
      for (const field of [
        'list',
        'settings',
        'get',
        'column',
        'workflowId',
        'status',
        'offset',
        'limit',
      ])
        expect(readSchema).toContain(`"${field}"`);
      for (const field of [
        'save',
        'assign',
        'expectedRevision',
        'expectedBoards',
        'expectedBoardId',
      ])
        expect(manageSchema).toContain(`"${field}"`);
      expect(
        tools.find((tool) => tool.name === 'workflow_requests')?.description,
      ).toContain(readTool);

      const call = async (
        name: string,
        request: Record<string, unknown>,
        error?: string,
      ) => {
        const result = await client.callTool({
          name,
          arguments: { request },
        });
        const [{ text }] = result.content as { text: string }[];
        if (error) {
          expect(result.isError).toBe(true);
          expect(text).toContain(error);
          return;
        }
        expect(result.isError).not.toBe(true);
        const data = JSON.parse(text);
        expect(result.structuredContent).toEqual(
          Array.isArray(data) ? { items: data } : data,
        );
        return data;
      };

      expect(await call(readTool, { action: 'list' })).toEqual({
        items: [],
        total: 0,
        nextOffset: null,
      });
      const board = await call(manageTool, {
        action: 'save',
        name: 'Delivery',
        columns: [{ name: 'Review' }, { name: 'Build' }],
        workflowIds: [],
      });
      const [review, build] = board.columns;
      const other = await call(manageTool, {
        action: 'save',
        name: 'Other',
        columns: [],
        workflowIds: [],
      });
      expect(await call(readTool, { action: 'list', limit: 1 })).toMatchObject({
        total: 2,
        nextOffset: 1,
        items: [{ id: board.id }],
      });
      expect(await call(readTool, { action: 'list', offset: 1 })).toEqual({
        total: 2,
        nextOffset: null,
        items: [
          { id: other.id, name: 'Other', workflowCount: 0, attentionCount: 0 },
        ],
      });

      const definition = blankDefinition();
      definition.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'input',
        label: 'Review plan',
        boardColumnId: review.id,
        humanInput: {
          question: 'Can work begin?',
          answer: { kind: 'text' },
        },
      });
      const workflow = engine.create('Delivery workflow', '', definition);
      engine.publish(workflow.id);
      expect(
        await call(manageTool, {
          action: 'assign',
          workflowId: workflow.id,
          boardId: other.id,
          expectedBoardId: null,
        }),
      ).toEqual({ workflowId: workflow.id, boardId: other.id });
      await call(
        manageTool,
        {
          action: 'assign',
          workflowId: workflow.id,
          boardId: board.id,
          expectedBoardId: null,
        },
        'Workflow board changed',
      );

      const settings = await call(readTool, {
        action: 'settings',
        id: board.id,
      });
      expect(settings).toMatchObject({
        ...board,
        workflowIds: [],
        protectedColumnIds: [review.id],
      });
      const update = {
        action: 'save',
        id: board.id,
        expectedRevision: settings.revision,
        name: 'Delivery',
        columns: [build, { ...review, name: 'Plan review' }],
        workflowIds: [workflow.id],
        expectedBoards: { [workflow.id]: other.id },
      };
      await call(
        manageTool,
        { ...update, expectedBoards: { [workflow.id]: null } },
        'changed',
      );
      const saved = await call(manageTool, update);
      expect(saved).toMatchObject({
        id: board.id,
        revision: board.revision + 1,
        columns: update.columns,
      });
      await call(manageTool, update, 'Board settings changed');
      await call(
        manageTool,
        { ...update, expectedRevision: saved.revision, columns: [build] },
        'Columns still used',
      );
      expect(
        await call(readTool, { action: 'settings', id: other.id }),
      ).toMatchObject({ revision: other.revision + 2, workflowIds: [] });

      const unrelatedDefinition = blankDefinition();
      unrelatedDefinition.nodes.splice(1, 1);
      unrelatedDefinition.edges = [
        { id: 'finish', source: 'entry', target: 'exit', port: 'default' },
      ];
      const unrelated = engine.create('Unrelated', '', unrelatedDefinition);
      engine.publish(unrelated.id);
      for (let index = 0; index < 100; index++) engine.start(unrelated.id, {});
      engine.start(workflow.id, {});
      const run = engine.start(workflow.id, {});
      const cardQuery = {
        action: 'get',
        id: board.id,
        column: review.id,
        status: 'attention',
        limit: 1,
      };
      const page = await call(readTool, cardQuery);
      expect(page).toMatchObject({
        attentionCount: 2,
        columns: [
          { id: build.id, total: 0, cards: [] },
          { id: review.id, total: 2, cards: [{ attentionCount: 1 }] },
        ],
      });
      const nextPage = await call(readTool, { ...cardQuery, offset: 1 });
      expect(nextPage.columns[1].cards).toHaveLength(1);
      const cards = [page.columns[1].cards[0], nextPage.columns[1].cards[0]];
      const target = cards.find((card) => card.runId === run.run.id).request;
      expect(
        await call('workflow_requests', { action: 'list', boardId: board.id }),
      ).toMatchObject({ total: 2 });
      expect(
        JSON.stringify(
          await call('workflow_requests', { action: 'get', target }),
        ),
      ).toContain('Can work begin?');
      expect(
        await call(readTool, { ...cardQuery, workflowId: unrelated.id }),
      ).toMatchObject({ attentionCount: 0 });

      expect(
        await call(manageTool, {
          action: 'assign',
          workflowId: workflow.id,
          boardId: null,
          expectedBoardId: board.id,
        }),
      ).toEqual({ workflowId: workflow.id, boardId: null });
      expect(await call(readTool, cardQuery)).toMatchObject({
        attentionCount: 0,
      });
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      engine.stop();
      engine.store.close();
    }
  },
);
