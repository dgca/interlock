import { afterEach, expect, it } from 'vitest';
import {
  blankDefinition,
  boardQuerySchema,
  type BoardImportSetup,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { previewBoardImport } from '../packages/runtime/src/boardImport';
import {
  inspectImportDocument,
  importSelection,
} from '../packages/runtime/src/importSelection';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { workflowBundleSchema } from '../packages/core/src/transfer';
import { workflowCall } from './fixtures/detached';

const engines: Engine[] = [];
function open() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  return engine;
}
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
});

function assign(
  engine: Engine,
  workflowId: string,
  boardId: string | null,
  expectedBoardId: string | null = null,
) {
  return engine.boards.assign({ workflowId, boardId, expectedBoardId });
}

function stageFixture() {
  const engine = open();
  const board = engine.boards.save({
    name: 'Delivery',
    columns: [{ name: 'Build' }, { name: 'Review' }],
    workflowIds: [],
  });
  const definition = blankDefinition();
  const [build, review] = board.columns;
  definition.nodes[0].boardColumnId = build.id;
  definition.nodes[1].boardColumnId = review.id;
  definition.nodes[1].stage = 'Review';
  const workflow = engine.create('Build release', '', definition);
  engine.publish(workflow.id);
  assign(engine, workflow.id, board.id);
  const bundle = exportWorkflows(engine.store, workflow.id);
  return { engine, board, build, review, workflow, bundle };
}

function cards(engine: Engine, boardId: string) {
  return engine.boards.read(boardQuerySchema.parse({ id: boardId })).columns;
}

it('suggests a board for authored stages without an assigned source board', () => {
  const source = open();
  const definition = blankDefinition();
  definition.nodes[1].stage = 'Review';
  definition.nodes[1].stageId = 'review';
  const workflow = source.create('Review release', '', definition);
  source.publish(workflow.id);
  const bundle = exportWorkflows(source.store, workflow.id);
  expect(bundle.workflows[0].boardSuggestion).toEqual({
    id: workflow.id,
    name: 'Review release',
    columns: [{ id: 'review', name: 'Review' }],
    stages: [{ id: 'review', name: 'Review', columnId: 'review' }],
  });
  const target = open();
  const result = importWorkflows(target.store, bundle, {
    boardSetup: {
      requestId: 'author-review',
      choices: [
        {
          suggestionId: workflow.id,
          action: 'create',
          expectedBoards: { [workflow.id]: null },
        },
      ],
    },
  });
  const runId = target.start(workflow.id, {}).run.id;
  expect(
    cards(target, result.boardSetup!.boards[0].boardId)[0].cards,
  ).toMatchObject([{ runId }]);
});

it('exports portable board suggestions and creates the suggested board atomically on a fresh instance', () => {
  const { engine, board, build, review, workflow, bundle } = stageFixture();
  const target = open();
  expect(workflowBundleSchema.parse(bundle)).toEqual(bundle);
  expect(bundle.formatVersion).toBe(11);
  expect(bundle.workflows[0].boardSuggestion).toMatchObject({
    id: board.id,
    name: 'Delivery',
    columns: board.columns,
    stages: [
      { id: build.id, name: 'Build', columnId: build.id },
      { id: review.id, name: 'Review', columnId: review.id },
    ],
  });
  expect(
    previewBoardImport(target.store, bundle).suggestions[0].workflows,
  ).toMatchObject([{ workflowId: workflow.id, currentBoardId: null }]);
  expect(target.store.workflows()).toEqual([]);

  const boardSetup = {
    requestId: 'create-delivery-board',
    choices: [
      {
        suggestionId: board.id,
        action: 'create',
        expectedBoards: { [workflow.id]: null },
      },
    ],
  } satisfies BoardImportSetup;
  const applied = importWorkflows(target.store, bundle, { boardSetup });
  const destination = target.boards.settings(
    applied.boardSetup!.boards[0].boardId,
  );
  expect(destination.id).not.toBe(board.id);
  expect(destination.columns.map((column) => column.name)).toEqual([
    'Build',
    'Review',
  ]);
  expect(destination.columns.map((column) => column.id)).not.toEqual(
    board.columns.map((column) => column.id),
  );
  expect(target.store.getVersion(workflow.id, 1)!.definition).toEqual(
    engine.store.getVersion(workflow.id, 1)!.definition,
  );

  const runId = target.start(workflow.id, {}).run.id;
  expect(
    cards(target, destination.id).find((column) => column.name === 'Review')
      ?.cards,
  ).toMatchObject([{ runId }]);
  expect(importWorkflows(target.store, bundle, { boardSetup })).toEqual(
    applied,
  );
  expect(target.boards.list()).toHaveLength(1);
  expect(() =>
    importWorkflows(target.store, bundle, {
      boardSetup: {
        ...boardSetup,
        choices: [{ ...boardSetup.choices[0], name: 'Other' }],
      },
    }),
  ).toThrow('different arguments');
});

