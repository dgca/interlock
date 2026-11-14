import { z } from 'zod';
import type { ExternalTask } from './runStarts.js';
import { runWaitingSchema, type RunProjection } from './runProjection.js';
import { runTagsSchema, type RunTags } from './runTags.js';

const key = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\w.-]+$/, 'Use letters, digits, ".", "_" or "-"');
const label = z.string().trim().min(1).max(80);
const stage = z.string().trim().min(1).max(200);

/** Lane match statuses. `held` is a queued start parked until release. */
export const boardLaneStatuses = [
  'held',
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
] as const;
export type BoardLaneStatus = (typeof boardLaneStatuses)[number];

/** Every present condition must match; each list matches any of its values. */
const laneRuleSchema = z
  .object({
    stages: z.array(stage).min(1).max(50).optional(),
    status: z.array(z.enum(boardLaneStatuses)).min(1).optional(),
    waiting: z.array(runWaitingSchema.shape.kind).min(1).optional(),
    actor: z
      .array(z.enum(['agent', 'person', 'engine']))
      .min(1)
      .optional(),
    tags: runTagsSchema.optional(),
  })
  .strict();
export type LaneRule = z.infer<typeof laneRuleSchema>;

export const boardCardFieldSources = [
  'link',
  'workflow',
  'stage',
  'waiting',
  'actor',
  'spend',
  'age',
  'tags',
] as const;
/** A built-in source, or `node.<nodeId>` with an optional dot path into its latest output. */
const boardFieldSourceSchema = z.union([
  z.enum(boardCardFieldSources),
  z
    .string()
    .max(300)
    .regex(/^node\.[^.\s]+(\.\S+)?$/, 'Use node.<nodeId>.<path>'),
]);
const boardCardActions = [
  'open',
  'answer',
  'cancel',
  'backlog',
  'release',
] as const;
export type BoardCardAction = (typeof boardCardActions)[number];

