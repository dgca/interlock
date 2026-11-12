import type { BoardImportSetup, WorkflowBoard } from '@interlock/core';
import { useState } from 'react';
import {
  ActionError,
  Button,
  Group,
  NativeSelect,
  Stack,
  Text,
  TextInput,
} from '../../design-system';
import { api, errorMessage } from '../../lib/api';
import styles from './ImportWorkflowDialog.module.css';

export type BoardImportPreview = NonNullable<
  Awaited<ReturnType<typeof api.workflows.previewImport.query>>['boardSetup']
>;
type Suggestion = BoardImportPreview['suggestions'][number];
type SourcePreview = Pick<BoardImportPreview, 'suggestions' | 'unresolved'>;

export function mergeBoardImportPreviews(
  previews: (SourcePreview | undefined)[],
): SourcePreview {
  const suggestions = new Map<string, Suggestion>();
  const unresolved = new Map<string, SourcePreview['unresolved'][number]>();
  for (const preview of previews) {
    for (const group of preview?.suggestions ?? []) {
      const previous = suggestions.get(group.id);
      if (!previous) {
        suggestions.set(group.id, group);
        continue;
      }
      const workflows = new Map(
        [...previous.workflows, ...group.workflows].map((workflow) => [
          workflow.workflowId,
          workflow,
        ]),
      );
      suggestions.set(group.id, {
        ...previous,
        workflows: [...workflows.values()],
      });
    }
    for (const workflow of preview?.unresolved ?? []) {
      unresolved.set(workflow.workflowId, workflow);
    }
  }
  return {
    suggestions: [...suggestions.values()],
    unresolved: [...unresolved.values()],
  };
}

type ExistingChoice = Extract<
  BoardImportSetup['choices'][number],
  { action: 'existing' }
>;
type Draft =
  | { action: 'create'; name?: string }
  | {
      action: 'existing';
      board?: WorkflowBoard;
      stageColumns: ExistingChoice['stageColumns'];
    };
export type BoardImportDrafts = ReadonlyMap<string, Draft>;

export function boardImportChoices(
  suggestions: Suggestion[],
  drafts: BoardImportDrafts,
) {
  const choices: BoardImportSetup['choices'] = [];
  for (const suggestion of suggestions) {
    const draft = drafts.get(suggestion.id);
    if (!draft) continue;
    const expectedBoards = Object.fromEntries(
      suggestion.workflows.map(({ workflowId, currentBoardId }) => [
        workflowId,
        currentBoardId ?? null,
      ]),
    );
    if (draft.action === 'create') {
      if (draft.name !== undefined && !draft.name.trim()) return;
      choices.push({
        action: 'create',
        suggestionId: suggestion.id,
        expectedBoards,
        ...(draft.name !== undefined ? { name: draft.name.trim() } : {}),
      });
    } else {
      if (!draft.board) return;
      choices.push({
        action: 'existing',
        suggestionId: suggestion.id,
        expectedBoards,
        boardId: draft.board.id,
        expectedRevision: draft.board.revision,
        stageColumns: draft.stageColumns,
      });
    }
  }
  return choices;
}

function suggestedMapping(suggestion: Suggestion, board: WorkflowBoard) {
  const names = new Map(suggestion.columns.map(({ id, name }) => [id, name]));
  const columns = new Map(board.columns.map(({ id, name }) => [name, id]));
  return Object.fromEntries(
    suggestion.workflows.map(({ workflowId, stages }) => [
      workflowId,
      Object.fromEntries(
        stages.map((stage) => [
          stage.id,
          stage.columnId
            ? (columns.get(names.get(stage.columnId) ?? stage.name) ?? null)
            : null,
        ]),
      ),
    ]),
  );
}

