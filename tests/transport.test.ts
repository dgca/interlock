import { readFileSync } from 'node:fs';
import { assertContract, validateContractSchema } from '@interlock/core';
import { batchDefinition } from './fixtures/batch';
import { runCommand } from '../packages/cli/src/commands';
import { it, expect } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { createClient } from '@interlock/client';
import { createApp } from '../packages/server/src/app';
import { nodeSchema, blankDefinition } from '@interlock/core';

function leaseDeadline(value: unknown): number {
  if (
    !value ||
    typeof value !== 'object' ||
    !('leaseUntil' in value) ||
    typeof value.leaseUntil !== 'string'
  )
    throw new Error('Expected a claim deadline');
  return Date.parse(value.leaseUntil);
}

it.each(['stdio', 'http'])(
  'completes a workflow through MCP %s and the shared HTTP and SQLite interfaces',
  async (mode) => {
    const store = new Store(':memory:'),
      engine = new Engine(store, process.cwd());
    const w = engine.create('Transport smoke', '', blankDefinition());
    engine.publish(w.id);
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
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    const transport =
      mode === 'http'
        ? new StreamableHTTPClientTransport(new URL(`${url}/mcp`))
        : new StdioClientTransport({
            command: process.execPath,
            args: ['--import', 'tsx', 'packages/mcp/src/index.ts'],
            cwd: process.cwd(),
            env: {
              ...Object.fromEntries(
                Object.entries(process.env).filter(
                  (pair): pair is [string, string] => pair[1] !== undefined,
                ),
              ),
              INTERLOCK_URL: url,
            },
            stderr: 'pipe',
          });
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError).not.toBe(true);
      const content = response.content as { type: string; text: string }[];
      return JSON.parse(content[0].text);
    };
    try {
      await client.connect(transport);
      expect(
        (await call('list_workflows', {})).some(
          (item: { id: string }) => item.id === w.id,
        ),
      ).toBe(true);
      const tools = (await client.listTools()).tools;
      for (const tool of tools) validateContractSchema(tool.inputSchema);
      expect(tools.map((t) => t.name)).toContain('claim_work');
      const renewalSchema = tools.find(
        (t) => t.name === 'renew_claim',
      )!.inputSchema;
      expect(renewalSchema.properties!.leaseSeconds).not.toHaveProperty(
        'default',
      );
      expect(renewalSchema.required).not.toContain('leaseSeconds');
      expect(renewalSchema.properties!.leaseSeconds).toMatchObject({
        minimum: 10,
        maximum: 3600,
      });
      const createDefinition = tools.find((t) => t.name === 'create_workflow')!
        .inputSchema.properties!.definition as { description: string };
      const updateDefinition = tools.find((t) => t.name === 'update_workflow')!
        .inputSchema.properties!.draft as { description: string };
      expect(createDefinition.description).toContain('unclaimedTimeoutMs');
      expect(createDefinition.description).toContain('31536000000');
      expect(createDefinition.description).toContain('maxItems');
      expect(createDefinition.description).toContain('10000');
      expect(updateDefinition.description).toBe(createDefinition.description);
      for (const value of [
        null,
        false,
        3,
        'text',
        '{"literal":true}',
        [1, { nested: [false, null] }],
        { nested: { array: [1] } },
      ]) {
        expect(() =>
          assertContract(
            tools.find((t) => t.name === 'start_run')!.inputSchema,
            { workflowId: w.id, input: value },
            'tool input',
          ),
        ).not.toThrow();
        const roundTrip = await call('start_run', {
          workflowId: w.id,
          input: value,
        });
        const [assignment] = await call('list_work', {
          runId: roundTrip.run.id,
        });
        const claim = await call('claim_work', {
          workId: assignment.id,
          workerId: 'json-values',
        });
        const completed = await call('submit_result', {
          workId: assignment.id,
          token: claim.token,
          output: value,
        });
        expect(completed.run.output).toEqual(value);
      }
      const disposable = await call('create_workflow', { name: 'Disposable' });
      await call('update_workflow', { id: disposable.id, archived: true });
      expect(
        (await call('list_workflows', { includeArchived: false })).some(
          (w: { id: string }) => w.id === disposable.id,
        ),
      ).toBe(false);
      await call('update_workflow', { id: disposable.id, archived: false });
      const bundle = await call('export_workflow', { id: disposable.id });
      expect((await call('import_workflows', { bundle })).changed).toEqual([]);
      await call('delete_workflow', { id: disposable.id });
      expect(
        (await call('list_workflows', {})).some(
          (w: { id: string }) => w.id === disposable.id,
        ),
      ).toBe(false);
      expect(createDefinition).toMatchObject({ type: 'object' });
      expect(updateDefinition).toMatchObject({ type: 'object' });
      for (const [name, parameter] of [
        ['start_run', 'input'],
        ['submit_result', 'output'],
      ]) {
        const schema = tools.find((tool) => tool.name === name)!.inputSchema;
        expect(schema.required).toContain(parameter);
        expect(schema.properties![parameter]).not.toEqual({});
      }
      expect(tools.find((t) => t.name === 'list_work')!.description).toContain(
        'availableUntil',
      );

      // Exercise the published JSON examples through both MCP transports.
      const examples = [
        ...readFileSync('docs/timers.md', 'utf8').matchAll(
          /```json\n([\s\S]*?)\n```/g,
        ),
      ].map((match) => JSON.parse(match[1]));
      for (const example of examples.filter((value) => !Array.isArray(value))) {
        const timerDefinition = blankDefinition();
        timerDefinition.nodes[1] = nodeSchema.parse(example);
        timerDefinition.edges = [
          { id: 'in', source: 'entry', target: example.id, port: 'default' },
          { id: 'out', source: example.id, target: 'exit', port: 'default' },
          ...(example.kind === 'agent'
            ? [
                {
                  id: 'timeout',
                  source: example.id,
                  target: 'exit',
                  port: 'timeout' as const,
                },
              ]
            : []),
        ];
        const timerWorkflow = await call('create_workflow', {
          name: 'Documented timer',
          definition: timerDefinition,
        });
        await call('publish_workflow', { id: timerWorkflow.id });
        const input = { dueAt: '2000-01-01T00:00:00Z' };
        const timerRun = await call('start_run', {
          workflowId: timerWorkflow.id,
          input,
        });
        const timerState = await call('get_run', { id: timerRun.run.id });
        if (example.kind === 'agent') {
          const assignments = await call('list_work', {
            runId: timerRun.run.id,
          });
          expect(assignments[0].availableUntil).toBeDefined();
          await call('cancel_run', { id: timerRun.run.id });
        } else if (example.timing.kind === 'duration') {
          expect(timerState.run.status).toBe('waiting');
          expect(timerState.run.executions.at(-1).resumeAt).toBeDefined();
          expect(await call('list_work', { runId: timerRun.run.id })).toEqual(
            [],
          );
          expect(
            (await call('cancel_run', { id: timerRun.run.id })).run.status,
          ).toBe('cancelled');
        } else {
          expect(timerState.run.status).toBe('completed');
          expect(timerState.run.output).toEqual(input);
        }
      }
      const batchDraft = await call('create_workflow', {
        name: 'Larger backlog',
        definition: batchDefinition(),
      });
      const raisedLimit = batchDefinition(undefined, {
        maxItems: 250,
        concurrency: 3,
      });
      const updatedBatch = await call('update_workflow', {
        id: batchDraft.id,
        draft: raisedLimit,
        draftRevision: batchDraft.draftRevision,
      });
      expect(
        updatedBatch.draft.nodes.find(
          (n: { kind: string }) => n.kind === 'batch',
        ).maxItems,
      ).toBe(250);
      await call('publish_workflow', { id: batchDraft.id });
      const backlog = await call('start_run', {
        workflowId: batchDraft.id,
        input: Array.from({ length: 207 }, (_, i) => i),
      });
      expect(backlog.run.status).toBe('waiting');
      expect(await call('list_work', { runId: backlog.run.id })).toHaveLength(
        3,
      );
      await call('cancel_run', { id: backlog.run.id });
      const started = await call('start_run', {
        workflowId: w.id,
        input: { number: 21 },
      });
      const work = await call('list_work', { runId: started.run.id });
      expect(
        await call('list_runs', {
          workflowId: w.id,
          status: 'waiting',
          rootOnly: true,
          limit: 1,
          inputMatch: { path: 'number', equals: 21 },
        }),
      ).toMatchObject([
        {
          id: started.run.id,
          workflowId: w.id,
          rootRunId: started.run.id,
          rootWorkflowId: w.id,
        },
      ]);
      const summary = await call('list_work', {
        runId: started.run.id,
        fields: 'summary',
      });
      expect(summary).toHaveLength(work.length);
      expect(summary[0]).not.toHaveProperty('parentRunId');
      expect(summary[0]).toMatchObject({
        id: work[0].id,
        context: work[0].context,
        workflowId: w.id,
        rootRunId: started.run.id,
        rootWorkflowId: w.id,
      });
      for (const field of [
        'prompt',
        'input',
        'outputSchema',
        'executionInstructions',
      ])
        expect(summary[0]).not.toHaveProperty(field);
      const claim = await call('claim_work', {
        workId: work[0].id,
        workerId: 'mcp-test',
        leaseSeconds: 3600,
      });
      const renewed = await call('renew_claim', {
        workId: claim.id,
        token: claim.token,
      });
      expect(Date.parse(renewed.leaseUntil)).toBeGreaterThanOrEqual(
        Date.parse(claim.leaseUntil),
      );
      const renewalUrl = process.env.INTERLOCK_URL;
      process.env.INTERLOCK_URL = url;
      try {
        const overridden = await runCommand([
          'renew',
          claim.id,
          claim.token,
          '{"leaseSeconds":60}',
        ]);
        expect(leaseDeadline(overridden) - Date.now()).toBeGreaterThan(55000);
        expect(leaseDeadline(overridden) - Date.now()).toBeLessThanOrEqual(
          60000,
        );
        await expect(
          runCommand(['renew', claim.id, claim.token, '{"leaseSeconds":3601}']),
        ).rejects.toThrow();
        const cliRenewed = await runCommand(['renew', claim.id, claim.token]);
        expect(leaseDeadline(cliRenewed)).toBeGreaterThanOrEqual(
          Date.parse(renewed.leaseUntil),
        );
      } finally {
        if (renewalUrl === undefined) delete process.env.INTERLOCK_URL;
        else process.env.INTERLOCK_URL = renewalUrl;
      }
      for (const duration of [9, 3601, 10.5]) {
        expect(
          (
            await client.callTool({
              name: 'renew_claim',
              arguments: {
                workId: claim.id,
                token: claim.token,
                leaseSeconds: duration,
              },
            })
          ).isError,
        ).toBe(true);
      }
      const result = await call('submit_result', {
        workId: claim.id,
        token: claim.token,
        output: { number: 42 },
      });
      expect(result.run.status).toBe('completed');
      expect(
        (
          await client.callTool({
            name: 'renew_claim',
            arguments: { workId: claim.id, token: claim.token },
          })
        ).isError,
      ).toBe(true);
      const rpc = createClient(url);
      expect(
        (await rpc.runs.get.query({ id: started.run.id })).run.output,
      ).toEqual({ number: 42 });
      const dependentDefinition = blankDefinition();
      dependentDefinition.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'workflow',
        label: 'Shared',
        workflowId: w.id,
        version: 1,
      });
      const dependent = engine.create('Dependent', '', dependentDefinition);
      engine.publish(dependent.id);
      await call('publish_workflow', { id: w.id, cascade: true });
      expect(engine.workflow(dependent.id).latestVersion).toBe(2);
      const dependentRun = await call('start_run', {
        workflowId: dependent.id,
        input: {},
      });
      const [nested] = await call('list_work', {
        runId: dependentRun.run.id,
        fields: 'summary',
      });
      expect(nested).toMatchObject({
        workflowId: w.id,
        parentRunId: dependentRun.run.id,
        rootRunId: dependentRun.run.id,
        rootWorkflowId: dependent.id,
      });
      expect(
        await call('list_runs', { workflowId: w.id, limit: 1 }),
      ).toMatchObject([
        {
          id: nested.runId,
          parentRunId: dependentRun.run.id,
          rootRunId: dependentRun.run.id,
          rootWorkflowId: dependent.id,
        },
      ]);
      await call('cancel_run', { id: dependentRun.run.id });
      const definition = batchDefinition();
      const workflow = await call('create_workflow', {
        name: 'Batch transport',
        definition,
      });
      await call('publish_workflow', { id: workflow.id });
      const root = await call('start_run', {
        workflowId: workflow.id,
        input: [3, 4],
      });
      const items = await call('list_work', { runId: root.run.id });
      expect(items.map((item: any) => item.input)).toEqual([3, 4]);
      const previousUrl = process.env.INTERLOCK_URL;
      process.env.INTERLOCK_URL = url;
      try {
        await runCommand(['publish', w.id, '--cascade']);
        expect(engine.workflow(dependent.id).latestVersion).toBe(3);
        expect(await runCommand(['work', root.run.id])).toMatchObject(items);
        const summaries = await call('list_work', {
          runId: root.run.id,
          fields: 'summary',
        });
        expect(summaries).toHaveLength(2);
        expect(summaries[0]).toMatchObject({
          workflowId: workflow.id,
          parentRunId: root.run.id,
          rootRunId: root.run.id,
          rootWorkflowId: workflow.id,
        });
        expect(await runCommand(['work', root.run.id, '--summary'])).toEqual(
          summaries,
        );
        expect(
          await runCommand(['runs', '--workflow', workflow.id, '--limit', '1']),
        ).toMatchObject([
          {
            rootRunId: root.run.id,
            rootWorkflowId: workflow.id,
            parentRunId: root.run.id,
          },
        ]);
        const detail = await runCommand(['run', items[0].runId]);
        expect(detail).toMatchObject({
          definition,
          run: { batchNodeId: 'batch' },
        });
      } finally {
        if (previousUrl === undefined) delete process.env.INTERLOCK_URL;
        else process.env.INTERLOCK_URL = previousUrl;
      }
      for (const item of items.reverse()) {
        const claimed = await call('claim_work', {
          workId: item.id,
          workerId: 'batch-mcp',
        });
        await call('submit_result', {
          workId: item.id,
          token: claimed.token,
          output: item.input * 2,
        });
      }
      expect((await call('get_run', { id: root.run.id })).run.output).toEqual([
        6, 8,
      ]);
      const failed = await call('start_run', {
        workflowId: workflow.id,
        input: [5],
      });
      const [assignment] = await call('list_work', { runId: failed.run.id });
      const failedClaim = await call('claim_work', {
        workId: assignment.id,
        workerId: 'retry-test',
      });
      await call('fail_work', {
        workId: assignment.id,
        token: failedClaim.token,
        error: 'Temporary executor failure',
      });
      expect((await call('get_run', { id: failed.run.id })).run.status).toBe(
        'failed',
      );
      await call('retry_run', { id: failed.run.id });
      const [retried] = await call('list_work', { runId: failed.run.id });
      const retriedClaim = await call('claim_work', {
        workId: retried.id,
        workerId: 'retry-test',
      });
      await call('submit_result', {
        workId: retried.id,
        token: retriedClaim.token,
        output: 10,
      });
      expect((await call('get_run', { id: failed.run.id })).run.output).toEqual(
        [10],
      );
      const invalidRetry = await client.callTool({
        name: 'retry_run',
        arguments: { id: failed.run.id },
      });
      expect(invalidRetry.isError).toBe(true);
      expect(
        (
          await fetch(`${url}/health`, {
            headers: { origin: 'https://untrusted.example' },
          })
        ).status,
      ).toBe(403);
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      engine.stop();
      store.close();
    }
  },
);

