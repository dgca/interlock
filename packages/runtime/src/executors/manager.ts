import { randomUUID, createHash } from 'node:crypto';
import { ManagedTranscripts } from './transcripts.js';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import {
  InterlockError,
  executorProfileSchema,
  executorProfileUpdateSchema,
  executorResponseSchema,
  executorOperationSchema,
  executorModelsQuerySchema,
  executorEffortSchema,
  executorSettingsSchema,
  executorSettingsUpdateSchema,
  resolveProvider,
  elapsedExcludingPausesMs,
  type ExecutorModels,
  tokenFields,
  type ExecutorProfile,
  type ExecutorProfileUpdate,
  type ExecutorRequest,
  type ExecutorAnswer,
  type ManagedExecution,
  type ManagedWorkSummary,
  type WorkRequest,
  type ModelUsage,
  type RecoveryEvent,
  type Run,
  type WorkflowDefinition,
  type PauseHold,
  type UsageAttempt,
  transcriptQuerySchema,
  executorMessageSchema,
  messageReceiptQuerySchema,
  type TranscriptPage,
  type MessageReceipt,
} from '@interlock/core';
import type { Engine, Worker } from '../index.js';
import { validateDirectoryContainment } from '../workingDirectory.js';

// Inspection needs assignment identity and configuration, never task payloads.
type ManagedAssignment = Pick<
  WorkRequest,
  | 'id'
  | 'runId'
  | 'attempt'
  | 'status'
  | 'executor'
  | 'executorModel'
  | 'executorModelSource'
  | 'executorEffort'
  | 'executorPermissions'
  | 'executorPermissionsSource'
> & {
  context: Pick<WorkRequest['context'], 'continuityGroup' | 'tools' | 'skills'>;
  trialEnvironment?: { id: string };
};
import {
  HarnessResultError,
  HarnessCleanupError,
  HarnessModelError,
  HarnessRequestError,
  classifyHarnessError,
  isModelRefusal,
  type HarnessAdapter,
  type HarnessRequest,
  type HarnessResult,
  assignmentPrompt,
} from './contracts.js';
import {
  buildTokenMap,
  customInvocation,
  interpolateTokens,
  executeCustomCommand,
} from './custom.js';
import {
  evaluateSessionNameTemplate,
  evaluateCommandOrUrlTemplate,
  sanitizeDeepLink,
  sanitizeMessage,
} from './templates.js';

interface LauncherSession {
  idempotencyKey: string;
  workId: string;
  runId: string;
  profile: ExecutorProfile;
  claimTicket: string;
  sessionId: string;
  sessionName?: string;
  resumeCommand?: string;
  deepLink?: string;
  cwd: string;
  status: 'working' | 'idle' | 'needs_attention' | 'ended';
  launchedAt: string;
  lastStatusAt: number;
  archived: boolean;
  cleanupFailed?: boolean;
}

const profilesCollection = 'executorProfiles',
  attemptsCollection = 'managedExecutions',
  sessionsCollection = 'executorSessions';
const now = () => new Date().toISOString();
const active = (r: ManagedExecution) =>
  ['starting', 'running', 'needs_human'].includes(r.state);
const defaults: ExecutorProfile[] = [
  executorProfileSchema.parse({
    id: 'claude-code',
    harness: 'claude-code',
    name: 'Claude Code',
  }),
  executorProfileSchema.parse({ id: 'codex', harness: 'codex', name: 'Codex' }),
  executorProfileSchema.parse({ id: 'pi', harness: 'pi', name: 'Pi' }),
];
interface Session {
  id: string;
  runId: string;
  profile: ExecutorProfile;
  permissionSource?: ManagedExecution['permissionSource'];
  modelSource?: ManagedExecution['modelSource'];
  effortSource?: ManagedExecution['effortSource'];
  command: string;
  cwd: string;
  nativeId?: string;
  sessionName?: string;
  resumeCommand?: string;
  deepLink?: string;
  requestedModel?: string;
  recoveryRequestedEffort?: ExecutorProfile['effort'];
  usage?: ModelUsage[];
  usageUncertain?: boolean;
}
interface Job {
  record: ManagedExecution;
  work: WorkRequest;
  sessionKey: string;
  abort: AbortController;
  answers: Map<
    string,
    {
      resolve: (answer: ExecutorAnswer) => void;
      reject: (error: Error) => void;
    }
  >;
  sendMessage?: (message: string) => Promise<void>;
  done?: Promise<void>;
}

