import type { Workflow } from '@interlock/core';

/** Use the same order for the initial target and the visible choices. */
export function workflowTargets<
  T extends Pick<Workflow, 'id' | 'name' | 'ownerWorkflowId' | 'archived'>,
>(workflows: T[], ownerId?: string, selectedId?: string) {
  return workflows
    .filter(
      (w) =>
        (!w.ownerWorkflowId || w.ownerWorkflowId === ownerId) &&
        (!w.archived || w.id === selectedId),
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.ownerWorkflowId)) -
          Number(Boolean(a.ownerWorkflowId)) || a.name.localeCompare(b.name),
    );
}
