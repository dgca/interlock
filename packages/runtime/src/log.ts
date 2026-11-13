import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import type { DiagnosticCheck } from '@interlock/core';
import { sanitizeMessage } from './executors/templates.js';

const levels = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof levels)[number];

export function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) return 'info';
  const level = levels.find((candidate) => candidate === value.toLowerCase());
  if (!level)
    throw new Error(`INTERLOCK_LOG_LEVEL must be one of ${levels.join(', ')}.`);
  return level;
}

/** Leveled JSON lines in a size-bounded set of rotated files. */
export class JsonLog {
  readonly file: string;
  private size = 0;
  constructor(
    directory: string,
    private level: LogLevel = 'info',
    private maxBytes = 5 * 1024 * 1024,
    private keep = 3,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, 'interlock.log');
    if (existsSync(this.file)) this.size = statSync(this.file).size;
  }
  write(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
    if (levels.indexOf(level) < levels.indexOf(this.level)) return;
    const at = new Date().toISOString();
    const line = `${JSON.stringify({ at, level, event, ...fields })}\n`;
    const bytes = Buffer.byteLength(line);
    try {
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
      appendFileSync(this.file, line, { mode: 0o600 });
      this.size += bytes;
    } catch {
      // A full or read-only disk must not stop scheduling; doctor keeps the last error.
    }
  }
  private rotate() {
    rmSync(`${this.file}.${this.keep}`, { force: true });
    for (let index = this.keep - 1; index >= 1; index--)
      if (existsSync(`${this.file}.${index}`))
        renameSync(`${this.file}.${index}`, `${this.file}.${index + 1}`);
    renameSync(this.file, `${this.file}.1`);
    this.size = 0;
  }
}

type SchedulerError = {
  at: string;
  source: string;
  message: string;
  count: number;
};
// Claim tickets and assignment tokens are UUIDs; adapter output may echo them.
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// URL query strings often carry credentials, e.g. in an unparseable status URL.
const query = /\?[^\s'"]+/g;
const repeatMs = 60_000;

/** Background scheduler failures are logged and kept for doctor instead of discarded. */
export class SchedulerErrors {
  last?: SchedulerError;
  private log?: JsonLog;
  /** `secrets` lists literal profile header and env maps whose values error text may echo. */
  constructor(
    private secrets: () => (Record<string, unknown> | undefined)[] = () => [],
  ) {}
  private logged = new Map<string, number>();
  attach(log: JsonLog) {
    this.log = log;
  }
  handler = (source: string) => (error: unknown) => this.record(source, error);
  record(source: string, error: unknown) {
    let text = error instanceof Error ? error.message : String(error);
    for (const values of this.secrets())
      for (const value of Object.values(values ?? {}))
        if (typeof value === 'string' && value.length >= 4)
          text = text.replaceAll(value, '[redacted]');
    const message = sanitizeMessage(
      text.replace(uuid, '[redacted]').replace(query, '?[redacted]'),
    );
    const same = this.last?.source === source && this.last.message === message;
    // count is consecutive occurrences of this same error.
    const count = same ? this.last!.count + 1 : 1;
    this.last = { at: new Date().toISOString(), source, message, count };
    // A failing status poll repeats every few seconds; log each distinct error once a minute.
    const key = `${source}\n${message}`;
    const previous = this.logged.get(key);
    if (previous !== undefined && Date.now() - previous < repeatMs) return;
    if (this.logged.size >= 100) this.logged.clear();
    this.logged.set(key, Date.now());
    this.log?.write('error', 'scheduler.error', { source, message });
  }
  check(): DiagnosticCheck {
    const base = { category: 'harnesses', name: 'Scheduler errors' } as const;
    const last = this.last;
    if (!last)
      return {
        ...base,
        status: 'ok',
        message: 'No scheduler errors since the server started',
      };
    return {
      ...base,
      status: 'warn',
      message: `Last scheduler error at ${last.at} (${last.source}): ${last.message}`,
      details: { ...last, ...(this.log ? { logFile: this.log.file } : {}) },
      remediation:
        'Check the harness profile and its launcher commands or URLs, then review the log file for earlier errors.',
    };
  }
}
