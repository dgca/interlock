import {
  InterlockError,
  resolveProvider,
  type ManagedExecution,
  type ModelUsage,
  type UsageAttempt,
  type WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';
import type { ExecutorConfiguration } from './configuration.js';
import { inspected } from './budgetStops.js';
import {
  attemptsCollection,
  sessionsCollection,
  type Job,
  type Session,
} from './supervision.js';

/** Read-only views of managed executions: a step's provenance and the inspect operation. */
export class ExecutionInspection {
  constructor(
    private readonly engine: Pick<Engine, 'store'>,
    private readonly jobs: Map<string, Job>,
    private readonly host: {
      settings(): ReturnType<ExecutorConfiguration['settings']>;
    },
  ) {}
  private settings() {
    return this.host.settings();
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
}
