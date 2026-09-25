import type { Run } from '@interlock/core';

/** Inspection includes all descendants; execution responsibility stops at detachment. */
export function detachedBoundary(
  id: string,
  rootId: string,
  runs: Map<string, Run>,
) {
  let run = runs.get(id);
  while (run && run.id !== rootId) {
    if (run.parentMode === 'detached') return run;
    run = run.parentRunId ? runs.get(run.parentRunId) : undefined;
  }
  return undefined;
}
