import {
  definitionSchema,
  InterlockError,
  type WorkflowDefinition,
  type Workflow,
  type BoardImportSetup,
  type BoardImportResult,
  type BoardSuggestion,
} from '@interlock/core';
import type { Engine } from '@interlock/runtime';
import { fingerprint } from '@interlock/runtime/versionIdentity';
import {
  applyBoardImport,
  previewBoardImport,
} from '@interlock/runtime/boardImport';
import sdlc from '../../../workflows/sdlc.json';
import sdlcV2 from '../../../workflows/sdlc-v2.json';
import evaluate from '../../../workflows/evaluate.json';

const sdlcColumns = [
  { id: 'planning', name: 'Planning' },
  { id: 'implementation', name: 'Implementation' },
  { id: 'review', name: 'Review' },
  { id: 'delivery', name: 'Delivery' },
];
const sdlcBoard: BoardSuggestion = {
  id: 'sdlc-board',
  name: 'Software development',
  columns: sdlcColumns,
  stages: sdlcColumns.map((column) => ({ ...column, columnId: column.id })),
};
/** A portable bundle: a root workflow and the helpers it owns and calls. */
interface StarterBundle {
  rootId: string;
  workflows: {
    id: string;
    name: string;
    description: string;
    draft: unknown;
    versions: { definition: unknown }[];
  }[];
}
const bundleRoot = (bundle: StarterBundle) => {
  const root = bundle.workflows.find((w) => w.id === bundle.rootId)!;
  return {
    name: root.name,
    description: root.description,
    definition: root.draft,
  };
};
const sdlcV2Bundle = sdlcV2 as StarterBundle;
const catalog = [
  {
    id: 'sdlc',
    template: sdlc,
    boardSuggestion: sdlcBoard,
    summary: 'Plan, implement, and review a software change.',
    requirements:
      'Needs a coding agent with repository access and a fresh final reviewer.',
  },
  {
    // A separate identity: copies of the first SDLC starter keep theirs.
    id: 'sdlc-v2',
    template: bundleRoot(sdlcV2Bundle),
    bundle: sdlcV2Bundle,
    boardSuggestion: sdlcBoard,
    summary:
      'Plan, build, and review a change; adds the Plan review and Change review it calls.',
    requirements:
      'Needs a coding agent and a fresh reviewer. Set repoPath or a Git worktree per run.',
  },
  {
    id: 'evaluate-comparison',
    template: evaluate,
    boardSuggestion: undefined,
    summary: 'Evaluate retained comparison results against a fixed rubric.',
    requirements:
      'Needs a completed workflow comparison. Review mode requires a fresh reviewer.',
  },
] as const;
type Starter = (typeof catalog)[number];
const bundleOf = (s: Starter) => ('bundle' in s ? s.bundle : undefined);
interface Copy {
  id: string;
  starterId: string;
}
interface Receipt {
  id: string;
  requestHash: string;
  workflowId: string;
  created: boolean;
  boardSetup?: BoardImportResult;
}
function contentHash(definition: WorkflowDefinition) {
  const order = (a: { id: string }, b: { id: string }) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return fingerprint({
    ...definition,
    nodes: definition.nodes
      .map(({ position: _position, ...n }) => n)
      .sort(order),
    edges: [...definition.edges].sort(order),
  });
}
function existing(
  engine: Engine,
  starterId: string,
  definition: WorkflowDefinition,
  hasPortableStages = false,
  bundleId?: string,
) {
  const workflows = engine.store.workflows();
  const known = new Set(
    engine.store
      .list<Copy>('starterCopies')
      .filter((c) => c.starterId === starterId)
      .map((c) => c.id),
  );
  const tracked = workflows.find((w) => known.has(w.id) || w.id === bundleId);
  if (tracked) return tracked;
  const hashes = new Set([contentHash(definition)]);
  if (hasPortableStages)
    hashes.add(
      contentHash({
        ...definition,
        nodes: definition.nodes.map(({ stageId, stage, ...node }) => node),
      }),
    );
  const retained = engine.store.listVersions();
  return workflows.find((w) =>
    [
      w.draft,
      ...retained.filter((v) => v.workflowId === w.id).map((v) => v.definition),
    ].some((d) => {
      // Historical definitions may use node kinds the current schema no longer supports.
      const parsed = definitionSchema.safeParse(d);
      return parsed.success && hashes.has(contentHash(parsed.data));
    }),
  );
}
const reference = (w: Workflow) => ({
  id: w.id,
  name: w.name,
  archived: w.archived,
  latestVersion: w.latestVersion,
});
function starterBoardPreview(
  engine: Engine,
  workflow: {
    id: string;
    name: string;
    draft: WorkflowDefinition;
    boardSuggestion: BoardSuggestion;
  },
  includeBoardCatalog = true,
) {
  const preview = previewBoardImport(
    engine.store,
    {
      format: 'interlock-workflows',
      formatVersion: 11,
      rootId: workflow.id,
      workflows: [
        {
          ...workflow,
          description: '',
          ownerWorkflowId: null,
          draftRevision: 1,
          versions: [],
        },
      ],
    },
    includeBoardCatalog,
  );
  // The catalog ID identifies a template. Board setup always applies to a new copy.
  for (const suggestion of preview.suggestions)
    for (const member of suggestion.workflows) member.currentBoardId = null;
  return preview;
}

