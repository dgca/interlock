import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  blankDefinition,
  boardQuerySchema,
  boardTypePresets,
  definitionSchema,
  nodeSchema,
  saveBoardSchema,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { workflowCall } from './fixtures/detached';

const engines = new Set<Engine>();
afterEach(() => {
  for (const engine of engines) engine.stop();
  engines.clear();
});
function open() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.add(engine);
  return engine;
}
const worker = {
  workerId: 'board-worker',
  freshContext: false,
  tools: [],
  skills: [],
};
/** Entry → one step per stage → Exit; `person` stages wait on Human input. */
function staged(...stages: { stage: string; person?: boolean }[]) {
  const nodes = stages.map(({ stage, person }, index) =>
    nodeSchema.parse(
      person
        ? {
            id: `step${index}`,
            kind: 'input',
            label: stage,
            stage,
            humanInput: { question: 'Approve?', answer: { kind: 'text' } },
          }
        : {
            id: `step${index}`,
            kind: 'agent',
            label: stage,
            stage,
            prompt: 'Work.',
          },
    ),
  );
  const blank = blankDefinition();
  const ids = ['entry', ...nodes.map((node) => node.id), 'exit'];
  return definitionSchema.parse({
    ...blank,
    nodes: [blank.nodes[0], ...nodes, blank.nodes[2]],
    edges: ids.slice(1).map((target, index) => ({
      id: `e${index}`,
      source: ids[index],
      target,
    })),
  });
}
function publish(engine: Engine, name: string, definition: WorkflowDefinition) {
  const workflow = engine.create(name, '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}
function lanes(view: ReturnType<Engine['boards']['views']['view']>) {
  return Object.fromEntries(
    view.lanes.map((lane) => [
      lane.id,
      lane.cards.map((card) => card.title ?? card.workflowName),
    ]),
  );
}

it('places cards from several workflows by shared or mapped stage names, groups tasks, and keeps unknown stages Unmapped', () => {
  const engine = open();
  const feature = publish(engine, 'Feature', staged({ stage: 'Build' }));
  const bugfix = publish(engine, 'Bugfix', staged({ stage: 'Build' }));
  const hotfix = publish(engine, 'Hotfix', staged({ stage: 'Implement' }));
  const polish = publish(engine, 'Polish', staged({ stage: 'Polish' }));
  const review = publish(
    engine,
    'Review',
    staged({ stage: 'Review', person: true }),
  );
  const elsewhere = publish(engine, 'Elsewhere', staged({ stage: 'Build' }));
  const type = engine.boards.types.save({ type: boardTypePresets.coding });
  const board = engine.boards.save(
    saveBoardSchema.parse({
      name: 'Coding',
      typeId: type.id,
      scope: {
        workflowIds: [feature, bugfix, hotfix, polish, review],
      },
      stageMap: { [hotfix]: { Implement: 'Build' } },
    }),
  );
  const start = (workflowId: string, title: string, task?: string) =>
    engine.start(workflowId, {}, undefined, undefined, {
      title,
      ...(task && { externalTask: { system: 'github', id: task } }),
    }).run;
  start(feature, 'Feature run');
  const done = start(bugfix, 'Bugfix run');
  start(hotfix, 'Hotfix run');
  start(polish, 'Polish run');
  start(elsewhere, 'Out of scope');
  // A person-waiting run places its task card even when a newer run is active.
  start(review, 'Task 7 review', '7');
  start(feature, 'Task 7 rework', '7');
  const work = engine.available(done.id)[0];
  engine.submit(work.id, engine.claim(work.id, worker).token!, {});

  const view = engine.boards.views.view({ id: board.id });
  expect(lanes(view)).toMatchObject({
    build: ['Hotfix run', 'Feature run'],
    'needs-you': ['Task 7 review'],
    done: ['Bugfix run'],
    unmapped: ['Polish run'],
  });
  const task = view.lanes
    .find((lane) => lane.id === 'needs-you')!
    .cards.find((card) => card.id === 'task:github/7')!;
  expect(task).toMatchObject({ runCount: 2, actor: 'person', stage: 'Review' });
  expect(
    engine.boards.list().find((item) => item.id === board.id),
  ).toMatchObject({
    attentionCount: 1,
    workflowIds: [feature, bugfix, hotfix, polish, review],
  });
  // Only the requested lane carries cards; every lane keeps its total.
  const page = engine.boards.views.view({
    id: board.id,
    lane: 'build',
    limit: 1,
  });
  expect(
    page.lanes.map((lane) => [lane.id, lane.total, lane.cards.length]),
  ).toContainEqual(['build', 2, 1]);
  expect(page.lanes.find((lane) => lane.id === 'done')).toMatchObject({
    total: 1,
    cards: [],
  });
});

it('gives each workflow a board with its stages in graph order and hides empty optional lanes', () => {
  const engine = open();
  const definition = staged(
    { stage: 'Plan' },
    { stage: 'Build' },
    { stage: 'Plan' },
    { stage: 'Review', person: true },
  );
  const workflow = publish(engine, 'Pipeline', definition);
  const run = engine.start(workflow, {}).run;
  const view = engine.boards.views.view({ workflowId: workflow });
  expect(view.board).toMatchObject({
    id: `workflow:${workflow}`,
    kind: 'workflow',
  });
  expect(view.lanes.map((lane) => lane.name)).toEqual([
    'Needs you',
    'Plan',
    'Build',
    'Review',
    'Done',
    'Failed',
  ]);
  expect(view.lanes[1].cards.map((card) => card.runId)).toEqual([run.id]);
});

it('keeps typed boards out of column membership and protects board types in use', () => {
  const engine = open();
  const workflow = publish(engine, 'Feature', staged({ stage: 'Build' }));
  const type = engine.boards.types.save({ type: boardTypePresets.design });
  expect(() =>
    saveBoardSchema.parse({
      name: 'Mixed',
      typeId: type.id,
      columns: [{ name: 'A' }],
    }),
  ).toThrow();
  const board = engine.boards.save(
    saveBoardSchema.parse({ name: 'Design', typeId: type.id }),
  );
  expect(() =>
    engine.boards.assign({
      workflowId: workflow,
      boardId: board.id,
      expectedBoardId: null,
    }),
  ).toThrow('Typed boards select runs by scope');
  expect(() =>
    engine.boards.save(
      saveBoardSchema.parse({
        id: board.id,
        expectedRevision: 1,
        name: 'Columns',
        columns: [{ name: 'A' }],
      }),
    ),
  ).toThrow('cannot become a typed board');
  expect(() => engine.boards.types.delete(type.id)).toThrow('Boards still use');
  expect(() =>
    engine.boards.types.save({
      id: type.id,
      expectedRevision: 0,
      type: boardTypePresets.design,
    }),
  ).toThrow('Board type changed');
});

it('keeps a held start in the Backlog until release, offers only valid card actions, and never re-queues an admitted run', () => {
  const engine = open();
  const workflow = publish(
    engine,
    'Capped',
    definitionSchema.parse({ ...staged({ stage: 'Plan' }), maxActiveRuns: 1 }),
  );
  const view = () => engine.boards.views.view({ workflowId: workflow });
  const card = (runId: string) =>
    view()
      .lanes.flatMap((lane) =>
        lane.cards.map((card) => ({ lane: lane.id, card })),
      )
      .find(({ card }) => card.runId === runId)!;
  const held = engine.start(workflow, {}, undefined, undefined, {
    hold: { reason: 'After the freeze' },
  }).run;
  const queued = engine.start(workflow, {}).run;
  // The held start never takes the free slot; the later start does.
  expect(engine.run(held.id).status).toBe('queued');
  expect(engine.run(queued.id).status).toBe('waiting');
  expect(card(held.id)).toMatchObject({
    lane: 'backlog',
    card: {
      held: { reason: 'After the freeze' },
      actions: ['open', 'cancel', 'release'],
    },
  });
  expect(() => engine.boards.hold({ runId: queued.id, reason: 'x' })).toThrow(
    'Only queued runs',
  );
  const waiting = engine.start(workflow, {}).run;
  expect(card(waiting.id)).toMatchObject({
    lane: 'queued',
    card: { actions: ['open', 'cancel', 'backlog'] },
  });
  engine.boards.hold({ runId: waiting.id, reason: 'Later' });
  expect(card(waiting.id).lane).toBe('backlog');
  // Release returns a start to admission; capacity still applies.
  engine.boards.release({ runId: held.id });
  expect(card(held.id).lane).toBe('queued');
  engine.cancel(queued.id);
  expect(engine.run(held.id).status).toBe('waiting');
  expect(engine.run(waiting.id).status).toBe('queued');
});

it('lists runs on Done by when they finished, newest first, and says how many it shows', () => {
  const engine = open();
  const quick = publish(
    engine,
    'Quick',
    definitionSchema.parse({
      ...blankDefinition(),
      nodes: [blankDefinition().nodes[0], blankDefinition().nodes[2]],
      edges: [{ id: 'e', source: 'entry', target: 'exit' }],
    }),
  );
  const slow = publish(engine, 'Slow', staged({ stage: 'Build' }));
  const long = engine.start(slow, {}, undefined, undefined, {
    title: 'Long run',
  }).run;
  for (let i = 0; i < 520; i++) engine.start(quick, {});
  const work = engine.available(long.id)[0];
  engine.submit(work.id, engine.claim(work.id, worker).token!, {});
  const type = engine.boards.types.save({ type: boardTypePresets.coding });
  const board = engine.boards.save(
    saveBoardSchema.parse({ name: 'All', typeId: type.id }),
  );
  const view = engine.boards.views.view({ id: board.id, lane: 'done' });
  expect(view.finished).toEqual({ total: 521, shown: 100 });
  expect(view.lanes.find((lane) => lane.id === 'done')!.cards[0]).toMatchObject(
    { runId: long.id },
  );
});

it('shows node results only as short scalars', () => {
  const engine = open();
  const workflow = publish(
    engine,
    'Results',
    staged({ stage: 'Open' }, { stage: 'Review' }),
  );
  const type = engine.boards.types.save({
    type: {
      name: 'Fields',
      lanes: [{ id: 'all', name: 'All' }],
      fields: [
        { id: 'url', label: 'URL', source: 'node.step0.url' },
        { id: 'long', label: 'Long', source: 'node.step0.long' },
        { id: 'list', label: 'List', source: 'node.step0.items' },
        { id: 'whole', label: 'Whole', source: 'node.step0' },
        { id: 'missing', label: 'Missing', source: 'node.nowhere.url' },
      ],
    },
  });
  const board = engine.boards.save(
    saveBoardSchema.parse({ name: 'Results', typeId: type.id }),
  );
  const run = engine.start(workflow, {}).run;
  const work = engine.available(run.id)[0];
  engine.submit(work.id, engine.claim(work.id, worker).token!, {
    url: 'https://example.com/pull/1',
    long: 'x'.repeat(5000),
    items: Array.from({ length: 20_000 }, (_, i) => ({ i })),
  });
  const view = engine.boards.views.view({ id: board.id });
  expect((view.lanes[0].cards[0] as { fields?: unknown }).fields).toEqual({
    url: 'https://example.com/pull/1',
    long: 'x'.repeat(200),
    list: '(list)',
    whole: '(object)',
  });
  expect(JSON.stringify(view).length).toBeLessThan(10_000);
});

it('keeps a held start queued across restart and pauses, and refuses holds on child runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-held-'));
  try {
    const file = join(dir, 'held.db');
    let engine = new Engine(new Store(file), dir);
    const child = publish(
      engine,
      'Child',
      definitionSchema.parse({
        ...staged({ stage: 'Build' }),
        maxActiveRuns: 1,
      }),
    );
    const parent = publish(engine, 'Parent', workflowCall(child));
    const held = engine.start(child, {}, undefined, undefined, {
      hold: { reason: 'Later' },
    }).run;
    engine.start(child, {});
    const queuedChild = engine.inspect(engine.start(parent, {}).run.id)
      .children[0];
    expect(engine.run(queuedChild.id).status).toBe('queued');
    expect(() =>
      engine.boards.hold({ runId: queuedChild.id, reason: 'x' }),
    ).toThrow('Hold the parent run');
    engine.stop();
    engine.store.close();
    engine = new Engine(new Store(file), dir);
    engines.add(engine);
    engine.pump();
    expect(engine.run(held.id).admission?.hold?.reason).toBe('Later');
    engine.pauses.create({
      target: { scope: 'workflow', workflowId: child },
      actor: 'test',
      reason: 'freeze',
    });
    engine.boards.release({ runId: held.id });
    expect(engine.run(held.id).status).toBe('queued');
    expect(engine.store.events(held.id).map((event) => event.type)).toEqual(
      expect.arrayContaining(['run.released']),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('reads a column board through the view exactly as the board read', () => {
  const engine = open();
  const board = engine.boards.save({
    name: 'Columns',
    columns: [{ name: 'Build' }],
    workflowIds: [],
  });
  const workflow = publish(engine, 'Member', staged({ stage: 'Build' }));
  engine.boards.assign({
    workflowId: workflow,
    boardId: board.id,
    expectedBoardId: null,
  });
  engine.start(workflow, {});
  const read = engine.boards.read(boardQuerySchema.parse({ id: board.id }));
  const view = engine.boards.views.view({ id: board.id });
  expect(view.lanes).toEqual(
    read.columns.map(({ id, name, total, cards }) => ({
      id,
      name,
      total,
      cards,
    })),
  );
});
