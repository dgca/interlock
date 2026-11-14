/**
 * Reads the opt-in trace export settings. This module stays free of exporter
 * code: the server imports the exporter only when this returns a config.
 */
export interface TraceExportConfig {
  /** Full OTLP/HTTP traces URL. */
  url: string;
  headers: Record<string, string>;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  maxQueueSize: number;
  maxBatchSize: number;
  /** Delay between batched sends in milliseconds. */
  scheduleDelayMs: number;
  resource: Record<string, string>;
  /** A protocol other than http/json that was requested; JSON is still sent. */
  ignoredProtocol?: string;
}

type Env = Record<string, string | undefined>;

const enabled = (value?: string) =>
  ['1', 'true', 'on', 'yes'].includes(value?.trim().toLowerCase() ?? '');

function positive(value: string | undefined, fallback: number) {
  const n = Number(value?.trim());
  return value?.trim() && Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : fallback;
}

/** `key=value` pairs separated by commas, values percent-decoded (W3C Baggage style). */
function pairs(value?: string) {
  const out: Record<string, string> = {};
  for (const item of value?.split(',') ?? []) {
    const at = item.indexOf('=');
    if (at <= 0) continue;
    const key = item.slice(0, at).trim();
    let raw = item.slice(at + 1).trim();
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Keep the literal value.
    }
    if (key) out[key] = raw;
  }
  return out;
}

function tracesUrl(env: Env) {
  const signal = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (signal) return signal;
  const base =
    env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || 'http://localhost:4318';
  return `${base.replace(/\/+$/, '')}/v1/traces`;
}

/**
 * Returns the trace export config when INTERLOCK_OTEL_TRACES is on, otherwise
 * undefined. OTEL_* variables alone never turn export on.
 */
export function traceExportConfig(
  env: Env = process.env,
): TraceExportConfig | undefined {
  if (!enabled(env.INTERLOCK_OTEL_TRACES)) return undefined;
  const protocol = (
    env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL
  )?.trim();
  const maxQueueSize = positive(env.OTEL_BSP_MAX_QUEUE_SIZE, 2048);
  return {
    url: tracesUrl(env),
    headers: {
      ...pairs(env.OTEL_EXPORTER_OTLP_HEADERS),
      ...pairs(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS),
    },
    timeoutMs: positive(
      env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT ?? env.OTEL_EXPORTER_OTLP_TIMEOUT,
      10_000,
    ),
    maxQueueSize,
    maxBatchSize: Math.min(
      positive(env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE, 512),
      maxQueueSize,
    ),
    scheduleDelayMs: positive(env.OTEL_BSP_SCHEDULE_DELAY, 5000),
    resource: {
      ...pairs(env.OTEL_RESOURCE_ATTRIBUTES),
      'service.name':
        env.OTEL_SERVICE_NAME?.trim() ||
        pairs(env.OTEL_RESOURCE_ATTRIBUTES)['service.name'] ||
        'interlock',
    },
    ...(protocol && protocol !== 'http/json'
      ? { ignoredProtocol: protocol }
      : {}),
  };
}
