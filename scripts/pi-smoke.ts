// Opt-in live account/model check: pnpm exec tsx scripts/pi-smoke.ts [provider/model]
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { blankDefinition, definitionSchema } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { piAdapter } from '../packages/runtime/src/executors/pi.js';

const directory = await mkdtemp(join(tmpdir(), 'interlock-pi-smoke-'));
const engine = new Engine(
  new Store(join(directory, 'smoke.sqlite')),
  directory,
);
const nonce = randomUUID();
try {
  await writeFile(join(directory, 'nonce.txt'), nonce);
  engine.executors.saveProfile({
    id: 'pi',
    harness: 'pi',
    name: 'Pi smoke',
    enabled: true,
    expectedRevision: 0,
    cwd: directory,
    permissions: 'read-only',
    ...(process.argv[2] ? { model: process.argv[2] } : {}),
  });
  const definition = blankDefinition();
  definition.executor = 'pi';
  const first = definition.nodes.find((n) => n.kind === 'agent')!;
  Object.assign(first, {
    prompt:
      'Use the read tool to read nonce.txt in your working directory. Remember its exact contents for the next assignment in this session. Return {"ready":true}, without the nonce.',
    context: { mode: 'current', continuityGroup: 'pi-smoke' },
    outputSchema: {
      type: 'object',
      properties: { ready: { const: true } },
      required: ['ready'],
      additionalProperties: false,
    },
  });
  definition.nodes.push({
    id: 'recall',
    kind: 'agent',
    label: 'Recall the session nonce',
    position: { x: 600, y: 160 },
    prompt:
      'Return {"nonce":string} using the exact nonce you read in the previous assignment. Do not use any tools or read any files for this assignment.',
    context: { mode: 'current', continuityGroup: 'pi-smoke' },
    outputSchema: {
      type: 'object',
      properties: { nonce: { type: 'string' } },
      required: ['nonce'],
      additionalProperties: false,
    },
  });
  definition.edges[1].target = 'recall';
  definition.edges.push({ id: 'e3', source: 'recall', target: 'exit' });
  const workflow = engine.create(
    'Pi integration smoke',
    '',
    definitionSchema.parse(definition),
  );
  engine.publish(workflow.id);
  engine.executors.start([piAdapter]);
  const run = engine.start(workflow.id, {}).run;
  const deadline = Date.now() + 180000;
  while (
    !['completed', 'failed', 'cancelled'].includes(engine.run(run.id).status) &&
    Date.now() < deadline
  ) {
    engine.pump();
    await delay(100);
  }
  const result = engine.run(run.id);
  const attempts = engine.store
    .work()
    .flatMap((w) => engine.executors.inspect(w.id).items);
  assert.equal(
    result.status,
    'completed',
    JSON.stringify(
      attempts.map((a) => ({ state: a.state, error: a.error, logs: a.logs })),
      null,
      2,
    ),
  );
  assert.deepEqual(result.output, { nonce });
  assert.equal(attempts.length, 2);
  assert.equal(new Set(attempts.map((a) => a.sessionId)).size, 1);
  console.log(
    JSON.stringify(
      {
        runId: run.id,
        status: result.status,
        assignments: attempts.length,
        model: attempts[0].profile.model,
        sameNativeSession: true,
        readToolUsed: attempts.some((a) =>
          a.logs.some((l) => l.message === 'Using read'),
        ),
        usageReceipts: engine.store
          .list<any>('usageAttempts')
          .filter((u) => u.snapshot).length,
      },
      null,
      2,
    ),
  );
} finally {
  await engine.executors.stop();
  engine.stop();
  engine.store.close();
  await rm(directory, { recursive: true, force: true });
}
