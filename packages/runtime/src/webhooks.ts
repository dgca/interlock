import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  externalTaskSchema,
  webhookPath,
  type ExternalTask,
  type Json,
  type Run,
  type WebhookBinding,
  type WebhookConfig,
  type WebhookDelivery,
  type WebhookReceipt,
  type WebhookTrigger,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { Variables } from './variables.js';

export class WebhookRejection extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export type WebhookDispatch = {
  input?: Json;
  externalTask?: ExternalTask;
  requestId: string;
  eventAt: string;
};
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const reject = (status: number, code: string): never => {
  throw new WebhookRejection(status, code);
};
/** Authenticated raw-byte ingress. Payloads and headers never enter delivery history. */
export class Webhooks {
  constructor(
    private store: Store,
    private dispatch: (
      trigger: WebhookTrigger,
      request: WebhookDispatch,
      effects: (() => void)[],
    ) => Partial<Pick<WebhookDelivery, 'runId' | 'affectedRuns'>> &
      Pick<WebhookDelivery, 'outcome'>,
  ) {}
  private secret(config: WebhookConfig) {
    const variables = new Variables(this.store);
    const variable = variables.get(config.authentication.secretId);
    if (variable.kind !== 'secret')
      throw new InterlockError(
        'Webhook authentication requires a Secret variable',
      );
    const capture = variables.captureIds([config.authentication.secretId]);
    return variables
      .resolve({ variableCaptures: capture }, [config.authentication.secretId])
      .value(config.authentication.secretId);
  }
  validate(config: WebhookConfig, enabling = false) {
    if (enabling) this.secret(config);
    else {
      const variables = new Variables(this.store);
      const variable = variables.get(config.authentication.secretId);
      if (variable.kind !== 'secret')
        throw new InterlockError(
          'Webhook authentication requires a Secret variable',
        );
    }
  }
  bodyLimit(id: string) {
    const trigger = this.store.get<WebhookTrigger>('workflowTriggers', id);
    return trigger?.kind === 'webhook' ? trigger.maxBodyBytes : undefined;
  }
  rejectBody(id: string) {
    return this.recordRejection(id, 413, 'body_too_large');
  }
  private admitRequest(trigger: WebhookTrigger, at: string) {
    if (
      !trigger.rateWindow ||
      Date.parse(at) - Date.parse(trigger.rateWindow.startedAt) >=
        trigger.rateLimit.windowMs
    )
      trigger.rateWindow = { startedAt: at, requests: 0 };
    return ++trigger.rateWindow.requests <= trigger.rateLimit.maxRequests;
  }
  private recordRejection(id: string, status: number, code: string) {
    return this.store.transaction(() => {
      const trigger = this.store.get<WebhookTrigger>('workflowTriggers', id);
      if (trigger?.kind !== 'webhook')
        return { status: 404, code: 'trigger_not_found' };
      const receivedAt = new Date().toISOString();
      if (!this.admitRequest(trigger, receivedAt)) {
        status = 429;
        code = 'rate_limited';
      }
      const delivery: WebhookDelivery = {
        id: randomUUID(),
        triggerId: id,
        receivedAt,
        outcome: 'rejected',
        status,
        code,
      };
      trigger.rejectedCount++;
      this.record(trigger, delivery);
      return { status, code };
    });
  }
  private record(trigger: WebhookTrigger, delivery: WebhookDelivery) {
    trigger.deliveryCount++;
    trigger.lastFireAt = delivery.receivedAt;
    this.store.put('workflowTriggers', trigger);
    this.store.put('webhookDeliveries', delivery);
    this.store.trimWebhookDeliveries(trigger.id);
  }
  receive(id: string, body: Buffer, headers: Record<string, string>) {
    const effects: (() => void)[] = [];
    const response = this.store.transaction(() => {
      const trigger = this.store.get<WebhookTrigger>('workflowTriggers', id);
      if (trigger?.kind !== 'webhook')
        return { status: 404, code: 'trigger_not_found' };
      const now = Date.now();
      const delivery: WebhookDelivery = {
        id: randomUUID(),
        triggerId: id,
        receivedAt: new Date(now).toISOString(),
        outcome: 'rejected',
        status: 400,
        code: 'invalid_delivery',
      };
      let attemptedAction = false;
      try {
        if (!this.admitRequest(trigger, delivery.receivedAt))
          reject(429, 'rate_limited');
        if (body.length > trigger.maxBodyBytes) reject(413, 'body_too_large');
        if (!trigger.enabled || trigger.autoPaused)
          reject(409, 'trigger_disabled');
        let secret: string;
        try {
          secret = this.secret(trigger);
        } catch {
          return this.rejected(trigger, delivery, 401, 'secret_unavailable');
        }
        const parts = trigger.authentication.parts.map((part) => {
          if (part.source === 'body') return body;
          const value = headers[part.path];
          if (value === undefined) reject(401, 'signed_header_missing');
          if (value.includes(trigger.authentication.separator))
            reject(401, 'ambiguous_signed_header');
          return Buffer.from(value);
        });
        const material = Buffer.concat(
          parts.flatMap((part, i) =>
            i ? [Buffer.from(trigger.authentication.separator), part] : [part],
          ),
        );
        const expected = createHmac(trigger.authentication.algorithm, secret)
          .update(material)
          .digest();
        const signature = headers[trigger.authentication.header];
        const prefix = trigger.authentication.prefix;
        if (!signature?.startsWith(prefix)) reject(401, 'invalid_signature');
        const hex = signature.slice(prefix.length);
        if (
          hex.length !== expected.length * 2 ||
          !/^[0-9a-f]+$/i.test(hex) ||
          !timingSafeEqual(expected, Buffer.from(hex, 'hex'))
        )
          reject(401, 'invalid_signature');
        let parsed: Json;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          return this.rejected(trigger, delivery, 400, 'invalid_json');
        }
        const value = (binding: WebhookBinding): Json => {
          const found =
            binding.source === 'literal'
              ? binding.value
              : binding.source === 'body'
                ? webhookPath(parsed, binding.path)
                : headers[binding.path];
          if (found === undefined) reject(400, 'binding_missing');
          return found as Json;
        };
        const identity = value(trigger.deliveryId);
        if (
          (typeof identity !== 'string' && typeof identity !== 'number') ||
          !String(identity).trim() ||
          String(identity).length > 500
        )
          reject(400, 'invalid_delivery_id');
        const timestamp = value(trigger.timestamp);
        const eventMs =
          trigger.timestampFormat === 'iso'
            ? typeof timestamp === 'string'
              ? Date.parse(timestamp)
              : NaN
            : (typeof timestamp === 'string' && timestamp.trim()) ||
                typeof timestamp === 'number'
              ? Number(timestamp) *
                (trigger.timestampFormat === 'unix_seconds' ? 1000 : 1)
              : NaN;
        if (
          !Number.isFinite(eventMs) ||
          Math.abs(now - eventMs) > trigger.timestampWindowMs
        )
          reject(401, 'timestamp_outside_window');
        delivery.eventAt = new Date(eventMs).toISOString();
        const receiptId = hash(JSON.stringify([trigger.id, String(identity)]));
        const materialHash = hash(material);
        const saved = this.store.get<WebhookReceipt>(
          'webhookReceipts',
          receiptId,
        );
        if (saved) {
          if (saved.materialHash !== materialHash)
            reject(409, 'delivery_id_conflict');
          Object.assign(delivery, {
            outcome: 'duplicate',
            status: saved.delivery.status,
            code: 'duplicate',
            runId: saved.delivery.runId,
            affectedRuns: saved.delivery.affectedRuns,
          });
        } else if (
          !trigger.filters.every((filter) =>
            isDeepStrictEqual(
              filter.value.source === 'body'
                ? webhookPath(parsed, filter.value.path)
                : headers[filter.value.path],
              filter.equals,
            ),
          )
        ) {
          delivery.outcome = 'ignored';
          delivery.status = 202;
          delivery.code = 'ignored';
          trigger.ignoredCount++;
        } else {
          if (
            trigger.action.type !== 'input' &&
            this.store.pauseHolds(trigger.workflowId).length
          )
            reject(409, 'workflow_paused');
          const action = trigger.action;
          let externalTask: ExternalTask | undefined;
          if (action.externalTask) {
            const result = externalTaskSchema.safeParse(
              Object.fromEntries(
                Object.entries(action.externalTask).map(([key, binding]) => [
                  key,
                  value(binding),
                ]),
              ),
            );
            if (!result.success) reject(400, 'invalid_external_task');
            externalTask = result.data;
          }
          let input: Json | undefined;
          if ('input' in action) {
            input = structuredClone(action.input);
            for (const [path, binding] of Object.entries(action.bindings)) {
              let target = input as Record<string, Json>;
              const keys = path.split('.');
              for (const key of keys.slice(0, -1)) {
                if (
                  !target[key] ||
                  typeof target[key] !== 'object' ||
                  Array.isArray(target[key])
                )
                  target[key] = {};
                target = target[key] as Record<string, Json>;
              }
              target[keys.at(-1)!] = value(binding);
            }
          }
          // Savepoint keeps rejection counters/logs while rolling back all target mutations.
          let result: ReturnType<Webhooks['dispatch']>;
          attemptedAction = true;
          try {
            result = this.store.transaction(() =>
              this.dispatch(
                trigger,
                {
                  input,
                  externalTask,
                  requestId: `hook:${receiptId}`,
                  eventAt: delivery.eventAt!,
                },
                effects,
              ),
            );
          } catch (error) {
            effects.length = 0;
            if (error instanceof WebhookRejection) throw error;
            if (
              error instanceof InterlockError ||
              (error instanceof Error && error.name === 'ZodError')
            )
              reject(409, 'action_rejected');
            throw error;
          }
          Object.assign(delivery, result, {
            status: 202,
            code: result.outcome,
          });
          if (result.runId && action.type === 'start')
            this.store.put('webhookOutcomes', {
              id: receiptId,
              triggerId: id,
              runId: result.runId,
            });
          if (action.type !== 'start') trigger.consecutiveFailures = 0;
        }
        if (!saved)
          this.store.put<WebhookReceipt>('webhookReceipts', {
            id: receiptId,
            triggerId: id,
            materialHash,
            delivery,
          });
      } catch (error) {
        if (!(error instanceof WebhookRejection)) throw error;
        delivery.status = error.status;
        delivery.code = error.code;
        trigger.rejectedCount++;
        // Unauthenticated noise never auto-pauses a valid trigger.
        if (attemptedAction)
          this.failure(trigger, delivery.receivedAt, error.code);
      }
      this.record(trigger, delivery);
      return {
        status: delivery.status,
        code: delivery.code,
        outcome: delivery.outcome,
        ...(delivery.runId ? { runId: delivery.runId } : {}),
      };
    });
    for (const effect of effects) effect();
    return response;
  }
  private rejected(
    trigger: WebhookTrigger,
    delivery: WebhookDelivery,
    status: number,
    code: string,
  ) {
    delivery.status = status;
    delivery.code = code;
    trigger.rejectedCount++;
    this.record(trigger, delivery);
    return { status, code };
  }
  private failure(trigger: WebhookTrigger, at: string, reason: string) {
    trigger.consecutiveFailures++;
    if (
      trigger.pauseAfterConsecutiveFailures &&
      trigger.consecutiveFailures >= trigger.pauseAfterConsecutiveFailures
    )
      trigger.autoPaused = {
        at,
        reason: `Paused after ${trigger.consecutiveFailures} consecutive failures: ${reason}`,
      };
  }
  tick() {
    for (const outcome of this.store.pendingWebhookOutcomes()) {
      let run = this.store.get<Run>('runs', outcome.runId);
      const seen = new Set<string>();
      while (run?.chain?.nextRunId && !seen.has(run.id)) {
        seen.add(run.id);
        run = this.store.get<Run>('runs', run.chain.nextRunId);
      }
      if (run && ['queued', 'running', 'waiting'].includes(run.status))
        continue;
      const trigger = this.store.get<WebhookTrigger>(
        'workflowTriggers',
        outcome.triggerId,
      );
      if (trigger?.kind === 'webhook') {
        if (run?.status === 'failed')
          this.failure(
            trigger,
            new Date().toISOString(),
            'Triggered run failed',
          );
        else if (run?.status === 'completed') trigger.consecutiveFailures = 0;
        this.store.put('workflowTriggers', trigger);
      }
      this.store.remove('webhookOutcomes', outcome.id);
    }
  }
}
