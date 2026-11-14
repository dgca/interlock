import { afterEach, expect, it, vi } from 'vitest';
import { setImmediate as tick } from 'node:timers/promises';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition } from '@interlock/core';
import { appRouter } from '../packages/server/src/router';

const engines: Engine[] = [];
const worker = {
  workerId: 'reviewer',
  tools: [],
  skills: [],
  freshContext: true,
};
afterEach(async () => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  await tick();
});
function setup() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  const w = engine.create('Reviewed', '', blankDefinition());
  engine.publish(w.id);
  return {
    engine,
    w,
    person: appRouter.createCaller({ engine }),
    agent: appRouter.createCaller({ engine, author: 'agent' }),
  };
}
function claim(engine: Engine, workflowId: string) {
  const run = engine.start(workflowId, {}).run;
  const work = engine.available(run.id)[0];
  const claimed = engine.claim(work.id, worker);
  return {
    run,
    workId: work.id,
    token: claimed.token!,
    executionId: work.executionId,
  };
}
const prompt = (text: string) => [
  { op: 'update_node', id: 'agent', set: { prompt: text } },
];
async function settled(person: ReturnType<typeof setup>['person'], id: string) {
  await vi.waitFor(async () =>
    expect((await person.proposals.get({ id })).simulation?.state).toMatch(
      /completed|unavailable/,
    ),
  );
  return person.proposals.get({ id });
}

it('keeps agent proposals behind the workflow setting and applies them only on approval', async () => {
  const { engine, w, person, agent } = setup();
  const c = claim(engine, w.id);
  const input = {
    workId: c.workId,
    token: c.token,
    title: 'Require changelog entries',
    rationale: 'Reviews keep rejecting missing changelog entries.',
    edits: prompt('Add a changelog entry.'),
  };
  await expect(agent.proposals.create(input)).rejects.toThrow(
    'does not accept agent proposals',
  );
  await expect(
    agent.proposals.saveSettings({
      workflowId: w.id,
      settings: { agents: true },
    }),
  ).rejects.toThrow('A person');
  await person.proposals.saveSettings({
    workflowId: w.id,
    settings: { agents: true },
  });
  await expect(
    agent.proposals.create({ ...input, token: 'wrong' }),
  ).rejects.toThrow('Claim is not active');
  const proposal = await agent.proposals.create(input);
  expect(proposal).toMatchObject({
    workflowId: w.id,
    runId: c.run.id,
    executionId: c.executionId,
    sources: [{ runId: c.run.id, executionId: c.executionId }],
    author: { kind: 'agent', workerId: 'reviewer' },
    status: 'open',
  });
  // A claim cannot reach another workflow unless that workflow allows it.
  const other = engine.create('Other', '', blankDefinition());
  await person.proposals.saveSettings({
    workflowId: other.id,
    settings: { agents: true },
  });
  await expect(
    agent.proposals.create({ ...input, workflowId: other.id }),
  ).rejects.toThrow("its own run's workflow");
  expect((await person.proposals.list({ runId: c.run.id })).total).toBe(1);

  const draft = engine.workflow(w.id);
  expect(draft.draft.nodes[1]).not.toHaveProperty(
    'prompt',
    'Add a changelog entry.',
  );
  await expect(
    agent.proposals.decide({ action: 'approve', id: proposal.id }),
  ).rejects.toThrow('A person');
  const edited = prompt('Add a changelog entry for user-visible changes.');
  const { result } = await person.proposals.decide({
    action: 'approve',
    id: proposal.id,
    edits: edited,
  });
  expect(result).toMatchObject({
    applied: true,
    draftRevision: draft.draftRevision + 1,
  });
  const after = engine.workflow(w.id);
  expect(after.draft.nodes.find((n) => n.id === 'agent')).toMatchObject({
    prompt: 'Add a changelog entry for user-visible changes.',
  });
  expect(after.latestVersion).toBe(1);
  expect(
    (await person.proposals.get({ id: proposal.id })).decision,
  ).toMatchObject({
    edited: true,
    draftRevision: after.draftRevision,
  });
});

it('limits agents to the allowed scope, merges duplicates and caps open proposals', async () => {
  const { engine, w, person, agent } = setup();
  await person.proposals.saveSettings({
    workflowId: w.id,
    settings: { agents: true, nodeKinds: ['agent'], fields: ['prompt'] },
  });
  const base = { workflowId: w.id, title: 'Change', rationale: 'Because.' };
  await expect(
    agent.proposals.create({
      ...base,
      edits: [{ op: 'update_node', id: 'agent', set: { label: 'Renamed' } }],
    }),
  ).rejects.toThrow('field label is outside');
  await expect(
    agent.proposals.create({
      ...base,
      edits: [{ op: 'update_node', id: 'exit', set: { prompt: 'x' } }],
    }),
  ).rejects.toThrow('exit nodes');
  await expect(
    agent.proposals.create({
      ...base,
      edits: [{ op: 'remove_node', id: 'agent' }],
    }),
  ).rejects.toThrow('only accepts agent proposals that update prompt');
  // People are not limited by the agent scope.
  await person.proposals.create({
    ...base,
    edits: [{ op: 'update_node', id: 'agent', set: { label: 'Renamed' } }],
  });

  const first = await agent.proposals.create({ ...base, edits: prompt('v1') });
  const again = await agent.proposals.create({
    ...base,
    title: 'Same change, new title',
    edits: prompt('v1'),
  });
  expect(again).toMatchObject({ id: first.id, deduplicated: true });

  const c = claim(engine, w.id);
  for (const text of ['r1', 'r2', 'r3'])
    await agent.proposals.create({
      ...base,
      workId: c.workId,
      token: c.token,
      edits: prompt(text),
    });
  await expect(
    agent.proposals.create({
      ...base,
      workId: c.workId,
      token: c.token,
      edits: prompt('r4'),
    }),
  ).rejects.toThrow('This run already has 3 open proposals');
  for (let i = 0; i < 15; i++)
    await agent.proposals.create({ ...base, edits: prompt(`w${i}`) });
  await expect(
    agent.proposals.create({ ...base, edits: prompt('one too many') }),
  ).rejects.toThrow('already has 20 open proposals');
});

