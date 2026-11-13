import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  executorResponseSchema,
  transcriptQuerySchema,
  executorMessageSchema,
  messageReceiptQuerySchema,
  type ExecutorAnswer,
  type ExecutorRequest,
  type ManagedExecution,
  type MessageReceipt,
  type TranscriptPage,
  type WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';
import { HarnessRequestError, type HarnessRequest } from './contracts.js';
import type { LauncherSession } from './launcher.js';
import type { ManagedTranscripts } from './transcripts.js';
import { active, attemptsCollection, now, type Job } from './supervision.js';

/** Supervision state and operations the operator channel reads but does not own. */
export interface OperatorChannelHost {
  stopped(): boolean;
  write(record: ManagedExecution): void;
  checkJobs(): void;
  sendLauncherMessage(session: LauncherSession, message: string): Promise<void>;
}

/** Operator messages to live executions, and harness questions answered by a person. */
export class OperatorChannel {
  constructor(
    private readonly engine: Pick<Engine, 'store'>,
    private readonly transcripts: ManagedTranscripts,
    private readonly jobs: Map<string, Job>,
    private readonly launchedWork: Map<string, LauncherSession>,
    private readonly host: OperatorChannelHost,
  ) {}
  private get stopped() {
    return this.host.stopped();
  }
  private write(record: ManagedExecution) {
    this.host.write(record);
  }
  private checkJobs() {
    this.host.checkJobs();
  }
  private sendLauncherMessage(session: LauncherSession, message: string) {
    return this.host.sendLauncherMessage(session, message);
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
  request(job: Job, input: HarnessRequest): Promise<ExecutorAnswer> {
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
}
