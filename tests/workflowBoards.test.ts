import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  boardQuerySchema,
  boardSettingsRevisionConflict,
  definitionSchema,
  nodeSchema,
  requestListSchema,
  type HumanResponse,
  type RequestTarget,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { appRouter } from '../packages/server/src/router';
import { parallelDefinition } from './fixtures/parallel';
import { workflowCall } from './fixtures/detached';

const engines = new Set<Engine>();
const dirs: string[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'interlock-boards-'));
  dirs.push(path);
  return path;
}
function open(path = ':memory:', now = Date.now) {
  const engine = new Engine(new Store(path), process.cwd(), { clock: { now } });
  engines.add(engine);
  return engine;
}
function close(engine: Engine) {
  engine.stop();
  engine.store.close();
  engines.delete(engine);
}
afterEach(() => {
  for (const engine of engines) close(engine);
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function publish(
  engine: Engine,
  definition: WorkflowDefinition,
  name = 'SDLC',
) {
  const workflow = engine.create(name, '', definition);
  engine.publish(workflow.id);
  return workflow;
}
function createBoard(engine: Engine, name = 'Coding') {
  return engine.boards.save({
    name,
    columns: [{ name: 'Build' }, { name: 'Review' }],
    workflowIds: [],
  });
}
function assign(
  engine: Engine,
  workflowId: string,
  boardId: string | null,
  expectedBoardId: string | null = null,
) {
  return engine.boards.assign({ workflowId, boardId, expectedBoardId });
}
function read(
  engine: Engine,
  id: string,
  args: Partial<ReturnType<typeof boardQuerySchema.parse>> = {},
) {
  return engine.boards.read(boardQuerySchema.parse({ id, ...args }));
}
function humanTarget(
  target: RequestTarget,
): Extract<RequestTarget, { kind: 'human' }> {
  if (target.kind !== 'human') throw new Error('Expected Human input');
  return target;
}
function review(columnId?: string) {
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'input',
    label: 'Plan review',
    ...(columnId ? { boardColumnId: columnId, stage: 'Review' } : {}),
    humanInput: {
      question: 'Can implementation proceed?',
      evidence: {
        title: 'Implementation plan',
        contentPath: 'plan',
        revisionPath: 'revision',
      },
      answer: {
        kind: 'choice',
        choices: [
          { label: 'Approve', value: 'approve' },
          { label: 'Request changes', value: 'change', requireComment: true },
        ],
      },
    },
  });
  return definition;
}
function approve(
  target: RequestTarget,
  submissionId: string,
): Extract<HumanResponse, { action: 'answer' }> {
  return {
    action: 'answer',
    target: humanTarget(target),
    value: { choice: 'approve' },
    expectedRevision: 0,
    submissionId,
  };
}

it('rejects a stale board settings write through the shared API and accepts the current revision', async () => {
  const engine = open();
  const board = createBoard(engine);
  const first = appRouter.createCaller({ engine });
  const second = appRouter.createCaller({ engine });
  const input = {
    id: board.id,
    name: 'Other editor',
    columns: board.columns,
    workflowIds: [],
  };
  const original = await first.boards.settings({ id: board.id });
  const saved = await second.boards.save({
    ...input,
    expectedRevision: original.revision,
  });
  await expect(
    first.boards.save({ ...input, expectedRevision: original.revision }),
  ).rejects.toThrow(boardSettingsRevisionConflict);
  const latest = await first.boards.settings({ id: board.id });
  expect(latest.revision).toBe(saved.revision);
  await expect(
    first.boards.save({
      ...input,
      name: 'Reopened editor',
      expectedRevision: latest.revision,
    }),
  ).resolves.toMatchObject({ name: 'Reopened editor' });
});