it('never applies a stale proposal silently and re-applies only clean edits', async () => {
  const { engine, w, person } = setup();
  const base = { workflowId: w.id, title: 'Change', rationale: 'Because.' };
  const clean = await person.proposals.create({
    ...base,
    edits: prompt('new'),
  });
  const doomed = await person.proposals.create({
    ...base,
    edits: [{ op: 'update_node', id: 'exit', set: { label: 'Done' } }],
  });
  engine.editDraft(w.id, engine.workflow(w.id).draftRevision, [
    { op: 'remove_node', id: 'exit' },
  ]);
  await expect(
    person.proposals.decide({ action: 'approve', id: clean.id }),
  ).rejects.toThrow('The draft changed');
  expect((await person.proposals.get({ id: clean.id })).conflict.state).toBe(
    'reapplicable',
  );
  const conflicting = await person.proposals.get({ id: doomed.id });
  expect(conflicting.conflict.state).toBe('conflicting');
  await expect(
    person.proposals.decide({ action: 'reapply', id: doomed.id }),
  ).rejects.toThrow('Ask for a new proposal');

  await person.proposals.decide({ action: 'reapply', id: clean.id });
  const { result } = await person.proposals.decide({
    action: 'approve',
    id: clean.id,
  });
  expect(result?.applied).toBe(true);
  await person.proposals.decide({
    action: 'reject',
    id: doomed.id,
    reason: 'Exit is gone.',
  });
  expect(
    (await person.proposals.list({ workflowId: w.id, status: 'open' })).total,
  ).toBe(0);
});

it('treats Script content from an approved proposal as agent-written', async () => {
  const { engine, w, person } = setup();
  await person.scripts.saveSettings({ mode: 'imports_and_agents' });
  const command = 'console.log(JSON.stringify({ ok: true }))';
  const proposal = await person.proposals.create({
    workflowId: w.id,
    title: 'Add a check',
    rationale: 'Catch missing entries early.',
    edits: [
      {
        op: 'add_node',
        node: {
          id: 'check',
          kind: 'script',
          label: 'Check',
          command,
          position: { x: 0, y: 0 },
        },
      },
    ],
  });
  await person.proposals.decide({ action: 'approve', id: proposal.id });
  expect(
    engine.scriptApprovals.required(w.id, { language: 'javascript', command }),
  ).toBeTruthy();
});

it('attaches a fixture simulation of the draft with and without the proposal', async () => {
  const { engine, w, person } = setup();
  const before = await person.proposals.create({
    workflowId: w.id,
    title: 'No suite yet',
    rationale: 'Because.',
    edits: prompt('x'),
  });
  expect((await settled(person, before.id)).simulation).toMatchObject({
    state: 'unavailable',
    reason: 'This workflow has no saved test suite.',
  });
  engine.testbench.createSuite({
    workflowId: w.id,
    content: {
      name: 'Fixtures',
      cases: [
        {
          id: 'ok',
          name: 'Returns ok',
          input: {},
          fixtures: [{ nodeId: 'agent', kind: 'agent', output: { ok: true } }],
          assertions: [
            { kind: 'output', path: 'ok', operator: 'equals', expected: true },
          ],
        },
      ],
    },
  });
  const proposal = await person.proposals.create({
    workflowId: w.id,
    title: 'Require a score',
    rationale: 'Downstream needs a score.',
    edits: [
      {
        op: 'update_node',
        id: 'agent',
        set: {
          outputSchema: {
            type: 'object',
            required: ['score'],
            properties: { score: { type: 'number' } },
          },
        },
      },
    ],
  });
  const view = await settled(person, proposal.id);
  expect(view.simulation).toMatchObject({
    state: 'completed',
    draftRevision: engine.workflow(w.id).draftRevision,
    cases: [{ caseId: 'ok', before: 'passed', after: 'failed' }],
    coverage: { before: { coveredEdges: 2, totalEdges: 2 } },
  });
  // Proposal simulations leave no stored simulation records and no draft change.
  expect(engine.store.list('workflowSimulations')).toEqual([]);
  expect(engine.workflow(w.id).draftRevision).toBe(proposal.baseDraftRevision);
});
