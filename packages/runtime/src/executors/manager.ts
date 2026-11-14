import { randomUUID } from 'node:crypto';
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
  type Run,
  type WorkflowDefinition,
  type UsageAttempt,
  type TranscriptPage,
  type MessageReceipt,
} from '@interlock/core';
import type { Engine, Worker } from '../index.js';
import { SchedulerErrors } from '../log.js';
import {
  ExecutorConfiguration,
  errorText,
  parseProfileSnapshot,
  type ManagedAssignment,
} from './configuration.js';
import {
  LauncherSupervisor,
  type ClaimTicket,
  type LauncherSession,
} from './launcher.js';
import { OperatorChannel } from './operator.js';
import { RecoveryPolicies } from './recovery.js';
import { BudgetStops, usageDelta } from './budgetStops.js';
import {
  active,
  attemptsCollection,
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
import {
  evaluateSessionNameTemplate,
  evaluateCommandOrUrlTemplate,
  sanitizeDeepLink,
  sanitizeMessage,
} from './templates.js';

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
  private scanning = false;
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
    this.budgetStops = new BudgetStops(engine, {
      write: (record) => this.write(record),
      interrupt: (job, reason) => this.interruptJob(job, reason),
    });
    this.config = new ExecutorConfiguration(engine, defaultCwd, {
      adapters: () => this.adapters,
      running: () => this.running,
      stopped: () => this.stopped,
      schedule: () => this.schedule(),
    });
  }
  profiles() {
    return this.config.profiles();
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
    return this.config.saveProfile(input);
  }
  listProfiles(refresh = false) {
    return this.config.listProfiles(refresh);
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
  private occupancy(profileId?: string) {
    const occupied = new Map<string, string>();
    for (const job of this.jobs.values())
      occupied.set(job.work.id, job.record.profile.id);
    for (const [id, profile] of this.pendingLaunches) occupied.set(id, profile);
    for (const [id, session] of this.launchedWork) {
      const status = this.engine.store.workStatus(id);
      if (status === 'available' || status === 'claimed')
        occupied.set(id, session.profile.id);
    }
    return [...occupied.values()].filter((id) => !profileId || id === profileId)
      .length;
  }
  private profileAtCapacity(profileId: string) {
    const cap = this.profiles().find(
      (profile) => profile.id === profileId,
    )?.concurrency;
    return cap != null && this.occupancy(profileId) >= cap;
  }
  private atCapacity() {
    const limit = this.settings().concurrency;
    return limit !== null && this.occupancy() >= limit;
  }
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
    const record = this.latest(work.id);
    if (
      record &&
      record.attempt === work.attempt &&
      !(record.modelRecovery?.replacementModel && work.status === 'available')
    )
      return {
        profileId: record.profile.id,
        executionId: record.id,
        harness: record.profile.harness,
        state: record.state,
        reason: record.error,
        pendingRequests: record.requests.filter((r) => r.state === 'pending')
          .length,
        recoveryEvents: record.recoveryEvents,
      };
    if (!work.executor || work.status !== 'available') return;
    const profile = this.profiles().find((p) => p.id === work.executor);
    const detection =
      profile &&
      this.config.detections.get(
        `${profile.id}:${profile.revision}:${profile.command ?? ''}`,
      )?.result;
    const binding = work.context.continuityGroup
      ? this.engine.contextGroups.describe(
          work.runId,
          work.context.continuityGroup,
        )?.session
      : undefined;
    const owned =
      binding &&
      this.engine.store.get<Session>(
        sessionsCollection,
        JSON.stringify([
          work.runId,
          work.context.continuityGroup,
          binding.sessionId,
        ]),
      );
    const resolvedProfile =
      owned?.profile ??
      record?.profile ??
      (profile && this.config.assignmentProfile(work, profile));
    const effort =
      !owned && !record && resolvedProfile
        ? this.config.effortProblem(resolvedProfile)
        : undefined;
    const reason =
      binding && (binding.executorId !== work.executor || !owned)
        ? 'This continuity group is bound to another executor session'
        : owned && this.continuityProblem(work, owned)
          ? this.continuityProblem(work, owned)
          : detection && detection.status !== 'detected'
            ? (detection.message ?? 'Harness executable is unavailable')
            : !profile
              ? 'Configure this local harness profile'
              : !profile.enabled
                ? 'Automatic execution is disabled for this profile'
                : (this.config.incompatible(work, resolvedProfile!) ??
                  effort?.reason);
    return {
      profileId: work.executor,
      harness: profile?.harness,
      state:
        reason && !(effort?.pending && reason === effort.reason)
          ? 'blocked'
          : 'queued',
      ...(reason
        ? { reason }
        : this.profileAtCapacity(work.executor)
          ? { reason: 'Waiting for this profile assignment slot' }
          : this.atCapacity()
            ? { reason: 'Waiting for a shared Agent assignment slot' }
            : {}),
    };
  }
  private continuityProblem(work: ManagedAssignment, session: Session) {
    if (
      work.executorPermissionsSource !== undefined &&
      work.executorPermissions !== undefined &&
      work.executorPermissions !== session.profile.permissions
    )
      return 'This continuity group already uses different permissions. Use the same permissions or a separate continuity group.';
    if (
      work.executorModel !== undefined &&
      (session.requestedModel !== undefined ||
        work.executorModelSource === 'node') &&
      work.executorModel !==
        (session.requestedModel ?? session.profile.model) &&
      work.executorModel !== session.profile.model
    )
      return 'This continuity group already uses another model. Use the same model or a separate continuity group.';
    if (
      work.executorEffort !== undefined &&
      (work.executorEffort ?? null) !== (session.profile.effort ?? null) &&
      (!Object.hasOwn(session, 'recoveryRequestedEffort') ||
        (work.executorEffort ?? null) !==
          (session.recoveryRequestedEffort ?? null))
    )
      return 'This continuity group already uses another thinking effort. Use the same effort or a separate continuity group.';
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
  private resolveSessionName(
    work: WorkRequest,
    profile: ExecutorProfile,
  ): string {
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
    const node = definition?.nodes?.find((n: any) => n.id === work.nodeId);
    const template =
      (node as any)?.sessionNameTemplate ||
      definition?.sessionNameTemplate ||
      profile.sessionNameTemplate;
    if (template) {
      const evaluated = evaluateSessionNameTemplate(template, {
        externalTask: run?.externalTask,
        node: node
          ? { id: node.id, label: node.label, kind: node.kind }
          : { id: work.nodeId, label: work.label },
        run: run
          ? { id: run.id, status: run.status, workflowId: run.workflowId }
          : { id: work.runId },
        work: {
          id: work.id,
          attempt: work.attempt,
          nodeId: work.nodeId,
          label: work.label,
        },
        runId: work.runId,
        workId: work.id,
        nodeId: work.nodeId,
      });
      if (evaluated) return evaluated;
    }
    return `interlock-${work.runId}-${work.id}`;
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
              ...latest,
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
        state: r.state,
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
  private managedOffer(id: string) {
    const work = this.engine.store.get<WorkRequest>('work', id);
    if (
      work?.status !== 'available' ||
      !work.executor ||
      work.pauseBlocked ||
      work.budgetBlocked ||
      work.resourceBlocked ||
      work.cwdBlocked
    )
      return;
    const workflowId = this.engine.store.runWorkflowId(work.runId);
    if (
      workflowId !== undefined &&
      !this.engine.pauses.applicable(workflowId).length
    )
      return work as WorkRequest & { executor: string };
  }
  private async scan() {
    if (this.scanning || this.stopped) return;
    this.scanning = true;
    try {
      this.checkJobs();
      for (const id of this.engine.store.availableManagedWorkIds()) {
        if (this.atCapacity() || this.stopped) break;
        // Recheck admission after an earlier launch may have awaited its adapter.
        const offered = this.managedOffer(id);
        if (!offered) continue;
        if (
          this.jobs.has(offered.id) ||
          ['interrupted', 'needs_model'].includes(
            this.latest(offered.id)?.state ?? '',
          )
        )
          continue;
        const configured = this.profiles().find(
          (p) => p.id === offered.executor,
        );
        if (!configured?.enabled || this.profileAtCapacity(configured.id))
          continue;
        const adapter = this.adapters.get(configured.harness);
        if (!adapter) continue;

        if (configured.harness === 'custom' && configured.mode === 'launcher') {
          if (this.launchedWork.has(offered.id)) continue;
          const candidateCwd =
            offered.trialEnvironment?.workspace ??
            offered.resolvedCwd ??
            configured.cwd ??
            this.defaultCwd;
          let cwd: string;
          try {
            cwd = this.engine.workspaces.validateCwd(candidateCwd, [
              ...(configured.allowedRoots ?? []),
              ...(this.settings().allowedRoots ?? []),
            ]);
          } catch (err) {
            offered.cwdBlocked = {
              reason: `Managed executor "${configured.id}": ${err instanceof Error ? err.message : String(err)}`,
              path: candidateCwd,
            };
            this.engine.store.put('work', offered);
            continue;
          }
          const group = offered.context.continuityGroup;
          const binding = group
            ? this.engine.contextGroups.describe(offered.runId, group)
            : undefined;
          const logicalSession = binding?.session?.sessionId ?? randomUUID();
          try {
            this.pendingLaunches.set(offered.id, configured.id);
            try {
              await this.launchCustom(
                offered,
                offered.executorPermissionsSource !== undefined
                  ? this.config.assignmentProfile(offered, configured)
                  : configured,
                cwd,
                logicalSession,
              );
            } finally {
              this.pendingLaunches.delete(offered.id);
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            const record: ManagedExecution = {
              id: `${offered.id}:launch:${offered.attempt}`,
              workId: offered.id,
              runId: offered.runId,
              attempt: offered.attempt,
              state:
                this.stopped ||
                err instanceof HarnessCleanupError ||
                this.engine.store.get<WorkRequest>('work', offered.id)
                  ?.status === 'cancelled'
                  ? 'interrupted'
                  : 'failed',
              profile: configured,
              command:
                configured.launchCommand || configured.command || 'launch',
              cwd,
              startedAt: now(),
              endedAt: now(),
              error: errorMsg,
              requests: [],
              logs: [{ at: now(), message: `Launch failed: ${errorMsg}` }],
              logCount: 1,
            };
            this.write(record);
          }
          continue;
        }
        const group = offered.context.continuityGroup;
        const binding = group
          ? this.engine.contextGroups.describe(offered.runId, group)
          : undefined;
        if (binding?.session && binding.session.executorId !== configured.id)
          continue;
        const logicalSession = binding?.session?.sessionId ?? randomUUID();
        const sessionKey = group
          ? JSON.stringify([offered.runId, group, logicalSession])
          : (this.budgetStops.resumeKey(offered) ?? randomUUID());
        if ([...this.jobs.values()].some((j) => j.sessionKey === sessionKey))
          continue;
        const priorSession = this.engine.store.get<Session>(
          sessionsCollection,
          sessionKey,
        );
        if (binding?.session && !priorSession) continue; // An external binding is not an owned managed session.
        if (priorSession)
          priorSession.profile = parseProfileSnapshot(priorSession.profile);
        if (priorSession && this.continuityProblem(offered, priorSession))
          continue;
        const previous = this.latest(offered.id);
        let profile = parseProfileSnapshot(
          priorSession?.profile ??
            previous?.profile ??
            this.config.assignmentProfile(offered, configured),
        );
        const replacement = previous?.modelRecovery?.replacementModel;
        if (!priorSession && replacement)
          profile = { ...profile, model: replacement, effort: null };
        const permissionSource =
          priorSession?.permissionSource ??
          previous?.permissionSource ??
          offered.executorPermissionsSource ??
          (offered.executorPermissions
            ? ('workflow' as const)
            : ('harness' as const));
        const modelSource =
          priorSession?.modelSource ??
          (replacement ? ('recovery' as const) : previous?.modelSource) ??
          (offered.executorModel
            ? (offered.executorModelSource ?? 'workflow')
            : profile.model
              ? 'harness'
              : 'cli');
        if (this.config.incompatible(offered, profile)) continue;
        const effortSource =
          priorSession?.effortSource ??
          (replacement ? ('recovery' as const) : previous?.effortSource) ??
          (offered.executorEffort !== undefined
            ? (offered.executorEffortSource ?? 'workflow')
            : profile.effort
              ? 'harness'
              : 'cli');
        const pinnedCommand = priorSession?.command ?? previous?.command;
        const catalogProfile = {
          ...profile,
          ...(pinnedCommand ? { command: pinnedCommand } : {}),
        };
        if (profile.effort && !priorSession && !previous) {
          if (profile.model) await this.config.profileModels(catalogProfile);
          if (this.config.effortProblem(catalogProfile)) continue;
        }
        const detection = await this.config.detect({
          ...profile,
          ...(pinnedCommand ? { command: pinnedCommand } : {}),
        });
        const currentProfile = this.profiles().find(
          (p) => p.id === configured.id,
        );
        const currentOffer = this.managedOffer(id);
        if (
          this.stopped ||
          detection.status !== 'detected' ||
          !detection.command ||
          !currentProfile?.enabled ||
          currentProfile.revision !== configured.revision ||
          currentOffer?.attempt !== offered.attempt ||
          currentOffer.executor !== configured.id
        )
          continue;
        const candidateCwd =
          currentOffer.trialEnvironment?.workspace ??
          priorSession?.cwd ??
          currentOffer.resolvedCwd ??
          previous?.cwd ??
          profile.cwd ??
          this.defaultCwd;
        let cwd: string;
        try {
          cwd = this.engine.workspaces.validateCwd(candidateCwd, [
            ...(profile.allowedRoots ?? []),
            ...(this.settings().allowedRoots ?? []),
          ]);
        } catch (err) {
          currentOffer.cwdBlocked = {
            reason: `Managed executor "${profile.id}": ${err instanceof Error ? err.message : String(err)}`,
            path: candidateCwd,
          };
          this.engine.store.put('work', currentOffer);
          continue;
        }
        // Settings can change while native executable detection is pending.
        if (this.atCapacity() || this.stopped) break;
        if (this.profileAtCapacity(configured.id)) continue;
        let work: WorkRequest;
        try {
          work = this.engine.claim(offered.id, {
            workerId: `managed:${profile.id}`,
            freshContext: true,
            tools: profile.tools,
            skills: profile.skills,
            ...(group
              ? {
                  session: {
                    executorId: profile.id,
                    sessionId: logicalSession,
                  },
                }
              : {}),
          });
        } catch {
          continue;
        }
        work.resolvedCwd = cwd;
        const runRecord = this.engine.store.get<import('@interlock/core').Run>(
          'runs',
          work.runId,
        );
        if (runRecord) {
          const nodeExecution = runRecord.executions.find(
            (e) => e.id === work.executionId,
          );
          if (nodeExecution) {
            nodeExecution.resolvedCwd = cwd;
            this.engine.store.put('runs', runRecord);
          }
        }
        const session: Session = priorSession ?? {
          id: sessionKey,
          runId: work.runId,
          requestedModel: profile.model,
          profile,
          permissionSource,
          modelSource,
          effortSource,
          command: detection.command,
          cwd,
        };
        this.engine.store.put(sessionsCollection, session);
        const sessionName = this.resolveSessionName(work, profile);
        const templateVars = {
          sessionId: session.nativeId ?? '',
          workId: work.id,
          runId: work.runId,
          cwd,
          sessionName,
        };
        const resumeCommand =
          session.resumeCommand ||
          (profile.resumeCommandTemplate && session.nativeId
            ? evaluateCommandOrUrlTemplate(
                profile.resumeCommandTemplate,
                templateVars,
              )
            : undefined);
        const deepLink = sanitizeDeepLink(
          session.deepLink ||
            (profile.deepLinkTemplate && session.nativeId
              ? evaluateCommandOrUrlTemplate(
                  profile.deepLinkTemplate,
                  templateVars,
                )
              : undefined),
        );
        const record: ManagedExecution = {
          id: `${work.id}:${work.attempt}`,
          workId: work.id,
          runId: work.runId,
          attempt: work.attempt,
          state: 'starting',
          profile,
          permissionSource,
          modelSource,
          effortSource,
          command: session.command,
          cwd,
          sessionId: session.nativeId,
          sessionName,
          resumeCommand,
          deepLink,
          startedAt: now(),
          requests: [],
          logs: [],
          logCount: 0,
        };
        this.write(record);
        const job: Job = {
          record,
          work,
          sessionKey,
          abort: new AbortController(),
          answers: new Map(),
        };
        this.jobs.set(work.id, job);
        job.done = this.execute(job, adapter, session);
      }
    } finally {
      this.scanning = false;
    }
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
      if (
        !session.cleanupFailed &&
        (session.profile.statusCommand || session.profile.statusUrl) &&
        Date.now() - session.lastStatusAt > 2000
      ) {
        session.lastStatusAt = Date.now();
        void this.pollLauncherStatus(session).catch(failed('launcher status'));
      }
      if (!session.cleanupFailed && current?.status === 'claimed')
        void this.recoverIdleLauncher(session, current).catch(
          failed('recovery'),
        );
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
  private recoverIdleLauncher(
    ...args: Parameters<LauncherSupervisor['recoverIdleLauncher']>
  ) {
    return this.launcher.recoverIdleLauncher(...args);
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

  private async execute(job: Job, adapter: HarnessAdapter, session: Session) {
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
                request: (request) => this.operator.request(job, request),
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
  private holdForModel(job: Job, session: Session, error: Error) {
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
  assertResume(workId: string) {
    if (this.latest(workId)?.state === 'needs_model')
      throw new InterlockError(
        'Use retry_model to choose a replacement and resume this assignment',
      );
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
