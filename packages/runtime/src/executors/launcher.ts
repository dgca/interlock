import { randomUUID } from 'node:crypto';
import type {
  ExecutorProfile,
  ManagedExecution,
  RecoveryEvent,
  Run,
  WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';
import type { SchedulerErrors } from '../log.js';
import { errorText } from './configuration.js';
import { HarnessCleanupError, HarnessRequestError } from './contracts.js';
import {
  buildTokenMap,
  customInvocation,
  interpolateTokens,
  executeCustomCommand,
} from './custom.js';
import { evaluateCommandOrUrlTemplate, sanitizeDeepLink } from './templates.js';
import { now } from './supervision.js';

export interface LauncherSession {
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

export interface ClaimTicket {
  ticket: string;
  workId: string;
  runId: string;
  profileId: string;
  idempotencyKey: string;
  issuedAt: string;
  used: boolean;
}

/** Launch state the manager owns and reads; the supervisor updates it in place. */
export interface LauncherState {
  claimTickets: Map<string, ClaimTicket>;
  launchedWork: Map<string, LauncherSession>;
  launchIdempotency: Map<string, LauncherSession>;
  launcherStops: Map<string, Promise<void>>;
  launcherCommands: Map<string, Map<string, Promise<string>>>;
  customCommands: Set<{ abort: AbortController; done: Promise<string> }>;
}

/** Supervision operations the launcher shares with native executions. */
export interface LauncherHost {
  readonly errors: SchedulerErrors;
  stopped(): boolean;
  mcpUrl(): string | undefined;
  apiToken(): string | undefined;
  latest(workId: string): ManagedExecution | undefined;
  write(record: ManagedExecution): void;
  log(record: ManagedExecution, message: string): void;
  interrupted(record: ManagedExecution, reason: string): void;
  recordRecoveryEvent(record: ManagedExecution, event: RecoveryEvent): void;
  resolveSessionName(work: WorkRequest, profile: ExecutorProfile): string;
  stopExecution(executionId: string): unknown;
  schedule(): void;
}

/** Delegated launcher sessions: launch, status polling, idle recovery, messages, archive and stop. */
export class LauncherSupervisor {
  private readonly idleRecovering = new Set<string>();
  private readonly claimTickets: LauncherState['claimTickets'];
  private readonly launchedWork: LauncherState['launchedWork'];
  private readonly launchIdempotency: LauncherState['launchIdempotency'];
  private readonly launcherStops: LauncherState['launcherStops'];
  private readonly launcherCommands: LauncherState['launcherCommands'];
  private readonly customCommands: LauncherState['customCommands'];
  constructor(
    private readonly engine: Pick<
      Engine,
      'store' | 'run' | 'pauses' | 'stalls' | 'pump' | 'reportFailure'
    >,
    private readonly host: LauncherHost,
    state: LauncherState,
  ) {
    this.claimTickets = state.claimTickets;
    this.launchedWork = state.launchedWork;
    this.launchIdempotency = state.launchIdempotency;
    this.launcherStops = state.launcherStops;
    this.launcherCommands = state.launcherCommands;
    this.customCommands = state.customCommands;
  }
  private get errors() {
    return this.host.errors;
  }
  private get stopped() {
    return this.host.stopped();
  }
  private get mcpUrl() {
    return this.host.mcpUrl();
  }
  private get apiToken() {
    return this.host.apiToken();
  }
  private latest(workId: string) {
    return this.host.latest(workId);
  }
  private write(record: ManagedExecution) {
    this.host.write(record);
  }
  private log(record: ManagedExecution, message: string) {
    this.host.log(record, message);
  }
  private interrupted(record: ManagedExecution, reason: string) {
    this.host.interrupted(record, reason);
  }
  private recordRecoveryEvent(record: ManagedExecution, event: RecoveryEvent) {
    this.host.recordRecoveryEvent(record, event);
  }
  private resolveSessionName(work: WorkRequest, profile: ExecutorProfile) {
    return this.host.resolveSessionName(work, profile);
  }
  private stopExecution(executionId: string) {
    return this.host.stopExecution(executionId);
  }
  private schedule() {
    this.host.schedule();
  }
  async launchCustom(
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
      ...(this.mcpUrl ? { INTERLOCK_MCP_URL: this.mcpUrl } : {}),
      ...(this.apiToken ? { INTERLOCK_API_TOKEN: this.apiToken } : {}),
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
      mcpUrl: this.mcpUrl,
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
  async pollLauncherStatus(session: LauncherSession) {
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

    try {
      if (session.profile.statusUrl) {
        const url = interpolateTokens(session.profile.statusUrl, tokenMap);
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (session.profile.headers)
          for (const [k, v] of Object.entries(session.profile.headers))
            headers[k] = interpolateTokens(v, tokenMap);
        const res = await fetch(url, { method: 'GET', headers });
        if (!res.ok) throw new Error(`Status URL returned HTTP ${res.status}`);
        const data = await res.json().catch(() => ({}));
        parsedStatusData = data;
        newStatus = typeof data === 'string' ? data : (data as any)?.status;
      } else if (session.profile.statusCommand) {
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
      }
    } catch (error) {
      this.errors.record('launcher status', error);
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
  async recoverIdleLauncher(session: LauncherSession, captured: WorkRequest) {
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
  async sendLauncherMessage(session: LauncherSession, message: string) {
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
  async archiveLauncherSession(session: LauncherSession) {
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
      if (session.profile.headers)
        for (const [k, v] of Object.entries(session.profile.headers))
          headers[k] = interpolateTokens(v, tokenMap);
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Archive URL returned HTTP ${res.status}`);
    } else if (session.profile.archiveCommand) {
      await this.runLauncherCommand(session, 'archive', {
        command: session.profile.archiveCommand,
        cwd: session.cwd,
        profile: session.profile,
        tokens: tokenMap,
        payload,
        timeoutSeconds: 10,
      });
    }
  }
  requestLauncherStop(session: LauncherSession) {
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
  async stopLauncherSession(session: LauncherSession) {
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
      if (session.profile.headers)
        for (const [k, v] of Object.entries(session.profile.headers))
          headers[k] = interpolateTokens(v, tokenMap);
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
}
