import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { blankDefinition, nodeSchema } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createApp } from '../packages/server/src/app';

it.each(['http', 'stdio'])(
  'manages model aliases across MCP %s and exports alias requirements in bundles',
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
    if (!address || typeof address === 'string') throw Error('No listener');
    const url = `http://127.0.0.1:${address.port}`;
    const client = new Client({ name: 'model-alias-transport', version: '1' });
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
      const exportTool = tools.find((t) => t.name === 'export_workflow');
      expect(exportTool?.description).toContain('Format 6');
      expect(tools.some((t) => t.name === 'manage_model_aliases')).toBe(true);

      const call = async (
        name: string,
        args: Record<string, unknown>,
        error = false,
      ) => {
        const r = await client.callTool({ name, arguments: args });
        expect(r.isError === true).toBe(error);
        return error
          ? r
          : JSON.parse((r.content as { text: string }[])[0].text);
      };

      // Create model alias
      const alias = await call('manage_model_aliases', {
        request: {
          action: 'create',
          name: 'builder',
          description: 'Builder agent',
          candidates: [{ model: 'claude-3-7-sonnet', effort: 'high' }],
        },
      });
      expect(alias.name).toBe('builder');
      expect(alias.revision).toBe(1);

      // List aliases
      const list = await call('manage_model_aliases', {
        request: { action: 'list' },
      });
      expect(list.total).toBe(1);
      expect(list.items[0].name).toBe('builder');

      // Inspect alias
      const inspected = await call('manage_model_aliases', {
        request: { action: 'inspect', id: alias.id },
      });
      expect(inspected.id).toBe(alias.id);

      // Create workflow referencing the alias
      const d = blankDefinition();
      d.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'agent',
        label: 'Build',
        prompt: 'Build something',
        model: 'builder',
      });
      const w = await call('create_workflow', {
        name: 'Alias workflow',
        definition: d,
      });
      await call('publish_workflow', { id: w.id });

      // Start run and verify alias capture
      const run = await call('start_run', { workflowId: w.id, input: {} });
      const runInfo = await call('get_run', { id: run.runId });
      expect(runInfo.run.modelAliasCaptures).toBeDefined();
      expect(runInfo.run.modelAliasCaptures[0]).toMatchObject({
        aliasId: alias.id,
        name: 'builder',
        revision: 1,
      });

      // Export workflow bundle
      const bundle = await call('export_workflow', { id: w.id });
      expect(bundle.formatVersion).toBe(6);
      expect(bundle.modelAliases).toEqual([
        { name: 'builder', description: 'Builder agent' },
      ]);
      const identified = structuredClone(d);
      if (identified.nodes[1].kind !== 'agent') throw Error('Expected Agent');
      identified.nodes[1].model = alias.id;
      const identifiedWorkflow = await call('create_workflow', {
        name: 'Alias ID workflow',
        definition: identified,
      });
      await call('publish_workflow', { id: identifiedWorkflow.id });
      const identifiedBundle = await call('export_workflow', {
        id: identifiedWorkflow.id,
      });
      expect(identifiedBundle).toMatchObject({
        formatVersion: 10,
        modelAliases: [{ name: 'builder', reference: alias.id }],
      });
      await call('import_workflows', { bundle: identifiedBundle });

      // Update alias
      const updated = await call('manage_model_aliases', {
        request: {
          action: 'update',
          id: alias.id,
          expectedRevision: 1,
          description: 'Updated description',
        },
      });
      expect(updated.revision).toBe(2);

      // Delete alias
      const deleted = await call('manage_model_aliases', {
        request: {
          action: 'delete',
          id: alias.id,
          expectedRevision: 2,
        },
      });
      expect(deleted.id).toBe(alias.id);
      const before = engine.store.runs().length;
      await call('start_run', { workflowId: w.id, input: {} }, true);
      await call(
        'start_run',
        { workflowId: identifiedWorkflow.id, input: {} },
        true,
      );
      expect(engine.store.runs()).toHaveLength(before);
      const existing = await call('get_run', { id: run.runId });
      expect(existing.run.modelAliasCaptures[0].candidates[0].model).toBe(
        'claude-3-7-sonnet',
      );
      await call('manage_model_aliases', {
        request: {
          action: 'create',
          name: 'builder',
          candidates: [{ model: 'repaired-model' }],
        },
      });
      const repaired = await call('start_run', {
        workflowId: identifiedWorkflow.id,
        input: {},
      });
      const repairedRun = await call('get_run', { id: repaired.runId });
      expect(repairedRun.run.modelAliasCaptures[0]).toMatchObject({
        reference: alias.id,
        candidates: [{ model: 'repaired-model' }],
      });
    } finally {
      await client.close();
      engine.stop();
      engine.store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  25000,
);
