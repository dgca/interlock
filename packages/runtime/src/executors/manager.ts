import { ManagedTranscripts } from './transcripts.js';
import {
  InterlockError,
  executorOperationSchema,
  resolveProvider,
  type ExecutorModels,
  type ExecutorProfile,
  type ExecutorProfileUpdate,
  type ManagedExecution,
  type ManagedWorkSummary,
  type WorkRequest,
  type ModelUsage,
  type RecoveryEvent,
  type UsageAttempt,
  type TranscriptPage,
  type MessageReceipt,
} from '@interlock/core';
import type { Engine, Worker } from '../index.js';
import { SchedulerErrors } from '../log.js';
import {
  ExecutorConfiguration,
  type ManagedAssignment,
} from './configuration.js';
import {
  LauncherSupervisor,
  type ClaimTicket,
  type LauncherSession,
} from './launcher.js';
import { OperatorChannel } from './operator.js';
import { RecoveryPolicies } from './recovery.js';
import { ModelRecovery } from './modelRecovery.js';
import { NativeTurns } from './nativeTurns.js';
import { ExecutorDispatch } from './dispatch.js';
import { resolveSessionName } from './continuity.js';
import { BudgetStops, inspected } from './budgetStops.js';
import {
  active,
  attemptsCollection,
  now,
  sessionsCollection,
  type Job,
  type Session,
} from './supervision.js';
import { type HarnessAdapter, assignmentPrompt } from './contracts.js';
import { sanitizeMessage } from './templates.js';