it('persists board settings, bound entry order, live membership and explicit titles across restart', async () => {
  const path = join(directory(), 'test.db');
  let engine = open(path);
  const board = createBoard(engine);
  const other = createBoard(engine, 'Operations');
  const definition = review(board.columns[1].id);
  definition.nodes[0].boardColumnId = board.columns[0].id;
  const workflow = publish(engine, definition);
  const custom = publish(engine, review(), 'Custom stage');
  const draft = engine.workflow(custom.id).draft;
  draft.nodes[1].stage = 'Review';
  engine.update(custom.id, {
    draft,
    draftRevision: engine.workflow(custom.id).draftRevision,
  });
  engine.publish(custom.id);
  const firstRevision = engine.boards.settings(board.id).revision;
  const configured = engine.boards.save({
    id: board.id,
    expectedRevision: firstRevision,
    name: 'Coding',
    columns: [{ id: board.columns[1].id, name: 'Approval' }, board.columns[0]],
    workflowIds: [workflow.id, custom.id],
  });
  expect(configured.columns[0].id).toBe(board.columns[1].id);
  expect(engine.workflow(workflow.id).draftRevision).toBe(
    workflow.draftRevision,
  );
  const input = { plan: 'Initial migration', revision: 'Revision 1' };
  const run = engine.start(workflow.id, input, undefined, undefined, {
    title: 'Implement x feature',
    requestId: 'explicit-title',
    externalTask: {
      system: 'GitHub',
      id: '481',
      title: 'Original issue',
      url: 'https://example.com/481',
    },
  }).run;
  const customRun = engine.start(custom.id, input).run;
  expect(
    read(engine, board.id).columns.map((column) => [
      column.name,
      column.cards.map((card) => card.id),
    ]),
  ).toEqual([
    ['Unstaged', [customRun.id]],
    ['Approval', [run.id]],
    ['Build', []],
  ]);
  expect(() =>
    engine.boards.save({
      id: board.id,
      expectedRevision: configured.revision,
      name: 'Invalid',
      columns: [board.columns[0]],
      workflowIds: [],
    }),
  ).toThrow(/Columns still used/);
  expect(engine.workflow(workflow.id).boardId).toBe(board.id);
  const request = engine.requests
    .current()
    .find((item) => item.cardId === run.id)!;
  engine.externalInputs.answer(approve(request.target, 'accept'), 'mcp');
  expect(() =>
    engine.start(workflow.id, input, undefined, undefined, {
      title: 'Changed title',
      requestId: 'explicit-title',
      externalTask: run.externalTask,
    }),
  ).toThrow(/different arguments/);

  close(engine);
  engine = open(path);
  const api = appRouter.createCaller({ engine });
  expect(
    (await api.runs.summaries({ tab: 'history', workflowId: workflow.id }))
      .items[0],
  ).toMatchObject({
    title: 'Implement x feature',
    workflowName: 'SDLC',
    externalTask: run.externalTask,
  });
  expect(
    read(engine, board.id, { status: 'completed' }).columns[0],
  ).toMatchObject({
    name: 'Approval',
    cards: [{ id: run.id, status: 'completed' }],
  });
  assign(engine, workflow.id, other.id, board.id);
  expect(
    read(engine, board.id)
      .columns.flatMap((column) => column.cards)
      .map((card) => card.id),
  ).toEqual([customRun.id]);
  expect(read(engine, other.id).columns[0]).toMatchObject({
    name: 'Unstaged',
    cards: [{ id: run.id }],
  });
  expect(engine.requests.get(request.target)).toMatchObject({
    state: 'accepted',
    source: 'mcp',
  });
});

it('retains captured content and held answers across restart and requires explicit acceptance', () => {
  const dir = directory();
  const db = join(dir, 'test.db');
  const file = join(dir, 'review.md');
  writeFileSync(file, 'Original migration');
  let engine = open(db);
  const workflow = publish(engine, review());
  const run = engine.start(workflow.id, {
    plan: readFileSync(file, 'utf8'),
    revision: 'Revision 3',
  }).run;
  const target = humanTarget(engine.requests.current()[0].target);
  writeFileSync(file, 'Changed after review opened');
  const answer = approve(target, 'held-answer');
  engine.externalInputs.mutate({
    action: 'hold',
    runId: run.id,
    expectedRevision: 0,
  });
  expect(engine.externalInputs.answer(answer, 'mcp')).not.toHaveProperty(
    'acceptedAt',
  );

  close(engine);
  engine = open(db);
  expect(engine.requests.get(target)).toMatchObject({
    state: 'saved',
    value: { choice: 'approve' },
    actions: ['release_hold'],
    evidence: { content: 'Original migration', revision: 'Revision 3' },
  });
  expect(engine.requests.current()).toHaveLength(1);
  expect(
    JSON.stringify(engine.continuation.briefing({ id: run.id, limit: 10 })),
  ).not.toContain('Original migration');
  engine.externalInputs.mutate({
    action: 'release',
    runId: run.id,
    expectedRevision: 1,
  });
  expect(engine.externalInputs.answer(answer, 'mcp')).not.toHaveProperty(
    'acceptedAt',
  );
  expect(engine.run(run.id).status).toBe('waiting');
  expect(engine.requests.get(target).actions).toEqual(['accept']);
  const acceptance = engine.externalInputs.answer(
    { action: 'accept', target, expectedRevision: 1 },
    'ui',
  );
  expect(acceptance).toHaveProperty('acceptedAt');
  expect(engine.externalInputs.answer(answer, 'mcp')).toEqual(acceptance);
  expect(engine.run(run.id).output).toEqual({ choice: 'approve' });
  expect(engine.requests.current()).toEqual([]);
});