export const boardTypeContentSchema = z
  .object({
    name: label,
    lanes: z
      .array(
        z
          .object({
            id: key,
            name: label,
            match: z.array(laneRuleSchema).min(1).max(10).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    fields: z
      .array(
        z.object({ id: key, label, source: boardFieldSourceSchema }).strict(),
      )
      .max(12)
      .default([]),
    actions: z
      .array(z.enum(boardCardActions))
      .max(boardCardActions.length)
      .default([...boardCardActions]),
  })
  .strict()
  .superRefine(({ lanes, fields }, ctx) => {
    const ids = lanes.map((lane) => lane.id);
    if (new Set(ids).size !== ids.length || ids.includes(unmappedLane.id))
      ctx.addIssue({
        code: 'custom',
        path: ['lanes'],
        message: `Lane IDs must be unique and cannot be "${unmappedLane.id}"`,
      });
    if (new Set(fields.map((field) => field.id)).size !== fields.length)
      ctx.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Field IDs must be unique',
      });
  });
export const saveBoardTypeSchema = z
  .object({
    id: key.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    type: boardTypeContentSchema,
  })
  .strict();
export type BoardTypeContent = z.infer<typeof boardTypeContentSchema>;
export type SaveBoardType = z.input<typeof saveBoardTypeSchema>;
export type BoardType = BoardTypeContent & { id: string; revision: number };

/** Which runs a typed board shows. Omitted workflowIds means every workflow. */
export const boardScopeSchema = z
  .object({
    workflowIds: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(1000)
      .optional(),
    tags: runTagsSchema.optional(),
    systems: z
      .array(z.string().trim().min(1).max(64))
      .min(1)
      .max(50)
      .optional(),
  })
  .strict();
export type BoardScope = z.infer<typeof boardScopeSchema>;
/** Per workflow: authored stage name → the board type's stage name. */
export const boardStageMapSchema = z.record(
  z.string().min(1).max(200),
  z.record(stage, stage),
);
/** Per workflow: field ID → a `node.<nodeId>.<path>` source for that workflow. */
export const boardFieldPathsSchema = z.record(
  z.string().min(1).max(200),
  z.record(key, boardFieldSourceSchema),
);

export const unmappedLane = { id: 'unmapped', name: 'Unmapped' } as const;

export const boardViewQuerySchema = z
  .object({
    id: z.string().min(1).max(200).optional(),
    workflowId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("With no id, that workflow's own stage board."),
    lane: z.string().min(1).max(200).optional(),
    offset: z.number().int().nonnegative().max(100_000).default(0),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strict()
  .refine((query) => query.id || query.workflowId, 'Pass id or workflowId');
export type BoardViewQuery = z.input<typeof boardViewQuerySchema>;

/** Facts one lane rule can test, taken from the run that places a card. */
export type LaneFacts = {
  status: BoardLaneStatus;
  stage: string | null;
  waiting: RunProjection['waiting'];
  actor: RunProjection['actor'];
  tags?: RunTags;
};

function laneMatches(rule: LaneRule, facts: LaneFacts) {
  return (
    (!rule.status || rule.status.includes(facts.status)) &&
    (!rule.stages || (!!facts.stage && rule.stages.includes(facts.stage))) &&
    (!rule.waiting ||
      (!!facts.waiting && rule.waiting.includes(facts.waiting.kind))) &&
    (!rule.actor || rule.actor.includes(facts.actor)) &&
    Object.entries(rule.tags ?? {}).every(
      ([name, value]) => facts.tags?.[name] === value,
    )
  );
}

/** The first lane whose rules match wins; a card no lane matches is Unmapped. */
export function placeInLane(
  lanes: Pick<BoardTypeContent['lanes'][number], 'id' | 'match'>[],
  facts: LaneFacts,
) {
  return (
    lanes.find(
      (lane) =>
        !lane.match || lane.match.some((rule) => laneMatches(rule, facts)),
    )?.id ?? unmappedLane.id
  );
}

const activeStatuses = new Set(['queued', 'running', 'waiting']);
/**
 * The run that places a card spanning several runs: a run waiting on a person
 * first, then the newest active run, then the newest run.
 */
export function placingRun<
  T extends { status: string; createdAt: string; actor: string },
>(runs: T[]): T {
  const newest = [...runs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const active = newest.filter((run) => activeStatuses.has(run.status));
  return active.find((run) => run.actor === 'person') ?? active[0] ?? newest[0];
}

/** Runs sharing an external task form one card; otherwise a run chain does. */
export function boardCardKey(run: {
  id: string;
  externalTask?: Pick<ExternalTask, 'system' | 'id'>;
  chain?: { rootRunId: string };
}) {
  return run.externalTask
    ? `task:${run.externalTask.system}/${run.externalTask.id}`
    : `run:${run.chain?.rootRunId ?? run.id}`;
}

/** The board each workflow gets without setup: its stages in graph order. */
export function workflowBoardType(name: string, stages: string[]): BoardType {
  const active = ['running', 'waiting'] as BoardLaneStatus[];
  return {
    id: 'workflow',
    revision: 0,
    name,
    lanes: [
      { id: 'backlog', name: 'Backlog', match: [{ status: ['held'] }] },
      { id: 'queued', name: 'Queued', match: [{ status: ['queued'] }] },
      {
        id: 'needs-you',
        name: 'Needs you',
        match: [{ status: active, actor: ['person'] }],
      },
      ...stages.map((stage, index) => ({
        id: `stage-${index + 1}`,
        name: stage,
        match: [{ status: active, stages: [stage] }],
      })),
      { id: 'done', name: 'Done', match: [{ status: ['completed'] }] },
      { id: 'failed', name: 'Failed', match: [{ status: ['failed'] }] },
      {
        id: 'cancelled',
        name: 'Cancelled',
        match: [{ status: ['cancelled'] }],
      },
    ],
    fields: [{ id: 'spend', label: 'Spend', source: 'spend' }],
    actions: [...boardCardActions],
  };
}
/** Workflow-board lanes hidden while empty; stage lanes always show. */
export const optionalWorkflowLanes = new Set([
  'backlog',
  'queued',
  'cancelled',
  unmappedLane.id,
]);

const working = { status: ['running', 'waiting'] } as const;
const stageLane = (id: string, name: string, actor = false) => ({
  id,
  name,
  match: [
    {
      ...working,
      stages: [name],
      ...(actor ? { actor: ['agent', 'engine'] as const } : {}),
    },
  ],
});
const [coding, design, research] = boardTypeContentSchema.array().parse([
  {
    name: 'Coding',
    lanes: [
      { id: 'backlog', name: 'Backlog', match: [{ status: ['held'] }] },
      { id: 'ready', name: 'Ready', match: [{ status: ['queued'] }] },
      stageLane('plan', 'Plan', true),
      stageLane('build', 'Build', true),
      stageLane('review', 'Review', true),
      {
        id: 'needs-you',
        name: 'Needs you',
        match: [{ ...working, actor: ['person'] }, { status: ['failed'] }],
      },
      stageLane('accept', 'Accept', true),
      { id: 'done', name: 'Done', match: [{ status: ['completed'] }] },
      {
        id: 'cancelled',
        name: 'Cancelled',
        match: [{ status: ['cancelled'] }],
      },
    ],
    fields: [
      { id: 'link', label: 'Task', source: 'link' },
      { id: 'pr', label: 'Pull request', source: 'node.open_pr.url' },
      { id: 'spend', label: 'Spend', source: 'spend' },
    ],
  },
  {
    name: 'Design',
    lanes: [
      stageLane('brief', 'Brief'),
      stageLane('explore', 'Explore'),
      {
        id: 'critique',
        name: 'Critique',
        match: [
          { ...working, stages: ['Critique'] },
          { ...working, actor: ['person'] },
        ],
      },
      stageLane('refine', 'Refine'),
      stageLane('handoff', 'Handoff'),
      { id: 'done', name: 'Done', match: [{ status: ['completed'] }] },
    ],
    fields: [
      { id: 'link', label: 'Brief', source: 'link' },
      { id: 'age', label: 'Age', source: 'age' },
    ],
  },
  {
    name: 'Research',
    lanes: [
      {
        id: 'question',
        name: 'Question',
        match: [
          { status: ['held', 'queued'] },
          { ...working, stages: ['Question'] },
        ],
      },
      stageLane('gathering', 'Gathering'),
      stageLane('synthesis', 'Synthesis'),
      {
        id: 'review',
        name: 'Review',
        match: [
          { ...working, stages: ['Review'] },
          { ...working, actor: ['person'] },
        ],
      },
      {
        id: 'published',
        name: 'Published',
        match: [{ status: ['completed'] }],
      },
      {
        id: 'abandoned',
        name: 'Abandoned',
        match: [{ status: ['failed', 'cancelled'] }],
      },
    ],
    fields: [
      { id: 'link', label: 'Question', source: 'link' },
      { id: 'spend', label: 'Spend', source: 'spend' },
    ],
  },
]);
/** Starting points for new board types; copied, never referenced. */
export const boardTypePresets = { coding, design, research };