/** Queue and claim lifecycle are shared; adapters own native session protocols. */
export class ExecutorManager {
  readonly errors = new SchedulerErrors(() => [
    { apiToken: this.apiToken },
    ...this.profiles().flatMap((p) => [p.headers, p.env]),
  ]);
  private transcripts: ManagedTranscripts;
  private config: ExecutorConfiguration;
  private launcher: LauncherSupervisor;
  private operator: OperatorChannel;
  private recovery: RecoveryPolicies;
  private modelRecovery: ModelRecovery;
  private turns: NativeTurns;
  private dispatch: ExecutorDispatch;
  readonly budgetStops: BudgetStops;
  private adapters = new Map<string, HarnessAdapter>();
  private jobs = new Map<string, Job>();
  private claimTickets = new Map<string, ClaimTicket>();
  private launchedWork = new Map<string, LauncherSession>();
  private launchIdempotency = new Map<string, LauncherSession>();
  private launcherStops = new Map<string, Promise<void>>();
  private launcherCommands = new Map<string, Map<string, Promise<string>>>();
  private customCommands = new Set<{
    abort: AbortController;
    done: Promise<string>;
  }>();
  private running = false;
  private stopped = false;
  mcpUrl?: string; // Execute-profile MCP endpoint offered to launched sessions.
  apiToken?: string; // Required API token offered to launched sessions; never in the payload.
  private scheduled = false;
  private unsubscribe?: () => void;
  private interval?: ReturnType<typeof setInterval>;
  constructor(
    private engine: Engine,
    private defaultCwd: string,
  ) {
    this.transcripts = new ManagedTranscripts(engine);
    this.launcher = new LauncherSupervisor(
      engine,
      {
        errors: this.errors,
        stopped: () => this.stopped,
        mcpUrl: () => this.mcpUrl,
        apiToken: () => this.apiToken,
        latest: (workId) => this.latest(workId),
        write: (record) => this.write(record),
        log: (record, message) => this.log(record, message),
        interrupted: (record, reason) => this.interrupted(record, reason),
        recordRecoveryEvent: (record, event) =>
          this.recordRecoveryEvent(record, event),
        resolveSessionName: (work, profile) =>
          this.resolveSessionName(work, profile),
        stopExecution: (executionId) => this.stopExecution(executionId),
        schedule: () => this.schedule(),
      },
      {
        claimTickets: this.claimTickets,
        launchedWork: this.launchedWork,
        launchIdempotency: this.launchIdempotency,
        launcherStops: this.launcherStops,
        launcherCommands: this.launcherCommands,
        customCommands: this.customCommands,
      },
    );
    this.operator = new OperatorChannel(
      engine,
      this.transcripts,
      this.jobs,
      this.launchedWork,
      {
        stopped: () => this.stopped,
        write: (record) => this.write(record),
        checkJobs: () => this.checkJobs(),
        sendLauncherMessage: (session, message) =>
          this.sendLauncherMessage(session, message),
      },
    );
    this.recovery = new RecoveryPolicies(engine, {
      stopped: () => this.stopped,
    });
    this.modelRecovery = new ModelRecovery(engine, this.jobs, {
      write: (record) => this.write(record),
      schedule: () => this.schedule(),
    });
    this.budgetStops = new BudgetStops(engine, {
      write: (record) => this.write(record),
      interrupt: (job, reason) => this.interruptJob(job, reason),
    });
    this.turns = new NativeTurns(
      engine,
      this.transcripts,
      this.recovery,
      this.budgetStops,
      this.operator,
      this.jobs,
      {
        stopped: () => this.stopped,
        write: (record) => this.write(record),
        log: (record, message) => this.log(record, message),
        recordRecoveryEvent: (record, event) =>
          this.recordRecoveryEvent(record, event),
        interruptJob: (job, reason) => this.interruptJob(job, reason),
        holdForModel: (job, session, error) =>
          this.modelRecovery.holdForModel(job, session, error),
        schedule: () => this.schedule(),
      },
    );
    this.config = new ExecutorConfiguration(engine, defaultCwd, {
      adapters: () => this.adapters,
      running: () => this.running,
      stopped: () => this.stopped,
      schedule: () => this.schedule(),
    });
    this.dispatch = new ExecutorDispatch(
      engine,
      defaultCwd,
      this.config,
      this.launcher,
      this.budgetStops,
      {
        jobs: this.jobs,
        launchedWork: this.launchedWork,
        pendingLaunches: this.pendingLaunches,
      },
      {
        stopped: () => this.stopped,
        adapters: () => this.adapters,
        profiles: () => this.profiles(),
        settings: () => this.settings(),
        latest: (workId) => this.latest(workId),
        write: (record) => this.write(record),
        checkJobs: () => this.checkJobs(),
        launchCustom: (...args) => this.launchCustom(...args),
        execute: (job, adapter, session) => this.execute(job, adapter, session),
      },
    );
  }
  profiles() {
    return this.config.profiles();
  }
  get pull() {
    return this.launcher.pull;
  }
  configuredPresetProfile(profile: ExecutorProfile | undefined) {
    return this.config.configuredPresetProfile(profile);
  }
  /** Undefined means the version check is still pending. */
  presetProfileReady(profile: ExecutorProfile): boolean | undefined {
    return this.config.presetProfileReady(profile);
  }
  settings() {
    return this.config.settings();
  }
  saveSettings(input: unknown) {
    return this.config.saveSettings(input);
  }
  saveProfile(input: ExecutorProfileUpdate) {
    return this.launcher.pull.saved(this.config.saveProfile(input));
  }
  listProfiles(refresh = false) {
    return this.launcher.pull.annotate(this.config.listProfiles(refresh));
  }
  models(input: unknown): Promise<ExecutorModels> {
    return this.config.models(input);
  }
  async manage(input: unknown) {
    const q = executorOperationSchema.parse(input);
    switch (q.action) {
      case 'transcript': {
        const { action: _action, ...query } = q;
        return this.transcript(query);
      }
      case 'message': {
        const { action: _action, ...query } = q;
        return this.message(query);
      }
      case 'receipt': {
        const { action: _action, ...query } = q;
        return this.messageReceipt(query);
      }
      case 'settings':
        return this.settings();
      case 'save_settings': {
        const { action: _action, ...settings } = q;
        return this.saveSettings(settings);
      }
      case 'models': {
        const { action: _action, ...query } = q;
        return this.models(query);
      }
      case 'list':
        return this.listProfiles(q.refresh);
      case 'save':
        return this.saveProfile(q.profile);
      case 'inspect':
        return this.inspect(q.workId);
      case 'respond': {
        const { action: _action, ...response } = q;
        return this.respond(response);
      }
      case 'stop':
        return this.stopExecution(q.executionId);
      case 'retry_model':
        return this.retryModel(q.executionId, q.model);
      case 'reconcile':
        return this.confirmStopped(q.executionId, q.confirmStopped);
    }
  }
  private pendingLaunches = new Map<string, string>();
  start(adapters: HarnessAdapter[]) {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.adapters = new Map(adapters.map((a) => [a.id, a]));
    try {
      this.engine.store.transcripts.recover();
    } catch {
      /* Capture never prevents startup. */
    }
    this.transcripts.tick();
    // No process surviving a server loss is assumed to have stopped or completed.
    for (const record of this.engine.store.list<ManagedExecution>(
      attemptsCollection,
    ))
      if (active(record))
        this.interrupted(
          record,
          'Interlock restarted during execution. Stop the previous harness session and subprocesses, then confirm before retrying.',
        );
    this.unsubscribe = this.engine.store.subscribe(() => this.schedule());
    this.interval = setInterval(() => {
      this.transcripts.tick();
      this.checkJobs();
      this.schedule();
    }, 1000);
    this.interval.unref();
    this.schedule();
  }
  private schedule() {
    if (!this.running || this.stopped || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.scan().catch(this.errors.handler('executor scan'));
    });
  }
  private latest(workId: string) {
    return this.engine.store
      .forWork<ManagedExecution>(attemptsCollection, workId)
      .reverse()
      .sort((a, b) => b.attempt - a.attempt)[0];
  }
  executionProvenance(
    workId: string,
    attempt: number,
  ):
    | {
        profileId: string | null;
        harness: string | null;
        sessionId: string | null;
        requestedModel: string | null;
        actualModel: string | null;
        provider: string | null;
        effort: string | null;
        usage: ModelUsage[] | null;
      }
    | undefined {
    const job = this.jobs.get(workId);
    const record =
      (job && job.record.attempt === attempt ? job.record : undefined) ??
      this.engine.store.get<ManagedExecution>(
        attemptsCollection,
        `${workId}:${attempt}`,
      );
    if (!record) return undefined;
    const sessionKey = job?.sessionKey ?? record.sessionId;
    const session = sessionKey
      ? this.engine.store.get<Session>(sessionsCollection, sessionKey)
      : undefined;
    const usageAttempt = this.engine.store.get<UsageAttempt>(
      'usageAttempts',
      `${workId}:${attempt}`,
    );
    const usage =
      usageAttempt?.snapshot?.models ?? (job && session?.usage) ?? null;
    const actualModel =
      usage?.[0]?.model ??
      session?.requestedModel ??
      record.profile.model ??
      null;
    const provider =
      usage?.[0]?.provider ??
      resolveProvider({
        model: actualModel,
        profile: record.profile,
        prefixOverrides: this.settings().providerPrefixes,
      });

    return {
      profileId: record.profile.id,
      harness: record.profile.harness,
      sessionId: session?.id ?? record.sessionId ?? null,
      requestedModel: session?.requestedModel ?? record.profile.model ?? null,
      actualModel,
      provider,
      effort: record.profile.effort ?? null,
      usage: usage ?? null,
    };
  }
  describe(work: ManagedAssignment): ManagedWorkSummary | undefined {
    return this.dispatch.describe(work);
  }
  assertClaim(work: WorkRequest, worker?: Worker) {
    const ticketRecord = this.claimTickets.get(work.id);
    if (ticketRecord) {
      if (!worker?.claimTicket) {
        throw new InterlockError(
          'A claim ticket is required to claim this delegated assignment',
        );
      }
      if (worker.claimTicket !== ticketRecord.ticket) {
        throw new InterlockError('Invalid claim ticket');
      }
      if (ticketRecord.used) {
        throw new InterlockError('Claim ticket has already been used');
      }
      return;
    } else if (worker?.claimTicket) {
      throw new InterlockError(
        'No claim ticket was issued for this assignment',
      );
    }

    const record = this.latest(work.id);
    if (record?.state === 'needs_model')
      throw new InterlockError(
        'Choose a replacement through retry_model before claiming this assignment',
      );
    if (record && (active(record) || record.state === 'interrupted'))
      throw new InterlockError(
        'Managed execution is uncertain. Confirm that its old session and subprocesses stopped before claiming again.',
      );
  }
  claimCommitted(workId: string) {
    const ticket = this.claimTickets.get(workId);
    if (ticket) ticket.used = true;
  }
  claimed(work: WorkRequest) {
    const ticket = this.claimTickets.get(work.id);
    if (!ticket) return;
    const pending = this.latest(work.id);
    if (!pending || !this.launchedWork.has(work.id)) return;
    // A launch precedes the successful claim; bind its supervision to that attempt.
    const record: ManagedExecution = {
      ...pending,
      id: `${work.id}:${work.attempt}`,
      attempt: work.attempt,
      state: 'running',
      startedAt: now(),
      endedAt: undefined,
    };
    this.engine.store.put(attemptsCollection, {
      ...pending,
      state: 'completed',
      endedAt: now(),
    });
    this.transcripts.finish({ ...pending, endedAt: now() });
    this.transcripts.register(record);
    this.transcripts.capture(
      record,
      { kind: 'user', text: assignmentPrompt(work) },
      [work.token ?? '', ticket.ticket],
    );
    this.engine.store.put(attemptsCollection, record);
    work.managedExecution = {
      profileId: record.profile.id,
      executionId: record.id,
      harness: record.profile.harness,
      state: record.state,
      pendingRequests: 0,
    };
  }
  private write(record: ManagedExecution) {
    this.engine.stalls?.hold(
      `managed:${record.id}`,
      record.runId,
      record.state === 'needs_human',
      record.workId,
    );
    this.engine.store.put(attemptsCollection, record);
    this.transcripts.finish(record);
    const work = this.engine.store.get<WorkRequest>('work', record.workId);
    if (work && work.attempt === record.attempt)
      this.engine.store.put('work', {
        ...work,
        managedExecution: {
          profileId: record.profile.id,
          executionId: record.id,
          harness: record.profile.harness,
          state: record.state,
          ...(record.error ? { reason: record.error } : {}),
          pendingRequests: record.requests.filter((q) => q.state === 'pending')
            .length,
          sessionId: record.sessionId,
          sessionName: record.sessionName,
          resumeCommand: record.resumeCommand,
          deepLink: record.deepLink,
        },
      });
    this.engine.store.touchRun(record.runId);
  }
  private log(record: ManagedExecution, message: string) {
    const current = this.engine.store.get<WorkRequest>('work', record.workId);
    this.transcripts.capture(record, { kind: 'status', text: message }, [
      current?.token ?? '',
      this.launchedWork.get(record.workId)?.claimTicket ?? '',
    ]);
    record.logCount++;
    const cleanMessage = sanitizeMessage(message).slice(0, 1000);
    record.logs = [...record.logs, { at: now(), message: cleanMessage }].slice(
      -20,
    );
    this.write(record);
  }
  private resolveSessionName(work: WorkRequest, profile: ExecutorProfile) {
    return resolveSessionName(this.engine, work, profile);
  }
  inspect(workId: string) {
    if (!this.engine.store.get<WorkRequest>('work', workId))
      throw new InterlockError('Assignment not found');
    const records = this.engine.store
      .forWork<ManagedExecution>(attemptsCollection, workId)
      .reverse()
      .sort((a, b) => b.attempt - a.attempt);
    const latest = records[0];
    return {
      items: latest
        ? [
            {
              ...inspected(latest),
              requests: [
                ...latest.requests.filter((r) => r.state === 'pending'),
                ...latest.requests
                  .filter((r) => r.state !== 'pending')
                  .slice(-3),
              ],
              requestCount: latest.requests.length,
              logs: latest.logs.slice(-20),
            },
          ]
        : [],
      total: records.length,
      history: records.slice(1, 11).map((r) => ({
        id: r.id,
        attempt: r.attempt,
        state: inspected(r).state,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        error: r.error,
        sessionId: r.sessionId,
        sessionName: r.sessionName,
        resumeCommand: r.resumeCommand,
        deepLink: r.deepLink,
        recoveryEvents: r.recoveryEvents,
        transcriptCapture: r.transcriptCapture,
      })),
    };
  }
  transcript(input: unknown): TranscriptPage {
    return this.operator.transcript(input);
  }
  messageReceipt(input: unknown) {
    return this.operator.messageReceipt(input);
  }
  message(input: unknown): Promise<MessageReceipt> {
    return this.operator.message(input);
  }
  respond(input: unknown) {
    return this.operator.respond(input);
  }
  private scan() {
    return this.dispatch.scan();
  }
  private checkJobs() {
    for (const job of this.jobs.values()) {
      if (job.abort.signal.aborted) continue;
      const current = this.engine.store.get<WorkRequest>('work', job.work.id);
      if (
        !current ||
        current.status !== 'claimed' ||
        current.token !== job.work.token ||
        current.attempt !== job.work.attempt
      ) {
        this.interruptJob(
          job,
          'The assignment claim ended; stopping the harness.',
        );
      } else if (
        !this.profiles().find((p) => p.id === job.record.profile.id)?.enabled
      ) {
        this.interruptJob(
          job,
          'Harness profile was disabled. Confirm the session stopped before retrying.',
        );
      } else if (Date.parse(current.leaseUntil!) - Date.now() < 60000) {
        try {
          this.engine.renew(current.id, job.work.token!, 300);
        } catch {
          this.interruptJob(job, 'The claim could not be renewed.');
        }
      }
    }
    const failed = this.errors.handler;
    for (const [workId, session] of this.launchedWork.entries()) {
      const current = this.engine.store.get<WorkRequest>('work', workId);
      const run = this.engine.store.get<import('@interlock/core').Run>(
        'runs',
        session.runId,
      );
      if (!session.cleanupFailed && this.launcher.pull.statusDue(session)) {
        session.lastStatusAt = Date.now();
        void this.pollLauncherStatus(session).catch(failed('launcher status'));
      }
      if (!session.cleanupFailed && current?.status === 'claimed')
        void this.launcher
          .recoverIdleLauncher(session, current)
          .catch(failed('recovery'));
      const runEnded =
        run && ['completed', 'failed', 'cancelled'].includes(run.status);
      const workEnded =
        current &&
        ['completed', 'failed', 'cancelled'].includes(current.status);
      if ((runEnded || workEnded) && !session.archived) {
        session.archived = true;
        if (current?.status === 'cancelled' || run?.status === 'cancelled') {
          this.claimTickets.delete(workId);
          const record = this.latest(workId);
          if (record && record.state !== 'interrupted')
            this.interrupted(
              record,
              'Run cancelled. Confirm the remote session and subprocesses stopped before reconciliation.',
            );
          void this.requestLauncherStop(session)
            .then(() => this.archiveLauncherSession(session))
            .catch(failed('launcher stop'));
        } else if (!session.cleanupFailed)
          void this.archiveLauncherSession(session).catch(failed('archive'));
      }
    }
  }
  // Launcher operations stay reachable here; the supervisor owns their bodies.
  private launchCustom(
    ...args: Parameters<LauncherSupervisor['launchCustom']>
  ) {
    return this.launcher.launchCustom(...args);
  }
  private pollLauncherStatus(
    ...args: Parameters<LauncherSupervisor['pollLauncherStatus']>
  ) {
    return this.launcher.pollLauncherStatus(...args);
  }
  private sendLauncherMessage(
    ...args: Parameters<LauncherSupervisor['sendLauncherMessage']>
  ) {
    return this.launcher.sendLauncherMessage(...args);
  }
  private archiveLauncherSession(
    ...args: Parameters<LauncherSupervisor['archiveLauncherSession']>
  ) {
    return this.launcher.archiveLauncherSession(...args);
  }
  private requestLauncherStop(
    ...args: Parameters<LauncherSupervisor['requestLauncherStop']>
  ) {
    return this.launcher.requestLauncherStop(...args);
  }
  private stopLauncherSession(
    ...args: Parameters<LauncherSupervisor['stopLauncherSession']>
  ) {
    return this.launcher.stopLauncherSession(...args);
  }
  private recordRecoveryEvent(record: ManagedExecution, event: RecoveryEvent) {
    record.recoveryEvents = record.recoveryEvents ?? [];
    record.recoveryEvents.push(event);
    this.write(record);
  }
  private execute(job: Job, adapter: HarnessAdapter, session: Session) {
    return this.turns.execute(job, adapter, session);
  }
  assertResume(workId: string) {
    if (this.latest(workId)?.state === 'needs_model')
      throw new InterlockError(
        'Use retry_model to choose a replacement and resume this assignment',
      );
  }
  retryModel(executionId: string, model: string) {
    return this.modelRecovery.retryModel(executionId, model);
  }
  deadlineRevoked(work: WorkRequest) {
    const record = this.latest(work.id);
    if (!record || record.attempt !== work.attempt) return;
    const launcher = this.launchedWork.get(work.id);
    const job = this.jobs.get(work.id);
    if (!launcher && !job && !active(record)) return;
    const reason =
      'Active execution deadline expired. Stop the old session and subprocesses, then confirm before retrying.';
    this.claimTickets.delete(work.id);
    this.interrupted(record, reason);
    if (work.status === 'available')
      this.engine.holds.change({
        action: 'hold',
        workId: work.id,
        expectedAttempt: work.attempt,
        expectedRevision: work.holdRevision ?? 0,
        actor: 'managed-executor',
        category: 'other',
        reason,
        checkpointRef: `execution:${record.id}`,
      });
    if (job) {
      job.abort.abort();
      for (const answer of job.answers.values())
        answer.reject(new Error(reason));
      job.answers.clear();
    }
    if (launcher) void this.requestLauncherStop(launcher).catch(() => {});
  }
  private interrupted(record: ManagedExecution, reason: string) {
    this.claimTickets.delete(record.workId);
    for (const session of this.engine.store.forRuns<Session>(
      sessionsCollection,
      new Set([record.runId]),
    )) {
      if (
        session.profile.id === record.profile.id &&
        (!record.sessionId || session.nativeId === record.sessionId)
      )
        this.engine.store.put(sessionsCollection, {
          ...session,
          usageUncertain: true,
        });
    }
    record.state = 'interrupted';
    record.error = reason;
    record.endedAt = now();
    for (const request of record.requests)
      if (request.state === 'pending') request.state = 'cancelled';
    this.write(record);
    const work = this.engine.store.get<WorkRequest>('work', record.workId);
    if (work?.status === 'claimed' && work.attempt === record.attempt) {
      try {
        this.engine.manageWorkHold({
          action: 'hold',
          workId: work.id,
          expectedAttempt: work.attempt,
          expectedRevision: work.holdRevision ?? 0,
          actor: 'managed-executor',
          category: 'other',
          reason,
          checkpointRef: `execution:${record.id}`,
          token: work.token,
        });
      } catch {}
    }
  }
  private interruptJob(job: Job, reason: string) {
    if (job.abort.signal.aborted) return;
    this.interrupted(job.record, reason);
    job.abort.abort();
    for (const answer of job.answers.values()) answer.reject(new Error(reason));
    job.answers.clear();
  }
  stopExecution(executionId: string) {
    const record = this.engine.store.get<ManagedExecution>(
      attemptsCollection,
      executionId,
    );
    if (!record) throw new InterlockError('Execution not found');
    const launcherSession = this.launchedWork.get(record.workId);
    if (launcherSession) {
      void this.requestLauncherStop(launcherSession).catch(() => {});
      this.interrupted(record, 'Execution stopped by the user.');
      return { stopping: true };
    }
    const job = this.jobs.get(record.workId);
    if (!job || job.record.id !== executionId)
      throw new InterlockError('This execution is not running on this server');
    this.interruptJob(
      job,
      'Execution stopped by the user. Confirm its session and subprocesses stopped before retrying.',
    );
    return { stopping: true };
  }
  confirmStopped(executionId: string, confirmStopped: true) {
    if (confirmStopped !== true)
      throw new InterlockError('Stop confirmation is required');
    const record = this.engine.store.get<ManagedExecution>(
      attemptsCollection,
      executionId,
    );
    if (record?.reconciledAt) return { applied: false };
    const endedAttention =
      record?.state === 'needs_human' &&
      !!record.endedAt &&
      !record.requests.some((request) => request.state === 'pending');
    if (!record || (record.state !== 'interrupted' && !endedAttention))
      throw new InterlockError(
        'Only interrupted executions or ended attention holds can be reconciled',
      );
    if (
      this.jobs.has(record.workId) ||
      this.pendingLaunches.has(record.workId) ||
      this.launcherStops.has(record.workId) ||
      this.launcherCommands.has(record.workId)
    )
      throw new InterlockError('The old harness is still stopping');
    const work = this.engine.store.get<WorkRequest>('work', record.workId);
    if (!work || work.attempt !== record.attempt)
      throw new InterlockError('The assignment attempt changed');
    // A delegated launch can be cancelled before its first claim. Attempt zero
    // has no reservations or revoked claim to release, but still needs stop proof.
    if (record.attempt > 0)
      this.engine.manageWorkResources({
        action: 'release',
        workId: work.id,
        expectedAttempt: record.attempt,
        confirmStopped: true,
        actor: 'managed-executor-reconciliation',
      });
    record.state = 'failed';
    record.reconciledAt = new Date().toISOString();
    this.write(record);
    const launcher = this.launchedWork.get(work.id);
    if (launcher) {
      this.launchedWork.delete(work.id);
      this.launchIdempotency.delete(launcher.idempotencyKey);
      this.claimTickets.delete(work.id);
    }
    if (work.status === 'held')
      this.engine.manageWorkHold({
        action: 'resume',
        workId: work.id,
        expectedAttempt: work.attempt,
        expectedRevision: work.holdRevision ?? 0,
        actor: 'managed-executor-reconciliation',
      });
    this.schedule();
    return { applied: true };
  }
  assertDelete(runIds: Set<string>) {
    if (this.engine.store.transcripts.hasPending(runIds))
      throw new InterlockError(
        'Managed messages are pending; wait for delivery to settle before deleting history.',
      );
    if (
      this.engine.store
        .forRuns<ManagedExecution>(attemptsCollection, runIds)
        .some(
          (r) =>
            runIds.has(r.runId) && (active(r) || r.state === 'interrupted'),
        )
    )
      throw new InterlockError(
        'Managed agent executions remain active or uncertain. Stop and reconcile them before deleting history.',
      );
  }
  removeRuns(runIds: Set<string>) {
    this.assertDelete(runIds);
    for (const collection of [attemptsCollection, sessionsCollection])
      for (const record of this.engine.store.list<{
        id: string;
        runId: string;
      }>(collection))
        if (runIds.has(record.runId))
          this.engine.store.remove(collection, record.id);
  }
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe?.();
    clearInterval(this.interval);
    for (const request of this.config.modelRequests.values())
      request.abort.abort(new Error('Interlock stopped'));
    for (const command of this.customCommands) command.abort.abort();
    for (const id of new Set([
      ...this.pendingLaunches.keys(),
      ...this.launchedWork.keys(),
    ])) {
      const record = this.latest(id);
      if (
        record &&
        (active(record) ||
          this.pendingLaunches.has(id) ||
          this.launcherCommands.has(id))
      )
        this.interrupted(
          record,
          'Interlock stopped. Confirm the delegated session and subprocesses stopped before retrying.',
        );
    }
    for (const job of this.jobs.values())
      this.interruptJob(
        job,
        'Interlock stopped during execution. Confirm the previous session and subprocesses stopped before retrying.',
      );
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
    await Promise.allSettled(
      [...this.customCommands].map((command) => command.done),
    );
    await Promise.allSettled(
      [...this.config.modelRequests.values()].map((r) => r.done),
    );
  }
}
