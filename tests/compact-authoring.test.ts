import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import {
  assertContract,
  definitionSchema,
  summarizeDiagnostics,
  type DraftDiagnostic,
} from '@interlock/core';
import { exportWorkflows } from '../packages/runtime/src/transfer';
import { createApp } from '../packages/server/src/app';
import { runCommand } from '../packages/cli/src/commands';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function largeDefinition() {
  const nodes = [
    { id: 'entry', kind: 'entry', label: 'Input' },
    ...Array.from({ length: 25 }, (_, i) => ({
      id: `agent-${i}`,
      kind: 'agent',
      label: `Step ${i}`,
      prompt: 'definition-payload-marker'.repeat(600),
      inputSchema: { type: 'object' },
      context: {},
    })),
    { id: 'exit', kind: 'exit', label: 'Output' },
  ];
  return definitionSchema.parse({
    nodes,
    edges: nodes
      .slice(1)
      .map((n, i) => ({ id: `edge-${i}`, source: nodes[i].id, target: n.id })),
  });
}
let discovered: unknown;
it.each(['http', 'stdio'])(
  'offers compatible authoring modes and schemas over %s',
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
    const url = `http://127.0.0.1:${address.port}`;
    const client = new Client({ name: 'authoring-test', version: '1' });
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
      const names = [
        'create_workflow',
        'update_workflow',
        'publish_workflow',
        'edit_workflow',
        'claim_work',
      ];
      const schemas = (await client.listTools()).tools.filter((t) =>
        names.includes(t.name),
      );
      expect(schemas).toHaveLength(names.length);
      for (const s of schemas) expect(s.outputSchema?.type).toBe('object');
      if (discovered) expect(schemas).toEqual(discovered);
      discovered = schemas;
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError, JSON.stringify(response.content)).not.toBe(
          true,
        );
        const data = response.structuredContent as any;
        const text = (response.content as { text: string }[])[0].text;
        expect(JSON.parse(text)).toEqual(data);
        const schema = schemas.find((s) => s.name === name)?.outputSchema;
        if (schema) assertContract(schema, data, name);
        return { data, text };
      };
      const compact = (r: { data: any; text: string }) => {
        expect(Buffer.byteLength(r.text)).toBeLessThan(1024);
        expect(Buffer.byteLength(JSON.stringify(r.data))).toBeLessThan(1024);
        expect(r.text).not.toContain('definition-payload-marker');
        expect(r.data).not.toHaveProperty('draft');
      };
      const definition = largeDefinition();
      const created = await call('create_workflow', {
        name: 'Large',
        definition,
        detail: 'summary',
      });
      compact(created);
      expect(created.data).toMatchObject({
        ok: true,
        draftRevision: 1,
        latestVersion: 0,
        draftMatchesLatest: null,
        archived: false,
      });
      const id = created.data.id;
      const published = await call('publish_workflow', {
        id,
        detail: 'summary',
      });
      compact(published);
      expect(published.data).toMatchObject({
        latestVersion: 1,
        draftMatchesLatest: true,
      });
      console.log(
        `${mode}: authoring summary ${Buffer.byteLength(published.text)} B text / ${Buffer.byteLength(JSON.stringify(published.data))} B structured`,
      );
      const full = await call('publish_workflow', { id });
      console.log(
        `${mode}: full publication ${Buffer.byteLength(full.text)} B text`,
      );
      expect(full.text.length).toBeGreaterThan(300000);
      expect(full.data).toHaveProperty('draft');
      for (const archived of [true, false]) {
        const updated = await call('update_workflow', {
          id,
          archived,
          detail: 'summary',
        });
        compact(updated);
        expect(updated.data.archived).toBe(archived);
      }
      expect(
        (await call('update_workflow', { id, name: 'Renamed', detail: 'full' }))
          .data,
      ).toHaveProperty('draft');
      expect(
        (await call('create_workflow', { name: 'Full', definition })).data,
      ).toHaveProperty('draft');
      const dependent = engine.create(
        'Dependent',
        '',
        definitionSchema.parse({
          nodes: [
            { id: 'entry', kind: 'entry', label: 'Input' },
            {
              id: 'child',
              kind: 'workflow',
              label: 'Child',
              workflowId: id,
              version: 2,
            },
            { id: 'exit', kind: 'exit', label: 'Output' },
          ],
          edges: [
            { id: 'a', source: 'entry', target: 'child' },
            { id: 'b', source: 'child', target: 'exit' },
          ],
        }),
      );
      engine.publish(dependent.id);
      const cascade = await call('publish_workflow', {
        id,
        cascade: true,
        detail: 'summary',
      });
      compact(cascade);
      expect(cascade.data.latestVersion).toBe(3);
      expect(engine.workflow(dependent.id)).toMatchObject({
        latestVersion: 2,
        draft: {
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: 'child', version: 3 }),
          ]),
        },
      });
      const imported = await call('import_workflows', {
        bundle: exportWorkflows(store, id),
      });
      expect(imported.data).toHaveProperty('workflows');
      expect(imported.text).not.toContain('definition-payload-marker');
      const before = engine.workflow(id);
      for (const name of [
        'create_workflow',
        'update_workflow',
        'publish_workflow',
      ]) {
        const response = await client.callTool({
          name,
          arguments: { id, name: 'Bad', detail: 'tiny' },
        });
        expect(response.isError).toBe(true);
        expect(engine.workflow(id)).toEqual(before);
      }
      const edited = await call('edit_workflow', {
        id,
        draftRevision: before.draftRevision,
        edits: [
          { op: 'update_node', id: 'agent-0', set: { leaseSeconds: 60 } },
        ],
        diagnostics: 'summary',
      });
      expect(edited.data.applied).toBe(true);
      expect(edited.data.diagnosticSummary.total).toBeGreaterThan(20);
      expect(edited.data.diagnostics).toHaveLength(5);
      expect(edited.data.diagnosticSummary.omitted).toBeGreaterThan(15);
      const all = await call('edit_workflow', {
        id,
        draftRevision: edited.data.draftRevision,
        edits: [],
      });
      expect(all.data).not.toHaveProperty('diagnosticSummary');
      expect(all.data.diagnostics.length).toBe(
        edited.data.diagnosticSummary.total,
      );
      const state = engine.workflow(id);
      const stale = await call('edit_workflow', {
        id,
        draftRevision: 1,
        edits: [],
        diagnostics: 'summary',
      });
      expect(stale.data.applied).toBe(false);
      expect(stale.data.diagnostics[0].code).toBe('stale_revision');
      expect(engine.workflow(id)).toEqual(state);
      const invalid = await client.callTool({
        name: 'edit_workflow',
        arguments: {
          id,
          draftRevision: state.draftRevision,
          edits: [],
          diagnostics: 'tiny',
        },
      });
      expect(invalid.isError).toBe(true);
      expect(engine.workflow(id)).toEqual(state);
      const run = engine.start(id, {}).run;
      const work = engine.available(run.id)[0];
      expect(
        (await call('claim_work', { workId: work.id, workerId: 'test' })).data
          .token,
      ).toBeTypeOf('string');
    } finally {
      await client.close();
      await transport.close();
      engine.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  },
  20000,
);

