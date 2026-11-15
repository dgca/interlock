// Opt-in live check of Interlock's own tools in a managed session:
//   pnpm exec tsx scripts/managed-tools-smoke.ts <claude-code|codex|pi> [model]
// It makes real model calls and needs the owner's approval to run. It uses a
// temporary database and working directory, never your Interlock data.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  blankDefinition,
  definitionSchema,
  nodeSchema,
  type MemoryNote,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { claudeAdapter } from '../packages/runtime/src/executors/claude.js';
import { codexAdapter } from '../packages/runtime/src/executors/codex.js';
import { piAdapter } from '../packages/runtime/src/executors/pi.js';

const adapters = {
  'claude-code': claudeAdapter,
  codex: codexAdapter,
  pi: piAdapter,
};
const harness = process.argv[2] as keyof typeof adapters;
if (!adapters[harness])
  throw new Error(
    'Usage: managed-tools-smoke.ts <claude-code|codex|pi> [model]',
  );
const directory = await mkdtemp(join(tmpdir(), 'interlock-tools-smoke-'));
const engine = new Engine(
  new Store(join(directory, 'smoke.sqlite')),
  directory,
);
const nonce = randomUUID();

/** One Agent step with the given prompt and result contract. */
function agentWorkflow(prompt: string, result: string): WorkflowDefinition {
  const d = blankDefinition();
  d.executor = harness;
  const agent = d.nodes.find((n) => n.kind === 'agent')!;
  Object.assign(agent, {
    prompt,
    outputSchema: {
      type: 'object',
      properties: { [result]: { type: 'string' } },
      required: [result],
      additionalProperties: false,
    },
  });
  return d;
}
async function finish(runId: string) {
  const deadline = Date.now() + 300_000;
  while (
    !['completed', 'failed', 'cancelled'].includes(engine.run(runId).status) &&
    Date.now() < deadline
  ) {
    engine.pump();
    await delay(100);
  }
  const run = engine.run(runId);
  const attempts = engine.store
    .work()
    .filter((w) => w.runId === runId)
    .flatMap((w) => engine.executors.inspect(w.id).items);
  assert.equal(
    run.status,
    'completed',
    JSON.stringify(
      attempts.map((a) => ({
        state: a.state,
        error: a.error,
        interlockTools: a.interlockTools,
        logs: a.logs,
      })),
      null,
      2,
    ),
  );
  return { run, attempts };
}

try {
  engine.executors.saveProfile({
    id: harness,
    harness,
    name: `${harness} tools smoke`,
    enabled: true,
    expectedRevision: 0,
    cwd: directory,
    permissions: 'standard',
    ...(process.argv[3] ? { model: process.argv[3] } : {}),
  });
  engine.executors.start([adapters[harness]]);

  // 1. Memory: the first run saves a note, a person approves it, and the next
  // run of the same workflow receives it in its prompt.
  const memory = engine.create(
    'Managed memory smoke',
    '',
    definitionSchema.parse(
      agentWorkflow(
        `If the Memory section of this prompt holds a smoke code, return {"code":string} with that code and save nothing. Otherwise save this exact fact with your Interlock tool whose name ends in save_memory_note, scope workflow: "The smoke code is ${nonce}", and return {"code":"saved"}.`,
        'code',
      ),
    ),
  );
  engine.publish(memory.id);
  engine.memory.manage({
    action: 'configure',
    workflowId: memory.id,
    enabled: true,
  });
  const saving = await finish(engine.start(memory.id, {}).run.id);
  assert.deepEqual(saving.run.output, { code: 'saved' });
  const notes = engine.memory.list(memory.id).notes as MemoryNote[];
  const note = notes.find((n) => n.content.includes(nonce));
  assert.ok(note, `No note was saved: ${JSON.stringify(notes)}`);
  assert.equal(note.status, 'pending');
  engine.memory.manage({
    action: 'approve',
    noteId: note.id,
    revision: note.revision,
  });
  const recalled = await finish(engine.start(memory.id, {}).run.id);
  assert.deepEqual(recalled.run.output, { code: nonce });

  // 2. Tool call: the Agent calls a Script attached as a tool.
  const tools = agentWorkflow(
    'Call the make_token workflow tool with your Interlock tool whose name ends in call_workflow_tool, arguments {"value":"smoke"}. Return {"token":string} with the token it returns.',
    'token',
  );
  tools.nodes.push(
    nodeSchema.parse({
      id: 'token',
      kind: 'script',
      label: 'Make token',
      language: 'javascript',
      command: `return { token: input.value + "-${nonce}" }`,
      timeoutMs: 5000,
      inputSchema: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
    }),
  );
  tools.edges.push({
    id: 'tool',
    source: 'agent',
    target: 'token',
    port: 'default',
    kind: 'tool',
  });
  const toolWorkflow = engine.create(
    'Managed tool smoke',
    '',
    definitionSchema.parse(tools),
  );
  engine.publish(toolWorkflow.id);
  const calling = await finish(engine.start(toolWorkflow.id, {}).run.id);
  assert.deepEqual(calling.run.output, { token: `smoke-${nonce}` });

  console.log(
    JSON.stringify(
      {
        harness,
        model: saving.attempts[0]?.profile.model,
        noteSaved: true,
        laterRunReceivedNote: true,
        toolCallOutput: calling.run.output,
        interlockTools: [saving, calling].map(
          (r) => r.attempts[0]?.interlockTools,
        ),
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
