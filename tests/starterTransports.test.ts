import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { jsonSchema } from '@interlock/core';
import { createApp } from '../packages/server/src/app';
import { exportWorkflows } from '../packages/runtime/src/transfer';
import { createClient } from '@interlock/client';
import sdlc from '../workflows/sdlc.json';
import { runCommand } from '../packages/cli/src/commands';
let discovery: unknown;
it('previews large workflow files through the browser client without URL limits or writes', async () => {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  const server = serve({
    fetch: createApp(engine).fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((r) =>
    server.listening ? r() : server.once('listening', r),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No listener');
  try {
    const api = createClient(`http://127.0.0.1:${address.port}`);
    const document = { ...sdlc, description: 'Large file '.repeat(4000) };
    expect(
      await api.workflows.previewImport.query({
        document: jsonSchema.parse(document),
      }),
    ).toMatchObject({
      name: sdlc.name,
      description: document.description,
      published: false,
    });
    expect(engine.store.workflows()).toEqual([]);
    expect(engine.store.runs()).toEqual([]);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      if ('closeAllConnections' in server) server.closeAllConnections();
    });
    engine.stop();
    engine.store.close();
  }
});
it.each(['http', 'stdio'])(
  'discovers and explicitly imports starters without adding MCP tools over %s',
  async (mode) => {
    const e = new Engine(new Store(':memory:'), process.cwd()),
      server = serve({
        fetch: createApp(e).fetch,
        hostname: '127.0.0.1',
        port: 0,
      });
    await new Promise<void>((r) =>
      server.listening ? r() : server.once('listening', r),
    );
    const a = server.address();
    if (!a || typeof a === 'string') throw Error('No listener');
    const url = `http://127.0.0.1:${a.port}`;
    const client = new Client({ name: 'starter-test', version: '1' }),
      transport =
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
    const call = async (name: string, args: any = {}) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).not.toBe(true);
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(69);
      if (discovery) expect(tools).toEqual(discovery);
      else discovery = tools;
      expect(await call('list_workflows')).toEqual([]);
      const choices = await call('list_workflows', { source: 'starters' });
      expect(choices.map((s: any) => s.id)).toEqual([
        'sdlc',
        'sdlc-v2',
        'pr-watcher',
        'evaluate-comparison',
        'github-issue-intake',
      ]);
      expect(JSON.stringify(choices).length).toBeLessThan(2000);
      expect(e.store.workflows()).toEqual([]);
      // The listing names the board; one starter's detail carries its setup.
      expect(JSON.stringify(choices)).not.toContain('boardSetup');
      expect(JSON.stringify(choices)).toContain('"board":"sdlc-board"');
      const [detail] = (await call('list_workflows', {
        source: 'starters',
        starterId: 'sdlc',
      })) as { boardSetup: { suggestions: unknown[] } }[];
      expect(detail.boardSetup.suggestions[0]).toMatchObject({
        id: 'sdlc-board',
        workflows: [{ workflowId: 'sdlc', currentBoardId: null }],
      });
      expect(
        tools.find((tool) => tool.name === 'import_workflows')?.inputSchema
          .properties,
      ).toHaveProperty('boardSetup');
      const requestId = ' request-one ';
      const q = {
          starterId: 'sdlc',
          requestId,
          boardSetup: {
            requestId,
            choices: [
              {
                action: 'create',
                suggestionId: 'sdlc-board',
                expectedBoards: { sdlc: null },
              },
            ],
          },
        },
        a = await call('import_workflows', q);
      expect(a).toMatchObject({
        created: true,
        workflow: { latestVersion: 1 },
      });
      expect(await call('import_workflows', q)).toEqual(a);
      expect(a.boardSetup.boards[0].workflowIds).toEqual([a.workflow.id]);
      expect(e.boards.list()).toHaveLength(1);
      expect(e.store.runs()).toEqual([]);
      const copy = await call('import_workflows', {
        starterId: 'sdlc',
        requestId: 'another',
        copy: true,
      });
      expect(copy.workflow.id).not.toBe(a.workflow.id);
      expect((await call('list_workflows')).length).toBe(2);
      const bundle = exportWorkflows(e.store, a.workflow.id);
      expect(bundle.formatVersion).toBe(11);
      const preview = await call('import_workflows', { bundle, dryRun: true });
      const suggestion = preview.boardSetup.suggestions[0];
      expect(suggestion.workflows[0]).toMatchObject({
        workflowId: a.workflow.id,
        currentBoardId: a.boardSetup.boards[0].boardId,
      });
      expect((await call('import_workflows', { bundle })).rootId).toBe(
        a.workflow.id,
      );
      expect(e.workflow(a.workflow.id).boardId).toBe(
        a.boardSetup.boards[0].boardId,
      );
      const setup = {
        requestId: 'setup-imported-board',
        choices: [
          {
            action: 'create',
            suggestionId: suggestion.id,
            expectedBoards: { [a.workflow.id]: a.boardSetup.boards[0].boardId },
          },
        ],
      };
      const priorUrl = process.env.INTERLOCK_URL;
      process.env.INTERLOCK_URL = url;
      try {
        const cliPreview = await runCommand([
          'import',
          JSON.stringify(bundle),
          '--dry-run',
        ]);
        expect(cliPreview).toEqual(preview);
        const first = await runCommand([
          'import',
          JSON.stringify(bundle),
          '--board-setup',
          JSON.stringify(setup),
        ]);
        expect(
          await call('import_workflows', { bundle, boardSetup: setup }),
        ).toEqual(first);
        expect(e.boards.list()).toHaveLength(2);
        const starterSetup = {
          ...q.boardSetup,
          requestId: 'cli-starter-board',
        };
        const args = [
          'import-starter',
          'sdlc',
          '--copy',
          '--board-setup',
          JSON.stringify(starterSetup),
        ];
        const cliStarter = await runCommand(args);
        expect(await runCommand(args)).toEqual(cliStarter);
        expect(cliStarter).toMatchObject({
          created: true,
          boardSetup: { boards: [{ suggestionId: 'sdlc-board' }] },
        });
        expect(e.boards.list()).toHaveLength(3);
      } finally {
        if (priorUrl === undefined) delete process.env.INTERLOCK_URL;
        else process.env.INTERLOCK_URL = priorUrl;
      }
      const invalid = await client.callTool({
        name: 'import_workflows',
        arguments: { ...q, bundle },
      });
      expect(invalid.isError).toBe(true);
      expect(e.store.workflows()).toHaveLength(3);
      e.deleteWorkflow(copy.workflow.id);
      const old = await client.callTool({
        name: 'import_workflows',
        arguments: { starterId: 'sdlc', requestId: 'another', copy: true },
      });
      expect(old.isError).toBe(true);
    } finally {
      await client.close();
      await new Promise<void>((r) => {
        server.close(() => r());
        if ('closeAllConnections' in server) server.closeAllConnections();
      });
      e.stop();
      e.store.close();
    }
  },
);
