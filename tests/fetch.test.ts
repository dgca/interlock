import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  resolveFetch,
  validateDefinition,
  type FetchNode,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { listDefinition } from './fixtures/list';
import { parseRawDefinition } from '../packages/ui/src/features/workflows/rawDefinition';
let server: Server,
  base: string,
  engine: Engine,
  requests: number,
  stats: { active: number; peak: number };
const dirs: string[] = [];
function node(patch: Partial<FetchNode> = {}): FetchNode {
  return nodeSchema.parse({
    id: 'agent',
    kind: 'fetch',
    label: 'Fetch data',
    url: base + '/echo',
    ...patch,
  }) as FetchNode;
}
function definition(fetchNode = node()): WorkflowDefinition {
  const d = blankDefinition();
  d.nodes[1] = fetchNode;
  return d;
}
function start(d = definition(), input: any = {}) {
  const w = engine.create('Fetch test', '', d);
  engine.publish(w.id);
  return engine.start(w.id, input).run;
}
async function done(id: string) {
  await vi.waitFor(() =>
    expect(['completed', 'failed', 'cancelled']).toContain(
      engine.run(id).status,
    ),
  );
  return engine.run(id);
}
beforeEach(async () => {
  requests = 0;
  stats = { active: 0, peak: 0 };
  const counters = stats;
  engine = new Engine(new Store(':memory:'), process.cwd());
  server = createServer(async (req, res) => {
    requests++;
    counters.active++;
    counters.peak = Math.max(counters.peak, counters.active);
    res.on('close', () => counters.active--);
    const url = new URL(req.url!, base);
    if (url.pathname === '/slow')
      await new Promise((resolve) => setTimeout(resolve, 250));
    if (url.pathname.startsWith('/item/'))
      await new Promise((resolve) =>
        setTimeout(resolve, url.pathname.endsWith('/1') ? 80 : 10),
      );
    if (res.destroyed) return;
    if (url.pathname === '/text') {
      res.end('hello');
      return;
    }
    if (url.pathname === '/empty') {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/huge') {
      res.end('x'.repeat(6 * 1024 * 1024));
      return;
    }
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (url.pathname === '/invalid') {
      res.end('{');
      return;
    }
    if (url.pathname === '/failure') {
      res.writeHead(422).end(JSON.stringify({ error: 'Invalid request' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    res.end(
      JSON.stringify({
        url: req.url,
        method: req.method,
        header: req.headers['x-demo'],
        body: body ? JSON.parse(body) : null,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  engine.stop();
  engine.store.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});
it('resolves encoded URLs and typed body fields while keeping fixed strings literal', () => {
  const n = node({
    method: 'POST',
    url: base + '/customers/{{input.id}}',
    query: [
      { name: 'q', value: { kind: 'input', path: 'search' } },
      { name: 'literal', value: { kind: 'fixed', value: '{{input.id}}' } },
    ],
    body: {
      kind: 'fields',
      fields: [
        { name: 'count', value: { kind: 'input', path: 'count' } },
        { name: 'options', value: { kind: 'input', path: 'options' } },
        { name: 'literal', value: { kind: 'fixed', value: '{{input.id}}' } },
      ],
    },
  });
  const r = resolveFetch(n, {
    id: 'a/b?#',
    search: 'a & b',
    count: 3,
    options: { enabled: true, value: null },
  });
  expect(r.url).toContain('/customers/a%2Fb%3F%23?');
  expect(new URL(r.url).searchParams.get('q')).toBe('a & b');
  expect(new URL(r.url).searchParams.get('literal')).toBe('{{input.id}}');
  expect(r.body).toEqual({
    count: 3,
    options: { enabled: true, value: null },
    literal: '{{input.id}}',
  });
  expect(r.headers['content-type']).toBe('application/json');
  const d = definition(n);
  expect(parseRawDefinition(JSON.stringify(d))).toEqual({ definition: d });
});
it('rejects missing fields and expressions, invalid protocols, duplicate headers, and GET bodies', () => {
  expect(() =>
    resolveFetch(node({ url: base + '/{{input.missing}}' }), {}),
  ).toThrow('Input is missing "missing"');
  expect(() =>
    resolveFetch(node({ url: base + '/{{input.toString}}' }), {}),
  ).toThrow('missing');
  for (const url of [
    'file:///tmp/data',
    'https://{{input.host}}/',
    'https://example.com/{{input.a + 1}}',
  ])
    expect(() => validateDefinition(definition(node({ url })))).toThrow();
  expect(() =>
    validateDefinition(
      definition(
        node({
          headers: [
            { name: 'X-Test', value: { kind: 'fixed', value: '1' } },
            { name: 'x-test', value: { kind: 'fixed', value: '2' } },
          ],
        }),
      ),
    ),
  ).toThrow('Duplicate header');
  expect(() =>
    validateDefinition(definition(node({ body: { kind: 'input' } }))),
  ).toThrow('cannot have a body');
  expect(
    parseRawDefinition(JSON.stringify(definition(node({ url: '' }))))
      .publishError,
  ).toBeTruthy();
});
it('sends resolved POST requests and persists request and response for inspection', async () => {
  const run = start(
    definition(
      node({
        method: 'POST',
        query: [{ name: 'name', value: { kind: 'input', path: 'name' } }],
        headers: [{ name: 'X-Demo', value: { kind: 'fixed', value: 'hello' } }],
        body: { kind: 'input' },
      }),
    ),
    { name: 'Ada & Grace', count: 2 },
  );
  const result = await done(run.id);
  expect(result.output).toMatchObject({
    status: 200,
    body: {
      method: 'POST',
      header: 'hello',
      body: { name: 'Ada & Grace', count: 2 },
    },
  });
  expect(result.executions[1].request).toMatchObject({
    method: 'POST',
    body: { name: 'Ada & Grace', count: 2 },
  });
  expect(result.executions[1].completedAt).toBeTruthy();
  expect(requests).toBe(1);
});
it.each([
  ['text', 'hello'],
  ['empty', null],
])('returns %s bodies', async (path, body) => {
  const result = await done(
    start(definition(node({ url: base + '/' + path }))).id,
  );
  expect(result.output).toMatchObject({ body });
});
it('fails on HTTP errors, retains their responses, and sends again only on explicit retry', async () => {
  const run = start(
    definition(
      node({
        method: 'POST',
        url: base + '/failure',
        body: { kind: 'fixed', value: { name: 'Ada' } },
      }),
    ),
  );
  const result = await done(run.id);
  expect(result.error).toBe('Fetch returned HTTP 422');
  expect(result.executions[1].output).toMatchObject({
    status: 422,
    body: { error: 'Invalid request' },
  });
  engine.pump();
  expect(requests).toBe(1);
  engine.retry(run.id);
  await done(run.id);
  expect(requests).toBe(2);
});
it('can return HTTP errors to a Condition', async () => {
  const d = definition(
    node({ url: base + '/failure', failOnHttpError: false }),
  );
  d.nodes.push(
    nodeSchema.parse({
      id: 'check',
      label: 'Check status',
      kind: 'condition',
      path: 'status',
      equals: 422,
    }),
  );
  d.edges[1].target = 'check';
  d.edges.push(
    { id: 'yes', source: 'check', port: 'true', target: 'exit' },
    { id: 'no', source: 'check', port: 'false', target: 'exit' },
  );
  expect((await done(start(d).id)).output).toMatchObject({ status: 422 });
});
it.each([
  ['invalid', 'invalid JSON'],
  ['huge', '5 MiB'],
  ['slow', 'exceeded 100ms'],
])('fails %s responses', async (path, error) => {
  const result = await done(
    start(
      definition(
        node({
          url: base + '/' + path,
          timeoutMs: path === 'slow' ? 100 : 30000,
        }),
      ),
    ).id,
  );
  expect(result.status).toBe('failed');
  expect(result.error).toContain(error);
});
it('aborts cancellation and ignores late completion', async () => {
  const run = start(definition(node({ url: base + '/slow' })));
  await vi.waitFor(() => expect(requests).toBe(1));
  engine.cancel(run.id);
  await vi.waitFor(() => expect(stats.active).toBe(0));
  expect(engine.run(run.id).status).toBe('cancelled');
  expect(engine.run(run.id).output).toBeUndefined();
});
it('runs Fetch inside List with bounded concurrency and ordered outputs', async () => {
  const d = listDefinition(
    node({ id: 'work', url: base + '/item/{{input.id}}' }),
    { concurrency: 2 },
  );
  const result = await done(start(d, [{ id: 1 }, { id: 2 }, { id: 3 }]).id);
  expect((result.output as any[]).map((r) => r.body.url)).toEqual([
    '/item/1',
    '/item/2',
    '/item/3',
  ]);
  expect(stats.peak).toBe(2);
});
it('marks interrupted requests failed on restart and never resends automatically', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-fetch-'));
  dirs.push(dir);
  const path = join(dir, 'data.db');
  engine.stop();
  engine.store.close();
  engine = new Engine(new Store(path), process.cwd());
  const run = start(definition(node({ url: base + '/slow' })));
  await vi.waitFor(() => expect(requests).toBe(1));
  engine.stop();
  engine.store.close();
  engine = new Engine(new Store(path), process.cwd());
  engine.pump();
  expect(engine.run(run.id).status).toBe('failed');
  expect(engine.run(run.id).error).toContain('interrupted during fetch');
  expect(requests).toBe(1);
  engine.retry(run.id);
  expect((await done(run.id)).status).toBe('completed');
  expect(requests).toBe(2);
});
