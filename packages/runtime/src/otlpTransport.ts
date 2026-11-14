import { VERSION } from '@interlock/core';
import type { TraceExportConfig } from './traceExportConfig.js';

/** One span in OTLP/JSON form: hex IDs, nanosecond times as decimal strings. */
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** SPAN_KIND_INTERNAL */
  kind: 1;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  links?: { traceId: string; spanId: string; attributes: OtlpAttribute[] }[];
  /** 0 unset, 2 error. */
  status: { code: 0 | 2 };
}
interface OtlpAttribute {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: string }
    | { doubleValue: number }
    | { boolValue: boolean }
    | { arrayValue: { values: { stringValue: string }[] } };
}
export type AttributeValue = string | number | boolean | string[] | undefined;

/** Encodes defined attributes; integers as int64 strings, other numbers as doubles. */
export function attributes(
  record: Record<string, AttributeValue>,
): OtlpAttribute[] {
  return Object.entries(record).flatMap(([key, value]): OtlpAttribute[] => {
    if (value === undefined) return [];
    if (Array.isArray(value))
      return [
        {
          key,
          value: {
            arrayValue: { values: value.map((v) => ({ stringValue: v })) },
          },
        },
      ];
    if (typeof value === 'number')
      return [
        {
          key,
          value: Number.isSafeInteger(value)
            ? { intValue: String(value) }
            : { doubleValue: value },
        },
      ];
    if (typeof value === 'boolean')
      return [{ key, value: { boolValue: value } }];
    return [{ key, value: { stringValue: value } }];
  });
}

const DROP_LOG_INTERVAL_MS = 60_000;

/**
 * Bounded span queue sent in batches over OTLP/HTTP JSON, one request at a
 * time. Never throws to callers: full queues and failed sends drop spans and
 * log a count at most once a minute.
 */
export class OtlpBatcher {
  private queue: OtlpSpan[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private sending?: Promise<void>;
  private stopped = false;
  private dropped = 0;
  private lastDropLog = 0;
  private dropReason = '';
  private readonly body: (spans: OtlpSpan[]) => string;
  constructor(
    private readonly config: TraceExportConfig,
    private readonly log: (message: string) => void,
  ) {
    const resource = {
      attributes: attributes({
        'service.version': VERSION,
        ...config.resource,
      }),
    };
    const scope = { name: '@type_of/interlock', version: VERSION };
    this.body = (spans) =>
      JSON.stringify({
        resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }],
      });
  }

  enqueue(spans: OtlpSpan[]) {
    if (this.stopped) return;
    const room = this.config.maxQueueSize - this.queue.length;
    if (spans.length > room) this.drop(spans.length - room, 'queue full');
    this.queue.push(...spans.slice(0, Math.max(room, 0)));
    if (this.queue.length >= this.config.maxBatchSize) void this.drain();
    else this.schedule();
  }

  /** Sends everything queued, giving up on what remains after `deadlineMs`. */
  async flush(deadlineMs: number) {
    clearTimeout(this.timer);
    this.timer = undefined;
    let expire: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      expire = setTimeout(resolve, deadlineMs);
    });
    await Promise.race([this.drain(Date.now() + deadlineMs), deadline]);
    clearTimeout(expire);
  }

  async stop(deadlineMs: number) {
    await this.flush(deadlineMs);
    this.stopped = true;
    if (this.queue.length) this.drop(this.queue.length, 'shutdown deadline');
    this.queue = [];
    this.logDrops(true);
  }

  private schedule() {
    if (this.timer || this.sending || !this.queue.length) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, this.config.scheduleDelayMs);
    this.timer.unref?.();
  }

  private drain(until = Infinity): Promise<void> {
    this.sending ??= (async () => {
      while (this.queue.length && Date.now() < until) {
        const batch = this.queue.splice(0, this.config.maxBatchSize);
        const timeout = Math.max(
          1,
          Math.min(this.config.timeoutMs, until - Date.now()),
        );
        await this.send(batch, timeout);
      }
    })().finally(() => {
      this.sending = undefined;
      this.schedule();
    });
    return this.sending;
  }

  private async send(batch: OtlpSpan[], timeoutMs: number) {
    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: { ...this.config.headers, 'content-type': 'application/json' },
        body: this.body(batch),
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel();
      if (!response.ok) this.drop(batch.length, `HTTP ${response.status}`);
    } catch (error) {
      this.drop(
        batch.length,
        error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout'
          : 'collector unreachable',
      );
    }
  }

  private drop(count: number, reason: string) {
    this.dropped += count;
    this.dropReason = reason;
    this.logDrops(false);
  }

  private logDrops(force: boolean) {
    const now = Date.now();
    if (
      !this.dropped ||
      (!force && now - this.lastDropLog < DROP_LOG_INTERVAL_MS)
    )
      return;
    this.log(
      `Trace export dropped ${this.dropped} span${this.dropped === 1 ? '' : 's'} (${this.dropReason}); runs are unaffected.`,
    );
    this.dropped = 0;
    this.lastDropLog = now;
  }
}
