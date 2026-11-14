import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  InterlockError,
  type ExecutorProfile,
  type ManagedExecution,
  type WorkRequest,
} from '@interlock/core';
import {
  LauncherClientError,
  launcherCompleteSchema,
  launcherCredentialSchema,
  launcherFailSchema,
  launcherPollSchema,
  type LauncherOperationKind,
  type LeasedLauncherOperation,
} from '@interlock/core/launcherClient';
import type { Engine } from '../index.js';
import { parseProfileSnapshot } from './configuration.js';
import { HarnessCleanupError, HarnessRequestError } from './contracts.js';
import { now } from './supervision.js';

const operationsCollection = 'launcherOperations';
const clientsCollection = 'launcherClients';
/** How long a polled operation stays with its client before it returns to the queue. */
const leaseMs = 30_000;
const defaultClientTimeoutSeconds = 60;
const statusIntervalMs = 10_000;
const statusWaitMs = 15_000;
const operationWaitMs = 30_000;
const maxQueued = 200;
const maxPollers = 2;
const maxDeliveries = 5;
const pollSliceMs = 5_000;
const abandonedRetentionMs = 24 * 60 * 60 * 1000;

interface StoredOperation {
  id: string;
  profileId: string;
  kind: LauncherOperationKind;
  workId: string;
  runId: string;
  attempt: number;
  /** Launch payloads carry claim tickets, so they stay in memory only. */
  payload?: Record<string, unknown>;
  state: 'queued' | 'leased' | 'abandoned';
  createdAt: string;
  deliveries: number;
  leaseToken?: string;
  clientId?: string;
  leaseUntil?: string;
  abandonedAt?: string;
}
interface ClientRecord {
  id: string;
  credentialHash?: string;
  rotatedAt?: string;
  clientId?: string;
  lastPolledAt?: string;
}
type Waiter = {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};
export interface PullSessionRef {
  workId: string;
  runId: string;
  attempt?: number;
  profile: ExecutorProfile;
}
export interface PullHost {
  stopped(): boolean;
  latest(workId: string): ManagedExecution | undefined;
  log(record: ManagedExecution, message: string): void;
}
/** Pending operations register here so shutdown aborts them with launcher commands. */
type Commands = Set<{ abort: AbortController; done: Promise<string> }>;

const digest = (value: string) => createHash('sha256').update(value).digest();
const text = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined;

/**
 * The pull transport: Interlock queues launcher operations per profile and one
 * client that can only make outbound requests leases and completes them.
 */