it('keeps exact parallel requests separate while work progresses and rejects racing answers', async () => {
  const engine = open();
  const board = createBoard(engine);
  const emptyBoard = createBoard(engine, 'Operations');
  const definition = parallelDefinition({
    keys: ['plan', 'rollout', 'work'],
    concurrency: 3,
  });
  definition.nodes[2] = nodeSchema.parse({
    ...review(board.columns[1].id).nodes[1],
    id: 'r0',
    parallelId: 'parallel',
    parallelBranchId: 'r0',
  });
  definition.nodes[3] = nodeSchema.parse({
    id: 'r1',
    parallelId: 'parallel',
    parallelBranchId: 'r1',
    kind: 'input',
    label: 'Rollout target',
    humanInput: { question: 'Which environment?', answer: { kind: 'text' } },
  });
  const planScope = { parallelId: 'parallel', parallelBranchId: 'r0' };
  definition.nodes.push(
    nodeSchema.parse({
      id: 'route-plan',
      kind: 'switch',
      label: 'Plan decision',
      path: 'choice',
      cases: [{ port: 'revise', equals: 'change' }],
      default: 'approved',
      ...planScope,
    }),
    nodeSchema.parse({
      id: 'revise-plan',
      kind: 'agent',
      label: 'Revise plan',
      prompt: 'Update the plan.',
      boardColumnId: board.columns[0].id,
      ...planScope,
    }),
  );
  const firstJoin = definition.edges.find((edge) => edge.id === 'join-r0')!;
  Object.assign(firstJoin, { target: 'route-plan', targetHandle: 'default' });
  definition.edges.push(
    {
      id: 'revise',
      source: 'route-plan',
      target: 'revise-plan',
      port: 'revise',
    },
    {
      id: 'approved',
      source: 'route-plan',
      target: 'parallel',
      targetHandle: 'join',
      port: 'approved',
    },
    {
      id: 'revised',
      source: 'revise-plan',
      target: 'parallel',
      targetHandle: 'join',
      port: 'default',
    },
  );
  const workflow = publish(engine, definition);
  assign(engine, workflow.id, board.id);
  const root = engine.start(workflow.id, {
    plan: 'Review me',
    revision: 'Revision 3',
  }).run;
  const request = engine.requests.list(
    requestListSchema.parse({ boardId: board.id, runId: root.id, limit: 1 }),
  );
  expect(request).toMatchObject({ total: 2, nextOffset: 1 });
  const plan = humanTarget(request.items[0].target);
  const rollout = humanTarget(
    engine.requests.list(requestListSchema.parse({ runId: root.id, offset: 1 }))
      .items[0].target,
  );
  expect(plan.runId).not.toBe(rollout.runId);
  const worker = engine
    .available(root.id)
    .find((work) => work.nodeId === 'r2')!;
  const claimed = engine.claim(worker.id, {
    workerId: 'test',
    freshContext: false,
    skills: [],
    tools: [],
  });
  const card = read(engine, board.id, { status: 'attention' }).columns[1]
    .cards[0];
  expect(card).toMatchObject({ id: root.id, attentionCount: 2, request: plan });
  expect(card.actor).toBe('agent');
  const api = appRouter.createCaller({ engine });
  expect(await api.boards.list()).toEqual(
    expect.arrayContaining([
      { ...board, revision: 2, workflowIds: [workflow.id], attentionCount: 2 },
      { ...emptyBoard, workflowIds: [], attentionCount: 0 },
    ]),
  );
  const requestChanges = {
    ...approve(plan, 'first'),
    value: { choice: 'change', comment: 'Add rollback details' },
  };
  await expect(
    api.requests.answer({
      request: { ...requestChanges, value: { choice: 'change' } },
    }),
  ).rejects.toThrow(/requires a comment/);
  const outcomes = await Promise.allSettled([
    api.requests.answer({ request: requestChanges, source: 'ui' }),
    api.requests.answer({ request: approve(plan, 'other'), source: 'mcp' }),
  ]);
  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    'fulfilled',
    'rejected',
  ]);
  expect(engine.requests.current().map((item) => item.target)).toEqual([
    rollout,
  ]);
  expect(await api.boards.list()).toContainEqual(
    expect.objectContaining({ id: board.id, attentionCount: 1 }),
  );
  expect(engine.requests.get(plan)).toMatchObject({
    state: 'accepted',
    value: requestChanges.value,
  });
  expect(
    read(engine, board.id, { status: 'attention' }).columns[0].cards[0],
  ).toMatchObject({
    id: root.id,
    request: rollout,
    attentionCount: 1,
  });
  engine.submit(claimed.id, claimed.token!, { shipped: true });
  const revise = engine
    .available(root.id)
    .find((work) => work.nodeId === 'revise-plan')!;
  const revision = engine.claim(revise.id, {
    workerId: 'test',
    freshContext: false,
    skills: [],
    tools: [],
  });
  engine.submit(revision.id, revision.token!, { revised: true });
  await api.requests.answer({
    request: { ...approve(rollout, 'rollout'), value: 'Staging' },
    source: 'mcp',
  });
  expect(engine.run(root.id).status).toBe('completed');
  expect(await api.boards.list()).toContainEqual(
    expect.objectContaining({ id: board.id, attentionCount: 0 }),
  );
  expect(
    read(engine, board.id, { status: 'attention' }).columns.every(
      (column) => !column.total,
    ),
  ).toBe(true);
  expect(
    read(engine, board.id, { status: 'completed' }).columns[0].cards[0],
  ).toMatchObject({ id: root.id });
});

