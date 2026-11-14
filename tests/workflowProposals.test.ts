import { afterEach, expect, it, vi } from 'vitest';
import { setImmediate as tick } from 'node:timers/promises';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition } from '@interlock/core';
import { wideningChanges } from '@interlock/core/proposals';
import { appRouter } from '../packages/server/src/router';

const engines: Engine[] = [];
const worker = {
  workerId: 'reviewer',
  tools: [],
  skills: [],
  freshContext: true,
};
afterEach(async () => {
  vi.restoreAllMocks();
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
  const base = { workflowId: w.id, title: 'Change', rationale: 'Because.' };
  const settings = { agents: true, nodeKinds: ['agent' as const] };
  await person.proposals.saveSettings({ workflowId: w.id, settings });
  // Without a claim on one of its runs, the workflow must allow it.
  await expect(
    agent.proposals.create({ ...base, edits: prompt('x') }),
  ).rejects.toThrow('Propose during a claim');
  const c = claim(engine, w.id);
  const claimed = { ...base, workId: c.workId, token: c.token };
  // Moving a route onto a kind outside the list is refused like adding one.
  await expect(
    agent.proposals.create({
      ...claimed,
      edits: [{ op: 'update_edge', id: 'e2', set: { target: 'entry' } }],
    }),
  ).rejects.toThrow('route endpoint is outside');
  await expect(
    agent.proposals.create({
      ...claimed,
      edits: [
        { op: 'update_settings', set: { agentPermissions: 'full-access' } },
      ],
    }),
  ).rejects.toThrow('workflow settings');
  await person.proposals.saveSettings({
    workflowId: w.id,
    settings: { ...settings, fields: ['prompt'], otherWorkflows: true },
  });
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
    edits: [
      { op: 'update_node', id: 'agent', set: { prompt: 'v1' }, unset: [] },
    ],
  });
  expect(again).toMatchObject({ id: first.id, deduplicated: true });
  for (const text of ['c1', 'c2', 'c3', 'c4'])
    await agent.proposals.create({ ...base, edits: prompt(text) });
  await expect(
    agent.proposals.create({ ...base, edits: prompt('c5') }),
  ).rejects.toThrow('5 open agent proposals made without a claim');

  for (const text of ['r1', 'r2', 'r3'])
    await agent.proposals.create({ ...claimed, edits: prompt(text) });
  await expect(
    agent.proposals.create({ ...claimed, edits: prompt('r4') }),
  ).rejects.toThrow('This run already has 3 open proposals');
  // 1 person + 5 claimless + 3 above; 11 more across new runs reach 20.
  for (let i = 0; i < 11; i++) {
    const next = i % 3 === 0 ? claim(engine, w.id) : undefined;
    if (next)
      Object.assign(claimed, { workId: next.workId, token: next.token });
    await agent.proposals.create({ ...claimed, edits: prompt(`w${i}`) });
  }
  await expect(
    agent.proposals.create({ ...claimed, edits: prompt('one too many') }),
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

it('replaces a simulation that was running when the proposal was re-applied', async () => {
  const { engine, w, person } = setup();
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
          assertions: [],
        },
      ],
    },
  });
  // Hold the first case until the draft has changed and been re-applied.
  const simulate = engine.simulations.simulateDefinition.bind(
    engine.simulations,
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  vi.spyOn(engine.simulations, 'simulateDefinition').mockImplementationOnce(
    async (...args) => {
      await held;
      return simulate(...args);
    },
  );
  const proposal = await person.proposals.create({
    workflowId: w.id,
    title: 'Change',
    rationale: 'Because.',
    edits: prompt('x'),
  });
  await vi.waitFor(async () =>
    expect(
      (await person.proposals.get({ id: proposal.id })).simulation?.state,
    ).toBe('running'),
  );
  engine.editDraft(w.id, proposal.baseDraftRevision, [
    { op: 'update_node', id: 'agent', set: { label: 'Renamed' } },
  ]);
  await person.proposals.decide({ action: 'reapply', id: proposal.id });
  const revision = engine.workflow(w.id).draftRevision;
  release();
  await vi.waitFor(async () =>
    expect(
      (await person.proposals.get({ id: proposal.id })).simulation,
    ).toMatchObject({
      state: 'completed',
      draftRevision: revision,
    }),
  );
});

it('treats a tool edge like other routes in the agent scope and calls it out', async () => {
  const { engine, w, person, agent } = setup();
  engine.editDraft(w.id, engine.workflow(w.id).draftRevision, [
    {
      op: 'add_node',
      node: {
        id: 'lookup',
        kind: 'script',
        label: 'Lookup',
        command: 'console.log("{}")',
        position: { x: 0, y: 300 },
      },
    },
  ]);
  await person.proposals.saveSettings({
    workflowId: w.id,
    settings: { agents: true, nodeKinds: ['agent'], otherWorkflows: true },
  });
  const tool = {
    op: 'add_edge',
    edge: { id: 't1', source: 'agent', target: 'lookup', kind: 'tool' },
  };
  const base = {
    workflowId: w.id,
    title: 'Offer lookup',
    rationale: 'Faster.',
  };
  await expect(
    agent.proposals.create({ ...base, edits: [tool] }),
  ).rejects.toThrow('route endpoint is outside');
  const proposal = await person.proposals.create({ ...base, edits: [tool] });
  const view = await person.proposals.get({ id: proposal.id });
  if (!('proposed' in view) || !view.proposed || !view.draft)
    throw new Error('No draft');
  expect(wideningChanges(view.draft, view.proposed)).toMatchObject([
    { subject: 'Route t1', reason: 'Agent tool' },
  ]);
});
