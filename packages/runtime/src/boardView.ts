import {
  InterlockError,
  boardCardKey,
  boardViewQuerySchema,
  optionalWorkflowLanes,
  placeInLane,
  placingRun,
  readPath,
  summarizeUsage,
  unmappedLane,
  workflowBoardType,
  type BoardCardAction,
  type BoardLaneStatus,
  type BoardType,
  type BoardViewQuery,
  type Json,
  type Run,
  type RunProjection,
  type RunStatus,
  type Workflow,
  type WorkflowBoard,
  type WorkflowDefinition,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Requests } from './requests.js';
import type { Usage } from './usage.js';
import type { BoardTypes } from './boardTypes.js';
import type { WorkflowBoards } from './workflowBoards.js';

type CandidateRun = Pick<
  Run,
  | 'id'
  | 'workflowId'
  | 'workflowName'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'title'
  | 'externalTask'
  | 'tags'
  | 'chain'
  | 'admission'
  | 'parentRunId'
  | 'parentMode'
  | 'batchNodeId'
  | 'parallelBranch'
  | 'error'
> & { stepStartedAt?: string };
type Placed = CandidateRun & RunProjection;

const terminalWindowMs = 86_400_000;
const terminalLanePerCap = 20;
const terminalScanLimit = 500;
const terminalStatuses = ['completed', 'failed', 'cancelled'] as const;
const activeStatuses = new Set<RunStatus>(['queued', 'running', 'waiting']);

/** Stage names in graph order from Entry, then any unreachable stages. */
function graphStages(definition: WorkflowDefinition) {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const next = new Map<string, string[]>();
  for (const edge of definition.edges)
    next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = definition.nodes
    .filter((node) => node.kind === 'entry')
    .map((node) => node.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    queue.push(...(next.get(id) ?? []));
  }
  for (const node of definition.nodes)
    if (!seen.has(node.id)) order.push(node.id);
  return [...new Set(order.flatMap((id) => nodes.get(id)?.stage ?? []))];
}

const formatSpend = (
  costs: ReturnType<typeof summarizeUsage>['costs'],
): string | undefined => {
  const known = costs.filter((cost) => cost.amountMicros.value !== null);
  if (!known.length) return undefined;
  return known
    .map(({ currency, amountMicros }) => {
      const amount = new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
      }).format(amountMicros.value! / 1_000_000);
      return amountMicros.coverage === 'complete' ? amount : `≥ ${amount}`;
    })
    .join(' + ');
};

type Resolved = {
  board: Pick<WorkflowBoard, 'id' | 'name' | 'revision' | 'typeId'> & {
    kind: 'typed' | 'workflow';
  };
  type: BoardType;
  scope: NonNullable<WorkflowBoard['scope']>;
  stageMap: NonNullable<WorkflowBoard['stageMap']>;
  fieldPaths: NonNullable<WorkflowBoard['fieldPaths']>;
};

/**
 * Lanes and cards computed from run state on every read. Typed boards and
 * each workflow's own board share this projection; column boards keep their
 * recorded stage placement and are adapted to the same shape.
 */
export type BoardEngine = {
  projectRun(id: string): RunProjection;
  projectRuns<T extends { id: string }>(runs: T[]): (T & RunProjection)[];
  nowMs(): number;
  readonly usage: Usage;
};

export class BoardViews {
  constructor(
    private store: Store,
    private requests: Requests,
    private engine: BoardEngine,
    private boards: WorkflowBoards,
    private types: BoardTypes,
  ) {}

  private resolve(query: { id?: string; workflowId?: string }): Resolved {
    if (query.id) {
      const board = this.boards.get(query.id);
      if (!board.typeId) throw new InterlockError('Not a typed board');
      return {
        board: { ...board, kind: 'typed' },
        type: this.types.get(board.typeId),
        scope: board.scope ?? {},
        stageMap: board.stageMap ?? {},
        fieldPaths: board.fieldPaths ?? {},
      };
    }
    const workflow = this.store.get<Workflow>('workflows', query.workflowId!);
    if (!workflow) throw new InterlockError('Workflow not found');
    const definition =
      this.store.getVersion(workflow.id, workflow.latestVersion)?.definition ??
      workflow.draft;
    return {
      board: {
        id: `workflow:${workflow.id}`,
        name: workflow.name,
        revision: workflow.latestVersion,
        kind: 'workflow',
      },
      type: workflowBoardType(workflow.name, graphStages(definition)),
      scope: { workflowIds: [workflow.id] },
      stageMap: {},
      fieldPaths: {},
    };
  }

