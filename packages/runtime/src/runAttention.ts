import type {
  Run,
  StallRecord,
  RunAttention,
  RunAttentionReason,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

/** Human decisions roll up through owned work and stop at detached boundaries. */
export function runAttention(store: Store): RunAttention[] {
  const work = store.attentionWork();
  const runs = new Map(
    store
      .attentionAncestors(new Set(work.map((w) => w.runId)))
      .map((run) => [run.id, run]),
  );
  const result = new Map<string, RunAttention>();
  for (const assignment of work) {
    const reasons: RunAttentionReason[] =
      assignment.state === 'interrupted'
        ? ['recovery']
        : assignment.state === 'needs_model'
          ? ['model']
          : [
              ...(assignment.pendingKinds.includes('permission')
                ? ['approval' as const]
                : []),
              ...(assignment.pendingKinds.includes('question')
                ? ['question' as const]
                : []),
            ];
    if (!reasons.length) continue;
    let run = runs.get(assignment.runId);
    if (!run) continue;
    const seen = new Set<string>();
    while (
      run.parentRunId &&
      run.parentMode !== 'detached' &&
      !seen.has(run.id)
    ) {
      seen.add(run.id);
      const parent = runs.get(run.parentRunId);
      if (!parent) break;
      run = parent;
    }
    const entry = result.get(run.id);
    if (entry) {
      for (const reason of reasons)
        if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    } else
      result.set(run.id, {
        runId: run.id,
        reasons,
        target: {
          runId: assignment.runId,
          executionId: assignment.executionId,
        },
      });
  }
  for (const stall of store.currentStalls()) {
    const found = store.get<Run>('runs', stall.runId);
    if (!found || !['running', 'waiting'].includes(found.status)) continue;
    let run: Run = found;
    const seen = new Set<string>();
    while (
      run.parentRunId &&
      run.parentMode !== 'detached' &&
      !seen.has(run.id)
    ) {
      seen.add(run.id);
      const parent: Run | undefined = store.get<Run>('runs', run.parentRunId);
      if (!parent) break;
      run = parent;
    }
    const entry = result.get(run.id);
    if (entry) {
      if (!entry.reasons.includes('stalled')) entry.reasons.push('stalled');
    } else
      result.set(run.id, {
        runId: run.id,
        reasons: ['stalled'],
        target: { runId: stall.runId, executionId: stall.executionId },
      });
  }
  return [...result.values()];
}
