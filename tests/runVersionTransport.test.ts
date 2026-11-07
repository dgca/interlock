import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertContract, blankDefinition, jsonSchema } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createClient } from '@interlock/client';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';

let versionDiscovery: unknown;
it.each(['http', 'stdio'])(
  'manages exact run versions through %s, shared API and CLI',
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
    const api = createClient(url);
    const client = new Client({ name: 'run-versions', version: '1' });
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
    const prior = process.env.INTERLOCK_URL;
    try {
      await client.connect(transport);
      const discovery = await client.listTools();
      const tools = discovery.tools;
      const tool = tools.find((entry) => entry.name === 'manage_run_version')!;
      expect(tool).toBeDefined();
      if (versionDiscovery) expect(tool).toEqual(versionDiscovery);
      else versionDiscovery = tool;
      for (const request of [
        { action: 'read', runId: 'run', offset: 0, limit: 100 },
        {
          action: 'policy',
          runId: 'run',
          expectedRevision: 0,
          policy: 'pinned',
        },
        { action: 'preview', runId: 'run', version: 2 },
        {
          action: 'apply',
          runId: 'run',
          version: 2,
          confirmation: 'confirmation',
          reason: 'Operator fix',
          recapturePrompts: true,
        },
      ])
        assertContract(
          tool.inputSchema,
          jsonSchema.parse({ request }),
          'run version request',
        );
      expect(() =>
        assertContract(
          tool.inputSchema,
          { request: { action: 'read', runId: 'run', limit: 101 } },
          'invalid history bound',
        ),
      ).toThrow();
      expect(
        tools.find((entry) => entry.name === 'start_run')!.inputSchema
          .properties!.versionPolicy,
      ).toMatchObject({ enum: ['pinned', 'latest-compatible'] });
      expect(client.getInstructions()).toContain(
        'existing assignments finish unchanged',
      );
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
        const data = JSON.parse((result.content as { text: string }[])[0].text);
        expect(result.structuredContent).toEqual(data);
        return data;
      };
      const definition = blankDefinition();
      const workflow = engine.create('Version operations', '', definition);
      engine.publish(workflow.id);
      const newer = structuredClone(definition);
      if (newer.nodes[1].kind !== 'agent') throw new Error('Expected Agent');
      newer.nodes[1].prompt = 'Fixed prompt';
      engine.update(workflow.id, {
        draft: newer,
        draftRevision: workflow.draftRevision,
      });
      engine.publish(workflow.id);
      const hold = engine.pauses.create({
        target: { scope: 'library' },
        actor: 'operator',
        reason: 'Review version move',
      });
      const started = await call('start_run', {
        workflowId: workflow.id,
        version: 1,
        input: {},
        versionPolicy: 'pinned',
        requestId: `version-${mode}`,
      });
      const runId = started.runId;
      expect(
        await call('manage_run_version', {
          request: { action: 'read', runId, limit: 1 },
        }),
      ).toMatchObject({
        version: 1,
        policy: 'pinned',
        revision: 0,
        history: { total: 0 },
      });
      process.env.INTERLOCK_URL = url;
      const enabled: any = await runCommand([
        'run-version',
        JSON.stringify({
          action: 'policy',
          runId,
          expectedRevision: 0,
          policy: 'latest-compatible',
        }),
      ]);
      expect(enabled).toMatchObject({
        policy: 'latest-compatible',
        revision: 1,
      });
      const incompatibleRetry = await client.callTool({
        name: 'start_run',
        arguments: {
          workflowId: workflow.id,
          version: 1,
          input: {},
          versionPolicy: 'latest-compatible',
          requestId: `version-${mode}`,
        },
      });
      expect(incompatibleRetry.isError).toBe(true);
      const preview = await call('manage_run_version', {
        request: { action: 'preview', runId, version: 2 },
      });
      expect(preview).toMatchObject({
        fromVersion: 1,
        toVersion: 2,
        canApply: true,
        blockers: [],
      });
      await api.runs.setVersionPolicy.mutate({
        runId,
        expectedRevision: 1,
        policy: 'pinned',
      });
      const stale = await client.callTool({
        name: 'manage_run_version',
        arguments: {
          request: {
            action: 'apply',
            runId,
            version: 2,
            confirmation: preview.confirmation,
            reason: 'Apply stale preview',
          },
        },
      });
      expect(stale.isError).toBe(true);
      expect(engine.run(runId).version).toBe(1);
      const fresh = await api.runs.previewVersionMove.query({
        runId,
        version: 2,
      });
      const moved = await call('manage_run_version', {
        request: {
          action: 'apply',
          runId,
          version: 2,
          confirmation: fresh.confirmation,
          reason: 'Deploy published fix',
        },
      });
      expect(moved).toMatchObject({
        version: 2,
        history: {
          total: 1,
          items: [
            { fromVersion: 1, toVersion: 2, reason: 'Deploy published fix' },
          ],
        },
      });
      expect(
        await runCommand([
          'run-version',
          JSON.stringify({ action: 'read', runId, limit: 1 }),
        ]),
      ).toMatchObject({ version: 2, policy: 'pinned', history: { total: 1 } });
      await api.pauses.resume.mutate({ id: hold.id });
      const work = engine.available(runId)[0];
      expect(work.prompt).toContain('Fixed prompt');
      expect(
        (await call('get_run', { id: runId })).run.executions.at(-1),
      ).toHaveProperty('version', 2);
      engine.update(workflow.id, {
        draft: newer,
        draftRevision: engine.workflow(workflow.id).draftRevision,
      });
      engine.publish(workflow.id);
      const retained = structuredClone(engine.store.work(undefined, runId));
      const blocked = await runCommand([
        'run-version',
        JSON.stringify({ action: 'preview', runId, version: 3 }),
      ]);
      expect(blocked).toMatchObject({
        canApply: false,
        blockers: expect.arrayContaining([
          expect.stringMatching(/execut|assignment|step/i),
        ]),
      });
      expect(engine.store.work(undefined, runId)).toEqual(retained);
      expect(engine.run(runId).version).toBe(2);
      expect(JSON.stringify(await runCommand(['help']))).toContain(
        '--version-policy pinned|latest-compatible',
      );
      expect(JSON.stringify(await runCommand(['help']))).toContain(
        'run-version <json|@file>',
      );
      console.info(
        `${mode}: manage_run_version ${Buffer.byteLength(JSON.stringify(tool))} B, ${tools.length} tools, discovery ${Buffer.byteLength(JSON.stringify(discovery))} B, instructions ${Buffer.byteLength(client.getInstructions() ?? '')} B`,
      );
    } finally {
      if (prior === undefined) delete process.env.INTERLOCK_URL;
      else process.env.INTERLOCK_URL = prior;
      await client.close();
      engine.stop();
      engine.store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