it('validates HTTP MCP requests and preserves local-access and body limits', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  const app = createApp(engine);
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  const message = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'http-validation', version: '1.0.0' },
    },
  };
  const request = (body: unknown, extra: Record<string, string> = {}) =>
    app.request('http://127.0.0.1:4310/mcp', {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  try {
    const initialized = await request(message);
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get('content-type')).toContain(
      'application/json',
    );
    expect(initialized.headers.has('mcp-session-id')).toBe(false);
    expect(await initialized.json()).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'interlock' } },
    });
    expect(
      (await request({ jsonrpc: '2.0', method: 'notifications/initialized' }))
        .status,
    ).toBe(202);
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const response = await app.request('http://127.0.0.1:4310/mcp', {
        method,
      });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
    expect(
      (await request(message, { origin: 'https://untrusted.example' })).status,
    ).toBe(403);
    expect(
      (
        await app.request('http://untrusted.example/mcp', {
          method: 'POST',
          headers,
          body: JSON.stringify(message),
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(message, { origin: 'http://127.0.0.1:4310' })).status,
    ).toBe(200);
    expect((await request(message, { accept: 'text/html' })).status).toBe(406);
    expect(
      (await request(message, { 'content-type': 'text/plain' })).status,
    ).toBe(415);
    expect(
      (
        await app.request('http://127.0.0.1:4310/mcp', {
          method: 'POST',
          headers,
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
          {
            'mcp-protocol-version': 'unsupported',
          },
        )
      ).status,
    ).toBe(400);
    expect((await request('x'.repeat(2 * 1024 * 1024))).status).toBe(413);
    // Independent clients can reuse JSON-RPC IDs without sharing a transport.
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: 1,
        result: { tools: expect.any(Array) },
      });
    }
  } finally {
    engine.stop();
    store.close();
  }
});