/** Queue and claim lifecycle are shared; adapters own native session protocols. */
export class ExecutorManager {
  private transcripts: ManagedTranscripts;
  private adapters = new Map<string, HarnessAdapter>();
  private jobs = new Map<string, Job>();
  private catalogs = new Map<string, { at: number; result: ExecutorModels }>();
  private modelRequests = new Map<
    string,
    { abort: AbortController; done: Promise<ExecutorModels> }
  >();
  private detections = new Map<
    string,
    { at: number; result: Awaited<ReturnType<HarnessAdapter['detect']>> }
  >();
  private detectionRequests = new Map<
    string,
    ReturnType<HarnessAdapter['detect']>
  >();
  private presetChecks = new Set<string>();
  private claimTickets = new Map<
    string,
    {
      ticket: string;
      workId: string;
      runId: string;
      profileId: string;
      idempotencyKey: string;
      issuedAt: string;
      used: boolean;
    }
  >();
  private launchedWork = new Map<string, LauncherSession>();
  private launchIdempotency = new Map<string, LauncherSession>();
  private idleRecovering = new Set<string>();
  private launcherStops = new Map<string, Promise<void>>();
  private launcherCommands = new Map<string, Map<string, Promise<string>>>();
  private customCommands = new Set<{
    abort: AbortController;
    done: Promise<string>;
  }>();
  private running = false;
  private stopped = false;
  private scheduled = false;
  private scanning = false;
  private unsubscribe?: () => void;
  private interval?: ReturnType<typeof setInterval>;
  constructor(
    private engine: Engine,
    private defaultCwd: string,
  ) {
    this.transcripts = new ManagedTranscripts(engine);
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
  profiles() {
    const stored = this.engine.store
      .list<unknown>(profilesCollection)
      .map(parseProfileSnapshot);
    return [
      ...defaults.filter((d) => !stored.some((p) => p.id === d.id)),
      ...stored,
    ];
  }
  configuredPresetProfile(profile: ExecutorProfile | undefined) {
    if (
      !profile?.enabled ||
      (profile.harness === 'custom' && !customInvocation(profile))
    )
      return;
    if (!this.running) return profile;
    const adapter = this.adapters.get(profile.harness);
    return adapter && adapter.available?.(profile.command) !== false
      ? profile
      : undefined;
  }
  /** Undefined means the version check is still pending. */
  presetProfileReady(profile: ExecutorProfile): boolean | undefined {
    if (!this.running) return true;
    const key = this.detectionKey(profile);
    const checked = this.currentDetection(key);
    if (checked) return checked.status === 'detected';
    if (!this.presetChecks.has(key)) {
      this.presetChecks.add(key);
      void this.detect(profile)
        .then(() => {
          this.presetChecks.delete(key);
          this.engine.pump();
        })
        .catch(() => {});
    }
  }
  settings() {
    const stored = this.engine.store.get<{
      id: string;
      revision: number;
      concurrency: number | null;
      allowedRoots?: string[];
      providerPrefixes?: Record<string, string>;
    }>('executorSettings', 'shared');
    const roots = stored?.allowedRoots ?? this.engine.getAllowedRoots();
    return executorSettingsSchema.parse({
      revision: stored?.revision ?? 0,
      concurrency: stored ? stored.concurrency : 3,
      ...(roots && roots.length > 0 ? { allowedRoots: roots } : {}),
      ...(stored?.providerPrefixes
        ? { providerPrefixes: stored.providerPrefixes }
        : {}),
    });
  }
  saveSettings(input: unknown) {
    const q = executorSettingsUpdateSchema.parse(input);
    const result = this.engine.store.transaction(() => {
      if (this.settings().revision !== q.expectedRevision)
        throw new InterlockError(
          'Execution settings changed. Reload before saving.',
        );
      const currentRoots = this.settings().allowedRoots;
      const roots =
        q.allowedRoots !== undefined ? q.allowedRoots : currentRoots;
      const currentPrefixes = this.settings().providerPrefixes;
      const providerPrefixes =
        q.providerPrefixes !== undefined ? q.providerPrefixes : currentPrefixes;
      const next = executorSettingsSchema.parse({
        revision: q.expectedRevision + 1,
        concurrency: q.concurrency,
        ...(roots && roots.length > 0 ? { allowedRoots: roots } : {}),
        ...(providerPrefixes && Object.keys(providerPrefixes).length > 0
          ? { providerPrefixes }
          : {}),
      });
      this.engine.store.put('executorSettings', { id: 'shared', ...next });
      return next;
    });
    this.schedule();
    return result;
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
  saveProfile(input: ExecutorProfileUpdate) {
    const q = executorProfileUpdateSchema.parse(input);
    const pathsToCheck = [
      q.harness !== 'custom' ? q.command : undefined,
      q.cwd,
      ...(q.allowedRoots ?? []),
    ];
    for (const path of pathsToCheck)
      if (path && !isAbsolute(path))
        throw new InterlockError(
          'Executable, working directory, and allowed root overrides must be absolute paths',
        );
    const result = this.engine.store.transaction(() => {
      const current = this.profiles().find((p) => p.id === q.id);
      if ((current?.revision ?? 0) !== q.expectedRevision)
        throw new InterlockError(
          'Harness configuration changed. Reload before saving.',
        );
      if (current && current.harness !== q.harness)
        throw new InterlockError('A profile cannot change harness identity');
      if (!current && this.profiles().length >= 20)
        throw new InterlockError(
          'At most 20 local executor configurations are supported',
        );
      const { expectedRevision: _revision, ...value } = q;
      const next = executorProfileSchema.parse({
        ...value,
        revision: q.expectedRevision + 1,
      });
      this.engine.store.put(profilesCollection, next);
      return next;
    });
    this.detections.clear();
    this.schedule();
    return result;
  }
  async listProfiles(refresh = false) {
    return Promise.all(
      this.profiles().map(async (profile) => ({
        ...profile,
        detection:
          profile.harness === 'custom' && !customInvocation(profile)
            ? {
                status: 'unavailable' as const,
                message:
                  profile.transport === 'http'
                    ? 'Set the integration URL.'
                    : 'Set the integration command.',
              }
            : await this.detect(profile, refresh),
      })),
    );
  }
  async models(input: unknown): Promise<ExecutorModels> {
    const q = executorModelsQuerySchema.parse(input);
    const stored = this.profiles().find((p) => p.id === q.profileId);
    if (!stored) throw new InterlockError('Harness configuration not found');
    const profile = q.paths
      ? { ...stored, command: q.paths.command, cwd: q.paths.cwd }
      : stored;
    return this.profileModels(profile, q.refresh);
  }
  private catalogKey(profile: ExecutorProfile) {
    return JSON.stringify([
      profile.harness,
      profile.command,
      profile.cwd ?? this.defaultCwd,
    ]);
  }
  private async profileModels(
    profile: ExecutorProfile,
    refresh = false,
  ): Promise<ExecutorModels> {
    for (const path of [profile.command, profile.cwd])
      if (path && !isAbsolute(path))
        throw new InterlockError(
          'Executable and working directory overrides must be absolute paths',
        );
    const key = this.catalogKey(profile);
    const cached = this.catalogs.get(key);
    if (
      !refresh &&
      cached &&
      Date.now() - cached.at <
        (cached.result.status === 'ready' ? 300000 : 30000)
    )
      return cached.result;
    const pending = this.modelRequests.get(key);
    if (pending) return pending.done;
    if (this.stopped || this.modelRequests.size >= 4)
      return {
        status: 'unavailable',
        models: [],
        truncated: false,
        message: 'Model discovery is busy or stopping. Try again shortly.',
      };
    const abort = new AbortController();
    const done = (async (): Promise<ExecutorModels> => {
      const timer = setTimeout(
        () => abort.abort(new Error('Model discovery timed out')),
        15000,
      );
      try {
        const adapter = this.adapters.get(profile.harness);
        if (!adapter?.models)
          throw new Error('This harness does not support model discovery');
        const detection = await this.detect(profile, refresh);
        if (abort.signal.aborted) throw abort.signal.reason;
        if (!detection.command || detection.status !== 'detected')
          throw new Error(detection.message ?? 'Harness is unavailable');
        const catalog = await adapter.models({
          command: detection.command,
          cwd: profile.cwd ?? this.defaultCwd,
          signal: abort.signal,
        });
        if (abort.signal.aborted) throw abort.signal.reason;
        const models: ExecutorModels['models'] = [];
        const ids = new Set<string>();
        for (const model of catalog.models) {
          if (
            typeof model.id !== 'string' ||
            !model.id.trim() ||
            model.id.length > 200 ||
            ids.has(model.id)
          )
            continue;
          ids.add(model.id);
          models.push({
            id: model.id,
            name: (model.name || model.id).slice(0, 120),
            ...(model.effortLevels !== undefined
              ? {
                  effortLevels: [
                    ...new Set(
                      model.effortLevels.filter(
                        (level) =>
                          executorEffortSchema.safeParse(level).success,
                      ),
                    ),
                  ].slice(0, 20),
                }
              : {}),
            ...(model.defaultEffort &&
            executorEffortSchema.safeParse(model.defaultEffort).success
              ? { defaultEffort: model.defaultEffort }
              : {}),
            ...(model.description
              ? { description: model.description.slice(0, 300) }
              : {}),
          });
          if (models.length === 100) break;
        }
        return {
          status: 'ready',
          models,
          truncated: !!catalog.truncated || catalog.models.length > 100,
        };
      } catch (error) {
        return {
          status: 'unavailable',
          models: [],
          truncated: false,
          message: errorText(error),
        };
      } finally {
        clearTimeout(timer);
      }
    })();
    this.modelRequests.set(key, { abort, done });
    try {
      const result = await done;
      if (!this.stopped) {
        if (this.catalogs.size >= 20)
          this.catalogs.delete(this.catalogs.keys().next().value!);
        this.catalogs.set(key, { at: Date.now(), result });
      }
      return result;
    } finally {
      this.modelRequests.delete(key);
    }
  }
  private detectionKey(profile: ExecutorProfile) {
    return `${profile.id}:${profile.revision}:${profile.command ?? ''}`;
  }
  private currentDetection(key: string) {
    const cached = this.detections.get(key);
    return cached && Date.now() - cached.at < 30000 ? cached.result : undefined;
  }
  private async detect(
    profile: ExecutorProfile,
    refresh = false,
  ): ReturnType<HarnessAdapter['detect']> {
    const key = this.detectionKey(profile);
    const cached = this.currentDetection(key);
    if (!refresh && cached) return cached;
    const pending = this.detectionRequests.get(key);
    if (pending) return pending;
    const adapter = this.adapters.get(profile.harness);
    const probe = Promise.resolve()
      .then(() =>
        adapter
          ? adapter.detect(profile.command)
          : {
              status: 'unavailable' as const,
              message: 'Harness execution is not attached to this server',
            },
      )
      .catch((error: unknown) => ({
        status: 'unavailable' as const,
        message:
          error instanceof Error ? error.message : 'Harness check failed',
      }))
      .then((result) => {
        this.detections.set(key, { at: Date.now(), result });
        return result;
      })
      .finally(() => this.detectionRequests.delete(key));
    this.detectionRequests.set(key, probe);
    return probe;
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
      void this.scan().catch(() => {});
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
      this.detections.get(
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
      (profile && this.assignmentProfile(work, profile));
    const effort =
      !owned && !record && resolvedProfile
        ? this.effortProblem(resolvedProfile)
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
                : (this.incompatible(work, resolvedProfile!) ?? effort?.reason);
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
  private incompatible(work: ManagedAssignment, profile: ExecutorProfile) {
    if (work.trialEnvironment)
      return 'Managed local Git trials require a scoped external executor; native harness dispatch is not supported';
    const missing = [
      ...work.context.tools.filter((t) => !profile.tools.includes(t)),
      ...work.context.skills.filter((s) => !profile.skills.includes(s)),
    ];
    return missing.length
      ? `Profile is missing configured capabilities: ${missing.join(', ')}`
      : undefined;
  }
  private assignmentProfile(
    work: ManagedAssignment,
    configured: ExecutorProfile,
  ): ExecutorProfile {
    return {
      ...configured,
      model: work.executorModel ?? configured.model,
      effort:
        work.executorEffort !== undefined
          ? work.executorEffort
          : configured.effort,
      permissions: work.executorPermissions ?? configured.permissions,
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
  private effortProblem(
    profile: ExecutorProfile,
  ): { reason: string; pending?: boolean } | undefined {
    if (!profile.effort) return;
    if (!profile.model)
      return { reason: 'Select a model before configuring thinking effort' };
    const catalog = this.catalogs.get(this.catalogKey(profile))?.result;
    if (!catalog)
      return {
        reason: 'Checking thinking effort support for the selected model',
        pending: true,
      };
    if (catalog.status !== 'ready')
      return {
        reason: `Thinking effort support could not be checked: ${catalog.message ?? 'model discovery unavailable'}`,
      };
    const model = catalog.models.find((m) => m.id === profile.model);
    if (!model?.effortLevels)
      return {
        reason:
          'This model does not report thinking effort choices. Use native default or select a model with reported support.',
      };
    if (!model.effortLevels.includes(profile.effort))
      return {
        reason: `Thinking effort ${profile.effort} is not supported by ${profile.model}. Choose a supported level or use native default.`,
      };
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
  private execution(id: string) {
    const record = this.engine.store.get<ManagedExecution>(
      attemptsCollection,
      id,
    );
    if (!record) throw new InterlockError('Managed execution not found');
    return record;
  }
  private channel(record: ManagedExecution) {
    const work = this.engine.store.get<WorkRequest>('work', record.workId);
    if (
      this.stopped ||
      !active(record) ||
      record.endedAt ||
      work?.status !== 'claimed' ||
      work.attempt !== record.attempt ||
      !work.token ||
      Date.parse(work.leaseUntil ?? '') <= Date.now()
    )
      return undefined;
    const job = this.jobs.get(record.workId);
    if (
      job?.record.id === record.id &&
      !job.abort.signal.aborted &&
      work.token === job.work.token
    )
      return job.sendMessage;
    const launcher = this.launchedWork.get(record.workId);
    if (
      launcher &&
      (launcher.profile.messageCommand || launcher.profile.messageUrl) &&
      launcher.status !== 'ended'
    )
      return (message: string) => this.sendLauncherMessage(launcher, message);
    return undefined;
  }
  transcript(input: unknown): TranscriptPage {
    const q = transcriptQuerySchema.parse(input),
      record = this.execution(q.executionId);
    return {
      ...this.engine.store.transcripts.page(q),
      messageAvailable: !!this.channel(record),
      messageReason: this.channel(record)
        ? undefined
        : 'No supported live message channel for this execution',
      ...(record.transcriptError ? { reason: record.transcriptError } : {}),
    };
  }
  messageReceipt(input: unknown) {
    const q = messageReceiptQuerySchema.parse(input);
    const record = this.execution(q.executionId);
    return {
      receiptsPruned: this.engine.store.transcripts.receiptsPruned(
        q.executionId,
      ),
      canSend: !!this.channel(record),
      receipt:
        this.engine.store.transcripts.receipt(q.executionId, q.requestId)
          ?.receipt ?? null,
    };
  }
  async message(input: unknown): Promise<MessageReceipt> {
    const q = executorMessageSchema.parse(input);
    const record = this.execution(q.executionId);
    const currentWork = this.engine.store.get<WorkRequest>(
      'work',
      record.workId,
    );
    if (
      !this.transcripts.safeMetadata(
        record,
        [q.operator, q.requestId],
        [
          currentWork?.token ?? '',
          this.launchedWork.get(record.workId)?.claimTicket ?? '',
        ],
      )
    )
      throw new InterlockError(
        'Message not sent: request ID or operator label contains protected data, or its protection is unavailable. Choose safe metadata.',
      );
    const hash = createHash('sha256')
      .update(JSON.stringify([q.message, q.operator]))
      .digest('hex');
    const existing = this.engine.store.transcripts.receipt(
      record.id,
      q.requestId,
    );
    if (existing) {
      if (existing.hash !== hash)
        throw new InterlockError(
          'Message request ID already has different content',
        );
      return existing.receipt;
    }
    const send = this.channel(record);
    if (!send)
      throw new InterlockError(
        'Message not sent: execution has no supported active message channel',
      );
    this.transcripts.register(record);
    const receipt: MessageReceipt = {
      executionId: record.id,
      requestId: q.requestId,
      status: 'pending',
      operator: q.operator,
      source: q.source,
      at: now(),
      updatedAt: now(),
    };
    this.engine.store.transcripts.begin(receipt, hash);
    const work = this.engine.store.get<WorkRequest>('work', record.workId);
    this.transcripts.capture(
      record,
      { kind: 'operator', text: q.message, key: `operator:${q.requestId}` },
      [
        work?.token ?? '',
        this.launchedWork.get(record.workId)?.claimTicket ?? '',
      ],
    );
    try {
      // No await separates the final ownership check from dispatch.
      if (!this.channel(this.execution(record.id))) {
        receipt.status = 'failed';
        receipt.reason = 'Execution ended before message dispatch';
      } else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            send(q.message),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Delivery timeout')),
                10000,
              );
            }),
          ]);
          receipt.status = 'accepted';
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (error) {
      receipt.status =
        error instanceof HarnessRequestError ? 'failed' : 'unknown';
      receipt.reason =
        receipt.status === 'failed'
          ? 'Harness rejected the message before delivery'
          : 'Delivery could not be confirmed; this request will not be resent';
    }
    receipt.updatedAt = now();
    // A failed receipt write leaves durable pending, never permission to resend.
    this.engine.store.transcripts.settle(receipt);
    this.engine.store.put('events', {
      id: randomUUID(),
      runId: record.runId,
      type: 'managed.message',
      at: now(),
      message: `Operator message ${receipt.status}`,
      executionId: record.id,
      requestId: q.requestId,
      source: q.source,
      operator: q.operator,
    });
    this.engine.store.touchRun(record.runId);
    return receipt;
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
            const profileRoots = configured.allowedRoots ?? [];
            const serverRoots = this.settings().allowedRoots ?? [];
            const rootsToCheck = [...profileRoots, ...serverRoots];
            cwd = validateDirectoryContainment(
              candidateCwd,
              rootsToCheck.length ? rootsToCheck : undefined,
            );
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
                  ? this.assignmentProfile(offered, configured)
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
          : randomUUID();
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
            this.assignmentProfile(offered, configured),
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
        if (this.incompatible(offered, profile)) continue;
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
          if (profile.model) await this.profileModels(catalogProfile);
          if (this.effortProblem(catalogProfile)) continue;
        }
        const detection = await this.detect({
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
          const profileRoots = profile.allowedRoots ?? [];
          const serverRoots = this.settings().allowedRoots ?? [];
          const rootsToCheck = [...profileRoots, ...serverRoots];
          cwd = validateDirectoryContainment(
            candidateCwd,
            rootsToCheck.length ? rootsToCheck : undefined,
          );
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
        void this.pollLauncherStatus(session).catch(() => {});
      }
      if (!session.cleanupFailed && current?.status === 'claimed')
        void this.recoverIdleLauncher(session, current).catch(() => {});
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
            .catch(() => {});
        } else if (!session.cleanupFailed)
          void this.archiveLauncherSession(session).catch(() => {});
      }
    }
  }
  private async launchCustom(
    work: WorkRequest,
    profile: ExecutorProfile,
    cwd: string,
    logicalSession: string,
  ) {
    const idempotencyKey = `${work.id}:${work.attempt}`;
    const existing = this.launchIdempotency.get(idempotencyKey);
    if (existing) {
      this.launchedWork.set(work.id, existing);
      return existing;
    }

    const sessionName = this.resolveSessionName(work, profile);
    const claimTicket = randomUUID();
    const tokenMap = buildTokenMap(work, cwd, {
      claimTicket,
      sessionId: logicalSession,
      sessionName,
      INTERLOCK_SESSION_NAME: sessionName,
    });

    const launchPayload = {
      idempotencyKey,
      workId: work.id,
      runId: work.runId,
      attempt: work.attempt,
      claimTicket,
      prompt: work.prompt,
      input: work.input,
      outputSchema: work.outputSchema,
      cwd,
      model: profile.model,
      effort: profile.effort,
      permissions: profile.permissions,
      sessionName,
      sessionId: logicalSession,
    };

    const record: ManagedExecution = {
      id: `${work.id}:launch:${work.attempt}`,
      workId: work.id,
      runId: work.runId,
      attempt: work.attempt,
      state: 'starting',
      profile,
      permissionSource: work.executorPermissionsSource ?? 'harness',
      command: profile.launchCommand || profile.command || 'launch',
      cwd,
      sessionId: logicalSession,
      sessionName,
      startedAt: now(),
      requests: [],
      logs: [
        {
          at: now(),
          message: `Launching ${profile.name}`,
        },
      ],
      logCount: 1,
    };
    this.write(record);

    let remoteSessionId: string | undefined;
    let remoteResumeCommand: string | undefined;
    let remoteDeepLink: string | undefined;

    const invocation = customInvocation(profile, 'launcher');
    if (profile.transport === 'http') {
      if (!invocation) {
        throw new Error(
          `Custom profile "${profile.id}" in launcher HTTP mode requires launchUrl`,
        );
      }
      const url = interpolateTokens(invocation, tokenMap);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (profile.headers) {
        for (const [k, v] of Object.entries(profile.headers)) {
          headers[k] = interpolateTokens(v, tokenMap);
        }
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(launchPayload),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(
          `Launcher HTTP launch failed (${res.status}): ${errText.slice(0, 500)}`,
        );
      }
      const data = await res.json().catch(() => ({}));
      remoteSessionId = (data as any)?.sessionId;
      remoteResumeCommand = (data as any)?.resumeCommand;
      remoteDeepLink = (data as any)?.deepLink;
    } else {
      if (!invocation) {
        throw new Error(
          `Custom profile "${profile.id}" in launcher subprocess mode requires launchCommand`,
        );
      }
      const output = await this.runCustomCommand({
        command: invocation,
        cwd,
        profile,
        tokens: tokenMap,
        payload: launchPayload,
        timeoutSeconds: profile.timeoutSeconds ?? 60,
        retainChildrenOnSuccess: true,
      });
      try {
        const parsed = JSON.parse(output);
        remoteSessionId = parsed.sessionId;
        remoteResumeCommand = parsed.resumeCommand;
        remoteDeepLink = parsed.deepLink;
      } catch {}
    }

    const effectiveSessionId = remoteSessionId || logicalSession;
    const templateVars: Record<string, string> = {
      sessionId: effectiveSessionId,
      workId: work.id,
      runId: work.runId,
      cwd,
      sessionName,
    };
    const resumeCommand =
      remoteResumeCommand ||
      (profile.resumeCommandTemplate
        ? evaluateCommandOrUrlTemplate(
            profile.resumeCommandTemplate,
            templateVars,
          )
        : undefined);
    const deepLink = sanitizeDeepLink(
      remoteDeepLink ||
        (profile.deepLinkTemplate
          ? evaluateCommandOrUrlTemplate(profile.deepLinkTemplate, templateVars)
          : undefined),
    );

    const sessionRecord: LauncherSession = {
      idempotencyKey,
      workId: work.id,
      runId: work.runId,
      profile,
      claimTicket,
      sessionId: effectiveSessionId,
      sessionName,
      resumeCommand,
      deepLink,
      cwd,
      status: 'working',
      launchedAt: now(),
      lastStatusAt: Date.now(),
      archived: false,
    };

    Object.assign(record, {
      state: 'running',
      sessionId: effectiveSessionId,
      resumeCommand,
      deepLink,
    });
    this.write(record);
    this.claimTickets.set(work.id, {
      ticket: claimTicket,
      workId: work.id,
      runId: work.runId,
      profileId: profile.id,
      idempotencyKey,
      issuedAt: now(),
      used: false,
    });

    this.launchedWork.set(work.id, sessionRecord);
    this.launchIdempotency.set(idempotencyKey, sessionRecord);
    const current = this.engine.store.get<WorkRequest>('work', work.id);
    if (
      this.stopped ||
      current?.status === 'cancelled' ||
      this.engine.run(work.runId).status === 'cancelled'
    ) {
      // Cancellation may commit while the remote launch response is pending.
      // Never issue a usable ticket or treat the late response as quiescence.
      this.claimTickets.delete(work.id);
      this.stopExecution(record.id);
    }
    return sessionRecord;
  }
  private async pollLauncherStatus(session: LauncherSession) {
    if (session.cleanupFailed) return;
    const tokenMap = {
      INTERLOCK_WORK_ID: session.workId,
      INTERLOCK_RUN_ID: session.runId,
      INTERLOCK_CWD: session.cwd,
      INTERLOCK_CLAIM_TOKEN: session.claimTicket,
      INTERLOCK_CLAIM_TICKET: session.claimTicket,
      INTERLOCK_SESSION_ID: session.sessionId,
      INTERLOCK_SESSION_NAME: session.sessionName ?? '',
    };
    let newStatus: string | undefined;
    let parsedStatusData: any;

    if (session.profile.statusUrl) {
      const url = interpolateTokens(session.profile.statusUrl, tokenMap);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (session.profile.headers) {
        for (const [k, v] of Object.entries(session.profile.headers)) {
          headers[k] = interpolateTokens(v, tokenMap);
        }
      }
      try {
        const res = await fetch(url, { method: 'GET', headers });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          parsedStatusData = data;
          newStatus =
            (data as any)?.status ??
            (typeof data === 'string' ? data : undefined);
        }
      } catch {}
    } else if (session.profile.statusCommand) {
      try {
        const output = await this.runLauncherCommand(session, 'status', {
          command: session.profile.statusCommand,
          cwd: session.cwd,
          profile: session.profile,
          tokens: tokenMap,
          timeoutSeconds: 10,
        });
        try {
          const parsed = JSON.parse(output);
          parsedStatusData = parsed;
          newStatus = parsed.status ?? parsed;
        } catch {
          newStatus = output;
        }
      } catch {}
    }