export function BoardImportEditor({
  suggestions,
  unresolved,
  boards,
  drafts,
  onChange,
  onRefreshing,
  boardConflict,
  disabled,
}: BoardImportPreview & {
  drafts: BoardImportDrafts;
  onChange: (drafts: BoardImportDrafts) => void;
  onRefreshing: (value: boolean) => void;
  boardConflict: boolean;
  disabled: boolean;
}) {
  const [refreshing, setRefreshing] = useState<string>();
  const [readError, setReadError] = useState<{ id: string; message: string }>();

  const change = (id: string, draft?: Draft) => {
    setReadError(undefined);
    const next = new Map(drafts);
    if (draft) next.set(id, draft);
    else next.delete(id);
    onChange(next);
  };
  const reloadBoard = async (
    suggestion: Suggestion,
    draft: Extract<Draft, { action: 'existing' }>,
  ) => {
    if (!draft.board) return;
    setRefreshing(suggestion.id);
    onRefreshing(true);
    setReadError(undefined);
    try {
      const board = await api.boards.settings.query({ id: draft.board.id });
      const ids = new Set(board.columns.map(({ id }) => id));
      const stageColumns = Object.fromEntries(
        Object.entries(draft.stageColumns).map(([workflowId, stages]) => [
          workflowId,
          Object.fromEntries(
            Object.entries(stages).map(([stageId, column]) => [
              stageId,
              column && ids.has(column) ? column : null,
            ]),
          ),
        ]),
      );
      change(suggestion.id, { ...draft, board, stageColumns });
    } catch (e) {
      setReadError({ id: suggestion.id, message: errorMessage(e) });
    } finally {
      setRefreshing(undefined);
      onRefreshing(false);
    }
  };
  return (
    <section className={styles.boardSetup} aria-labelledby="import-board-setup">
      <h3 id="import-board-setup">Board setup</h3>
      {unresolved.length > 0 && (
        <Text size="sm" c="dimmed">
          Some stages in {unresolved.map(({ name }) => name).join(', ')} have no
          board suggestion. To place future runs in columns, assign a board and
          bind those stages in the workflow editor.
        </Text>
      )}
      <Stack gap="md">
        {suggestions.map((suggestion) => {
          const draft = drafts.get(suggestion.id);
          const workflows = suggestion.workflows.map(({ name }) => name);
          return (
            <fieldset
              key={suggestion.id}
              className={styles.boardSuggestion}
              disabled={disabled || !!refreshing}
            >
              <legend>{suggestion.name}</legend>
              <Stack gap="sm">
                <Text size="sm" c="dimmed">
                  {workflows.join(', ')}
                </Text>
                <NativeSelect
                  label="Board action"
                  value={draft?.action ?? 'skip'}
                  onChange={(event) => {
                    const action = event.currentTarget.value;
                    change(
                      suggestion.id,
                      action === 'create'
                        ? { action }
                        : action === 'existing'
                          ? { action, stageColumns: {} }
                          : undefined,
                    );
                  }}
                >
                  <option value="skip">Skip board setup</option>
                  <option value="create">Create suggested board</option>
                  <option value="existing" disabled={!boards.length}>
                    Use existing board
                  </option>
                </NativeSelect>
                {draft?.action === 'create' && (
                  <>
                    <TextInput
                      label="Board name"
                      maxLength={200}
                      value={draft.name ?? suggestion.name}
                      onChange={(event) =>
                        change(suggestion.id, {
                          action: 'create',
                          name: event.currentTarget.value,
                        })
                      }
                    />
                    {suggestion.columns.length > 0 && (
                      <Text size="sm" c="dimmed">
                        Columns in order{' '}
                        {suggestion.columns.map(({ name }) => name).join(', ')}
                      </Text>
                    )}
                    {suggestion.workflows.some(
                      ({ stages }) => stages.length,
                    ) && (
                      <details className={styles.details}>
                        <summary>Stage mappings</summary>
                        {suggestion.workflows.map(
                          ({ workflowId, name, stages }) => (
                            <div key={workflowId}>
                              {suggestion.workflows.length > 1 && <p>{name}</p>}
                              <ul>
                                {stages.map((stage) => (
                                  <li key={stage.id}>
                                    {stage.name} →{' '}
                                    {suggestion.columns.find(
                                      ({ id }) => id === stage.columnId,
                                    )?.name ?? 'Unstaged'}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ),
                        )}
                      </details>
                    )}
                  </>
                )}
                {draft?.action === 'existing' && (
                  <>
                    <NativeSelect
                      label="Existing board"
                      value={draft.board?.id ?? ''}
                      disabled={!boards.length}
                      onChange={(event) => {
                        const board = boards.find(
                          ({ id }) => id === event.currentTarget.value,
                        );
                        change(suggestion.id, {
                          action: 'existing',
                          board,
                          stageColumns: board
                            ? suggestedMapping(suggestion, board)
                            : {},
                        });
                      }}
                    >
                      <option value="">
                        {boards.length
                          ? 'Choose a board'
                          : 'No boards available'}
                      </option>
                      {boards.map(({ id, name }) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </NativeSelect>
                    {draft.board && boardConflict && (
                      <Group gap="sm">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void reloadBoard(suggestion, draft)}
                        >
                          {refreshing === suggestion.id
                            ? 'Loading board…'
                            : 'Reload board columns'}
                        </Button>
                        {readError?.id === suggestion.id && (
                          <ActionError message={readError.message} />
                        )}
                      </Group>
                    )}
                    {draft.board &&
                      suggestion.workflows.map(
                        ({ workflowId, name, stages }) => (
                          <Stack key={workflowId} gap="xs">
                            {workflows.length > 1 && (
                              <Text size="sm" fw={600}>
                                {name}
                              </Text>
                            )}
                            {stages.map((stage) => (
                              <NativeSelect
                                key={stage.id}
                                label={stage.name}
                                value={
                                  draft.stageColumns[workflowId]?.[stage.id] ??
                                  ''
                                }
                                onChange={(event) =>
                                  change(suggestion.id, {
                                    ...draft,
                                    stageColumns: {
                                      ...draft.stageColumns,
                                      [workflowId]: {
                                        ...draft.stageColumns[workflowId],
                                        [stage.id]:
                                          event.currentTarget.value || null,
                                      },
                                    },
                                  })
                                }
                              >
                                <option value="">Leave unstaged</option>
                                {draft.board?.columns.map(({ id, name }) => (
                                  <option key={id} value={id}>
                                    {name}
                                  </option>
                                ))}
                              </NativeSelect>
                            ))}
                          </Stack>
                        ),
                      )}
                  </>
                )}
                {draft &&
                  suggestion.workflows.some(
                    ({ currentBoardId }) =>
                      currentBoardId &&
                      (draft.action === 'create' ||
                        (draft.board && draft.board.id !== currentBoardId)),
                  ) && (
                    <Text size="sm" c="dimmed">
                      This moves workflows from their current boards.
                    </Text>
                  )}
              </Stack>
            </fieldset>
          );
        })}
      </Stack>
    </section>
  );
}
