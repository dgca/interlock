import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  workflowLayoutInputSchema,
  workflowPositionsSchema,
  type Workflow,
  type WorkflowLayout,
  type WorkflowPositions,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

export function readWorkflowLayout(store: Store, id: string): WorkflowLayout {
  return (
    store.get<WorkflowLayout>('workflowLayouts', id) ?? {
      id,
      revision: 0,
      positions: {},
    }
  );
}

export function saveWorkflowLayout(
  store: Store,
  input: { id: string; expectedRevision: number; positions: WorkflowPositions },
): WorkflowLayout {
  const request = workflowLayoutInputSchema.parse(input);
  return store.transaction(() => {
    if (!store.get<Workflow>('workflows', request.id))
      throw new InterlockError('Workflow not found');
    const current = readWorkflowLayout(store, request.id);
    if (request.expectedRevision !== current.revision)
      throw new InterlockError(
        'Layout changed elsewhere. Reload before saving.',
      );
    const positions = workflowPositionsSchema.parse({
      ...current.positions,
      ...request.positions,
    });
    if (isDeepStrictEqual(current.positions, positions)) return current;
    const next = { id: request.id, revision: current.revision + 1, positions };
    store.put('workflowLayouts', next);
    return next;
  });
}

/** Legacy draft authoring already serializes writes in the store transaction. */
export function persistWorkflowPositions(
  store: Store,
  id: string,
  positions: WorkflowPositions,
) {
  return saveWorkflowLayout(store, {
    id,
    expectedRevision: readWorkflowLayout(store, id).revision,
    positions,
  });
}
