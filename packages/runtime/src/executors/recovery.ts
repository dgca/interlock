import { setTimeout as delay } from 'node:timers/promises';
import {
  elapsedExcludingPausesMs,
  type ExecutorProfile,
  type ManagedExecution,
  type PauseHold,
  type Run,
  type WorkflowDefinition,
  type WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';

/** Recovery policy resolution and pause-aware retry timing for native executions. */
export class RecoveryPolicies {
  constructor(
    private readonly engine: Pick<Engine, 'store'>,
    private readonly host: { stopped(): boolean },
  ) {}
  private get stopped() {
    return this.host.stopped();
  }
  private getPauseHolds(
    workflowId?: string,
    includeReleased = false,
  ): PauseHold[] {
    if (typeof (this.engine.store as any).pauseHolds === 'function') {
      return (this.engine.store as any).pauseHolds(workflowId, includeReleased);
    }
    try {
      const list = this.engine.store.list<PauseHold>('pauseHolds');
      return list.filter((h) => {
        if (!includeReleased && h.releasedAt) return false;
        if (h.scope === 'library') return true;
        return workflowId && h.workflowId === workflowId;
      });
    } catch {
      return [];
    }
  }

  countTransientRetriesInWindow(
    record: ManagedExecution,
    windowMs: number,
    runId: string,
  ): number {
    const events = record.recoveryEvents ?? [];
    const retryEvents = events.filter(
      (e) => e.errorClass === 'transient' && e.action === 'retry',
    );
    if (!retryEvents.length) return 0;
    const nowMs = Date.now();
    const run = this.engine.store.get<Run>('runs', runId);
    const pauseHolds = run ? this.getPauseHolds(run.workflowId, true) : [];
    let count = 0;
    for (const event of retryEvents) {
      const eventMs = Date.parse(event.at);
      const { activeMs } = elapsedExcludingPausesMs(eventMs, nowMs, pauseHolds);
      if (activeMs <= windowMs) {
        count++;
      }
    }
    return count;
  }

  async sleepHonoringPauses(
    delayMs: number,
    runId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const stepMs = 50;
    let remainingMs = delayMs;
    while (remainingMs > 0) {
      if (signal.aborted || this.stopped) return;
      const run = this.engine.store.get<Run>('runs', runId);
      const isPaused = run
        ? this.getPauseHolds(run.workflowId, false).length > 0
        : false;
      if (!isPaused) {
        remainingMs -= stepMs;
      }
      await delay(stepMs);
    }
  }

  resolveRecoveryPolicies(work: WorkRequest, profile: ExecutorProfile) {
    const run = this.engine.store.get<Run>('runs', work.runId);
    let definition: WorkflowDefinition | undefined;
    if (run) {
      if (typeof (this.engine.store as any).getVersion === 'function') {
        const versionRecord = (this.engine.store as any).getVersion(
          run.workflowId,
          run.version,
        );
        definition = versionRecord?.definition;
      }
      if (!definition) {
        const wf = this.engine.store.get<{ draft?: WorkflowDefinition }>(
          'workflows',
          run.workflowId,
        );
        definition = wf?.draft;
      }
    }
    const node = definition?.nodes?.find((n) => n.id === work.nodeId);
    const workflow = definition;

    const continueOnMissingResult = {
      maxTurns:
        node?.kind === 'agent' &&
        node.continueOnMissingResult?.maxTurns !== undefined
          ? node.continueOnMissingResult.maxTurns
          : workflow?.continueOnMissingResult?.maxTurns !== undefined
            ? workflow.continueOnMissingResult.maxTurns
            : (profile.continueOnMissingResult?.maxTurns ?? 0),
      message:
        (node?.kind === 'agent' && node.continueOnMissingResult?.message) ||
        workflow?.continueOnMissingResult?.message ||
        profile.continueOnMissingResult?.message,
    };

    const transientRetry = {
      maxRetries:
        node?.kind === 'agent' && node.transientRetry?.maxRetries !== undefined
          ? node.transientRetry.maxRetries
          : workflow?.transientRetry?.maxRetries !== undefined
            ? workflow.transientRetry.maxRetries
            : (profile.transientRetry?.maxRetries ?? 0),
      windowMs:
        node?.kind === 'agent' && node.transientRetry?.windowMs !== undefined
          ? node.transientRetry.windowMs
          : workflow?.transientRetry?.windowMs !== undefined
            ? workflow.transientRetry.windowMs
            : (profile.transientRetry?.windowMs ?? 300_000),
      initialBackoffMs:
        node?.kind === 'agent' &&
        node.transientRetry?.initialBackoffMs !== undefined
          ? node.transientRetry.initialBackoffMs
          : workflow?.transientRetry?.initialBackoffMs !== undefined
            ? workflow.transientRetry.initialBackoffMs
            : (profile.transientRetry?.initialBackoffMs ?? 1000),
    };

    return { continueOnMissingResult, transientRetry };
  }
}
