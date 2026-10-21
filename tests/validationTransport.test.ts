import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { blankDefinition, jsonSchema, type Json } from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { createClient } from '@interlock/client';
import { createApp } from '../packages/server/src/app';

async function withServer(
  check: (engine: Engine, url: string, id: string) => Promise<void>,
) {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  const workflow = engine.create('Candidate validation', '', blankDefinition());
  engine.publish(workflow.id);
  const before = engine.workflow(workflow.id);
  const server = serve({
    fetch: createApp(engine).fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const url = `http://127.0.0.1:${address.port}`;
    const client = createClient(url);
    const versions = await client.workflows.versions.query({ id: workflow.id });
    await check(engine, url, workflow.id);
    expect(engine.workflow(workflow.id)).toEqual(before);
    expect(await client.workflows.versions.query({ id: workflow.id })).toEqual(
      versions,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
  }
}

function candidate(prompt: string) {
  const definition = blankDefinition();
  const agent = definition.nodes.find((node) => node.kind === 'agent')!;
  if (agent.kind !== 'agent') throw new Error('Expected agent');
  agent.prompt = prompt;
  return jsonSchema.parse(definition) as Record<string, Json>;
}

it.each([1_000, 20_000, 550_000])(
  'validates a %i-byte prompt through the shared HTTP client without saving it',
  async (size) =>
    withServer(async (engine, url, id) => {
      const client = createClient(url);
      const definition = candidate('x'.repeat(size));
      expect(await client.workflows.validate.query({ id, definition })).toEqual(
        engine.validateDraft(id, definition),
      );
      expect(await client.workflows.validate.query({ id })).toEqual(
        engine.validateDraft(id),
      );
      expect(
        await client.workflows.validate.query({
          id,
          definition: { ...definition, edges: [] },
        }),
      ).toMatchObject({ saveable: true, publishable: false });
      expect(
        await client.workflows.validate.query({
          id,
          definition: { ...definition, unexpected: true },
        }),
      ).toMatchObject({ saveable: false, publishable: false });
    }),
);

it('preserves legacy GET validation with and without batching', async () =>
  withServer(async (engine, url, id) => {
    for (const definition of [undefined, candidate('Legacy candidate')]) {
      const input = { id, definition };
      const expected = {
        result: { data: engine.validateDraft(id, definition) },
      };
      for (const batch of [false, true]) {
        const query = new URLSearchParams({
          input: JSON.stringify(batch ? { 0: input } : input),
        });
        if (batch) query.set('batch', '1');
        const response = await fetch(`${url}/trpc/workflows.validate?${query}`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(batch ? [expected] : expected);
      }
    }
  }));

it('accepts a 2 MiB UTF-8 request and explains rejection one byte over the limit', async () =>
  withServer(async (_engine, url, id) => {
    const definition = candidate('');
    const remaining =
      2 * 1024 * 1024 - Buffer.byteLength(JSON.stringify({ id, definition }));
    const prompt =
      'é'.repeat(Math.floor(remaining / 2)) + 'x'.repeat(remaining % 2);
    const input = { id, definition: candidate(prompt) };
    expect(Buffer.byteLength(JSON.stringify(input))).toBe(2 * 1024 * 1024);
    const client = createClient(url);
    expect(await client.workflows.validate.query(input)).toMatchObject({
      publishable: true,
    });
    await expect(
      client.workflows.validate.query({
        id,
        definition: candidate(prompt + 'x'),
      }),
    ).rejects.toThrow(
      'Request body exceeds the 2 MiB limit. Reduce the request size.',
    );
    expect(await client.workflows.validate.query({ id })).toMatchObject({
      publishable: true,
    });
  }));

it('enforces the body limit on streamed validation requests without Content-Length', async () =>
  withServer(async (_engine, url, id) => {
    const body = JSON.stringify({
      id,
      definition: candidate('x'.repeat(2 * 1024 * 1024)),
    });
    const response = await fetch(`${url}/trpc/workflows.validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          const bytes = new TextEncoder().encode(body);
          for (let i = 0; i < bytes.length; i += 64 * 1024)
            controller.enqueue(bytes.slice(i, i + 64 * 1024));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(await response.text()).toContain('2 MiB limit');
  }));
