import { expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { blankDefinition, nodeSchema } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createClient } from '@interlock/client';
import { createApp } from '../packages/server/src/app';
import { isConfirmedWriteRejection } from '../packages/ui/src/lib/isConfirmedWriteRejection';

let discovery: unknown;
it.each(['http', 'stdio'])(
  'manages safe variable references across MCP %s and the shared API',
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
    const client = new Client({ name: 'variable-transport', version: '1' });
    const token = 'transport-fake-credential-P4w9';
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
      expect(
        tools.find((t) => t.name === 'export_workflow')?.description,
      ).toMatch(/Format 4.*variable requirements/);
      const schemas = tools.filter((t) =>
        ['read_variables', 'manage_variables'].includes(t.name),
      );
      expect(schemas).toHaveLength(2);
      expect(
        schemas.find((tool) => tool.name === 'read_variables')?.description,
      ).toContain('valueRevision');
      if (discovery) expect(schemas).toEqual(discovery);
      else discovery = schemas;
      const definition = JSON.stringify(
        tools.find((t) => t.name === 'create_workflow')!.inputSchema,
      );
      expect(definition).toContain('variableId');
      expect(definition).toContain('environment');
      const call = async (
        name: string,
        args: Record<string, unknown>,
        error = false,
      ) => {
        const r = await client.callTool({ name, arguments: args });
        expect(r.isError === true).toBe(error);
        expect(JSON.stringify(r)).not.toContain(token);
        return error
          ? r
          : JSON.parse((r.content as { text: string }[])[0].text);
      };
      const variable = await call('manage_variables', {
        request: {
          action: 'create',
          name: 'api_token',
          kind: 'secret',
          value: token,
        },
      });
      const listed = await call('read_variables', {
        request: { action: 'list', limit: 1 },
      });
      expect(listed).toMatchObject({ total: 1, truncated: false });
      expect(listed.items[0]).not.toHaveProperty('value');
      await call(
        'read_variables',
        { request: { action: 'config_value', id: variable.id } },
        true,
      );
      const config = await call('manage_variables', {
        request: {
          action: 'create',
          name: 'ordinary',
          kind: 'config',
          value: 'non-secret-config',
        },
      });
      expect(
        await call('read_variables', {
          request: { action: 'config_value', id: config.id },
        }),
      ).toEqual({
        id: config.id,
        value: 'non-secret-config',
        valueRevision: 1,
      });
      await call('manage_variables', {
        request: {
          action: 'update',
          id: config.id,
          expectedRevision: 1,
          value: 'rotated-config',
        },
      });
      const shared = createClient(url);
      const readConfig = { action: 'config_value' as const, id: config.id };
      const rotated = {
        id: config.id,
        value: 'rotated-config',
        valueRevision: 2,
      };
      expect(await call('read_variables', { request: readConfig })).toEqual(
        rotated,
      );
      expect(await shared.variables.read.query(readConfig)).toEqual(rotated);
      const d = blankDefinition();
      d.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'script',
        label: 'Use credential',
        language: 'javascript',
        command: 'return {echo:process.env.API_TOKEN};',
        environment: [{ name: 'API_TOKEN', variableId: variable.id }],
      });
      const w = await call('create_workflow', {
        name: 'Variable workflow',
        definition: d,
      });
      await call('publish_workflow', { id: w.id });
      const run = await call('start_run', { workflowId: w.id, input: {} });
      await vi.waitFor(() =>
        expect(engine.run(run.runId).status).toBe('completed'),
      );
      const inspected = await call('get_run', { id: run.runId });
      expect(inspected.run.variableCaptures[0]).toMatchObject({
        variableId: variable.id,
        valueRevision: 1,
      });
      expect(inspected.run.output).toEqual({ echo: '[REDACTED]' });
      const metadata = await call('read_variables', {
        request: { action: 'inspect', id: variable.id, limit: 1 },
      });
      expect(metadata.dependencies).toMatchObject({ total: 1 });
      const bundle = await call('export_workflow', { id: w.id });
      expect(bundle.formatVersion).toBe(4);
      await call('import_workflows', { bundle }, true);
      await call('import_workflows', {
        bundle,
        variableBindings: {
          [variable.id]: { action: 'bind', variableId: variable.id },
        },
      });
      await call('manage_variables', {
        request: {
          action: 'update',
          id: variable.id,
          expectedRevision: 1,
          enabled: false,
        },
      });
      await call(
        'manage_variables',
        {
          request: {
            action: 'update',
            id: variable.id,
            expectedRevision: 1,
            value: token,
          },
        },
        true,
      );
      await call('start_run', { workflowId: w.id, input: {} }, true);
      await call(
        'manage_variables',
        { request: { action: 'delete', id: variable.id, expectedRevision: 2 } },
        true,
      );
      if (mode === 'http') {
        const rejections = [
          {
            call: shared.variables.manage.mutate({
              action: 'create',
              name: 'api_token',
              kind: 'secret',
              value: token,
            }),
            message:
              'A variable with that name already exists. Choose a different name.',
          },
          {
            call: shared.boards.save.mutate({
              name: 'Missing workflow',
              columns: [],
              workflowIds: ['missing'],
            }),
            message: 'A selected workflow no longer exists',
          },
          {
            call: shared.workflows.publish.mutate({ id: 'missing' }),
            message: 'Workflow not found',
          },
        ];
        await Promise.all(
          rejections.map(async ({ call, message }) => {
            const error = await call.catch((reason: unknown) => reason);
            expect(error).toMatchObject({
              message,
              data: {
                code: 'INTERNAL_SERVER_ERROR',
                httpStatus: 500,
                domainRejection: true,
              },
            });
            expect(isConfirmedWriteRejection(error)).toBe(true);
            expect(JSON.stringify(error)).not.toContain(token);
          }),
        );
      }
      try {
        await shared.variables.manage.mutate({
          action: 'create',
          name: 'invalid name',
          kind: 'secret',
          value: token,
        });
        throw new Error('Expected safe validation failure');
      } catch (error) {
        expect(isConfirmedWriteRejection(error)).toBe(true);
        expect(String(error)).not.toContain(token);
        expect(String(error)).toContain('Invalid variable change');
      }
      await call(
        'manage_variables',
        {
          request: {
            action: 'create',
            name: 'oversized',
            kind: 'secret',
            value: token.repeat(1000),
          },
        },
        true,
      );
      await call(
        'manage_variables',
        {
          request: {
            action: 'create',
            name: 'invalid_kind',
            kind: token,
            value: token,
          },
        },
        true,
      );
    } finally {
      await client.close();
      engine.stop();
      engine.store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  20000,
);
