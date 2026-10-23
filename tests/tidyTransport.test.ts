import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { blankDefinition, assertContract } from '@interlock/core';
import { tidyWorkflow } from '@interlock/core/layout';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';

it.each(['http', 'stdio'])(
  'authors arranged drafts over %s and the CLI with revision protection',
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
    const client = new Client({ name: 'tidy-transport', version: '1' });
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
    const previousUrl = process.env.INTERLOCK_URL;
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      for (const name of [
        'create_workflow',
        'update_workflow',
        'edit_workflow',
      ]) {
        const schema = tools.find((t) => t.name === name)!.inputSchema
          .properties!.layout as any;
        expect(schema.const ?? schema.enum?.[0]).toBe('tidy');
        expect(schema.description).toContain('Dagre');
        expect(
          tools.find((t) => t.name === name)!.inputSchema.required,
        ).not.toContain('layout');
      }
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError).not.toBe(true);
        const data = JSON.parse(
          (response.content as { text: string }[])[0].text,
        );
        expect(response.structuredContent).toEqual(data);
        const schema = tools.find((t) => t.name === name)?.outputSchema;
        if (schema) assertContract(schema, data, `${name} output`);
        return data;
      };
      const d = blankDefinition();
      for (const n of d.nodes) n.position = { x: 0, y: 0 };
      const plain = await call('create_workflow', {
        name: 'Preserved',
        definition: d,
      });
      expect(plain.draft).toEqual(d);
      const w = await call('create_workflow', {
        name: 'Tidy',
        definition: d,
        layout: 'tidy',
      });
      expect(w.draft).toEqual(tidyWorkflow(d));
      const summary = await call('create_workflow', {
        name: 'Compact tidy',
        definition: d,
        layout: 'tidy',
        detail: 'summary',
      });
      expect(summary).not.toHaveProperty('draft');
      expect(engine.workflow(summary.id).draft).toEqual(tidyWorkflow(d));
      const before = engine.workflow(w.id);
      expect(
        (
          await client.callTool({
            name: 'update_workflow',
            arguments: { id: w.id, layout: 'tidy', name: 'Must not save' },
          })
        ).isError,
      ).toBe(true);
      expect(engine.workflow(w.id)).toEqual(before);
      const updated = await call('update_workflow', {
        id: w.id,
        draft: d,
        draftRevision: w.draftRevision,
        layout: 'tidy',
        detail: 'summary',
      });
      expect(updated).toMatchObject({ draftRevision: 2 });
      expect(updated).not.toHaveProperty('draft');
      expect(engine.workflow(w.id).draft).toEqual(tidyWorkflow(d));
      const stale = await call('edit_workflow', {
        id: w.id,
        draftRevision: 1,
        edits: [],
        layout: 'tidy',
      });
      expect(stale).toMatchObject({
        applied: false,
        draftRevision: 2,
        diagnostics: [{ code: 'stale_revision' }],
      });
      const edited = await call('edit_workflow', {
        id: w.id,
        draftRevision: 2,
        layout: 'tidy',
        diagnostics: 'summary',
        edits: [
          {
            op: 'add_node',
            node: {
              id: 'new',
              kind: 'script',
              label: 'New',
              command: 'return input;',
            },
          },
        ],
      });
      expect(edited).toMatchObject({
        applied: true,
        draftRevision: 3,
        changes: { nodes: { added: ['new'] } },
      });
      const added = engine
        .workflow(w.id)
        .draft.nodes.find((n) => n.id === 'new')!;
      expect(added).toMatchObject({ language: 'javascript' });
      expect(added.position).not.toEqual({ x: 0, y: 0 });
      const protectedState = store.workflows();
      expect(
        (
          await client.callTool({
            name: 'update_workflow',
            arguments: { id: w.id, draftRevision: 3, layout: 'missing' },
          })
        ).isError,
      ).toBe(true);
      expect(store.workflows()).toEqual(protectedState);

      process.env.INTERLOCK_URL = url;
      const imported = (await runCommand([
        'import',
        JSON.stringify({ name: 'CLI tidy', definition: d, layout: 'tidy' }),
      ])) as any;
      expect(imported.draft).toEqual(tidyWorkflow(d));
      const cliUpdated = (await runCommand([
        'update',
        imported.id,
        JSON.stringify({ draftRevision: imported.draftRevision, draft: d }),
      ])) as any;
      expect(cliUpdated.draft).toEqual(d);
      const cliEdited = (await runCommand([
        'edit',
        imported.id,
        JSON.stringify({
          draftRevision: cliUpdated.draftRevision,
          edits: [],
          layout: 'tidy',
        }),
      ])) as any;
      expect(cliEdited).toMatchObject({
        applied: true,
        draftRevision: cliUpdated.draftRevision + 1,
      });
      expect(engine.workflow(imported.id).draft).toEqual(tidyWorkflow(d));
      const layoutOnly = (await runCommand([
        'update',
        imported.id,
        JSON.stringify({
          draftRevision: cliEdited.draftRevision,
          layout: 'tidy',
        }),
      ])) as any;
      expect(layoutOnly.draftRevision).toBe(cliEdited.draftRevision + 1);
      expect(layoutOnly.draft).toEqual(tidyWorkflow(d));
    } finally {
      if (previousUrl === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = previousUrl;
      await client.close();
      engine.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  },
  30000,
);