  /** Root and detached runs in scope: every active run plus the last day's finished runs. */
  private candidates(scope: Resolved['scope']): CandidateRun[] {
    const workflows = scope.workflowIds && new Set(scope.workflowIds);
    const systems = scope.systems && new Set(scope.systems);
    const inScope = (run: CandidateRun) =>
      (!run.parentRunId || run.parentMode === 'detached') &&
      !run.batchNodeId &&
      !run.parallelBranch &&
      (!workflows || workflows.has(run.workflowId)) &&
      (!systems || systems.has(run.externalTask?.system ?? '')) &&
      Object.entries(scope.tags ?? {}).every(
        ([name, value]) => run.tags?.[name] === value,
      );
    const runs: CandidateRun[] = this.store
      .activeRunState()
      .map(({ run, execution }) => ({
        ...run,
        ...(execution && { stepStartedAt: execution.startedAt }),
      }))
      .filter(inScope);
    const since = new Date(
      this.engine.nowMs() - terminalWindowMs,
    ).toISOString();
    const perWorkflow =
      scope.workflowIds && scope.workflowIds.length <= 10
        ? scope.workflowIds
        : [undefined];
    for (const workflowId of perWorkflow)
      for (const status of terminalStatuses)
        for (const found of this.store.findRuns({
          status,
          workflowId,
          tags: scope.tags,
          rootOnly: false,
          limit: terminalScanLimit,
        })) {
          if (found.updatedAt < since) continue;
          const run = this.store.currentRun(found.id);
          if (run && inScope(run)) runs.push(run);
        }
    return runs;
  }

  private cards(resolved: Resolved) {
    const placed = this.engine.projectRuns(this.candidates(resolved.scope));
    const groups = new Map<string, Placed[]>();
    for (const run of placed) {
      const key = boardCardKey(run);
      groups.set(key, [...(groups.get(key) ?? []), run]);
    }
    const requests = this.requests.byCard();
    return [...groups].map(([id, runs]) => {
      const run = placingRun(runs);
      const status: BoardLaneStatus =
        run.status === 'queued' && run.admission?.hold ? 'held' : run.status;
      const stage =
        (run.stage && resolved.stageMap[run.workflowId]?.[run.stage]) ||
        run.stage;
      const open = [
        ...new Set(runs.map((member) => member.chain?.rootRunId ?? member.id)),
      ].flatMap((cardId) => requests.get(cardId) ?? []);
      return {
        id,
        lane: placeInLane(resolved.type.lanes, {
          status,
          stage,
          waiting: run.waiting,
          actor: run.actor,
          tags: run.tags,
        }),
        runs,
        run,
        status,
        stage,
        open,
      };
    });
  }

  view(input: BoardViewQuery) {
    const query = boardViewQuerySchema.parse(input);
    if (query.id && !this.boards.get(query.id).typeId)
      return this.columnView(query);
    const resolved = this.resolve(query);
    const cards = this.cards(resolved);
    const lanes = [...resolved.type.lanes, unmappedLane].map((lane) => {
      const inLane = cards
        .filter((card) => card.lane === lane.id)
        .sort(
          (a, b) =>
            Number(b.open.length > 0) - Number(a.open.length > 0) ||
            b.run.updatedAt.localeCompare(a.run.updatedAt) ||
            a.id.localeCompare(b.id),
        );
      let finished = 0;
      const kept = inLane.filter(
        (card) =>
          activeStatuses.has(card.run.status) ||
          card.open.length > 0 ||
          ++finished <= terminalLanePerCap,
      );
      const page =
        query.lane === undefined || query.lane === lane.id
          ? kept.slice(query.offset, query.offset + query.limit)
          : [];
      return {
        id: lane.id,
        name: lane.name,
        total: kept.length,
        cards: page.map((card) => this.card(card, resolved)),
      };
    });
    return {
      board: resolved.board,
      fields: resolved.type.fields.map(({ id, label }) => ({ id, label })),
      actions: resolved.type.actions,
      attentionCount: cards.reduce((sum, card) => sum + card.open.length, 0),
      lanes: lanes.filter(
        (lane) =>
          lane.total > 0 ||
          (lane.id !== unmappedLane.id &&
            !(
              resolved.board.kind === 'workflow' &&
              optionalWorkflowLanes.has(lane.id)
            )),
      ),
    };
  }