function setupForCopy(
  setup: BoardImportSetup,
  starterId: string,
  workflowId: string,
): BoardImportSetup {
  const replaceId = <T>(record: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key === starterId ? workflowId : key,
        value,
      ]),
    );
  return {
    requestId: setup.requestId,
    choices: setup.choices.map((choice) => ({
      ...choice,
      expectedBoards: replaceId(choice.expectedBoards),
      ...(choice.action === 'existing'
        ? { stageColumns: replaceId(choice.stageColumns) }
        : {}),
    })),
  };
}

/**
 * Give a new root copy its own published copies of the bundle's helpers, owned
 * by it, and point the root's Workflow steps at them. Each helper keeps a
 * permanent identity of its own: `<starter id>/<bundle helper id>`.
 */
function addHelpers(
  engine: Engine,
  starterId: string,
  bundle: StarterBundle,
  rootId: string,
) {
  const ids = new Map<string, { id: string; version: number }>();
  for (const helper of bundle.workflows) {
    if (helper.id === bundle.rootId) continue;
    const copy = engine.create(
      helper.name,
      helper.description,
      definitionSchema.parse(helper.versions.at(-1)!.definition),
      rootId,
    );
    engine.publish(copy.id);
    const version = engine.workflow(copy.id).latestVersion;
    ids.set(helper.id, { id: copy.id, version });
    engine.store.put<Copy>('starterCopies', {
      id: copy.id,
      starterId: `${starterId}/${helper.id}`,
    });
  }
  const root = engine.workflow(rootId);
  engine.update(rootId, {
    draftRevision: root.draftRevision,
    draft: {
      ...root.draft,
      nodes: root.draft.nodes.map((node) => {
        const target = node.kind === 'workflow' && ids.get(node.workflowId);
        return target
          ? { ...node, workflowId: target.id, version: target.version }
          : node;
      }),
    },
  });
}

export function listStarters(engine: Engine) {
  return catalog.map((s) => {
    const definition = definitionSchema.parse(s.template.definition),
      copy = existing(
        engine,
        s.id,
        definition,
        !!s.boardSuggestion,
        bundleOf(s)?.rootId,
      );
    const boardSetup =
      s.boardSuggestion &&
      starterBoardPreview(engine, {
        id: s.id,
        name: s.template.name,
        draft: definition,
        boardSuggestion: s.boardSuggestion,
      });
    return {
      id: s.id,
      name: s.template.name,
      description: s.summary,
      requirements: s.requirements,
      nodeCount: definition.nodes.length,
      ...(boardSetup ? { boardSetup } : {}),
      ...(copy ? { existing: reference(copy) } : {}),
    };
  });
}
export function importStarter(
  engine: Engine,
  q: {
    starterId: string;
    requestId: string;
    copy?: boolean;
    boardSetup?: BoardImportSetup;
  },
) {
  if (!q.requestId || q.requestId.length > 120 || !/\S/.test(q.requestId))
    throw new InterlockError(
      'Use a nonblank request key of at most 120 characters',
    );
  if (q.boardSetup && q.boardSetup.requestId !== q.requestId)
    throw new InterlockError(
      'Use the same requestId for the starter and board setup.',
    );
  const starter = catalog.find((s) => s.id === q.starterId);
  if (!starter) throw new InterlockError('Starter not found');
  return engine.store.transaction(() => {
    const id = fingerprint(q.requestId),
      requestHash = fingerprint({
        starterId: q.starterId,
        copy: q.copy ?? false,
        boardSetup: q.boardSetup,
      });
    const prior = engine.store.get<Receipt>('starterImports', id);
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new InterlockError(
          'Starter requestId was already used with different arguments',
        );
      const workflow = engine.store.get<Workflow>(
        'workflows',
        prior.workflowId,
      );
      if (!workflow)
        throw new InterlockError(
          'The imported workflow was deleted. Inspect the library before intentionally adding a new copy.',
        );
      return {
        workflow: reference(workflow),
        created: prior.created,
        ...(prior.boardSetup ? { boardSetup: prior.boardSetup } : {}),
      };
    }
    const definition = definitionSchema.parse(starter.template.definition);
    const found = q.copy
      ? undefined
      : existing(
          engine,
          starter.id,
          definition,
          !!starter.boardSuggestion,
          bundleOf(starter)?.rootId,
        );
    if (q.boardSetup && !starter.boardSuggestion)
      throw new InterlockError('This starter has no suggested board.');
    if (q.boardSetup && found)
      throw new InterlockError(
        'Choose another copy to set up a board for this starter.',
      );
    const workflow =
      found ??
      engine.create(
        starter.template.name,
        starter.template.description,
        definition,
      );
    let boardSetup: BoardImportResult | undefined;
    if (!found) {
      const boardSuggestion = starter.boardSuggestion;
      if (boardSuggestion) {
        engine.store.put<Workflow>('workflows', {
          ...workflow,
          boardSuggestion,
        });
        if (q.boardSetup) {
          const preview = starterBoardPreview(
            engine,
            { ...workflow, boardSuggestion },
            false,
          );
          boardSetup = applyBoardImport(
            engine.store,
            preview.suggestions,
            setupForCopy(q.boardSetup, starter.id, workflow.id),
          );
        }
      }
      const bundle = bundleOf(starter);
      if (bundle) addHelpers(engine, starter.id, bundle, workflow.id);
      engine.publish(workflow.id);
    }
    engine.store.put<Copy>('starterCopies', {
      id: workflow.id,
      starterId: starter.id,
    });
    engine.store.put<Receipt>('starterImports', {
      id,
      requestHash,
      workflowId: workflow.id,
      created: !found,
      ...(boardSetup ? { boardSetup } : {}),
    });
    return {
      workflow: reference(engine.workflow(workflow.id)),
      created: !found,
      ...(boardSetup ? { boardSetup } : {}),
    };
  });
}
