import { afterEach, expect, it } from 'vitest';
import {
  blankDefinition,
  boardTypePresets,
  definitionSchema,
  nodeSchema,
  saveBoardSchema,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';

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
