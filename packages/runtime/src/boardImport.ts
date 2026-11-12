import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  boardSettingsRevisionConflict,
  InterlockError,
  workflowStageColumn,
  workflowStageId,
  type BoardImportResult,
  type BoardImportSetup,
  type BoardSuggestion,
  type Workflow,
  type WorkflowBoard,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { WorkflowBundle } from '../../core/src/transfer.js';
import { fingerprint } from './versionIdentity.js';

export const boardCollection = 'workflowBoards';
type SuggestedWorkflow = {
  workflowId: string;
  name: string;
  currentBoardId: string | null;
  stages: BoardSuggestion['stages'];
};
type SuggestedBoard = Pick<BoardSuggestion, 'id' | 'name' | 'columns'> & {
  workflows: SuggestedWorkflow[];
};
type UnresolvedStages = {
  workflowId: string;
  name: string;
  stageIds: string[];
};

export function withBoardImportReceipt<T>(
  store: Store,
  operation: 'bundle' | 'selection',
  setup: BoardImportSetup | undefined,
  request: unknown,
  apply: () => T,
): T {
  if (!setup) return apply();
  const id = fingerprint([operation, setup.requestId]);
  const hash = fingerprint(request);
  const receipt = store.get<{ id: string; hash: string; result: T }>(
    'boardImportReceipts',
    id,
  );
  if (receipt) {
    if (receipt.hash !== hash)
      throw new InterlockError(
        'Board setup requestId was already used with different arguments',
      );
    return receipt.result;
  }
  const result = apply();
  store.put('boardImportReceipts', { id, hash, result });
  return result;
}

function authoredStages(definitions: WorkflowDefinition[]) {
  const stages = new Map<string, WorkflowNode>();
  for (const definition of definitions)
    for (const node of definition.nodes) {
      const id = workflowStageId(node);
      if (id && !stages.has(id)) stages.set(id, node);
    }
  return stages;
}

function stageName(id: string, node: WorkflowNode, columnName?: string) {
  return node.stage ?? columnName ?? (node.label.trim().slice(0, 200) || id);
}

export function exportBoardSuggestion(
  store: Store,
  workflow: Workflow,
  definitions: WorkflowDefinition[],
): BoardSuggestion | undefined {
  const stages = authoredStages(definitions);
  const owner = workflow.ownerWorkflowId
    ? store.get<Workflow>('workflows', workflow.ownerWorkflowId)
    : undefined;
  const boardId = workflow.boardId ?? owner?.boardId;
  const board = boardId && store.get<WorkflowBoard>(boardCollection, boardId);
  if (board) {
    const columns = new Map(board.columns.map((column) => [column.id, column]));
    const mapped = [...stages].slice(0, 1000).map(([id, node]) => {
      const columnId = workflowStageColumn(node, workflow.boardStageColumns);
      const column = columnId ? columns.get(columnId) : undefined;
      return {
        id,
        name: stageName(id, node, column?.name),
        columnId: column?.id ?? null,
      };
    });
    if (workflow.boardId || mapped.some((stage) => stage.columnId))
      return {
        id: board.id,
        name: board.name,
        columns: board.columns,
        stages: mapped,
      };
  }
  const retained = workflow.boardSuggestion;
  if (retained)
    return {
      ...retained,
      stages: retained.stages.filter((stage) => stages.has(stage.id)),
    };
  const portable = [...stages].filter(([, node]) => node.stageId);
  if (portable.length) {
    const columns = portable.slice(0, 100).map(([id, node]) => ({
      id,
      name: stageName(id, node),
    }));
    const columnIds = new Set(columns.map((column) => column.id));
    return {
      id: workflow.id,
      name: workflow.name,
      columns,
      stages: portable.slice(0, 1000).map(([id, node]) => ({
        id,
        name: stageName(id, node),
        columnId: columnIds.has(id) ? id : null,
      })),
    };
  }
}

export function boardImportCatalog(store: Store) {
  return store.list<WorkflowBoard>(boardCollection);
}

export function previewBoardImport(
  store: Store,
  bundle: WorkflowBundle,
  includeBoardCatalog = true,
) {
  const suggestions = new Map<string, SuggestedBoard>();
  const unresolved: UnresolvedStages[] = [];
  for (const workflow of bundle.workflows) {
    const current = store.get<Workflow>('workflows', workflow.id);
    const suggestion = workflow.boardSuggestion;
    if (suggestion) {
      const { stages, ...board } = suggestion;
      const group = suggestions.get(board.id);
      if (
        group &&
        (group.name !== board.name ||
          !isDeepStrictEqual(group.columns, board.columns))
      )
        throw new InterlockError(
          `Conflicting suggestions for board ${board.id}`,
        );
      const member = {
        workflowId: workflow.id,
        name: workflow.name,
        currentBoardId: current?.boardId ?? null,
        stages,
      };
      if (group) group.workflows.push(member);
      else suggestions.set(board.id, { ...board, workflows: [member] });
    }
    const known = new Set(suggestion?.stages.map((stage) => stage.id));
    const stageIds = [
      ...authoredStages([
        workflow.draft,
        ...workflow.versions.map((version) => version.definition),
      ]).keys(),
    ].filter((id) => !known.has(id));
    if (stageIds.length)
      unresolved.push({
        workflowId: workflow.id,
        name: workflow.name,
        stageIds,
      });
  }
  return {
    suggestions: [...suggestions.values()],
    boards:
      includeBoardCatalog && suggestions.size ? boardImportCatalog(store) : [],
    unresolved,
  };
}