it('retains downstream warnings introduced by an upstream edit', () => {
  const store = new Store(':memory:'),
    engine = new Engine(store, process.cwd());
  try {
    const d = largeDefinition();
    d.nodes[1].outputSchema = { type: 'object' };
    const w = engine.create('Downstream', '', d);
    const before = engine.validateDraft(w.id).diagnostics;
    expect(before.some((x) => x.nodeId === 'agent-1')).toBe(false);
    const result = engine.editDraft(
      w.id,
      w.draftRevision,
      [{ op: 'update_node', id: 'agent-0', set: { outputSchema: {} } }],
      'summary',
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ nodeId: 'agent-1', code: 'contract_unknown' }),
    );
    const state = engine.workflow(w.id);
    const invalid = engine.editDraft(
      w.id,
      state.draftRevision,
      [{ op: 'update_node', id: 'agent-0', set: { maxLeaseExpiries: 0 } }],
      'summary',
    );
    expect(invalid.applied).toBe(false);
    expect(invalid.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(engine.workflow(w.id)).toEqual(state);
  } finally {
    engine.stop();
    store.close();
  }
});

it('deduplicates unchanged warning samples by stable location without losing errors', () => {
  const warning = (nodeId: string, path: string): DraftDiagnostic => ({
    severity: 'warning',
    category: 'contract',
    code: 'unknown',
    message: 'Unknown',
    nodeId,
    path,
  });
  const before = Array.from({ length: 8 }, (_, i) =>
    warning(`n${i}`, `nodes.${i + 1}.inputSchema`),
  );
  const after = before.map((d, i) => ({
    ...d,
    path: `nodes.${i}.inputSchema`,
  }));
  const error: DraftDiagnostic = {
    severity: 'error',
    category: 'publication',
    code: 'broken',
    path: 'edges',
    message: 'Broken',
  };
  const result = summarizeDiagnostics(before, [...after, after[0], error]);
  expect(result.diagnosticSummary).toMatchObject({
    total: 9,
    returned: 6,
    omitted: 3,
    unchangedWarnings: 8,
  });
  expect(result.diagnostics[0]).toEqual(error);
});

