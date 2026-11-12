import { isDeepStrictEqual } from 'node:util';
import type {
  Run,
  RunStartOptions,
  RunStartReceipt,
  WorkflowDefinition,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { fingerprint } from './versionIdentity.js';
import { createRunProjector } from './runProjection.js';

const isGroupedChild = (run: Pick<Run, 'batchNodeId' | 'parallelBranch'>) =>
  Boolean(run.batchNodeId || run.parallelBranch);

/** Durable start gating. All mutations run inside the engine's transaction. */
export class RunAdmission {
  constructor(private store: Store) {}

  queue(
    run: Run,
    definition: WorkflowDefinition,
    options: RunStartOptions = {},
  ) {
    if (
      isGroupedChild(run) ||
      (!definition.maxActiveRuns &&
        !options.after?.length &&
        !(run.schedule?.waitForPrevious && run.schedule.previousRunIds.length))
    )
      return;
    run.status = 'queued';
    run.admission = {
      queuedAt: run.createdAt,
      priority: options.priority ?? 0,
      position: 1,
      after: (options.after ?? []).map((reference) => ({ reference })),
      blockers: [],
    };
  }

  promote(onPromoted: (run: Run) => void): boolean {
    let changed = false;
    const queue = this.store.queuedRuns();
    const positions = new Map<string, number>();
    for (const run of queue) {
      const before = structuredClone(run.admission);
      const admission = run.admission!;
      admission.position = (positions.get(run.workflowId) ?? 0) + 1;
      positions.set(run.workflowId, admission.position);
      const blockers: string[] = [];
      if (this.store.pauseHolds(run.workflowId).length)
        blockers.push('Workflow admission is paused');
      if (run.schedule?.waitForPrevious) {
        for (const id of run.schedule.previousRunIds) {
          let previous = this.store.get<Run>('runs', id);
          const seen = new Set<string>();
          while (previous?.chain?.nextRunId && !seen.has(previous.id)) {
            seen.add(previous.id);
            previous = this.store.get<Run>('runs', previous.chain.nextRunId);
          }
          if (
            previous &&
            ['queued', 'running', 'waiting'].includes(previous.status)
          )
            blockers.push(
              `Schedule predecessor ${previous.id}: ${previous.status}`,
            );
        }
      }
      for (const dependency of admission.after) {
        const ref = dependency.reference;
        if (!dependency.runId) {
          const matches = this.store
            .findRuns({
              ...('requestId' in ref
                ? { requestId: ref.requestId }
                : { externalTask: ref.externalTask }),
              rootOnly: false,
              limit: 1000,
            })
            .filter((r) => r.id !== run.id && !isGroupedChild(r));
          dependency.runId =
            'requestId' in ref
              ? (this.store.get<RunStartReceipt>(
                  'runStarts',
                  fingerprint(ref.requestId),
                )?.runId ?? matches[0]?.id)
              : matches[0]?.id;
        }
        let dependencyRun = dependency.runId
          ? this.store.get<Run>('runs', dependency.runId)
          : undefined;
        const seen = new Set<string>();
        while (dependencyRun?.chain?.nextRunId && !seen.has(dependencyRun.id)) {
          seen.add(dependencyRun.id);
          dependencyRun = this.store.get<Run>(
            'runs',
            dependencyRun.chain.nextRunId,
          );
        }
        const label =
          dependency.runId ??
          ('requestId' in ref
            ? `requestId ${ref.requestId}`
            : `externalTask ${ref.externalTask.system}/${ref.externalTask.id}`);
        if (!dependencyRun || dependencyRun.status !== 'completed')
          blockers.push(
            `Dependency ${label}: ${dependencyRun?.status ?? (dependency.runId ? 'missing history' : 'not found')}`.slice(
              0,
              500,
            ),
          );
      }
      const definition = this.store.getVersion(
        run.workflowId,
        run.version,
      )?.definition;
      if (!definition) blockers.push('Published definition is unavailable');
      if (definition?.maxActiveRuns) {
        const activeIds = this.store.activeAdmissionRunIds(run.workflowId);
        const excluded = definition.excludeStages;
        let count = activeIds.length;
        if (excluded?.length && count) {
          const project = createRunProjector(
            this.store,
            this.store.currentProjection(activeIds),
          );
          count = activeIds.filter(
            (id) => !excluded.includes(project(id).stage ?? ''),
          ).length;
        }
        if (count >= definition.maxActiveRuns)
          blockers.push(
            `Workflow capacity ${count}/${definition.maxActiveRuns}`,
          );
      }
      admission.blockers = blockers;
      if (!blockers.length) {
        run.status = 'running';
        admission.admittedAt = new Date().toISOString();
        run.updatedAt = admission.admittedAt;
        this.store.put('runs', run);
        onPromoted(run);
        changed = true;
      } else if (!isDeepStrictEqual(before, admission)) {
        this.store.put('runs', run);
      }
    }
    return changed;
  }
}