    if (this.stopped || this.launchedWork.get(session.workId) !== session)
      return;

    const record = this.latest(session.workId);
    if (record && parsedStatusData && typeof parsedStatusData === 'object') {
      if (parsedStatusData.resumeCommand) {
        session.resumeCommand = parsedStatusData.resumeCommand;
        record.resumeCommand = parsedStatusData.resumeCommand;
      }
      if (parsedStatusData.deepLink) {
        const clean = sanitizeDeepLink(parsedStatusData.deepLink);
        if (clean) {
          session.deepLink = clean;
          record.deepLink = clean;
        }
      }
      if (parsedStatusData.progress || parsedStatusData.message) {
        this.log(record, parsedStatusData.progress ?? parsedStatusData.message);
      }
    }
    if (
      newStatus &&
      ['working', 'idle', 'needs_attention', 'ended'].includes(newStatus)
    ) {
      session.status = newStatus as
        'working' | 'idle' | 'needs_attention' | 'ended';
      const record = this.latest(session.workId);
      if (record) {
        if (newStatus === 'ended' && record.state === 'running') {
          record.state = 'completed';
          record.endedAt = now();
          this.write(record);
        } else {
          this.log(record, `Status updated: ${newStatus}`);
        }
      }
    }
  }
  private async recoverIdleLauncher(
    session: LauncherSession,
    captured: WorkRequest,
  ) {
    if (this.stopped || this.idleRecovering.has(captured.id)) return;
    const run = this.engine.store.get<Run>('runs', captured.runId);
    const definition =
      run &&
      this.engine.store.getVersion(run.workflowId, run.version)?.definition;
    const node = definition?.nodes.find((n) => n.id === captured.nodeId);
    if (
      !run ||
      !definition ||
      !node ||
      session.status !== 'idle' ||
      this.engine.pauses.applicable(run.workflowId).length
    )
      return;
    const policy = this.engine.stalls.policy(definition, node);
    const recovery = policy.idleRecovery;
    const threshold = policy.claimedIdleStallMs;
    if (
      !recovery?.maxRecoveries ||
      !threshold ||
      captured.managedExecution?.state === 'needs_human'
    )
      return;
    const activityAt = captured.lastActivityAt ?? captured.claimedAt;
    if (
      !activityAt ||
      this.engine.stalls.elapsed(run, activityAt, captured.id).activeMs <
        threshold
    )
      return;
    const pending = captured.idleNudge;
    if (
      pending &&
      this.engine.stalls.elapsed(run, pending.at, captured.id).activeMs <
        threshold
    )
      return;
    if (!pending && (captured.idleRecoveryCount ?? 0) >= recovery.maxRecoveries)
      return;
    const owned = () => {
      if (this.stopped || this.launchedWork.get(captured.id) !== session)
        return;
      const w = this.engine.store.get<WorkRequest>('work', captured.id);
      return w?.status === 'claimed' &&
        w.managedExecution?.state !== 'needs_human' &&
        w.attempt === captured.attempt &&
        !this.engine.stalls.deadlineExpired(w) &&
        w.token === captured.token &&
        w.lastActivityAt === captured.lastActivityAt
        ? w
        : undefined;
    };
    this.idleRecovering.add(captured.id);
    try {
      if (!pending) {
        if (!session.profile.messageCommand && !session.profile.messageUrl)
          return;
        const work = owned();
        if (!work) return;
        work.idleRecoveryCount = (work.idleRecoveryCount ?? 0) + 1;
        work.idleNudge = { attempt: work.attempt, activityAt, at: now() };
        this.engine.store.put('work', work);
        const record = this.latest(work.id);
        if (record)
          this.recordRecoveryEvent(record, {
            errorClass: 'idle',
            action: 'nudge',
            messageExcerpt: recovery.message.slice(0, 500),
            at: now(),
          });
        await this.sendLauncherMessage(session, recovery.message);
        return;
      }
      if (!session.profile.stopCommand && !session.profile.stopUrl) return;
      await this.requestLauncherStop(session);
      await this.pollLauncherStatus(session);
      const work = owned();
      if (!work) return;
      if ((session.status as string) !== 'ended')
        throw new Error('Launcher stop did not confirm ended status');
      // Confirmed external quiescence permits the ordinary bounded failure path.
      const recovered = this.latest(work.id);
      if (recovered)
        this.recordRecoveryEvent(recovered, {
          errorClass: 'idle',
          action: 'relaunch',
          messageExcerpt:
            'Confirmed ended status; ordinary attempt admission applies',
          at: now(),
        });
      this.engine.reportFailure(
        work.id,
        work.token!,
        'Idle recovery stopped the stalled session',
      );
      this.claimTickets.delete(work.id);
      this.launchedWork.delete(work.id);
      const record = this.latest(work.id);
      if (record) {
        record.state = 'failed';
        record.endedAt = now();
        this.write(record);
      }
      this.schedule();
    } catch (error) {
      // Deadline/lease processing can revoke the snapshot while external delivery waits.
      // Hold admission pumps too, so interruption must tolerate a second revocation.
      try {
        this.engine.pump();
        const work = owned();
        const record = work && this.latest(work.id);
        if (record)
          this.interrupted(
            record,
            ('Idle recovery uncertain: ' + errorText(error)).slice(0, 1000),
          );
      } catch {
        // The claim may have ended, or the engine may have closed during delivery.
      }
    } finally {
      this.idleRecovering.delete(captured.id);
    }
  }
  private runCustomCommand(input: Parameters<typeof executeCustomCommand>[0]) {
    if (this.stopped)
      return Promise.reject(
        new Error('Interlock stopped before launching command'),
      );
    const abort = new AbortController();
    const done = executeCustomCommand({ ...input, signal: abort.signal });
    const command = { abort, done };
    this.customCommands.add(command);
    void done
      .finally(() => this.customCommands.delete(command))
      .catch(() => {});
    return done;
  }
  private runLauncherCommand(
    session: LauncherSession,
    operation: 'status' | 'message' | 'archive' | 'stop',
    input: Parameters<typeof executeCustomCommand>[0],
  ): Promise<string> {
    if (session.cleanupFailed && operation !== 'stop')
      return Promise.reject(
        new HarnessCleanupError(
          'Launcher command cleanup requires stop confirmation',
        ),
      );
    const commands =
      this.launcherCommands.get(session.workId) ??
      new Map<string, Promise<string>>();
    const pending = commands.get(operation);
    if (pending)
      return operation === 'message'
        ? Promise.reject(
            new HarnessRequestError(
              'A launcher message is already being delivered',
            ),
          )
        : pending;
    const command = (async () => {
      try {
        return await this.runCustomCommand(input);
      } catch (error) {
        if (error instanceof HarnessCleanupError) {
          session.cleanupFailed = true;
          const record = this.latest(session.workId);
          if (record)
            this.interrupted(
              record,
              `Launcher ${operation} cleanup is uncertain. Confirm its subprocesses stopped before reconciling.`,
            );
        }
        throw error;
      } finally {
        commands.delete(operation);
        if (!commands.size) this.launcherCommands.delete(session.workId);
      }
    })();
    commands.set(operation, command);
    this.launcherCommands.set(session.workId, commands);
    return command;
  }
  private async sendLauncherMessage(session: LauncherSession, message: string) {
    const tokenMap = {
      INTERLOCK_WORK_ID: session.workId,
      INTERLOCK_RUN_ID: session.runId,
      INTERLOCK_CWD: session.cwd,
      INTERLOCK_CLAIM_TOKEN: session.claimTicket,
      INTERLOCK_CLAIM_TICKET: session.claimTicket,
      INTERLOCK_SESSION_ID: session.sessionId,
      INTERLOCK_INPUT: message,
    };
    const payload = {
      workId: session.workId,
      runId: session.runId,
      sessionId: session.sessionId,
      message,
    };

    if (session.profile.messageUrl) {
      const url = interpolateTokens(session.profile.messageUrl, tokenMap);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (session.profile.headers) {
        for (const [k, v] of Object.entries(session.profile.headers)) {
          headers[k] = interpolateTokens(v, tokenMap);
        }
      }
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers,
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw new Error(`Launcher operation failed (${response.status})`);
    } else if (session.profile.messageCommand) {
      await this.runLauncherCommand(session, 'message', {
        command: session.profile.messageCommand,
        cwd: session.cwd,
        profile: session.profile,
        tokens: tokenMap,
        payload,
        timeoutSeconds: 10,
      });
    }
  }
  private async archiveLauncherSession(session: LauncherSession) {
    const tokenMap = {
      INTERLOCK_WORK_ID: session.workId,
      INTERLOCK_RUN_ID: session.runId,
      INTERLOCK_CWD: session.cwd,
      INTERLOCK_CLAIM_TOKEN: session.claimTicket,
      INTERLOCK_CLAIM_TICKET: session.claimTicket,
      INTERLOCK_SESSION_ID: session.sessionId,
    };
    const payload = {
      workId: session.workId,
      runId: session.runId,
      sessionId: session.sessionId,
    };

    if (session.profile.archiveUrl) {
      const url = interpolateTokens(session.profile.archiveUrl, tokenMap);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (session.profile.headers) {
        for (const [k, v] of Object.entries(session.profile.headers)) {
          headers[k] = interpolateTokens(v, tokenMap);
        }
      }
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }).catch(() => {});
    } else if (session.profile.archiveCommand) {
      await this.runLauncherCommand(session, 'archive', {
        command: session.profile.archiveCommand,
        cwd: session.cwd,
        profile: session.profile,
        tokens: tokenMap,
        payload,
        timeoutSeconds: 10,
      }).catch(() => {});
    }
  }
  private requestLauncherStop(session: LauncherSession) {
    const pending = this.launcherStops.get(session.workId);
    if (pending) return pending;
    const stop = this.stopLauncherSession(session);
    this.launcherStops.set(session.workId, stop);
    void stop
      .finally(() => {
        if (this.launcherStops.get(session.workId) === stop)
          this.launcherStops.delete(session.workId);
      })
      .catch(() => {});
    return stop;
  }
  private async stopLauncherSession(session: LauncherSession) {
    const tokenMap = {
      INTERLOCK_WORK_ID: session.workId,
      INTERLOCK_RUN_ID: session.runId,
      INTERLOCK_CWD: session.cwd,
      INTERLOCK_CLAIM_TOKEN: session.claimTicket,
      INTERLOCK_CLAIM_TICKET: session.claimTicket,
      INTERLOCK_SESSION_ID: session.sessionId,
    };
    const payload = {
      workId: session.workId,
      runId: session.runId,
      sessionId: session.sessionId,
    };

    if (session.profile.stopUrl) {
      const url = interpolateTokens(session.profile.stopUrl, tokenMap);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (session.profile.headers) {
        for (const [k, v] of Object.entries(session.profile.headers)) {
          headers[k] = interpolateTokens(v, tokenMap);
        }
      }
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers,
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw new Error(`Launcher operation failed (${response.status})`);
    } else if (session.profile.stopCommand) {
      await this.runLauncherCommand(session, 'stop', {
        command: session.profile.stopCommand,
        cwd: session.cwd,
        profile: session.profile,
        tokens: tokenMap,
        payload,
        timeoutSeconds: 10,
      });
    }
  }
  private recordRecoveryEvent(record: ManagedExecution, event: RecoveryEvent) {
    record.recoveryEvents = record.recoveryEvents ?? [];
    record.recoveryEvents.push(event);
    this.write(record);
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

  private countTransientRetriesInWindow(
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

  private async sleepHonoringPauses(
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

  private resolveRecoveryPolicies(work: WorkRequest, profile: ExecutorProfile) {
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

  private async execute(job: Job, adapter: HarnessAdapter, session: Session) {
    const r = job.record;
    this.transcripts.register(r);
    const { continueOnMissingResult, transientRetry } =
      this.resolveRecoveryPolicies(job.work, r.profile);

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
                signal: job.abort.signal,
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
                request: (request) => this.request(job, request),
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
            if (usage?.length)
              this.engine.usage.report({
                workId: job.work.id,
                attempt: job.work.attempt,
                token: job.work.token,
                snapshot: { sequence: 1, final: true, models: usage },
              });
            // Validation and duplicate handling stay in the ordinary submission path.
            this.engine.submit(job.work.id, job.work.token!, turnResult.output);
            r.state = 'completed';
            r.endedAt = now();
            this.write(r);
            return;
          }
        } catch (error) {
          if (this.stopped || job.abort.signal.aborted) return;
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
              const recentRetries = this.countTransientRetriesInWindow(
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
                await this.sleepHonoringPauses(
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
  private request(job: Job, input: HarnessRequest): Promise<ExecutorAnswer> {
    if (this.stopped || job.abort.signal.aborted)
      return Promise.reject(new Error('Execution stopped'));
    if (job.answers.size >= 10 || job.record.requests.length >= 100)
      return Promise.reject(
        new Error('Too many human requests in one execution'),
      );
    if (
      JSON.stringify(input).length > 20000 ||
      input.detail.length > 16384 ||
      input.title.length > 200 ||
      (input.questions?.length ?? 0) > 10
    )
      return Promise.reject(
        new Error('Harness request is too large to present safely'),
      );
    if (
      input.kind === 'question' &&
      (!input.questions?.length ||
        new Set(input.questions.map((q) => q.id)).size !==
          input.questions.length ||
        input.questions.some(
          (q) =>
            !q.id ||
            !q.text ||
            q.id.length > 1000 ||
            q.text.length > 4000 ||
            (q.options?.length ?? 0) > 20,
        ))
    )
      return Promise.reject(new Error('Harness returned invalid questions'));
    const request: ExecutorRequest = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      state: 'pending',
    };
    job.record.requests.push(request);
    job.record.state = 'needs_human';
    this.write(job.record);
    return new Promise((resolve, reject) => {
      job.answers.set(request.id, { resolve, reject });
    });
  }
  respond(input: unknown) {
    const q = executorResponseSchema.parse(input);
    this.checkJobs();
    if (JSON.stringify(q.answer).length > 20000)
      throw new InterlockError('Answer is too large');
    const record = this.engine.store.get<ManagedExecution>(
      attemptsCollection,
      q.executionId,
    );
    const request = record?.requests.find((r) => r.id === q.requestId);
    if (!record || !request)
      throw new InterlockError('Execution request not found');
    if (
      request.state === 'answered' &&
      isDeepStrictEqual(request.answer, q.answer)
    )
      return { applied: false };
    const job = this.jobs.get(record.workId);
    if (
      !job ||
      job.record.id !== record.id ||
      job.abort.signal.aborted ||
      request.state !== 'pending'
    )
      throw new InterlockError(
        'This request is no longer active. Inspect the execution.',
      );
    const work = this.engine.store.get<WorkRequest>('work', record.workId);
    if (
      work?.status !== 'claimed' ||
      work.token !== job.work.token ||
      work.attempt !== record.attempt
    )
      throw new InterlockError('The assignment claim changed');
    if (request.kind === 'permission') {
      if (q.answer.allow === undefined || q.answer.answers)
        throw new InterlockError(
          'Answer this permission request with allow:true or allow:false',
        );
    } else {
      const keys = request.questions?.map((v) => v.id) ?? [];
      if (
        q.answer.allow !== undefined ||
        !q.answer.answers ||
        Object.keys(q.answer.answers).length !== keys.length ||
        keys.some((k) => !q.answer.answers![k]?.length)
      )
        throw new InterlockError(
          'Answer every question using its exact question ID',
        );
      if (
        request.questions?.some(
          (question) =>
            !question.multiple && q.answer.answers![question.id].length !== 1,
        )
      )
        throw new InterlockError(
          'Choose one answer for each single-choice question',
        );
    }
    if (
      request.kind === 'question' &&
      request.questions?.some((question) => {
        const values = q.answer.answers![question.id];
        return (
          new Set(values).size !== values.length ||
          values.some(
            (value) =>
              !value.trim() ||
              (question.options?.length &&
                !question.allowOther &&
                !question.options.includes(value)),
          )
        );
      })
    )
      throw new InterlockError(
        'Use the supplied choices unless the question allows another answer',
      );
    const live = job.record.requests.find((r) => r.id === request.id)!;
    live.state = 'answered';
    live.answer = q.answer;
    const pending = job.answers.get(request.id)!;
    job.answers.delete(request.id);
    job.record.state = job.answers.size ? 'needs_human' : 'running';
    this.write(job.record);
    pending.resolve(q.answer);
    return { applied: true };
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
    for (const request of this.modelRequests.values())
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
      [...this.modelRequests.values()].map((r) => r.done),
    );
  }
}
function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2000,
  );
}
/** Unknown resumed history stays unknown rather than charging an old session twice. */
export function usageDelta(
  current: ModelUsage[],
  before: ModelUsage[] | null,
): ModelUsage[] | undefined {
  if (!before) return;
  return current.map((value) => {
    const prior = before.find(
      (v) => v.provider === value.provider && v.model === value.model,
    );
    const result: ModelUsage = { provider: value.provider, model: value.model };
    for (const field of tokenFields)
      if (
        value[field] !== undefined &&
        (!prior || prior[field] !== undefined) &&
        value[field]! >= (prior?.[field] ?? 0)
      )
        result[field] = value[field]! - (prior?.[field] ?? 0);
    if (
      value.cost &&
      (!prior ||
        (prior.cost?.source === value.cost.source &&
          prior.cost.currency === value.cost.currency)) &&
      value.cost.amountMicros >= (prior?.cost?.amountMicros ?? 0)
    )
      result.cost = {
        ...value.cost,
        amountMicros:
          value.cost.amountMicros - (prior?.cost?.amountMicros ?? 0),
      };
    return result;
  });
}

/** Preserve captured profile settings while ignoring the retired timeout draft field. */
function parseProfileSnapshot(value: unknown): ExecutorProfile {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { timeoutMs: _retiredTimeout, ...current } = value as Record<
      string,
      unknown
    >;
    return executorProfileSchema.parse(current);
  }
  return executorProfileSchema.parse(value);
}