it('keeps an identical same-instance reimport unchanged and replays setup across a board revision', () => {
  const { engine, board, build, review, workflow, bundle } = stageFixture();
  const original = engine.workflow(workflow.id);
  const originalBoard = engine.boards.settings(board.id);
  expect(importWorkflows(engine.store, bundle).changed).toEqual([]);
  expect(engine.workflow(workflow.id)).toEqual(original);
  expect(engine.boards.settings(board.id)).toEqual(originalBoard);

  const boardSetup = {
    requestId: 'update-local-board',
    choices: [
      {
        suggestionId: board.id,
        action: 'existing',
        boardId: board.id,
        expectedRevision: originalBoard.revision,
        expectedBoards: { [workflow.id]: board.id },
        stageColumns: {
          [workflow.id]: { [build.id]: review.id, [review.id]: review.id },
        },
      },
    ],
  } satisfies BoardImportSetup;
  const result = importWorkflows(engine.store, bundle, { boardSetup });
  expect(engine.boards.settings(board.id).revision).toBe(
    originalBoard.revision + 1,
  );
  expect(importWorkflows(engine.store, bundle, { boardSetup })).toEqual(result);
  expect(engine.boards.settings(board.id).revision).toBe(
    originalBoard.revision + 1,
  );
});

it('maps stable stages to existing columns and preserves definitions, revision safety and history', () => {
  const { board, build, review, workflow, bundle } = stageFixture();
  const target = open();
  const local = target.boards.save({
    name: 'Local delivery',
    columns: [{ name: 'Implement' }, { name: 'Check' }],
    workflowIds: [],
  });
  const [implement, check] = local.columns;
  importWorkflows(target.store, bundle);
  expect(target.workflow(workflow.id).boardId).toBeUndefined();
  expect(
    exportWorkflows(target.store, workflow.id).workflows[0].boardSuggestion,
  ).toEqual(bundle.workflows[0].boardSuggestion);
  expect(target.start(workflow.id, {}).run.status).toBe('waiting');

  const setup = {
    requestId: 'existing-delivery-board',
    choices: [
      {
        suggestionId: board.id,
        action: 'existing',
        boardId: local.id,
        expectedRevision: local.revision,
        expectedBoards: { [workflow.id]: null },
        stageColumns: {
          [workflow.id]: { [build.id]: implement.id, [review.id]: check.id },
        },
      },
    ],
  } satisfies BoardImportSetup;
  importWorkflows(target.store, bundle, { boardSetup: setup });
  const revision = target.boards.settings(local.id).revision;
  const mapped = target.workflow(workflow.id).boardStageColumns;
  expect(mapped).toEqual({ [build.id]: implement.id, [review.id]: check.id });

  const afterSetup = target.start(workflow.id, {}).run.id;
  const rename = target.boards.save({
    id: local.id,
    expectedRevision: revision,
    name: local.name,
    columns: [{ ...check, name: 'Sign off' }, implement],
    workflowIds: [workflow.id],
  });
  expect(target.workflow(workflow.id).boardStageColumns).toEqual(mapped);
  expect(
    cards(target, local.id).find((column) => column.name === 'Sign off')?.cards,
  ).toMatchObject([{ runId: afterSetup }]);
  expect(() =>
    target.boards.save({
      id: local.id,
      expectedRevision: rename.revision,
      name: local.name,
      columns: [check],
      workflowIds: [workflow.id],
    }),
  ).toThrow('Columns still used');

  const remap = {
    requestId: 'remap-delivery-board',
    choices: [
      {
        ...setup.choices[0],
        expectedRevision: rename.revision,
        expectedBoards: { [workflow.id]: local.id },
        stageColumns: {
          [workflow.id]: { [build.id]: null, [review.id]: implement.id },
        },
      },
    ],
  } satisfies BoardImportSetup;
  importWorkflows(target.store, bundle, { boardSetup: remap });
  const afterRemap = target.start(workflow.id, {}).run.id;
  expect(
    cards(target, local.id).find((column) => column.id === check.id)?.cards,
  ).toMatchObject([{ runId: afterSetup }]);
  expect(
    cards(target, local.id).find((column) => column.id === implement.id)?.cards,
  ).toMatchObject([{ runId: afterRemap }]);

  const mapping = target.workflow(workflow.id).boardStageColumns;
  expect(importWorkflows(target.store, bundle).changed).toEqual([]);
  expect(target.workflow(workflow.id).boardStageColumns).toEqual(mapping);
  expect(target.store.getVersion(workflow.id, 1)!.definition).toEqual(
    bundle.workflows[0].versions[0].definition,
  );

  const movedTo = target.boards.save({
    name: 'Other',
    columns: [],
    workflowIds: [],
  });
  assign(target, workflow.id, movedTo.id, local.id);
  expect(target.workflow(workflow.id).boardStageColumns).toBeUndefined();
  assign(target, workflow.id, null, movedTo.id);
  expect(target.workflow(workflow.id).boardId).toBeUndefined();
});

