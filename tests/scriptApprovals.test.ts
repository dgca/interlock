import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  scheduleConfigSchema,
} from '@interlock/core';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { appRouter } from '../packages/server/src/router';

const engines: Engine[] = [];
const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  const dir = mkdtempSync(join(tmpdir(), 'interlock-approval-'));
  dirs.push(dir);
  return {
    engine,
    marker: join(dir, 'ran'),
    person: appRouter.createCaller({ engine }),
    agent: appRouter.createCaller({ engine, author: 'agent' }),
  };
}
// The Script appends to a marker file so a test can prove it never started.
const writes = (result = '42') =>
  `const fs = await import('node:fs'); fs.appendFileSync(input.marker, 'ran'); return ${result};`;
function scriptDefinition(command = writes()) {
  const blank = blankDefinition();
  return definitionSchema.parse({
    ...blank,
    nodes: blank.nodes.map((node) =>
      node.kind === 'agent'
        ? {
            id: node.id,
            kind: 'script',
            label: 'Write marker',
            language: 'javascript',
            command,
            position: node.position,
          }
        : node,
    ),
  });
}
/** Import a bundle authored elsewhere, as a person does with a shared file. */
function imported(engine: Engine, definitions = [scriptDefinition()]) {
  const source = new Engine(new Store(':memory:'), process.cwd());
  engines.push(source);
  const w = source.create('Shared', '', definitions[0]);
  for (const definition of definitions) {
    source.update(w.id, {
      draft: definition,
      draftRevision: source.workflow(w.id).draftRevision,
    });
    source.publish(w.id);
  }
  importWorkflows(engine.store, exportWorkflows(source.store, w.id));
  return w.id;
}
const latest = (engine: Engine, id: string) =>
  engine.run(id).executions.at(-1)!;

it('holds an imported Script until a person approves its code, then runs it', async () => {
  const { engine, marker, person, agent } = setup();
  const workflowId = imported(engine);
  const run = engine.start(workflowId, { marker }).run;
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('waiting'));
  expect(existsSync(marker)).toBe(false);
  expect(engine.projectRun(run.id).waiting).toMatchObject({
    kind: 'human_request',
  });
  const [request] = engine.requests.current();
  expect(request).toMatchObject({ reason: 'approval' });
  const detail = await person.requests.get(request.target);
  expect(detail).toMatchObject({
    kind: 'scriptApproval',
    state: 'open',
    script: { language: 'javascript', command: writes() },
  });
  const target = { runId: run.id, executionId: latest(engine, run.id).id };
  await expect(agent.scripts.approve(target)).rejects.toThrow('A person');
  await person.scripts.approve(target);
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));
  expect(readFileSync(marker, 'utf8')).toBe('ran');
  expect(await person.requests.get(request.target)).toMatchObject({
    state: 'accepted',
  });
  // Approval is one-time: later runs of the same code start without a hold.
  const again = engine.start(workflowId, { marker }).run;
  await vi.waitFor(() => expect(engine.run(again.id).status).toBe('completed'));
});

it('holds an imported polling check before it runs', async () => {
  const { engine, marker } = setup();
  const blank = blankDefinition();
  const definition = definitionSchema.parse({
    ...blank,
    nodes: blank.nodes.map((node) =>
      node.kind === 'agent'
        ? {
            id: node.id,
            kind: 'wait',
            label: 'Poll marker',
            position: node.position,
            timing: {
              kind: 'poll',
              everyMs: 1000,
              check: {
                kind: 'script',
                language: 'javascript',
                command: writes('{ ready: true }'),
              },
              path: 'ready',
              equals: true,
            },
          }
        : node,
    ),
  });
  const run = engine.start(imported(engine, [definition]), { marker }).run;
  await vi.waitFor(() =>
    expect(latest(engine, run.id).scriptApproval).toBeDefined(),
  );
  expect(existsSync(marker)).toBe(false);
});

