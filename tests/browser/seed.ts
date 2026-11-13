import { blankDefinition } from '@interlock/core';
import type { Engine } from '@interlock/runtime';

/** Representative data for screenshot and accessibility coverage of the main screens. */
export function seedScreens(engine: Engine) {
  const board = engine.boards.save({
    name: 'Release delivery',
    columns: [{ name: 'Draft' }, { name: 'Review' }, { name: 'Done' }],
    workflowIds: [],
  });
  const definition = blankDefinition();
  definition.nodes[1].label = 'Draft release notes';
  definition.nodes[1].boardColumnId = board.columns[1].id;
  const release = engine.create(
    'Release review',
    'Checks a release branch, drafts the notes, and waits for an agent to finish the review.',
    definition,
  );
  engine.publish(release.id);
  engine.create(
    'Incident triage',
    'Collects alerts and proposes an owner.',
    blankDefinition(),
  );
  engine.boards.assign({
    workflowId: release.id,
    boardId: board.id,
    expectedBoardId: null,
  });
  const runs = ['Release 0.3.0', 'Release 0.3.1'].map((title) =>
    engine.startSummary(release.id, {}, undefined, 1, undefined, {
      title,
      tags: { channel: 'stable' },
    }),
  );
  engine.variables.mutate({
    action: 'create',
    name: 'RELEASE_CHANNEL',
    kind: 'config',
    value: 'stable',
    description: 'Channel used for published builds.',
  });
  engine.variables.mutate({
    action: 'create',
    name: 'REVIEW_LIMIT',
    kind: 'config',
    value: '3',
  });
  return { board, release, run: runs[0] };
}