it('records loop visits independently and rejects an answer for a cancelled or completed visit', () => {
  const engine = open();
  const board = createBoard(engine);
  const definition = review(board.columns[1].id);
  definition.nodes[1] = nodeSchema.parse({
    ...definition.nodes[1],
    inputBindings: {
      plan: { source: 'input', path: 'plan', default: 'Revised plan' },
      revision: { source: 'input', path: 'revision', default: 'Revision 2' },
    },
  });
  definition.nodes.push(
    nodeSchema.parse({
      id: 'decision',
      kind: 'switch',
      label: 'Decision',
      path: 'choice',
      cases: [{ equals: 'change', port: 'revise' }],
      default: 'approve',
    }),
    nodeSchema.parse({
      id: 'build',
      kind: 'wait',
      label: 'Revise plan',
      stage: 'Build',
      boardColumnId: board.columns[0].id,
      timing: { kind: 'duration', ms: 0 },
    }),
  );
  definition.edges[1].target = 'decision';
  definition.edges.push(
    { id: 'revise', source: 'decision', target: 'build', port: 'revise' },
    { id: 'approve', source: 'decision', target: 'exit', port: 'approve' },
    { id: 'return', source: 'build', target: 'agent', port: 'default' },
  );
  const workflow = publish(engine, definition);
  assign(engine, workflow.id, board.id);
  const run = engine.start(workflow.id, {
    plan: 'First plan',
    revision: 'Revision 1',
  }).run;
  const first = humanTarget(engine.requests.current()[0].target);
  engine.externalInputs.answer(
    {
      ...approve(first, 'changes'),
      value: { choice: 'change', comment: 'Describe rollback' },
    },
    'ui',
  );
  const next = humanTarget(engine.requests.current()[0].target);
  expect(next.executionId).not.toBe(first.executionId);
  expect(engine.requests.get(next)).toMatchObject({
    evidence: { content: 'Revised plan', revision: 'Revision 2' },
  });
  expect(engine.requests.get(first)).toMatchObject({
    state: 'accepted',
    evidence: { content: 'First plan' },
  });
  expect(() =>
    engine.externalInputs.answer(approve(first, 'stale'), 'mcp'),
  ).toThrow(/no longer waiting/);
  const entries = engine
    .inspect(run.id)
    .events.filter((event) => event.boardColumnId);
  expect(entries.map((event) => event.boardColumnId)).toEqual([
    board.columns[1].id,
    board.columns[0].id,
    board.columns[1].id,
  ]);
  engine.cancel(run.id);
  expect(engine.requests.get(next)).toMatchObject({ state: 'cancelled' });
  expect(() =>
    engine.externalInputs.answer(approve(next, 'cancelled'), 'ui'),
  ).toThrow(/no longer waiting/);
  expect(
    read(engine, board.id, { status: 'cancelled' }).columns[1].cards[0].id,
  ).toBe(run.id);
});

