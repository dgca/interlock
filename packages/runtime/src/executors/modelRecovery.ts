import {
  InterlockError,
  executorOperationSchema,
  type ManagedExecution,
  type WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';
import { errorText } from './configuration.js';
import {
  attemptsCollection,
  now,
  sessionsCollection,
  type Job,
  type Session,
} from './supervision.js';

/** Supervision operations model recovery shares with the manager. */
export interface ModelRecoveryHost {
  write(record: ManagedExecution): void;
  schedule(): void;
}

/** A refused model holds its assignment; retry_model resumes it in the same native session on a replacement model. */
export class ModelRecovery {
  constructor(
    private readonly engine: Pick<
      Engine,
      'store' | 'manageWorkHold' | 'manageWorkResources'
    >,
    private readonly jobs: Map<string, Job>,
    private readonly host: ModelRecoveryHost,
  ) {}
  private write(record: ManagedExecution) {
    this.host.write(record);
  }
  private schedule() {
    this.host.schedule();
  }
  holdForModel(job: Job, session: Session, error: Error) {
    this.engine.store.transaction(() => {
      const work = this.engine.store.get<WorkRequest>('work', job.work.id);
      if (
        work?.status !== 'claimed' ||
        work.token !== job.work.token ||
        work.attempt !== job.record.attempt
      )
        throw new InterlockError('The assignment claim changed');
      const held = this.engine.manageWorkHold({
        action: 'hold',
        workId: work.id,
        expectedAttempt: work.attempt,
        expectedRevision: work.holdRevision ?? 0,
        token: work.token,
        actor: 'managed-model-recovery',
        category: 'other',
        reason: errorText(error).slice(0, 1000),
        checkpointRef: `model:${job.record.id}`,
      });
      // The adapter returned only after confirming its process group stopped.
      this.engine.manageWorkResources({
        action: 'release',
        workId: work.id,
        expectedAttempt: work.attempt,
        actor: 'managed-model-recovery',
        confirmStopped: true,
      });
      session.usageUncertain = true;
      this.engine.store.put(sessionsCollection, session);
      job.record.state = 'needs_model';
      for (const request of job.record.requests)
        if (request.state === 'pending') request.state = 'cancelled';
      job.record.error = errorText(error);
      job.record.endedAt = now();
      if (!('holdRevision' in held))
        throw new InterlockError('Model hold was not recorded');
      job.record.modelRecovery = {
        sessionKey: job.sessionKey,
        holdRevision: held.holdRevision,
      };
      this.write(job.record);
    });
  }
  retryModel(executionId: string, model: string) {
    // Validate through the same public operation contract as MCP/CLI callers.
    const q = executorOperationSchema.parse({
      action: 'retry_model',
      executionId,
      model,
    });
    if (q.action !== 'retry_model')
      throw new InterlockError('Invalid model recovery');
    const result = this.engine.store.transaction(() => {
      const record = this.engine.store.get<ManagedExecution>(
        attemptsCollection,
        q.executionId,
      );
      if (record?.modelRecovery?.replacementModel === q.model)
        return { applied: false };
      const work =
        record && this.engine.store.get<WorkRequest>('work', record.workId);
      const recovery = record?.modelRecovery;
      if (
        !record ||
        record.state !== 'needs_model' ||
        !recovery ||
        work?.status !== 'held' ||
        work.attempt !== record.attempt ||
        work.holdRevision !== recovery.holdRevision ||
        work.hold?.checkpointRef !== `model:${record.id}`
      )
        throw new InterlockError(
          'This model request is no longer active. Inspect the assignment.',
        );
      if (this.jobs.has(work.id))
        throw new InterlockError('The rejected execution is still closing');
      const session = this.engine.store.get<Session>(
        sessionsCollection,
        recovery.sessionKey,
      );
      if (
        !session ||
        [...this.jobs.values()].some((j) => j.sessionKey === session.id)
      )
        throw new InterlockError('The native session is unavailable or busy');
      session.recoveryRequestedEffort ??= session.profile.effort ?? null;
      session.profile = { ...session.profile, model: q.model, effort: null };
      session.modelSource = 'recovery';
      session.effortSource = 'recovery';
      this.engine.store.put(sessionsCollection, session);
      record.modelRecovery = { ...recovery, replacementModel: q.model };
      record.state = 'failed';
      this.write(record);
      this.engine.manageWorkHold({
        action: 'resume',
        workId: work.id,
        expectedAttempt: work.attempt,
        expectedRevision: recovery.holdRevision,
        actor: 'managed-model-recovery',
      });
      return { applied: true };
    });
    this.schedule();
    return result;
  }
}