  /** Request count for the Boards library; computes the same cards as the view. */
  attentionCount(board: WorkflowBoard) {
    try {
      return this.cards(this.resolve({ id: board.id })).reduce(
        (sum, card) => sum + card.open.length,
        0,
      );
    } catch (error) {
      if (error instanceof InterlockError) return 0;
      throw error;
    }
  }

  private card(
    card: ReturnType<BoardViews['cards']>[number],
    resolved: Resolved,
  ) {
    const { run, runs, open } = card;
    const fields: Record<string, Json> = {};
    for (const field of resolved.type.fields) {
      const source =
        resolved.fieldPaths[run.workflowId]?.[field.id] ?? field.source;
      const value = this.fieldValue(source, run, runs);
      if (value !== undefined && value !== null) fields[field.id] = value;
    }
    return {
      id: card.id,
      runId: run.id,
      runCount: runs.length,
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      ...(run.title && { title: run.title }),
      ...(run.externalTask && { externalTask: run.externalTask }),
      status: run.status,
      ...(card.status === 'held' && { held: run.admission!.hold! }),
      stage: card.stage,
      waiting: run.waiting,
      actor: run.actor,
      since: run.waiting?.since ?? run.stepStartedAt ?? run.updatedAt,
      createdAt: run.createdAt,
      changedAt: run.updatedAt,
      ...(run.tags && { tags: run.tags }),
      ...(run.status === 'failed' &&
        run.error && { error: run.error.slice(0, 240) }),
      attentionCount: open.length,
      ...(open[0] && { request: open[0].target }),
      ...(open.length && {
        requestSummary: open
          .slice(0, 3)
          .map((request) => request.label)
          .join(' · '),
      }),
      fields,
      actions: this.actions(card, resolved.type.actions),
    };
  }

  private actions(
    card: ReturnType<BoardViews['cards']>[number],
    allowed: BoardCardAction[],
  ) {
    const valid: Record<BoardCardAction, boolean> = {
      open: true,
      answer: card.open.length > 0,
      cancel: activeStatuses.has(card.run.status),
      backlog: card.status === 'queued',
      release: card.status === 'held',
    };
    return allowed.filter((action) => valid[action]);
  }

  private fieldValue(
    source: string,
    run: Placed,
    runs: Placed[],
  ): Json | undefined {
    switch (source) {
      case 'link':
        return run.externalTask?.url;
      case 'workflow':
        return run.workflowName;
      case 'stage':
        return run.stage;
      case 'waiting':
        return run.waiting?.detail.message ?? run.waiting?.kind;
      case 'actor':
        return run.actor;
      case 'age':
        return run.createdAt;
      case 'tags':
        return run.tags;
      case 'spend': {
        const scope = new Set(
          this.store
            .runTrees(new Set(runs.map((member) => member.id)))
            .map((member) => member.id),
        );
        return formatSpend(
          summarizeUsage(
            this.engine.usage.attemptsForRuns(scope),
            this.engine.usage.runReportsForRuns(scope),
          ).costs,
        );
      }
    }
    const [, nodeId, ...path] = source.split('.');
    for (const member of [...runs].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )) {
      const execution = this.store
        .get<Run>('runs', member.id)
        ?.executions.findLast(
          (step) => step.nodeId === nodeId && step.output !== undefined,
        );
      if (!execution) continue;
      try {
        const value = readPath(execution.output!, path.join('.'));
        return typeof value === 'string' ? value.slice(0, 500) : value;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /** Column boards keep recorded placement; this adapts them to lanes. */
  private columnView(query: ReturnType<typeof boardViewQuerySchema.parse>) {
    const read = this.boards.read({
      id: query.id!,
      status: 'all',
      column: query.lane,
      offset: query.offset,
      limit: query.limit,
    });
    return {
      board: { ...read.board, kind: 'columns' as const },
      fields: [],
      actions: ['open', 'answer'] as BoardCardAction[],
      attentionCount: read.attentionCount,
      lanes: read.columns.map((column) => ({
        id: column.id,
        name: column.name,
        total: column.total,
        cards: column.cards,
      })),
    };
  }
}
