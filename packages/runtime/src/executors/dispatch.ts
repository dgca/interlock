import { randomUUID } from 'node:crypto';
import type {
  ExecutorProfile,
  ManagedExecution,
  ManagedWorkSummary,
  WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';
import {
  parseProfileSnapshot,
  type ExecutorConfiguration,
  type ManagedAssignment,
} from './configuration.js';
import type { LauncherSession, LauncherSupervisor } from './launcher.js';
import type { BudgetStops } from './budgetStops.js';
import { continuityProblem, resolveSessionName } from './continuity.js';
import {
  now,
  sessionsCollection,
  type Job,
  type Session,
} from './supervision.js';
import { HarnessCleanupError, type HarnessAdapter } from './contracts.js';
import { evaluateCommandOrUrlTemplate, sanitizeDeepLink } from './templates.js';

/** Dispatch state the manager owns and reads; dispatch updates it in place. */
export interface DispatchState {
  jobs: Map<string, Job>;
  launchedWork: Map<string, LauncherSession>;
  pendingLaunches: Map<string, string>;
}

/** Supervision operations dispatch shares with the manager. */
export interface DispatchHost {
  stopped(): boolean;
  adapters(): Map<string, HarnessAdapter>;
  profiles(): ReturnType<ExecutorConfiguration['profiles']>;
  settings(): ReturnType<ExecutorConfiguration['settings']>;
  latest(workId: string): ManagedExecution | undefined;
  write(record: ManagedExecution): void;
  checkJobs(): void;
  launchCustom(
    ...args: Parameters<LauncherSupervisor['launchCustom']>
  ): ReturnType<LauncherSupervisor['launchCustom']>;
  execute(job: Job, adapter: HarnessAdapter, session: Session): Promise<void>;
}

/** Admission and launch: capacity, queued-state descriptions, and the scan that claims or launches available managed work. */
export class ExecutorDispatch {
  private scanning = false;
  private readonly jobs: DispatchState['jobs'];
  private readonly launchedWork: DispatchState['launchedWork'];
  private readonly pendingLaunches: DispatchState['pendingLaunches'];
  constructor(
    private readonly engine: Pick<
      Engine,
      'store' | 'contextGroups' | 'workspaces' | 'claim' | 'pauses'
    >,
    private readonly defaultCwd: string,
    private readonly config: ExecutorConfiguration,
    private readonly launcher: LauncherSupervisor,
    private readonly budgetStops: BudgetStops,
    state: DispatchState,
    private readonly host: DispatchHost,
  ) {
    this.jobs = state.jobs;
    this.launchedWork = state.launchedWork;
    this.pendingLaunches = state.pendingLaunches;
  }
  private get stopped() {
    return this.host.stopped();
  }
  private get adapters() {
    return this.host.adapters();
  }
  private profiles() {
    return this.host.profiles();
  }
  private settings() {
    return this.host.settings();
  }
  private latest(workId: string) {
    return this.host.latest(workId);
  }
  private write(record: ManagedExecution) {
    this.host.write(record);
  }
  private checkJobs() {
    this.host.checkJobs();
  }
  private launchCustom(
    ...args: Parameters<LauncherSupervisor['launchCustom']>
  ) {
    return this.host.launchCustom(...args);
  }
  private execute(job: Job, adapter: HarnessAdapter, session: Session) {
    return this.host.execute(job, adapter, session);
  }
  private continuityProblem(work: ManagedAssignment, session: Session) {
    return continuityProblem(work, session);
  }
  private resolveSessionName(work: WorkRequest, profile: ExecutorProfile) {
    return resolveSessionName(this.engine, work, profile);
  }
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
      this.launcher.pull.detection(profile) ??
      this.config.detections.get(
        `${profile?.id}:${profile?.revision}:${profile?.command ?? ''}`,
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
  async scan() {
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
          if (
            this.launchedWork.has(offered.id) ||
            !this.launcher.pull.ready(configured)
          )
            continue;
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
          const launch = this.config.launchProfile(
            offered,
            configured,
            this.latest(offered.id),
          );
          try {
            this.pendingLaunches.set(offered.id, configured.id);
            try {
              await this.launchCustom(offered, launch, cwd, logicalSession);
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
              ...launch,
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
          this.config.permissionSource(offered, configured);
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
          executorSource: work.executorSource,
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
}