export class PullLaunchers {
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly launchPayloads = new Map<string, Record<string, unknown>>();
  private readonly pollers = new Map<string, Set<() => void>>();
  constructor(
    private readonly store: Engine['store'],
    private readonly host: PullHost,
    private readonly commands: Commands,
  ) {
    this.recover();
  }
  /** Status polling cadence: pull clients answer a queued operation, so ask less often. */
  statusDue(session: { profile: ExecutorProfile; lastStatusAt: number }) {
    const { profile } = session;
    if (profile.transport === 'pull')
      return Date.now() - session.lastStatusAt > statusIntervalMs;
    return (
      !!(profile.statusCommand || profile.statusUrl) &&
      Date.now() - session.lastStatusAt > 2000
    );
  }
  /** After a restart only stop and archive remain deliverable; a launch that may have run waits for its late result. */
  private recover() {
    for (const op of this.store.list<StoredOperation>(operationsCollection)) {
      if (op.kind === 'stop' || op.kind === 'archive') continue;
      if (op.kind === 'launch' && (op.state !== 'queued' || op.deliveries > 0))
        this.store.put(operationsCollection, {
          ...op,
          state: 'abandoned',
          abandonedAt: op.abandonedAt ?? now(),
        });
      else this.store.remove(operationsCollection, op.id);
    }
  }
  private operations(profileId: string) {
    return this.store
      .list<StoredOperation>(operationsCollection)
      .filter((op) => op.profileId === profileId);
  }
  /** Pull profiles are always stored; built-in defaults never use this transport. */
  private profile(id: string) {
    const stored = this.store.get<unknown>('executorProfiles', id);
    return stored === undefined ? undefined : parseProfileSnapshot(stored);
  }
  private client(profileId: string) {
    return this.store.get<ClientRecord>(clientsCollection, profileId);
  }
  online(profile: ExecutorProfile) {
    if (this.pollers.get(profile.id)?.size) return true;
    const last = this.client(profile.id)?.lastPolledAt;
    return (
      !!last &&
      Date.now() - Date.parse(last) <=
        (profile.clientTimeoutSeconds ?? defaultClientTimeoutSeconds) * 1000
    );
  }
  /** Whether a launch may be queued now; other transports are always ready. */
  ready(profile: ExecutorProfile) {
    return profile.transport !== 'pull' || this.online(profile);
  }
  detection(profile: ExecutorProfile | undefined) {
    if (profile?.transport !== 'pull') return;
    return this.online(profile)
      ? { status: 'detected' as const, command: 'pull' }
      : {
          status: 'unavailable' as const,
          message: `launcher_client_offline: no launcher client has polled in the last ${profile.clientTimeoutSeconds ?? defaultClientTimeoutSeconds} seconds`,
        };
  }
  /** Profile list entries gain client liveness; credentials are never returned. */
  async annotate<T extends ExecutorProfile>(profiles: Promise<T[]>) {
    return (await profiles).map((profile) => {
      const detection = this.detection(profile);
      if (!detection) return profile;
      const client = this.client(profile.id);
      return {
        ...profile,
        detection,
        launcherClient: {
          credential: !!client?.credentialHash,
          online: detection.status === 'detected',
          ...(client?.clientId ? { clientId: client.clientId } : {}),
          ...(client?.lastPolledAt
            ? { lastPolledAt: client.lastPolledAt }
            : {}),
        },
      };
    });
  }
  rotateCredential(input: unknown) {
    const { profileId } = launcherCredentialSchema.parse(input);
    const profile = this.profile(profileId);
    if (profile?.transport !== 'pull')
      throw new InterlockError(
        'Launcher credentials apply only to custom launcher profiles with transport "pull"',
      );
    const credential = `ilc_${randomBytes(32).toString('base64url')}`;
    const rotatedAt = now();
    // A new credential also releases the active client so its replacement can poll.
    this.store.put(clientsCollection, {
      id: profileId,
      credentialHash: digest(credential).toString('hex'),
      rotatedAt,
    } satisfies ClientRecord);
    return { profileId, credential, rotatedAt };
  }
  private authorize(profileId: string, credential: string) {
    const client = this.client(profileId);
    const profile = this.profile(profileId);
    // Compare a digest of equal length even when nothing is stored.
    const expected = client?.credentialHash
      ? Buffer.from(client.credentialHash, 'hex')
      : randomBytes(32);
    const matches = timingSafeEqual(digest(credential), expected);
    if (!matches || !client?.credentialHash || profile?.transport !== 'pull')
      throw new LauncherClientError(
        'launcher_credential_invalid',
        'Launcher credential is not valid for this profile',
      );
    return { profile, client };
  }
  async poll(input: unknown, signal?: AbortSignal) {
    const q = launcherPollSchema.parse(input);
    const { profile, client } = this.authorize(q.profileId, q.credential);
    if (
      client.clientId &&
      client.clientId !== q.clientId &&
      this.online(profile)
    )
      throw new LauncherClientError(
        'launcher_client_conflict',
        'Another launcher client is active for this profile. Reuse its clientId, wait until it goes offline, or rotate the credential.',
      );
    const deadline = Date.now() + q.waitMs;
    for (;;) {
      this.touch(profile.id, q.clientId);
      const operations = this.lease(profile, q.clientId, q.limit);
      const remaining = deadline - Date.now();
      if (
        operations.length ||
        remaining <= 0 ||
        signal?.aborted ||
        this.host.stopped()
      )
        return { operations, leaseMs };
      await this.wait(profile.id, Math.min(remaining, pollSliceMs), signal);
    }
  }
  private touch(profileId: string, clientId: string) {
    const client = this.client(profileId);
    if (client)
      this.store.put(clientsCollection, {
        ...client,
        clientId,
        lastPolledAt: now(),
      });
  }
  /** One bounded wait per poll; a poll ends early when an operation is queued. */
  private wait(profileId: string, ms: number, signal?: AbortSignal) {
    const waiting = this.pollers.get(profileId) ?? new Set<() => void>();
    if (waiting.size >= maxPollers)
      throw new LauncherClientError(
        'launcher_poll_busy',
        'Too many concurrent polls for this profile',
      );
    this.pollers.set(profileId, waiting);
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        waiting.delete(done);
        if (!waiting.size) this.pollers.delete(profileId);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', done, { once: true });
      waiting.add(done);
    });
  }
  private notify(profileId: string) {
    for (const wake of [...(this.pollers.get(profileId) ?? [])]) wake();
  }
  private lease(profile: ExecutorProfile, clientId: string, limit: number) {
    const leased: LeasedLauncherOperation[] = [];
    const at = Date.now();
    for (const op of this.prune(profile.id)) {
      if (leased.length >= limit) break;
      if (op.state === 'abandoned') continue;
      if (op.state === 'leased' && Date.parse(op.leaseUntil!) > at) continue;
      if (op.deliveries >= maxDeliveries) {
        const reason = `The launcher client leased ${op.kind} ${maxDeliveries} times without completing it`;
        if (op.kind === 'launch') this.release(op, reason);
        else this.drop(op, new Error(reason));
        continue;
      }
      const payload =
        op.kind === 'launch' ? this.launchPayloads.get(op.id) : op.payload;
      if (!payload) {
        this.drop(op, new Error('Launcher operation payload is unavailable'));
        continue;
      }
      const leaseToken = randomBytes(24).toString('base64url');
      const leaseUntil = new Date(at + leaseMs).toISOString();
      this.store.put(operationsCollection, {
        ...op,
        state: 'leased',
        leaseToken,
        clientId,
        leaseUntil,
        deliveries: op.deliveries + 1,
      } satisfies StoredOperation);
      leased.push({
        operationId: op.id,
        kind: op.kind,
        leaseToken,
        leaseExpiresAt: leaseUntil,
        payload,
      });
    }
    return leased;
  }
  /** Drop work that can no longer use its operation; stop and archive always remain. */
  private prune(profileId: string) {
    const kept: StoredOperation[] = [];
    for (const op of this.operations(profileId)) {
      if (op.state === 'abandoned') {
        if (Date.now() - Date.parse(op.abandonedAt!) > abandonedRetentionMs)
          this.store.remove(operationsCollection, op.id);
        else kept.push(op);
        continue;
      }
      const work = this.store.get<WorkRequest>('work', op.workId);
      const inactive =
        op.kind === 'launch'
          ? op.deliveries === 0 &&
            (work?.status !== 'available' || work.attempt !== op.attempt)
          : (op.kind === 'status' || op.kind === 'message') &&
            !['available', 'claimed'].includes(work?.status ?? '');
      if (inactive)
        this.drop(op, new Error('The assignment is no longer active'));
      else kept.push(op);
    }
    return kept;
  }
  private take(id: string) {
    const waiting = this.waiters.get(id);
    this.waiters.delete(id);
    return [...(waiting ?? [])];
  }
  private drop(op: StoredOperation, error: Error) {
    this.store.remove(operationsCollection, op.id);
    this.launchPayloads.delete(op.id);
    for (const waiter of this.take(op.id)) waiter.reject(error);
  }
  /** Give up on an operation; a launch the client received may have created a session. */
  private release(op: StoredOperation, reason: string) {
    if (op.kind === 'launch' && op.deliveries > 0) {
      this.launchPayloads.delete(op.id);
      this.store.put(operationsCollection, {
        ...op,
        state: 'abandoned',
        abandonedAt: now(),
      } satisfies StoredOperation);
      const error = new HarnessCleanupError(
        `${reason}. The launcher client received the launch and may have created a session. Confirm it stopped before retrying.`,
      );
      for (const waiter of this.take(op.id)) waiter.reject(error);
    } else if (op.kind === 'stop' || op.kind === 'archive') {
      // Cleanup stays queued for a client that reconnects later.
      for (const waiter of this.take(op.id)) waiter.reject(new Error(reason));
    } else this.drop(op, new Error(reason));
  }
  /** Queue an operation and wait, bounded, for the client's result. */
  request(
    ref: PullSessionRef,
    kind: LauncherOperationKind,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Shutdown aborts a pending operation like a running launcher command.
    const abort = new AbortController();
    const result = this.queue(ref, kind, payload, abort.signal);
    const command = { abort, done: result.then(() => '') };
    this.commands.add(command);
    void command.done
      .finally(() => this.commands.delete(command))
      .catch(() => {});
    return result;
  }
  private queue(
    ref: PullSessionRef,
    kind: LauncherOperationKind,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (this.host.stopped() || signal.aborted)
      return Promise.reject(new Error('Interlock stopped'));
    const queued = this.prune(ref.profile.id);
    let op =
      kind === 'status' || kind === 'stop' || kind === 'archive'
        ? queued.find(
            (o) =>
              o.kind === kind &&
              o.workId === ref.workId &&
              o.state !== 'abandoned',
          )
        : undefined;
    if (
      kind === 'message' &&
      queued.some((o) => o.kind === 'message' && o.workId === ref.workId)
    )
      return Promise.reject(
        new HarnessRequestError(
          'A launcher message is already being delivered',
        ),
      );
    if (!op) {
      if (queued.filter((o) => o.state !== 'abandoned').length >= maxQueued)
        return Promise.reject(
          new Error('The launcher operation queue for this profile is full'),
        );
      op = this.enqueue(ref, kind, payload);
    }
    const timeoutMs =
      kind === 'launch'
        ? (ref.profile.timeoutSeconds ?? 60) * 1000
        : kind === 'status'
          ? statusWaitMs
          : operationWaitMs;
    return this.await(op, timeoutMs, signal);
  }
  private enqueue(
    ref: PullSessionRef,
    kind: LauncherOperationKind,
    payload: Record<string, unknown>,
  ) {
    const op: StoredOperation = {
      id: randomUUID(),
      profileId: ref.profile.id,
      kind,
      workId: ref.workId,
      runId: ref.runId,
      attempt: ref.attempt ?? 0,
      ...(kind === 'launch' ? {} : { payload }),
      state: 'queued',
      createdAt: now(),
      deliveries: 0,
    };
    if (kind === 'launch') this.launchPayloads.set(op.id, payload);
    this.store.put(operationsCollection, op);
    this.notify(ref.profile.id);
    return op;
  }
  private await(op: StoredOperation, timeoutMs: number, signal?: AbortSignal) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        const waiting = this.waiters.get(op.id);
        waiting?.delete(waiter);
        if (waiting && !waiting.size) this.waiters.delete(op.id);
        return !waiting?.size;
      };
      const waiter: Waiter = {
        resolve: (result) => {
          settle();
          resolve(result);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      };
      const giveUp = (reason: string) => {
        const current = this.store.get<StoredOperation>(
          operationsCollection,
          op.id,
        );
        if (settle() && current) {
          // The last waiter decides what happens to the queued operation.
          this.waiters.set(op.id, new Set([waiter]));
          this.release(current, reason);
        } else reject(new Error(reason));
      };
      const timer = setTimeout(
        () =>
          giveUp(
            `No launcher client completed ${op.kind} within ${Math.round(timeoutMs / 1000)} seconds`,
          ),
        timeoutMs,
      );
      const aborted = () => giveUp('Interlock stopped');
      signal?.addEventListener('abort', aborted, { once: true });
      const waiting = this.waiters.get(op.id) ?? new Set<Waiter>();
      waiting.add(waiter);
      this.waiters.set(op.id, waiting);
    });
  }
  private leased(q: {
    profileId: string;
    credential: string;
    operationId: string;
    leaseToken: string;
  }) {
    this.authorize(q.profileId, q.credential);
    const op = this.store.get<StoredOperation>(
      operationsCollection,
      q.operationId,
    );
    if (!op || op.profileId !== q.profileId)
      throw new LauncherClientError(
        'launcher_operation_not_found',
        'Launcher operation not found. It may have completed, been cancelled or expired.',
      );
    const token = Buffer.from(q.leaseToken);
    const expected = Buffer.from(op.leaseToken ?? '');
    if (
      op.state === 'queued' ||
      token.length !== expected.length ||
      !timingSafeEqual(token, expected)
    )
      throw new LauncherClientError(
        'launcher_lease_invalid',
        'The lease for this operation expired and was given to another delivery. Complete the newer delivery instead.',
      );
    return op;
  }
  complete(input: unknown) {
    const q = launcherCompleteSchema.parse(input);
    const op = this.leased(q);
    this.store.remove(operationsCollection, op.id);
    this.launchPayloads.delete(op.id);
    const waiting = this.take(op.id);
    for (const waiter of waiting) waiter.resolve(q.result);
    if (!waiting.length && op.kind === 'launch') this.lateLaunch(op, q.result);
    return { operationId: op.id, accepted: true, late: !waiting.length };
  }
  fail(input: unknown) {
    const q = launcherFailSchema.parse(input);
    const op = this.leased(q);
    if (
      q.retryable &&
      op.state !== 'abandoned' &&
      op.deliveries < maxDeliveries
    ) {
      this.store.put(operationsCollection, {
        ...op,
        state: 'queued',
        leaseToken: undefined,
        leaseUntil: undefined,
        clientId: undefined,
      } satisfies StoredOperation);
      this.notify(op.profileId);
      return { operationId: op.id, requeued: true };
    }
    this.drop(
      op,
      new Error(
        `Launcher client could not ${op.kind}: ${q.error}`.slice(0, 2000),
      ),
    );
    return { operationId: op.id, requeued: false };
  }
  /** Interlock stopped waiting, so the session it reports cannot claim work; stop it. */
  private lateLaunch(op: StoredOperation, result: Record<string, unknown>) {
    const sessionId = text(result.sessionHandle) ?? text(result.sessionId);
    const record = this.host.latest(op.workId);
    if (record && record.attempt === op.attempt)
      this.host.log(
        record,
        `The launcher client reported this launch after Interlock stopped waiting${sessionId ? ` (session ${sessionId})` : ''}. A stop was queued.`,
      );
    const profile = this.profile(op.profileId);
    if (profile)
      this.enqueue({ ...op, profile }, 'stop', {
        workId: op.workId,
        runId: op.runId,
        ...(sessionId ? { sessionId } : {}),
      });
  }
}

/** Normalise a launch result: `sessionHandle` and `url` are the pull names. */
export function pullLaunchResult(result: Record<string, unknown>) {
  return {
    sessionId: text(result.sessionHandle) ?? text(result.sessionId),
    resumeCommand: text(result.resumeCommand),
    deepLink: text(result.deepLink) ?? text(result.url),
  };
}

/** A status result may name the state as `state` (pull) or `status` (other transports). */
export function pullStatus(result: Record<string, unknown>) {
  return text(result.state) ?? text(result.status);
}
