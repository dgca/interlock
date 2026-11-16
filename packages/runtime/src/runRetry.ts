import { InterlockError, type Run } from '@interlock/core';
import type { Store } from '@interlock/storage';
import { terminal } from './engineHelpers.js';
import {
  uncertainClaimCollection,
  type UncertainClaim,
  uncertainOperationCollection,
  type UncertainOperation,
} from './quiescence.js';
import type { RunChains } from './runChains.js';
import type { RunInspection } from './runInspection.js';
import type { Testbench } from './testbench.js';
import type { VersionCleanup } from './versionCleanup.js';

/**
 * Retries failed runs: checks that nothing uncertain is still running, then
 * resumes the failed step or queues a Batch item within its parent's limit.
 */
export class RunRetry {
  constructor(
    private readonly store: Store,
    private readonly run: (id: string) => Run,
    private readonly save: (run: Run) => void,
    private readonly event: (run: Run, type: string, text: string) => void,
    private readonly pump: () => void,
    private readonly inspect: (
      id: string,
    ) => ReturnType<RunInspection['inspect']>,
    private readonly chains: RunChains,
    private readonly inspection: RunInspection,
    private readonly versions: VersionCleanup,
    private readonly testbench: Testbench,
  ) {}
  private assertResumeSafe(run: Run, checked = new Set<string>()) {
    if (checked.has(run.id)) return;
    checked.add(run.id);
    if (run.parallelBranch) {
      const attached = new Set(
        this.store
          .continuation(run.id)
          .runs.filter((child) => child.lifecycleRunId === run.id)
          .map((child) => child.id),
      );
      const claim = this.store.forRuns<UncertainClaim>(
        uncertainClaimCollection,
        attached,
      )[0];
      if (claim)
        throw new InterlockError(
          `Confirm stopped for revoked work ${claim.workId}, attempt ${claim.attempt}, before retrying the Parallel group`,
        );
      const operation = this.store.forRuns<UncertainOperation>(
        uncertainOperationCollection,
        attached,
      )[0];
      if (operation)
        throw new InterlockError(
          `Confirm stopped for run ${operation.runId}, execution ${operation.executionId}, before retrying the Parallel group`,
        );
    }
    const uncertain = run.executions.find(
      (step) => step.background?.state === 'uncertain',
    );
    if (uncertain)
      throw new InterlockError(
        `Reconcile the uncertain background Script in run ${run.id}, execution ${uncertain.id}, with stopped:true after inspecting processes and effects before retrying`,
      );
    const execution = run.executions.at(-1);
    if (
      execution?.kind !== 'workflow' &&
      execution?.kind !== 'batch' &&
      execution?.kind !== 'parallel'
    )
      return;
    for (const id of execution.childRunIds) {
      const child = this.run(id);
      if (
        child.parentMode !== 'detached' &&
        (child.status === 'failed' || child.status === 'cancelled')
      )
        this.assertResumeSafe(child, checked);
    }
  }
  resumeStep(run: Run) {
    // Retry admission also applies when a Workflow or Batch resumes a retained child.
    this.assertResumeSafe(run);
    const execution = run.executions.at(-1);
    run.status = 'running';
    run.error = undefined;
    if (!execution) {
      this.save(run);
      return;
    }
    // Cancellation can land between steps. Keep the completed execution and
    // its forwarded value so the next step starts at the persisted cursor.
    if (execution.nodeId === run.cursor && execution.status !== 'completed') {
      run.value = Object.hasOwn(execution, 'originalInput')
        ? execution.originalInput!
        : execution.input;
      if (execution.kind === 'script' || execution.kind === 'wait')
        run.nextScriptAttempt = (execution.attempt ?? 1) + 1;
      // Only dispatched child runs have progress to retain. Initialization
      // failures must resolve bindings and validate input again on retry.
      if (
        (execution.kind === 'batch' ||
          execution.kind === 'workflow' ||
          execution.kind === 'parallel') &&
        execution.childRunIds.length > 0
      ) {
        execution.status = 'waiting';
        execution.error = undefined;
        execution.completedAt = undefined;
        execution.retryChildRunIds = execution.childRunIds.filter((id) => {
          const child = this.run(id);
          return child.status === 'failed' || child.status === 'cancelled';
        });
      }
    }
    this.save(run);
    this.event(run, 'run.retried', 'Explicit retry requested');
  }
  retry(id: string) {
    this.store.transaction(() => {
      const run = this.run(id);
      if (run.status !== 'failed')
        throw new InterlockError('Only failed runs can be retried');
      if (run.parallelBranch)
        throw new InterlockError(
          'Retry the failed Parallel group from its parent run',
        );
      this.assertResumeSafe(run);
      this.chains.assertRetry(run);
      if (this.inspection.handledWorkflowFailure(run))
        throw new InterlockError(
          'This child failure was handled by its Workflow Failed route; inspect the parent recovery instead of retrying the child',
        );
      this.versions.assertRunnable(run);
      if (run.parentRunId && run.parentMode !== 'detached')
        this.versions.assertRunnable(this.run(run.parentRunId));
      if (
        run.parentRunId &&
        run.parentMode !== 'detached' &&
        terminal(this.run(run.parentRunId).status)
      )
        throw new InterlockError('Retry the failed parent run instead');
      this.testbench.assertRetryCapacity(run);
      if (run.parentRunId && run.parentMode !== 'detached') {
        const parent = this.run(run.parentRunId);
        const execution = parent.executions.at(-1);
        if (execution?.kind === 'batch' && execution.childRunIds.includes(id)) {
          execution.retryChildRunIds ??= [];
          if (!execution.retryChildRunIds.includes(id))
            execution.retryChildRunIds.push(id);
          this.save(parent);
          this.event(
            run,
            'run.retry-queued',
            'Explicit retry queued within parent concurrency limit',
          );
          return;
        }
      }
      this.resumeStep(run);
    });
    this.pump();
    return this.inspect(id);
  }
}
