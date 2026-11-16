import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  checkAgentResult,
  InterlockError,
  modelSelectionSchema,
  type Json,
  type NodeExecution,
  type ResultCheck,
  type Run,
  type WorkflowDefinition,
  type WorkRequest,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Budgets } from './budgets.js';
import type { ContextContinuityGroups } from './contextContinuity.js';
import { message, now } from './engineHelpers.js';
import { ResultProcessingError, type Worker } from './engineTypes.js';
import type { ExecutorManager } from './executors/manager.js';
import { claimTokenHash, leaseCounts, expiredClaimMessage } from './leases.js';
import type { PauseHolds } from './pauseHolds.js';
import type { RunInspection } from './runInspection.js';
import type { Stalls } from './stalls.js';
import type { StepCompletion } from './stepCompletion.js';
import type { TrialEnvironments } from './trialEnvironments.js';
import type { Usage } from './usage.js';
import type { WorkResources } from './workResources.js';

class ExpiredClaimError extends InterlockError {}

/**
 * Agent work claims: claiming available work, holding the claim (ownership,
 * renewal), checking a result before submission, and releasing a failed or
 * expired claim for another attempt or failing its step.
 */
export class WorkClaims {
  constructor(
    private readonly store: Store,
    private readonly nowMs: () => number,
    private readonly run: (id: string) => Run,
    private readonly event: (run: Run, type: string, text: string) => void,
    private readonly definition: (
      run: Pick<Run, 'workflowId' | 'version'>,
    ) => WorkflowDefinition,
    private readonly pump: () => void,
    private readonly inspect: (
      id: string,
    ) => ReturnType<RunInspection['inspect']>,
    private readonly prepareResult: StepCompletion['prepareResult'],
    private readonly fail: (
      run: Run,
      execution: NodeExecution,
      error: string,
    ) => void,
    private readonly cancelTree: (id: string) => void,
    private readonly pauses: PauseHolds,
    private readonly executors: ExecutorManager,
    private readonly trials: TrialEnvironments,
    private readonly budgets: Budgets,
    private readonly contextGroups: ContextContinuityGroups,
    private readonly resources: WorkResources,
    private readonly usage: Usage,
    private readonly stalls: Stalls,
    private readonly inspection: RunInspection,
  ) {}
  claim(workId: string, worker: Worker, leaseSeconds?: number) {
    const modelSelection =
      worker.modelSelection === undefined
        ? undefined
        : modelSelectionSchema.parse(worker.modelSelection);
    this.pump();
    const claimed = this.store.transaction(() => {
      const work = this.store.get<WorkRequest>('work', workId);
      if (!work || work.status !== 'available')
        throw new InterlockError('Work is not available');
      if (work.cwdBlocked) {
        throw new InterlockError(work.cwdBlocked.reason);
      }
      this.pauses.assert(this.run(work.runId));
      this.executors.assertClaim(work, worker);
      this.trials.context(this.run(work.runId));
      if (work.context.mode === 'fresh' && !worker.freshContext)
        throw new InterlockError('This assignment requires fresh context');
      const missingTools = work.context.tools.filter(
        (t) => !worker.tools.includes(t),
      );
      const missingSkills = work.context.skills.filter(
        (s) => !worker.skills.includes(s),
      );
      if (missingTools.length || missingSkills.length)
        throw new InterlockError(
          `Missing capabilities: ${[...missingTools, ...missingSkills].join(', ')}`,
        );
      this.budgets.assertClaim(work.runId);
      work.status = 'claimed';
      work.availableUntil = undefined;
      work.attempt++;
      work.claimedAt = now();
      work.lastActivityAt = work.claimedAt;
      work.idleNudge = undefined;
      work.workerId = worker.workerId;
      work.modelSelection = modelSelection;
      this.contextGroups.claimed(work, worker.session);
      work.token = randomUUID();
      work.claimLeaseSeconds = leaseSeconds ?? work.leaseSeconds ?? 300;
      work.leaseUntil = new Date(
        this.nowMs() + work.claimLeaseSeconds * 1000,
      ).toISOString();
      this.resources.acquire(work);
      this.executors.claimed(work);
      if (work.resolvedCwd) {
        const run = this.run(work.runId);
        const execution = run.executions.find((e) => e.id === work.executionId);
        if (execution) {
          execution.resolvedCwd = work.resolvedCwd;
          this.store.put('runs', run);
        }
      }
      this.store.put('work', work);
      this.event(
        this.run(work.runId),
        'work.claimed',
        `${work.label} claimed by ${worker.workerId}`,
      );
      this.usage.claimed(work);
      this.budgets.refresh();
      this.resources.refresh();
      return this.inspection.describeWork(work);
    });
    this.executors.claimCommitted(workId);
    return claimed;
  }
  private owned(id: string, token: string) {
    const work = this.store.get<WorkRequest>('work', id);
    if (!work || work.token !== token)
      throw new InterlockError(
        (work &&
          expiredClaimMessage(work, token, this.run(work.runId).status)) ||
          'Claim token does not match',
      );
    if (work.status === 'completed') return work;
    if (work.status !== 'claimed')
      throw new InterlockError('Claim no longer active');
    if (this.stalls.deadlineExpired(work))
      throw new ExpiredClaimError('Maximum active execution duration reached');
    if (Date.parse(work.leaseUntil!) <= this.nowMs())
      throw new ExpiredClaimError('Claim expired');
    return work;
  }
  withClaim<T>(id: string, token: string, action: (work: WorkRequest) => T): T {
    this.pump();
    try {
      return this.store.transaction(() => action(this.owned(id, token)));
    } catch (error) {
      // The deadline can cross between the initial pump and the ownership check.
      // Process that expiry after rollback so its receipt and budget survive rejection.
      if (error instanceof ExpiredClaimError) {
        this.pump();
        const work = this.store.get<WorkRequest>('work', id)!;
        throw new InterlockError(
          expiredClaimMessage(work, token, this.run(work.runId).status) ??
            error.message,
        );
      }
      throw error;
    }
  }
  renew(id: string, token: string, leaseSeconds?: number) {
    return this.withClaim(id, token, (work) => {
      if (work.status !== 'claimed')
        throw new InterlockError('Work already completed');
      work.lastActivityAt = now();
      work.idleNudge = undefined;
      work.leaseUntil = new Date(
        this.nowMs() + (leaseSeconds ?? work.claimLeaseSeconds ?? 300) * 1000,
      ).toISOString();
      this.store.put('work', work);
      return this.inspection.describeWork(work);
    });
  }
  /** Read-only: do not pump, renew, or process expired claims. */
  preflightResult(id: string, token: string, output: Json): ResultCheck {
    const work = this.store.get<WorkRequest>('work', id);
    const report = (
      code: ResultCheck['code'],
      claimUsable = false,
    ): ResultCheck => ({
      code,
      accepted: false,
      alreadyAccepted: code === 'already_accepted',
      claimUsable,
      canSubmit: code === 'ready' || code === 'already_accepted',
      nextAction:
        code === 'ready'
          ? 'submit'
          : code === 'invalid_result'
            ? 'correct_result'
            : code === 'already_accepted' || code === 'completed_conflict'
              ? 'read_result'
              : 'inspect_work',
      diagnostics: { items: [], total: 0, truncated: false },
    });
    if (!work) return report('not_found');
    if (work.status === 'cancelled') return report('cancelled');
    if (work.status === 'held') return report('held');
    if (work.token !== token) {
      const expired = work.expiredClaims?.some(
        (receipt) => receipt.tokenHash === claimTokenHash(token),
      );
      return report(
        expired
          ? work.status === 'claimed'
            ? 'replaced'
            : 'expired'
          : 'invalid_claim',
      );
    }
    if (work.status === 'completed')
      return report(
        isDeepStrictEqual(work.output, output)
          ? 'already_accepted'
          : 'completed_conflict',
      );
    if (work.status !== 'claimed') return report('inactive');
    if (
      Date.parse(work.leaseUntil!) <= this.nowMs() ||
      this.stalls.deadlineExpired(work)
    )
      return report('expired');
    const diagnostics = checkAgentResult(
      work.outputSchema,
      work.resultRules,
      work.input,
      output,
    );
    let inspectMapping = false;
    if (!diagnostics.total) {
      const run = this.run(work.runId);
      const node = this.definition(run).nodes.find(
        (n) => n.id === work.nodeId,
      )!;
      try {
        if (node.routing || node.outputBindings)
          this.prepareResult(run, node, output);
      } catch (error) {
        inspectMapping =
          error instanceof ResultProcessingError &&
          error.setting === 'outputBindings';
        diagnostics.items.push({
          path: '',
          schemaPath:
            error instanceof ResultProcessingError ? `#/${error.setting}` : '#',
          rule: 'result_mapping',
          message: message(error).slice(0, 512),
          pathTruncated: false,
        });
        diagnostics.total = 1;
      }
    }
    return {
      ...report(diagnostics.total ? 'invalid_result' : 'ready', true),
      ...(inspectMapping ? { nextAction: 'inspect_work' as const } : {}),
      diagnostics,
    };
  }
  releaseFailure(
    work: WorkRequest,
    error: string,
    reason: 'failure' | 'expiry' | 'deadline' = 'failure',
  ) {
    this.resources.end(work, reason === 'deadline' ? 'expiry' : reason);
    this.usage.ended(work, reason === 'expiry' ? 'expired' : 'failed');
    if (reason === 'expiry' && work.trialEnvironment) {
      work.status = 'failed';
      work.error =
        'Local trial lease expired; stop the worker and reconcile cleanup before starting a new comparison';
      work.token = undefined;
      work.leaseUntil = undefined;
      this.store.put('work', work);
      this.event(this.run(work.runId), 'work.lease_expired', work.error);
      for (const id of this.trials.interrupt(this.run(work.runId)))
        this.cancelTree(id);
      return;
    }
    if (work.maxLeaseExpiries !== undefined) {
      if (reason === 'expiry')
        work.leaseExpiryCount = (work.leaseExpiryCount ?? 0) + 1;
      else work.failureCount = (work.failureCount ?? 0) + 1;
    }
    const exhausted =
      work.maxLeaseExpiries === undefined
        ? work.attempt - (work.heldClaimCount ?? 0) >= work.maxAttempts
        : (work.failureCount ?? 0) >= work.maxAttempts ||
          (work.leaseExpiryCount ?? 0) >= work.maxLeaseExpiries;
    if (reason === 'expiry') {
      this.event(
        this.run(work.runId),
        'work.lease_expired',
        `${work.label} (${work.id}): claim expired at ${work.leaseUntil} on ${leaseCounts(work)}. ` +
          (exhausted
            ? 'No attempts remain under the configured budget; inspect the run before explicitly retrying the failed step. '
            : 'Another attempt is available; inspect the run and reclaim available work. ') +
          'Renew before expiry or choose a longer claim lease.',
      );
      if (exhausted && work.maxLeaseExpiries !== undefined)
        error = 'Lease expiry budget exhausted';
    }
    work.error = error;
    work.token = undefined;
    work.leaseUntil = undefined;
    const run = this.run(work.runId);
    if (reason === 'deadline' && work.trialEnvironment) {
      const interrupted = this.trials.interrupt(run);
      work.status = 'failed';
      this.store.put('work', work);
      this.fail(
        run,
        run.executions.find((e) => e.id === work.executionId)!,
        error,
      );
      for (const id of interrupted) if (id !== run.id) this.cancelTree(id);
      this.executors.deadlineRevoked(work);
      return;
    }

    if (exhausted) {
      work.status = 'failed';
      this.fail(
        run,
        run.executions.find((e) => e.id === work.executionId)!,
        error,
      );
    } else {
      work.status = 'available';
      work.availableSince = now();
      work.lastActivityAt = undefined;
      const node = this.definition(run).nodes.find((n) => n.id === work.nodeId);
      work.availableUntil =
        node?.kind === 'agent' && node.unclaimedTimeoutMs !== undefined
          ? new Date(this.nowMs() + node.unclaimedTimeoutMs).toISOString()
          : undefined;
      this.event(run, 'work.retry', `${work.label}: ${error}`);
    }
    this.store.put('work', work);
    if (reason === 'deadline') this.executors.deadlineRevoked(work);
  }
  reportFailure(id: string, token: string, error: string) {
    const runId = this.withClaim(id, token, (work) => {
      if (work.status === 'completed')
        throw new InterlockError('Work already completed');
      this.releaseFailure(work, error);
      return work.runId;
    });
    this.pump();
    return this.inspect(runId);
  }
}