it('supports CLI summary continuations and fresh/lease flags without changing defaults', async () => {
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
  const previous = process.env.INTERLOCK_URL;
  process.env.INTERLOCK_URL = `http://127.0.0.1:${address.port}`;
  const directory = mkdtempSync(join(tmpdir(), 'interlock-cli-'));
  try {
    const definition = definitionSchema.parse({
      nodes: [
        { id: 'entry', kind: 'entry', label: 'Input' },
        {
          id: 'agent',
          kind: 'agent',
          label: 'Task',
          prompt: 'Task',
          context: { mode: 'fresh' },
        },
        { id: 'exit', kind: 'exit', label: 'Output' },
      ],
      edges: [
        { id: 'a', source: 'entry', target: 'agent' },
        { id: 'b', source: 'agent', target: 'exit' },
      ],
    });
    const w = engine.create('CLI', '', definition);
    engine.publish(w.id);
    const file = join(directory, 'input.json');
    writeFileSync(file, '{}');
    const start = (await runCommand([
      'start',
      w.id,
      `@${file}`,
      '1',
      '--summary',
    ])) as any;
    expect(start).toMatchObject({
      runStatus: 'waiting',
      next: 'claim_work',
      nextCall: null,
    });
    expect(start).not.toHaveProperty('definition');
    const work = start.nextWork.items[0];
    await expect(runCommand(['claim', work.id])).rejects.toThrow(
      'requires fresh context',
    );
    for (const lease of ['9', '3601', '1.5', 'nope'])
      await expect(
        runCommand(['claim', work.id, '--fresh', '--lease', lease]),
      ).rejects.toThrow();
    const claim = (await runCommand([
      'claim',
      work.id,
      'cli-test',
      '{"freshContext":false,"leaseSeconds":60}',
      '--fresh',
      '--lease',
      '1800',
    ])) as any;
    expect(claim).toMatchObject({
      claimLeaseSeconds: 1800,
      workerId: 'cli-test',
    });
    const done = (await runCommand([
      'submit',
      claim.id,
      claim.token,
      `@${file}`,
      '--summary',
    ])) as any;
    expect(done).toMatchObject({
      runStatus: 'completed',
      nextCall: { tool: 'get_run_result', arguments: { id: start.runId } },
    });
    expect(
      ((await runCommand(['submit', claim.id, claim.token, '{}'])) as any).run
        .status,
    ).toBe('completed');
    expect(await runCommand(['start', w.id, '{}'])).toHaveProperty(
      'definition',
    );
    for (const json of ['-1', '-0', '-0.25', '-2e3', '-3.5E-2']) {
      for (const flags of [[], ['--summary']]) {
        const numericStart = (await runCommand([
          'start',
          ...flags,
          w.id,
          json,
          '1',
        ])) as any;
        const runId = numericStart.runId ?? numericStart.run.id;
        // JSON transport normalizes negative zero to zero.
        const expected = JSON.parse(JSON.stringify(JSON.parse(json)));
        expect(engine.inspect(runId).run.input).toBe(expected);
        const numericWork = engine.available(runId)[0];
        const numericClaim = (await runCommand([
          'claim',
          numericWork.id,
          '--fresh',
        ])) as any;
        const numericDone = (await runCommand([
          'submit',
          numericClaim.id,
          numericClaim.token,
          json,
          ...flags,
        ])) as any;
        expect(numericDone.runStatus ?? numericDone.run.status).toBe(
          'completed',
        );
        expect(engine.inspect(runId).run.output).toBe(expected);
        if (flags.length) {
          expect(numericStart).not.toHaveProperty('definition');
          expect(numericDone).not.toHaveProperty('definition');
        } else {
          expect(numericStart).toHaveProperty('definition');
          expect(numericDone).toHaveProperty('definition');
        }
      }
    }
    const separated = (await runCommand([
      'start',
      w.id,
      '--summary',
      '--',
      '-1',
      '1',
    ])) as any;
    const separatedClaim = (await runCommand([
      'claim',
      separated.nextWork.items[0].id,
      '--fresh',
    ])) as any;
    expect(
      await runCommand([
        'submit',
        '--summary',
        separatedClaim.id,
        separatedClaim.token,
        '--',
        '-1',
      ]),
    ).toMatchObject({ runStatus: 'completed' });
    for (const cmd of [
      ['start', w.id, '-1'],
      ['submit', claim.id, claim.token, '-1'],
      ['claim', claim.id],
    ]) {
      for (const flag of ['--unknown', '-x', '--summary=true'])
        await expect(runCommand([...cmd, flag])).rejects.toThrow();
    }
  } finally {
    if (previous === undefined) delete process.env.INTERLOCK_URL;
    else process.env.INTERLOCK_URL = previous;
    rmSync(directory, { recursive: true, force: true });
    engine.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
