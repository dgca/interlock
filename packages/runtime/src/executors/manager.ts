import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
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
} from '@interlock/core';
import type { Engine } from '../index.js';
import {
  HarnessResultError,
  HarnessModelError,
  type HarnessAdapter,
  type HarnessRequest,
} from './contracts.js';

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
  permissionSource?: 'workflow' | 'harness';
  modelSource?: ManagedExecution['modelSource'];
  effortSource?: ManagedExecution['effortSource'];
  command: string;
  cwd: string;
  nativeId?: string;
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
  done?: Promise<void>;
}

/** Queue and claim lifecycle are shared; adapters own native session protocols. */
export class ExecutorManager {
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
  private running = false;
  private stopped = false;
  private scheduled = false;
  private scanning = false;
  private unsubscribe?: () => void;
  private interval?: ReturnType<typeof setInterval>;
  constructor(
    private engine: Engine,
    private defaultCwd: string,
  ) {}
  async manage(input: unknown) {
    const q = executorOperationSchema.parse(input);
    switch (q.action) {
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
  settings() {
    const stored = this.engine.store.get<{
      id: string;
      revision: number;
      concurrency: number | null;
    }>('executorSettings', 'shared');
    return executorSettingsSchema.parse(
      stored
        ? { revision: stored.revision, concurrency: stored.concurrency }
        : {},
    );
  }
  saveSettings(input: unknown) {
    const q = executorSettingsUpdateSchema.parse(input);
    const result = this.engine.store.transaction(() => {
      if (this.settings().revision !== q.expectedRevision)
        throw new InterlockError(
          'Execution settings changed. Reload before saving.',
        );
      const next = executorSettingsSchema.parse({
        revision: q.expectedRevision + 1,
        concurrency: q.concurrency,
      });
      this.engine.store.put('executorSettings', { id: 'shared', ...next });
      return next;
    });
    this.schedule();
    return result;
  }
  private atCapacity() {
    const limit = this.settings().concurrency;
    return limit !== null && this.jobs.size >= limit;
  }
  saveProfile(input: ExecutorProfileUpdate) {
    const q = executorProfileUpdateSchema.parse(input);
    for (const path of [q.command, q.cwd])
      if (path && !isAbsolute(path))
        throw new InterlockError(
          'Executable and working directory overrides must be absolute paths',
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
        detection: await this.detect(profile, refresh),
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
  private async detect(profile: ExecutorProfile, refresh = false) {
    const key = `${profile.id}:${profile.revision}:${profile.command ?? ''}`;
    const cached = this.detections.get(key);
    if (!refresh && cached && Date.now() - cached.at < 30000)
      return cached.result;
    const adapter = this.adapters.get(profile.harness);
    const result = adapter
      ? await adapter.detect(profile.command)
      : {
          status: 'unavailable' as const,
          message: 'Harness execution is not attached to this server',
        };
    this.detections.set(key, { at: Date.now(), result });
    return result;
  }
  start(adapters: HarnessAdapter[]) {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.adapters = new Map(adapters.map((a) => [a.id, a]));
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
      .sort((a, b) => b.attempt - a.attempt)[0];
  }
  describe(work: WorkRequest): ManagedWorkSummary | undefined {
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
                : (this.incompatible(work, resolvedProfile!) ??
                  (owned || record
                    ? undefined
                    : this.effortProblem(resolvedProfile!)));
    return {
      profileId: work.executor,
      harness: profile?.harness,
      state: reason ? 'blocked' : 'queued',
      ...(reason
        ? { reason }
        : this.atCapacity()
          ? { reason: 'Waiting for a shared Agent assignment slot' }
          : {}),
    };
  }
  private incompatible(work: WorkRequest, profile: ExecutorProfile) {
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
    work: WorkRequest,
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
  private continuityProblem(work: WorkRequest, session: Session) {
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
  private effortProblem(profile: ExecutorProfile) {
    if (!profile.effort) return;
    if (!profile.model)
      return 'Select a model before configuring thinking effort';
    const catalog = this.catalogs.get(this.catalogKey(profile))?.result;
    if (!catalog)
      return 'Checking thinking effort support for the selected model';
    if (catalog.status !== 'ready')
      return `Thinking effort support could not be checked: ${catalog.message ?? 'model discovery unavailable'}`;
    const model = catalog.models.find((m) => m.id === profile.model);
    if (!model?.effortLevels)
      return 'This model does not report thinking effort choices. Use native default or select a model with reported support.';
    if (!model.effortLevels.includes(profile.effort))
      return `Thinking effort ${profile.effort} is not supported by ${profile.model}. Choose a supported level or use native default.`;
  }
  assertClaim(work: WorkRequest) {
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
  private write(record: ManagedExecution) {
    this.engine.store.put(attemptsCollection, record);
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
        },
      });
    this.engine.store.touchRun(record.runId);
  }
  private log(record: ManagedExecution, message: string) {
    record.logCount++;
    record.logs = [
      ...record.logs,
      { at: now(), message: message.slice(0, 1000) },
    ].slice(-50);
    this.write(record);
  }
  inspect(workId: string) {
    if (!this.engine.store.get<WorkRequest>('work', workId))
      throw new InterlockError('Assignment not found');
    const records = this.engine.store
      .forWork<ManagedExecution>(attemptsCollection, workId)
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
      })),
    };
  }
  private async scan() {
    if (this.scanning || this.stopped) return;
    this.scanning = true;
    try {
      this.checkJobs();
      // Observing ready work must not pump the engine and notify our own subscription.
      for (const offered of this.engine.available(undefined, {
        advance: false,
      })) {
        if (this.atCapacity() || this.stopped) break;
        if (
          !offered.executor ||
          this.jobs.has(offered.id) ||
          ['interrupted', 'needs_model'].includes(
            this.latest(offered.id)?.state ?? '',
          )
        )
          continue;
        const configured = this.profiles().find(
          (p) => p.id === offered.executor,
        );
        if (!configured?.enabled) continue;
        const adapter = this.adapters.get(configured.harness);
        if (!adapter) continue;
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
        if (
          this.stopped ||
          detection.status !== 'detected' ||
          !detection.command ||
          !currentProfile?.enabled ||
          currentProfile.revision !== configured.revision
        )
          continue;
        const cwd =
          offered.trialEnvironment?.workspace ??
          priorSession?.cwd ??
          previous?.cwd ??
          profile.cwd ??
          this.defaultCwd;
        // Settings can change while native executable detection is pending.
        if (this.atCapacity() || this.stopped) break;
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
  }
  private async execute(job: Job, adapter: HarnessAdapter, session: Session) {
    const r = job.record;
    let receivedResult = false;
    try {
      r.state = 'running';
      this.write(r);
      const result = await adapter.run({
        profile: r.profile,
        command: r.command,
        cwd: r.cwd,
        sessionId: session.nativeId,
        work: job.work,
        signal: job.abort.signal,
        onSession: (id, model) => {
          if (job.abort.signal.aborted || this.stopped) return;
          session.nativeId = id;
          r.sessionId = id;
          if (model) {
            session.profile = { ...session.profile, model };
            r.profile = session.profile;
          }
          this.engine.store.put(sessionsCollection, session);
          this.write(r);
        },
        onProgress: (message) => {
          if (!job.abort.signal.aborted && !this.stopped) this.log(r, message);
        },
        request: (request) => this.request(job, request),
      });
      receivedResult = true;
      if (this.stopped || job.abort.signal.aborted) return;
      const usage =
        result.usage &&
        (result.usageScope === 'attempt'
          ? result.usage
          : usageDelta(
              result.usage,
              session.nativeId && session.usageUncertain
                ? null
                : (session.usage ?? []),
            ));
      if (result.usage && result.usageScope !== 'attempt') {
        session.usage = result.usage;
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
      this.engine.submit(job.work.id, job.work.token!, result.output);
      r.state = 'completed';
      r.endedAt = now();
      this.write(r);
    } catch (error) {
      if (this.stopped || job.abort.signal.aborted) return;
      if (error instanceof HarnessModelError) {
        try {
          this.holdForModel(job, session, error);
        } catch (holdError) {
          this.interruptJob(
            job,
            'Could not hold the rejected model assignment: ' +
              errorText(holdError),
          );
        }
        return;
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
      const current = this.engine.store.get<WorkRequest>('work', job.work.id);
      if (current?.status === 'claimed' && current.token === job.work.token) {
        // An explicit failed attempt uses the existing bounded failure budget.
        try {
          this.engine.reportFailure(job.work.id, job.work.token!, r.error);
        } catch {}
      }
      session.usageUncertain = true;
      this.engine.store.put(sessionsCollection, session);
    } finally {
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
  private interrupted(record: ManagedExecution, reason: string) {
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
    if (!record || record.state !== 'interrupted')
      throw new InterlockError('Interrupted execution not found');
    if (this.jobs.has(record.workId))
      throw new InterlockError('The old harness is still stopping');
    const work = this.engine.store.get<WorkRequest>('work', record.workId);
    if (!work || work.attempt !== record.attempt)
      throw new InterlockError('The assignment attempt changed');
    this.engine.manageWorkResources({
      action: 'release',
      workId: work.id,
      expectedAttempt: record.attempt,
      confirmStopped: true,
      actor: 'managed-executor-reconciliation',
    });
    record.state = 'failed';
    this.write(record);
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
    for (const job of this.jobs.values())
      this.interruptJob(
        job,
        'Interlock stopped during execution. Confirm the previous session and subprocesses stopped before retrying.',
      );
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
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

/** Retired draft profile limits do not override the current shared execution settings. */
function parseProfileSnapshot(value: unknown): ExecutorProfile {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const {
      timeoutMs: _retiredTimeout,
      concurrency: _retiredConcurrency,
      ...current
    } = value as Record<string, unknown>;
    return executorProfileSchema.parse(current);
  }
  return executorProfileSchema.parse(value);
}
