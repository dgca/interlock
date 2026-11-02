import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  executorProfileSchema,
  executorProfileUpdateSchema,
  executorResponseSchema,
  executorOperationSchema,
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
];
interface Session {
  id: string;
  runId: string;
  profile: ExecutorProfile;
  permissionSource?: 'workflow' | 'harness';
  command: string;
  cwd: string;
  nativeId?: string;
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
    if (record && record.attempt === work.attempt)
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
    const resolvedProfile = owned?.profile ?? record?.profile ?? profile;
    const reason =
      binding && (binding.executorId !== work.executor || !owned)
        ? 'This continuity group is bound to another executor session'
        : detection && detection.status !== 'detected'
          ? (detection.message ?? 'Harness executable is unavailable')
          : !profile
            ? 'Configure this local harness profile'
            : !profile.enabled
              ? 'Automatic execution is disabled for this profile'
              : this.incompatible(work, resolvedProfile!);
    return {
      profileId: work.executor,
      harness: profile?.harness,
      state: reason ? 'blocked' : 'queued',
      ...(reason ? { reason } : {}),
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
  assertClaim(work: WorkRequest) {
    const record = this.latest(work.id);
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
        if (this.jobs.size >= 4 || this.stopped) break;
        if (
          !offered.executor ||
          this.jobs.has(offered.id) ||
          this.latest(offered.id)?.state === 'interrupted'
        )
          continue;
        const configured = this.profiles().find(
          (p) => p.id === offered.executor,
        );
        if (!configured?.enabled) continue;
        const adapter = this.adapters.get(configured.harness);
        if (
          !adapter ||
          [...this.jobs.values()].filter(
            (j) => j.record.profile.id === configured.id,
          ).length >= configured.concurrency
        )
          continue;
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
        const previous = this.latest(offered.id);
        const profile = parseProfileSnapshot(
          priorSession?.profile ??
            previous?.profile ?? {
              ...configured,
              permissions:
                offered.executorPermissions ?? configured.permissions,
            },
        );
        const permissionSource =
          priorSession?.permissionSource ??
          previous?.permissionSource ??
          (offered.executorPermissions
            ? ('workflow' as const)
            : ('harness' as const));
        if (this.incompatible(offered, profile)) continue;
        const pinnedCommand = priorSession?.command ?? previous?.command;
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
          profile,
          permissionSource,
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
        usageDelta(
          result.usage,
          session.nativeId && session.usageUncertain
            ? null
            : (session.usage ?? []),
        );
      if (result.usage) {
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
        .list<ManagedExecution>(attemptsCollection)
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
    for (const job of this.jobs.values())
      this.interruptJob(
        job,
        'Interlock stopped during execution. Confirm the previous session and subprocesses stopped before retrying.',
      );
    await Promise.allSettled([...this.jobs.values()].map((j) => j.done));
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

/** Earlier draft snapshots may retain a runtime cutoff; current execution ignores it. */
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
