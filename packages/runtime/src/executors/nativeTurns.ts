import type {
  ExecutorProfile,
  ManagedExecution,
  RecoveryEvent,
  WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';
import { errorText } from './configuration.js';
import { managedToolRun } from './interlockTools.js';
import type { RecoveryPolicies } from './recovery.js';
import { usageDelta, type BudgetStops } from './budgetStops.js';
import type { OperatorChannel } from './operator.js';
import type { ManagedTranscripts } from './transcripts.js';
import { resolveSessionName } from './continuity.js';
import {
  now,
  sessionsCollection,
  type Job,
  type Session,
} from './supervision.js';
import {
  HarnessResultError,
  HarnessCleanupError,
  HarnessModelError,
  classifyHarnessError,
  isModelRefusal,
  type HarnessAdapter,
  type HarnessResult,
  assignmentPrompt,
} from './contracts.js';
import { evaluateCommandOrUrlTemplate, sanitizeDeepLink } from './templates.js';

/** Supervision state and operations native turns share with the manager. */
export interface NativeTurnsHost {
  stopped(): boolean;
  write(record: ManagedExecution): void;
  log(record: ManagedExecution, message: string): void;
  recordRecoveryEvent(record: ManagedExecution, event: RecoveryEvent): void;
  interruptJob(job: Job, reason: string): void;
  holdForModel(job: Job, session: Session, error: Error): void;
  schedule(): void;
}

/** Runs a claimed native assignment through its harness turns: continuation, transient retry, holds and failure. */
export class NativeTurns {
  constructor(
    private readonly engine: Pick<
      Engine,
      | 'store'
      | 'stalls'
      | 'submit'
      | 'reportFailure'
      | 'manageWorkHold'
      | 'manageWorkResources'
      | 'run'
      | 'memory'
      | 'callTool'
    >,
    private readonly transcripts: ManagedTranscripts,
    private readonly recovery: RecoveryPolicies,
    private readonly budgetStops: BudgetStops,
    private readonly operator: OperatorChannel,
    private readonly jobs: Map<string, Job>,
    private readonly host: NativeTurnsHost,
  ) {}
  private get stopped() {
    return this.host.stopped();
  }
  private write(record: ManagedExecution) {
    this.host.write(record);
  }
  private log(record: ManagedExecution, message: string) {
    this.host.log(record, message);
  }
  private recordRecoveryEvent(record: ManagedExecution, event: RecoveryEvent) {
    this.host.recordRecoveryEvent(record, event);
  }
  private interruptJob(job: Job, reason: string) {
    this.host.interruptJob(job, reason);
  }
  private holdForModel(job: Job, session: Session, error: Error) {
    this.host.holdForModel(job, session, error);
  }
  private schedule() {
    this.host.schedule();
  }
  private resolveSessionName(work: WorkRequest, profile: ExecutorProfile) {
    return resolveSessionName(this.engine, work, profile);
  }

  private escalateTransientHold(
    job: Job,
    session: Session,
    record: ManagedExecution,
    reason: string,
  ) {
    this.engine.store.transaction(() => {
      const work = this.engine.store.get<WorkRequest>('work', job.work.id);
      if (
        work?.status !== 'claimed' ||
        work.token !== job.work.token ||
        work.attempt !== record.attempt
      )
        return;
      const holdReason = `Transient failure limit reached: ${reason}`.slice(
        0,
        1000,
      );
      try {
        this.engine.manageWorkHold({
          action: 'hold',
          workId: work.id,
          expectedAttempt: work.attempt,
          expectedRevision: work.holdRevision ?? 0,
          token: work.token,
          actor: 'managed-recovery',
          category: 'other',
          reason: holdReason,
          checkpointRef: `recovery:${record.id}`,
        });
      } catch (holdError) {
        this.interruptJob(
          job,
          'Could not hold transient failure assignment: ' +
            errorText(holdError),
        );
        return;
      }
      try {
        this.engine.manageWorkResources({
          action: 'release',
          workId: work.id,
          expectedAttempt: work.attempt,
          actor: 'managed-recovery',
          confirmStopped: true,
        });
      } catch {}
      session.usageUncertain = true;
      this.engine.store.put(sessionsCollection, session);
      record.state = 'needs_human';
      record.endedAt = now();
      record.error = holdReason;
      this.write(record);
    });
  }

  async execute(job: Job, adapter: HarnessAdapter, session: Session) {
    const r = job.record;
    this.transcripts.register(r);
    const { continueOnMissingResult, transientRetry } =
      this.recovery.resolveRecoveryPolicies(job.work, r.profile);
    const budget = this.budgetStops.attempt(job, session);

    try {
      while (!this.stopped && !job.abort.signal.aborted) {
        let continuationTurns = 0;
        let currentWork = job.work;
        let turnResult: HarnessResult | undefined;
        let turnSuccess = false;
        let receivedResult = false;

        try {
          while (!this.stopped && !job.abort.signal.aborted) {
            try {
              r.state = 'running';
              this.write(r);
              if (!adapter.recordsPrompt)
                this.transcripts.capture(
                  r,
                  { kind: 'user', text: assignmentPrompt(currentWork) },
                  [job.work.token ?? ''],
                );
              const sessionName = this.resolveSessionName(
                currentWork,
                r.profile,
              );
              turnResult = await adapter.run({
                profile: r.profile,
                command: r.command,
                cwd: r.cwd,
                sessionId: session.nativeId,
                sessionName,
                work: currentWork,
                signal: budget.turn(),
                onUsage: budget.observe,
                onTranscript: (event) => {
                  if (!job.abort.signal.aborted && !this.stopped)
                    this.transcripts.capture(r, event, [job.work.token ?? '']);
                },
                onMessageChannel: (send) => {
                  job.sendMessage = send;
                },
                onSession: (id, model) => {
                  if (job.abort.signal.aborted || this.stopped) return;
                  session.nativeId = id;
                  session.sessionName = sessionName;
                  r.sessionId = id;
                  r.sessionName = sessionName;
                  if (model) {
                    session.profile = { ...session.profile, model };
                    r.profile = session.profile;
                  }
                  const templateVars = {
                    sessionId: id,
                    workId: job.work.id,
                    runId: job.work.runId,
                    cwd: r.cwd,
                    sessionName,
                  };
                  const defaultResume =
                    r.profile.harness === 'pi'
                      ? `pi --session ${id}`
                      : r.profile.harness === 'claude-code'
                        ? `claude resume ${id}`
                        : undefined;
                  const resumeCommand =
                    (r.profile.resumeCommandTemplate
                      ? evaluateCommandOrUrlTemplate(
                          r.profile.resumeCommandTemplate,
                          templateVars,
                        )
                      : undefined) || defaultResume;
                  const deepLink = sanitizeDeepLink(
                    r.profile.deepLinkTemplate
                      ? evaluateCommandOrUrlTemplate(
                          r.profile.deepLinkTemplate,
                          templateVars,
                        )
                      : undefined,
                  );
                  if (resumeCommand) {
                    session.resumeCommand = resumeCommand;
                    r.resumeCommand = resumeCommand;
                  }
                  if (deepLink) {
                    session.deepLink = deepLink;
                    r.deepLink = deepLink;
                  }
                  this.engine.store.put(sessionsCollection, session);
                  this.write(r);
                },
                onProgress: (message) => {
                  if (!job.abort.signal.aborted && !this.stopped) {
                    this.engine.stalls.activity(
                      job.work.id,
                      job.work.attempt,
                      job.work.token,
                    );
                    this.log(r, message);
                  }
                },
                ...managedToolRun(
                  this.engine,
                  currentWork,
                  r,
                  (message) => this.log(r, message),
                  () => !job.abort.signal.aborted && !this.stopped,
                ),
                ...this.operator.sessionRequests(job),
              });
              job.sendMessage = undefined;
              if (turnResult?.resumeCommand) {
                session.resumeCommand = turnResult.resumeCommand;
                r.resumeCommand = turnResult.resumeCommand;
              }
              if (turnResult?.deepLink) {
                const clean = sanitizeDeepLink(turnResult.deepLink);
                if (clean) {
                  session.deepLink = clean;
                  r.deepLink = clean;
                }
              }
              turnSuccess = true;
              receivedResult = true;
              break;
            } catch (turnError) {
              if (this.stopped || job.abort.signal.aborted) return;
              if (budget.stopped) throw turnError; // Never start another turn.
              const classification = classifyHarnessError(turnError);
              if (classification.errorClass === 'missing_result') {
                if (continuationTurns < continueOnMissingResult.maxTurns) {
                  continuationTurns++;
                  const continuationPrompt =
                    continueOnMissingResult.message ||
                    'Your previous turn completed without returning the required structured result envelope. Please return a JSON object with one field, "result", matching the output schema.';
                  this.recordRecoveryEvent(r, {
                    errorClass: 'missing_result',
                    messageExcerpt: classification.reason.slice(0, 200),
                    action: 'continue',
                    at: now(),
                  });
                  this.log(
                    r,
                    `Turn ended without structured result. Sending continuation prompt (${continuationTurns}/${continueOnMissingResult.maxTurns})...`,
                  );
                  currentWork = { ...job.work, prompt: continuationPrompt };
                  continue;
                } else {
                  this.recordRecoveryEvent(r, {
                    errorClass: 'missing_result',
                    messageExcerpt: classification.reason.slice(0, 200),
                    action: 'fail',
                    at: now(),
                  });
                  throw turnError;
                }
              }
              throw turnError;
            }
          }

          if (turnSuccess && turnResult) {
            if (this.stopped || job.abort.signal.aborted) return;
            const usage =
              turnResult.usage &&
              (turnResult.usageScope === 'attempt'
                ? turnResult.usage
                : usageDelta(
                    turnResult.usage,
                    session.nativeId && session.usageUncertain
                      ? null
                      : (session.usage ?? []),
                  ));
            if (turnResult.usage && turnResult.usageScope !== 'attempt') {
              session.usage = turnResult.usage;
              session.usageUncertain = false;
              this.engine.store.put(sessionsCollection, session);
            }
            budget.complete(usage);
            // Validation and duplicate handling stay in the ordinary submission path.
            this.engine.submit(job.work.id, job.work.token!, turnResult.output);
            r.state = 'completed';
            r.endedAt = now();
            this.write(r);
            return;
          }
        } catch (error) {
          if (this.stopped || job.abort.signal.aborted) return;
          if (budget.stopped)
            return this.budgetStops.release(job, session, budget);
          const classification = classifyHarnessError(error);
          if (error instanceof HarnessCleanupError) {
            this.interruptJob(
              job,
              errorText(error) +
                '. Confirm the old session stopped before retrying.',
            );
            return;
          }

          if (error instanceof HarnessModelError || isModelRefusal(error)) {
            this.recordRecoveryEvent(r, {
              errorClass: 'permanent',
              messageExcerpt: classification.reason.slice(0, 200),
              action: 'fail',
              at: now(),
            });
            try {
              this.holdForModel(
                job,
                session,
                error instanceof Error
                  ? error
                  : new Error(classification.reason),
              );
            } catch (holdError) {
              this.interruptJob(
                job,
                'Could not hold the rejected model assignment: ' +
                  errorText(holdError),
              );
            }
            return;
          }

          if (classification.errorClass === 'transient') {
            if (transientRetry.maxRetries > 0) {
              const recentRetries = this.recovery.countTransientRetriesInWindow(
                r,
                transientRetry.windowMs,
                job.work.runId,
              );
              if (recentRetries < transientRetry.maxRetries) {
                const delayMs =
                  transientRetry.initialBackoffMs * Math.pow(2, recentRetries);
                this.recordRecoveryEvent(r, {
                  errorClass: 'transient',
                  messageExcerpt: classification.reason.slice(0, 200),
                  action: 'retry',
                  at: now(),
                });
                this.log(
                  r,
                  `Transient error: ${classification.reason.slice(0, 100)}. Retrying with backoff in ${delayMs}ms (${recentRetries + 1}/${transientRetry.maxRetries})...`,
                );
                await this.recovery.sleepHonoringPauses(
                  delayMs,
                  job.work.runId,
                  job.abort.signal,
                );
                if (this.stopped || job.abort.signal.aborted) return;
                continue; // Retry turn
              } else {
                // Escalate to Needs attention hold!
                this.recordRecoveryEvent(r, {
                  errorClass: 'transient',
                  messageExcerpt: classification.reason.slice(0, 200),
                  action: 'escalate',
                  at: now(),
                });
                this.escalateTransientHold(
                  job,
                  session,
                  r,
                  classification.reason,
                );
                return;
              }
            } else {
              this.recordRecoveryEvent(r, {
                errorClass: 'transient',
                messageExcerpt: classification.reason.slice(0, 200),
                action: 'fail',
                at: now(),
              });
            }
          } else if (classification.errorClass === 'permanent') {
            this.recordRecoveryEvent(r, {
              errorClass: 'permanent',
              messageExcerpt: classification.reason.slice(0, 200),
              action: 'fail',
              at: now(),
            });
          }

          if (!receivedResult && !(error instanceof HarnessResultError)) {
            this.interruptJob(
              job,
              'Harness execution was lost: ' +
                errorText(error) +
                '. Inspect external effects and confirm the old session stopped before retrying.',
            );
            return;
          }

          r.state = 'failed';
          r.endedAt = now();
          r.error = errorText(error);
          this.write(r);
          const current = this.engine.store.get<WorkRequest>(
            'work',
            job.work.id,
          );
          if (
            current?.status === 'claimed' &&
            current.token === job.work.token
          ) {
            // An explicit failed attempt uses the existing bounded failure budget.
            try {
              this.engine.reportFailure(job.work.id, job.work.token!, r.error);
            } catch {}
          }
          session.usageUncertain = true;
          this.engine.store.put(sessionsCollection, session);
          return;
        }
      }
    } finally {
      budget.complete();
      job.sendMessage = undefined;
      for (const answer of job.answers.values())
        answer.reject(new Error('Execution ended'));
      this.jobs.delete(job.work.id);
      if (!this.stopped) this.schedule();
    }
  }
}