it('does not rerun unapproved imported code when a failed run is retried', async () => {
  const { engine, marker, person } = setup();
  await person.scripts.saveSettings({ mode: 'off' });
  const workflowId = imported(engine, [scriptDefinition(writes('missing'))]);
  const run = engine.start(workflowId, { marker }).run;
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('failed'));
  await person.scripts.saveSettings({ mode: 'imports' });
  engine.retry(run.id);
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('waiting'));
  expect(readFileSync(marker, 'utf8')).toBe('ran');
});

it('holds Scripts in runs that a schedule starts', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-11-13T12:00:00.000Z');
  const { engine, marker } = setup();
  const workflowId = imported(engine);
  const created = engine.triggers.mutate({
    action: 'create',
    workflowId,
    config: scheduleConfigSchema.parse({
      name: 'Every minute',
      timing: { type: 'interval', intervalMs: 60_000 },
      input: { marker },
    }),
  }).trigger!;
  engine.triggers.mutate({
    action: 'enable',
    id: created.id,
    expectedRevision: created.revision,
  });
  vi.setSystemTime('2026-11-13T12:01:00.000Z');
  engine.pump();
  const [run] = engine.store.runs();
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('waiting'));
  expect(latest(engine, run.id).scriptApproval).toBeDefined();
  expect(existsSync(marker)).toBe(false);
});

it('holds Scripts in comparison samples', async () => {
  const { engine, marker } = setup();
  const workflowId = imported(engine, [
    scriptDefinition(),
    scriptDefinition(writes('43')),
  ]);
  const suite = engine.testbench.createSuite({
    workflowId,
    content: {
      name: 'Checks',
      cases: [{ id: 'case', name: 'Case', input: { marker }, assertions: [] }],
    },
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: 1,
    candidateVersion: 2,
    repetitions: 1,
    concurrency: 2,
  };
  engine.testbench.start({
    ...selection,
    confirmation: engine.testbench.preview(selection).confirmation,
    requestId: 'compare-imported',
  });
  engine.pump();
  await vi.waitFor(() =>
    expect(engine.store.waitingScriptApprovals()).toHaveLength(2),
  );
  expect(existsSync(marker)).toBe(false);
});

it('gates agent-authored Scripts only when the library extends approval to agents', async () => {
  const { engine, marker, person, agent } = setup();
  const created = await agent.workflows.create({
    name: 'Agent',
    definition: scriptDefinition(),
  });
  engine.publish(created.id);
  const first = engine.start(created.id, { marker }).run;
  await vi.waitFor(() => expect(engine.run(first.id).status).toBe('completed'));

  await expect(
    agent.scripts.saveSettings({ mode: 'imports_and_agents' }),
  ).rejects.toThrow('A person');
  await person.scripts.saveSettings({ mode: 'imports_and_agents' });
  await agent.workflows.update({
    id: created.id,
    draft: scriptDefinition(writes('7')),
    draftRevision: engine.workflow(created.id).draftRevision,
  });
  engine.publish(created.id);
  const second = engine.start(created.id, { marker }).run;
  await vi.waitFor(() => expect(engine.run(second.id).status).toBe('waiting'));
  // A person's edit of the same workflow is not gated.
  await person.workflows.update({
    id: created.id,
    draft: scriptDefinition(writes('8')),
    draftRevision: engine.workflow(created.id).draftRevision,
  });
  engine.publish(created.id);
  const third = engine.start(created.id, { marker }).run;
  await vi.waitFor(() => expect(engine.run(third.id).status).toBe('completed'));
});

it('keeps imported Script content held in a duplicated workflow', async () => {
  const { engine, marker, person } = setup();
  const copy = await person.workflows.clone({ id: imported(engine) });
  engine.publish(copy.id);
  const run = engine.start(copy.id, { marker }).run;
  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('waiting'));
  expect(existsSync(marker)).toBe(false);
});
