import type { Run, WorkflowComparison } from '@interlock/core';
import type { Store } from '@interlock/storage';

export type TreeRun = Pick<Run, 'id' | 'parentRunId' | 'parentMode' | 'status'>;

export const active = (run: Pick<Run, 'status'>) =>
  run.status === 'queued' ||
  run.status === 'running' ||
  run.status === 'waiting';

/** Sample roots and their descendants as compact metadata, without unrelated retained runs. */
export function sampleRuns(store: Store, comparisons: WorkflowComparison[]) {
  return store.runScopes.trees(
    new Set(
      comparisons.flatMap((c) => c.samples.flatMap((s) => s.runId ?? [])),
    ),
  );
}

/** The root and its descendants among the supplied runs. */
export function tree<T extends Pick<Run, 'id' | 'parentRunId'>>(
  rootId: string,
  runs: T[],
) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of runs)
      if (r.parentRunId && ids.has(r.parentRunId) && !ids.has(r.id)) {
        ids.add(r.id);
        changed = true;
      }
  }
  return runs.filter((r) => ids.has(r.id));
}