export function previewLegacyBoardImport(
  name: string,
  definition: WorkflowDefinition,
) {
  const stageIds = [...authoredStages([definition]).keys()];
  return {
    suggestions: [] as SuggestedBoard[],
    boards: [] as WorkflowBoard[],
    unresolved: stageIds.length
      ? [{ workflowId: 'legacy', name, stageIds }]
      : [],
  };
}

/** Call inside the import transaction. Requests are deduplicated by the caller. */
export function applyBoardImport(
  store: Store,
  suggestions: SuggestedBoard[],
  setup: BoardImportSetup,
): BoardImportResult {
  const plans = new Map(suggestions.map((item) => [item.id, item]));
  const choices = new Set<string>();
  const boards = new Map<string, WorkflowBoard>();
  const dirty = new Set<string>();
  const result: BoardImportResult['boards'] = [];
  const loadBoard = (id: string) => {
    const board =
      boards.get(id) ?? store.get<WorkflowBoard>(boardCollection, id);
    if (!board) throw new InterlockError('Board not found');
    boards.set(id, board);
    return board;
  };
  for (const choice of setup.choices) {
    const plan = plans.get(choice.suggestionId);
    if (!plan || choices.has(choice.suggestionId))
      throw new InterlockError(
        'Choose each available board suggestion at most once',
      );
    choices.add(choice.suggestionId);
    const workflowIds = plan.workflows.map((workflow) => workflow.workflowId);
    const ids = new Set(workflowIds);
    if (
      Object.keys(choice.expectedBoards).length !== ids.size ||
      workflowIds.some((id) => !Object.hasOwn(choice.expectedBoards, id))
    )
      throw new InterlockError(
        'Board setup requires current membership for each suggested workflow',
      );
    if (
      choice.action === 'existing' &&
      Object.keys(choice.stageColumns).some((id) => !ids.has(id))
    )
      throw new InterlockError(
        'Board setup includes a workflow outside the suggestion',
      );

    const suggestedColumns = new Map<string, string>();
    let board: WorkflowBoard;
    if (choice.action === 'existing') {
      board = loadBoard(choice.boardId);
      if (board.revision !== choice.expectedRevision)
        throw new InterlockError(boardSettingsRevisionConflict);
    } else {
      board = {
        id: randomUUID(),
        revision: 1,
        name: choice.name ?? plan.name,
        columns: plan.columns.map((column) => {
          const id = randomUUID();
          suggestedColumns.set(column.id, id);
          return { id, name: column.name };
        }),
      };
      boards.set(board.id, board);
      store.put(boardCollection, board);
    }
    const columns = new Set(board.columns.map((column) => column.id));
    for (const member of plan.workflows) {
      const workflow = store.get<Workflow>('workflows', member.workflowId);
      if (
        !workflow ||
        (workflow.boardId ?? null) !== choice.expectedBoards[member.workflowId]
      )
        throw new InterlockError(
          'Workflow board changed. Refresh and try again.',
        );
      const supplied =
        choice.action === 'existing' &&
        Object.hasOwn(choice.stageColumns, workflow.id)
          ? choice.stageColumns[workflow.id]
          : {};
      const known = new Set(member.stages.map((stage) => stage.id));
      if (
        Object.entries(supplied).some(
          ([id, column]) =>
            !known.has(id) || (column !== null && !columns.has(column)),
        )
      )
        throw new InterlockError(
          'Board setup includes an unknown stage or destination column',
        );
      const stageColumns = Object.fromEntries(
        member.stages.map((stage) => [
          stage.id,
          choice.action === 'create'
            ? ((stage.columnId && suggestedColumns.get(stage.columnId)) ?? null)
            : Object.hasOwn(supplied, stage.id)
              ? supplied[stage.id]
              : null,
        ]),
      );
      const nextMapping = member.stages.length ? stageColumns : undefined;
      if (
        workflow.boardId === board.id &&
        isDeepStrictEqual(workflow.boardStageColumns, nextMapping)
      )
        continue;
      if (workflow.boardId && workflow.boardId !== board.id) {
        loadBoard(workflow.boardId);
        dirty.add(workflow.boardId);
      }
      if (choice.action === 'existing') dirty.add(board.id);
      store.put<Workflow>('workflows', {
        ...workflow,
        boardId: board.id,
        boardStageColumns: nextMapping,
      });
    }
    result.push({ suggestionId: plan.id, boardId: board.id, workflowIds });
  }
  for (const id of dirty) {
    const board = loadBoard(id);
    store.put(boardCollection, { ...board, revision: board.revision + 1 });
  }
  return { boards: result };
}