it('groups waited children and continued runs while detached and duplicate task starts keep their own cards', () => {
  const engine = open();
  const board = createBoard(engine);
  const child = publish(engine, review(board.columns[1].id), 'Child');
  const waited = publish(engine, workflowCall(child.id), 'Waited');
  const detached = publish(
    engine,
    workflowCall(child.id, 'detached'),
    'Detached',
  );
  const chainDefinition = review(board.columns[0].id);
  const exit = chainDefinition.nodes.find((node) => node.kind === 'exit')!;
  if (exit.kind !== 'exit') throw new Error('Missing Exit');
  exit.continueAsNew = { maxRuns: 2 };
  // Each chain member reviews its current input and passes the checkpoint forward.
  chainDefinition.nodes[1] = nodeSchema.parse({
    ...chainDefinition.nodes[1],
    humanInput: { question: 'Continue?', answer: { kind: 'text' } },
  });
  const chain = publish(engine, chainDefinition, 'Chain');
  for (const workflow of [child, waited, detached, chain])
    assign(engine, workflow.id, board.id);
  const input = { plan: 'Review', revision: '1' };
  const task = { system: 'GitHub', id: '481' };
  const parent = engine.start(waited.id, input, undefined, undefined, {
    externalTask: task,
  }).run;
  const duplicate = engine.start(waited.id, input, undefined, undefined, {
    externalTask: task,
  }).run;
  const independent = engine.start(detached.id, input).run;
  const detachedChild = engine.inspect(independent.id).children[0];
  const root = engine.start(chain.id, 'checkpoint', undefined, undefined, {
    title: 'Continuation title',
  }).run;
  const target = engine.requests
    .current()
    .find((item) => item.cardId === root.id)!.target;
  engine.externalInputs.answer(
    { ...approve(target, 'rollover'), value: 'checkpoint' },
    'mcp',
  );
  const successor = engine.run(root.id).chain?.nextRunId;
  expect(successor).toBeTruthy();
  const boardCards = read(engine, board.id).columns.flatMap(
    (column) => column.cards,
  );
  expect(boardCards.map((card) => card.id).sort()).toEqual(
    [root.id, parent.id, duplicate.id, independent.id, detachedChild.id].sort(),
  );
  expect(boardCards.find((card) => card.id === root.id)).toMatchObject({
    runId: successor,
    title: 'Continuation title',
  });
  expect(
    read(engine, board.id)
      .columns.find((column) => column.name === 'Review')
      ?.cards.map((card) => card.id)
      .sort(),
  ).toEqual([parent.id, duplicate.id, detachedChild.id].sort());
});

it('shows queued and unstaged runs, paginates active cards, and caps recent terminal outcomes per column', () => {
  let time = Date.now();
  const engine = open(':memory:', () => time);
  const board = createBoard(engine);
  const active = review();
  active.maxActiveRuns = 31;
  const wait = publish(engine, active, 'Limited');
  assign(engine, wait.id, board.id);
  for (let i = 0; i < 32; i++)
    engine.start(wait.id, { plan: 'Review', revision: '1' });
  expect(read(engine, board.id, { status: 'queued' }).columns[0]).toMatchObject(
    { name: 'Queued', total: 1 },
  );
  const attention = read(engine, board.id, { status: 'attention' });
  expect(attention.attentionCount).toBe(31);
  expect(attention.columns[0]).toMatchObject({ name: 'Unstaged', total: 31 });
  expect(attention.columns[0].cards).toHaveLength(30);
  expect(
    read(engine, board.id, {
      status: 'attention',
      column: 'unstaged',
      offset: 30,
    }).columns[0].cards,
  ).toHaveLength(1);

  const complete = publish(
    engine,
    definitionSchema.parse({
      nodes: [
        {
          id: 'in',
          kind: 'entry',
          label: 'Input',
          boardColumnId: board.columns[0].id,
        },
        { id: 'out', kind: 'exit', label: 'Output' },
      ],
      edges: [{ id: 'edge', source: 'in', target: 'out' }],
    }),
    'Immediate',
  );
  for (let i = 0; i < 23; i++) engine.start(complete.id, null);
  assign(engine, complete.id, board.id);
  const recent = read(engine, board.id, { status: 'completed' }).columns.find(
    (column) => column.id === board.columns[0].id,
  )!;
  expect(recent.cards).toHaveLength(20);
  time = Date.now() + 86_400_001;
  expect(
    read(engine, board.id, { status: 'completed' }).columns.every(
      (column) => column.total === 0,
    ),
  ).toBe(true);
  expect(read(engine, board.id, { status: 'attention' }).attentionCount).toBe(
    31,
  );
  expect(
    engine.store.runSummaries(
      { tab: 'history', workflowId: complete.id, offset: 0, limit: 100 },
      [],
    ).total,
  ).toBe(23);
});

