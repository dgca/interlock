import { expect, it } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition } from '@interlock/core';
import { createApp } from '../packages/server/src/app';

type Body = {
  items: unknown[];
  issues: unknown[];
  error: string;
  code: string;
  runId: string;
  status: string;
  value: unknown;
};

it('starts, polls, reads, retries and cancels runs over the plain HTTP API', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  const definition = blankDefinition();
  definition.inputSchema = {
    type: 'object',
    properties: { task: { type: 'string' } },
    required: ['task'],
  };
  const w = engine.create('Review', '', definition);
  engine.publish(w.id);
  engine.create('Unpublished', '');
  const app = createApp(engine);
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await app.request(`http://127.0.0.1:4310/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Body };
  };
  try {
    // Discovery lists only startable workflows with their input contracts.
    const listed = await call('GET', '/workflows');
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        id: w.id,
        latestVersion: 1,
        inputSchema: definition.inputSchema,
      }),
    ]);

    const invalid = await call('POST', '/runs', {
      workflowId: w.id,
      input: {},
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toContain('"task"');
    const shape = await call('POST', '/runs', { workflowId: w.id, extra: 1 });
    expect(shape.status).toBe(400);
    expect(shape.body.issues.length).toBeGreaterThan(0);
    expect(
      (await call('POST', '/runs', { workflowId: 'missing', input: {} }))
        .status,
    ).toBe(404);

    const start = { workflowId: w.id, input: { task: 'issue 301' } };
    const key = { 'idempotency-key': 'delivery-1' };
    const accepted = await call('POST', '/runs', start, key);
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({
      status: 'waiting',
      actor: 'agent',
      requestId: 'delivery-1',
      waiting: { kind: 'claim_queue' },
    });
    const id = accepted.body.runId;
    // A lost response is retried with the same key and body.
    const retried = await call('POST', '/runs', start, key);
    expect(retried.body.runId).toBe(id);
    expect(store.runs()).toHaveLength(1);
    const reused = await call(
      'POST',
      '/runs',
      { ...start, input: { task: 'other' } },
      key,
    );
    expect(reused.status).toBe(409);
    expect(store.runs()).toHaveLength(1);

    const early = await call('GET', `/runs/${id}/result`);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('run_not_completed');
    const work = engine.available(id)[0];
    const claim = engine.claim(work.id, {
      workerId: 'test',
      freshContext: false,
      tools: [],
      skills: [],
    });
    engine.submit(work.id, claim.token!, { summary: 'done' });
    const done = await call('GET', `/runs/${id}`);
    expect(done.body).toMatchObject({ runId: id, status: 'completed' });
    expect(done.body).not.toHaveProperty('executions');
    expect((await call('GET', `/runs/${id}/result`)).body.value).toEqual({
      summary: 'done',
    });
    expect(
      (await call('GET', `/runs/${id}/result?path=summary`)).body.value,
    ).toBe('done');

    const other = await call('POST', '/runs', start);
    const cancelled = await call('POST', `/runs/${other.body.runId}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');

    for (const [method, path] of [
      ['GET', '/runs/missing'],
      ['GET', '/runs/missing/result'],
      ['POST', '/runs/missing/cancel'],
      ['GET', '/unknown'],
    ])
      expect((await call(method, path)).status).toBe(404);
  } finally {
    engine.stop();
    store.close();
  }
});
