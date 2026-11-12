import { randomUUID } from 'node:crypto';
import {
  InterlockError,
  boardSettingsRevisionConflict,
  type BoardMembership,
  type BoardQuery,
  type BoardRun,
  type RunProjection,
  type SaveBoard,
  type Workflow,
  type WorkflowBoard,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Requests } from './requests.js';

const collection = 'workflowBoards';
const terminalWindowMs = 86_400_000;
const terminalLimit = 20;

export class WorkflowBoards {
  constructor(
    private store: Store,
    private requests: Requests,
    private projectRun: (id: string) => RunProjection,
    private now: () => number,
    private changed: () => void,
  ) {}

  list() {
    const workflows = this.store.workflows();
    const boards = this.store.list<WorkflowBoard>(collection);
    if (!boards.length) return [];
    const boardByWorkflow = new Map(
      workflows.map((workflow) => [workflow.id, workflow.boardId]),
    );
    const requests = this.requests.byCard();
    const counts = new Map<string, number>();
    for (const card of this.store.attentionAncestors(
      new Set(requests.keys()),
    )) {
      const boardId = boardByWorkflow.get(card.workflowId);
      const count = requests.get(card.id)?.length;
      if (boardId && count)
        counts.set(boardId, (counts.get(boardId) ?? 0) + count);
    }
    return boards.map((board) => ({
      ...board,
      workflowIds: workflows
        .filter((workflow) => workflow.boardId === board.id)
        .map((workflow) => workflow.id),
      attentionCount: counts.get(board.id) ?? 0,
    }));
  }

  private get(id: string) {
    const board = this.store.get<WorkflowBoard>(collection, id);
    if (!board) throw new InterlockError('Board not found');
    return board;
  }

  settings(id: string) {
    const board = this.get(id);
    return {
      ...board,
      workflowIds: this.store
        .workflows()
        .filter((workflow) => workflow.boardId === id)
        .map((workflow) => workflow.id),
      protectedColumnIds: this.store.referencedBoardColumns(
        board.columns.map((column) => column.id),
      ),
    };
  }

  private membershipChanged(id: string | undefined) {
    if (!id) return;
    const board = this.get(id);
    this.store.put(collection, { ...board, revision: board.revision + 1 });
  }

  private workflow(id: string) {
    const workflow = this.store.get<Workflow>('workflows', id);
    if (!workflow) throw new InterlockError('Workflow not found');
    return workflow;
  }

  private writeMembership(workflow: Workflow, boardId?: string) {
    if (workflow.boardId === boardId) return workflow;
    this.store.put('workflows', { ...workflow, boardId });
    return { ...workflow, boardId };
  }

  assign(input: BoardMembership) {
    const workflow = this.store.transaction(() => {
      const workflow = this.workflow(input.workflowId);
      if ((workflow.boardId ?? null) !== input.expectedBoardId)
        throw new InterlockError(
          'Workflow board changed. Refresh and try again.',
        );
      if (input.boardId) this.get(input.boardId);
      if ((workflow.boardId ?? null) !== input.boardId) {
        this.membershipChanged(workflow.boardId);
        this.membershipChanged(input.boardId ?? undefined);
      }
      return this.writeMembership(workflow, input.boardId ?? undefined);
    });
    this.changed();
    return workflow;
  }

  save(input: SaveBoard) {
    const saved = this.store.transaction(() => {
      const current = input.id ? this.get(input.id) : undefined;
      if (current?.revision !== input.expectedRevision)
        throw new InterlockError(boardSettingsRevisionConflict);
      const existing = new Set(current?.columns.map((column) => column.id));
      const retained = new Set<string>();
      const columns = input.columns.map(({ id, name }) => {
        if (id && (!existing.has(id) || retained.has(id)))
          throw new InterlockError('Invalid or duplicate board column');
        if (id) retained.add(id);
        return { id: id ?? randomUUID(), name };
      });
      const removed = this.store.referencedBoardColumns(
        [...existing].filter((id) => !retained.has(id)),
      );
      if (removed.length) {
        const names = current?.columns
          .filter((column) => removed.includes(column.id))
          .map((column) => column.name);
        throw new InterlockError(
          `Columns still used by a workflow or retained run: ${names?.join(', ')}`,
        );
      }
      const board = {
        id: current?.id ?? randomUUID(),
        revision: (current?.revision ?? 0) + 1,
        name: input.name,
        columns,
      };
      const workflows = new Map(
        this.store.workflows().map((workflow) => [workflow.id, workflow]),
      );
      const selected = new Set(input.workflowIds);
      for (const id of selected) {
        const workflow = workflows.get(id);
        if (!workflow)
          throw new InterlockError('A selected workflow no longer exists');
        if (
          input.expectedBoards &&
          (workflow.boardId ?? null) !== input.expectedBoards[id]
        )
          throw new InterlockError(
            `The board for ${workflow.name} changed. Review the selection and try again.`,
          );
        if (workflow.boardId !== board.id)
          this.membershipChanged(workflow.boardId);
        this.writeMembership(workflow, board.id);
      }
      for (const workflow of workflows.values())
        if (workflow.boardId === board.id && !selected.has(workflow.id))
          this.writeMembership(workflow);
      this.store.put(collection, board);
      return board;
    });
    this.changed();
    return saved;
  }

  read(query: BoardQuery) {
    const board = this.get(query.id);
    const requests = this.requests.byCard();
    const page = this.store.boardRuns(
      board,
      query,
      Object.fromEntries([...requests].map(([id, open]) => [id, open.length])),
      new Date(this.now() - terminalWindowMs).toISOString(),
      terminalLimit,
    );
    const cards = new Map<string, ReturnType<typeof this.card>[]>();
    for (const { column, run } of page.cards) {
      const items = cards.get(column) ?? [];
      items.push(this.card(run, requests.get(run.id) ?? []));
      cards.set(column, items);
    }
    return {
      board,
      attentionCount: page.attentionCount,
      columns: [
        { id: 'queued', name: 'Queued' },
        { id: 'unstaged', name: 'Unstaged' },
        ...board.columns,
      ]
        .filter(
          (column) =>
            !['queued', 'unstaged'].includes(column.id) ||
            page.totals.has(column.id),
        )
        .map((column) => ({
          ...column,
          total: page.totals.get(column.id) ?? 0,
          cards: cards.get(column.id) ?? [],
        })),
    };
  }

  private card(run: BoardRun, open: ReturnType<Requests['current']>) {
    return {
      ...run,
      ...this.projectRun(run.runId),
      attentionCount: open.length,
      request: open[0]?.target,
      requestSummary: open
        .slice(0, 3)
        .map((request) => request.label)
        .join(' · '),
    };
  }
}