it('does not commit workflows, versions, boards or receipts when selected-set board setup conflicts', () => {
  const { board, workflow, bundle } = stageFixture();
  const target = open();
  const other = target.boards.save({
    name: 'Existing',
    columns: [],
    workflowIds: [],
  });
  const setup = {
    requestId: 'selected-set',
    choices: [
      {
        suggestionId: board.id,
        action: 'existing',
        boardId: other.id,
        expectedRevision: other.revision + 1,
        expectedBoards: { [workflow.id]: null },
        stageColumns: {},
      },
    ],
  } satisfies BoardImportSetup;
  const legacy = { name: 'Legacy' };
  expect(() =>
    importSelection(target, [legacy, bundle], undefined, setup),
  ).toThrow('Board settings changed');
  expect(target.store.workflows()).toEqual([]);
  expect(target.store.getVersion(workflow.id, 1)).toBeUndefined();
  expect(target.store.list('boardImportReceipts')).toEqual([]);

  setup.choices[0].expectedRevision = other.revision;
  const result = importSelection(target, [legacy, bundle], undefined, setup);
  expect(result.rootIds).toHaveLength(2);
  expect(result.boardSetup?.boards[0].boardId).toBe(other.id);
  expect(importSelection(target, [legacy, bundle], undefined, setup)).toEqual(
    result,
  );
  expect(target.store.workflows()).toHaveLength(2);
  expect(target.workflow(workflow.id).boardStageColumns).toEqual(
    Object.fromEntries(board.columns.map((column) => [column.id, null])),
  );
});

it('keeps older bundles importable and explains their unresolved column identities', () => {
  const { bundle, review, workflow } = stageFixture();
  const legacy = { ...bundle, formatVersion: 1 as const };
  delete legacy.workflows[0].boardSuggestion;
  const target = open();
  expect(inspectImportDocument(legacy, target.store).boardSetup).toMatchObject({
    suggestions: [],
    unresolved: [
      {
        workflowId: workflow.id,
        stageIds: expect.arrayContaining([review.id]),
      },
    ],
  });
  expect(importWorkflows(target.store, legacy).changed).toEqual([workflow.id]);
  expect(target.start(workflow.id, {}).run.status).toBe('waiting');
});

it.each(['wait', 'detached'] as const)(
  'projects a mapped owned %s child according to the existing Board lifecycle',
  (mode) => {
    const source = open();
    const board = source.boards.save({
      name: 'Review',
      columns: [{ name: 'Review' }],
      workflowIds: [],
    });
    const owner = source.create('Owner');
    const childDefinition = blankDefinition();
    childDefinition.nodes[1].boardColumnId = board.columns[0].id;
    const child = source.create('Review step', '', childDefinition, owner.id);
    source.publish(child.id);
    source.update(owner.id, {
      draft: workflowCall(child.id, mode),
      draftRevision: owner.draftRevision,
    });
    source.publish(owner.id);
    assign(source, owner.id, board.id);

    const target = open();
    const bundle = exportWorkflows(source.store, owner.id);
    expect(
      previewBoardImport(target.store, bundle).suggestions[0].workflows.map(
        (w) => w.workflowId,
      ),
    ).toEqual([owner.id, child.id]);
    const imported = importWorkflows(target.store, bundle, {
      boardSetup: {
        requestId: `child-${mode}`,
        choices: [
          {
            action: 'create',
            suggestionId: board.id,
            expectedBoards: { [owner.id]: null, [child.id]: null },
          },
        ],
      },
    });
    const targetBoard = imported.boardSetup!.boards[0].boardId;
    const run = target.start(owner.id, {}).run;
    const [attached] = target.inspect(run.id).children;
    expect(
      cards(target, targetBoard).find((column) => column.name === 'Review')
        ?.cards,
    ).toMatchObject([{ runId: mode === 'wait' ? run.id : attached.id }]);
  },
);