it('retains terminal recovery in the board beyond the recency window until the exact attempt is confirmed stopped', () => {
  let time = Date.now();
  const engine = open(':memory:', () => time);
  const board = createBoard(engine);
  const definition = blankDefinition();
  definition.nodes[0].boardColumnId = board.columns[0].id;
  const workflow = publish(engine, definition);
  assign(engine, workflow.id, board.id);
  const run = engine.start(workflow.id, null).run;
  const work = engine.available(run.id)[0];
  const claim = engine.claim(work.id, {
    workerId: 'test',
    freshContext: false,
    skills: [],
    tools: [],
  });
  engine.cancel(run.id);
  time = Date.now() + 25 * 60 * 60 * 1000;
  const summary = engine.requests.current()[0];
  expect(summary.target).toMatchObject({
    kind: 'resource',
    workId: work.id,
    attempt: claim.attempt,
  });
  expect(engine.requests.get(summary.target).actions).toEqual([
    'release_resources',
  ]);
  expect(
    read(engine, board.id, { status: 'attention' }).columns[0].cards[0],
  ).toMatchObject({
    id: run.id,
    status: 'cancelled',
    attentionCount: 1,
  });
  engine.manageWorkResources({
    action: 'release',
    workId: work.id,
    expectedAttempt: claim.attempt,
    actor: 'test',
    confirmStopped: true,
  });
  expect(engine.requests.get(summary.target)).toMatchObject({
    state: 'resolved',
    actions: [],
  });
  expect(
    read(engine, board.id).columns.every((column) => column.total === 0),
  ).toBe(true);
});

it('saves an answer during a workflow pause without accepting it', () => {
  const engine = open();
  const workflow = publish(engine, review());
  const run = engine.start(workflow.id, { plan: 'Review', revision: '1' }).run;
  const target = humanTarget(engine.requests.current()[0].target);
  const pause = engine.pauses.create({
    target: { scope: 'workflow', workflowId: workflow.id },
    reason: 'Pause for rollout',
    actor: 'test',
  });
  expect(
    engine.externalInputs.answer(approve(target, 'under-pause'), 'ui'),
  ).not.toHaveProperty('acceptedAt');
  expect(engine.requests.get(target)).toMatchObject({
    state: 'saved',
    status: { pauseCount: 1 },
  });
  engine.pauses.resume(pause.id);
  engine.pump();
  expect(engine.requests.get(target)).toMatchObject({
    state: 'saved',
    actions: ['accept'],
  });
  engine.externalInputs.answer(
    { action: 'accept', target, expectedRevision: 1 },
    'mcp',
  );
  expect(engine.run(run.id)).toMatchObject({
    status: 'completed',
    output: { choice: 'approve' },
  });
});

it('links a superseded Parallel request to the replacement branch visit after retry', () => {
  const engine = open();
  const definition = parallelDefinition();
  definition.nodes[2] = nodeSchema.parse({
    id: 'r0',
    parallelId: 'parallel',
    parallelBranchId: 'r0',
    kind: 'input',
    label: 'Plan review',
    humanInput: { question: 'Review?', answer: { kind: 'text' } },
  });
  const workflow = publish(engine, definition);
  const root = engine.start(workflow.id, null).run;
  const first = engine.requests.current()[0].target;
  const work = engine.available(root.id)[0];
  const claim = engine.claim(work.id, {
    workerId: 'test',
    freshContext: false,
    skills: [],
    tools: [],
  });
  engine.reportFailure(claim.id, claim.token!, 'Verifier failed');
  expect(engine.requests.get(first).state).toBe('cancelled');
  engine.retry(root.id);
  const next = engine.requests
    .current()
    .find((item) => item.target.kind === 'human')!.target;
  expect(next.executionId).not.toBe(first.executionId);
  expect(engine.requests.get(first)).toMatchObject({
    state: 'superseded',
    replacement: next,
  });
  expect(() =>
    engine.externalInputs.answer(
      { ...approve(first, 'stale'), value: 'approved' },
      'mcp',
    ),
  ).toThrow(/no longer waiting/);
  expect(engine.requests.get(next).state).toBe('open');
});
