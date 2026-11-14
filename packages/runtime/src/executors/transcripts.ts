import type { Engine } from '../index.js';
import type { ManagedExecution, Run, TranscriptEvent } from '@interlock/core';
import { secretRedaction } from '../secretRedaction.js';
import { sanitizeMessage } from './templates.js';
import { toolCallToken } from '../toolCalls.js';

/** Never let optional capture errors escape into execution or result submission. */
export class ManagedTranscripts {
  constructor(private engine: Engine) {}
  private redactor(record: ManagedExecution, credentials: string[]) {
    const run = this.engine.store.get<Run>('runs', record.runId);
    const ids =
      run?.variableCaptures
        ?.filter((c) => c.kind === 'secret')
        .map((c) => c.referenceId) ?? [];
    const secrets = run ? this.engine.variables.resolve(run, ids).secrets : [];
    const tools = credentials.filter(Boolean).map(toolCallToken);
    return secretRedaction(
      [...secrets, ...credentials, ...tools].filter(Boolean),
    );
  }
  safeMetadata(
    record: ManagedExecution,
    values: string[],
    credentials: string[],
  ) {
    try {
      const redact = this.redactor(record, credentials);
      return values.every(
        (value) => value === sanitizeMessage(redact.text(value)),
      );
    } catch {
      return false;
    }
  }
  register(record: ManagedExecution) {
    try {
      record.transcriptCapture =
        record.profile.harness === 'custom' ? 'partial' : 'conversation';
      this.engine.store.transcripts.register(
        record.id,
        record.runId,
        record.transcriptCapture,
      );
    } catch {
      record.transcriptError = 'Transcript storage unavailable';
    }
  }
  capture(
    record: ManagedExecution,
    event: TranscriptEvent,
    credentials: string[] = [],
  ) {
    try {
      if (!record.transcriptCapture) this.register(record);
      // Bound redaction work before creating any preview, so a partial Secret cannot leak.
      const tooLarge = Buffer.byteLength(event.text) > 1024 * 1024;
      const redact = this.redactor(record, credentials);
      const clean = (value: string) =>
        Buffer.byteLength(value) > 1024 * 1024
          ? '[Oversized content omitted]'
          : redact.text(value);
      // Mask known values over the complete bounded event before any preview.
      const text = tooLarge
        ? '[Content omitted: capture input exceeds 1 MiB]'
        : clean(event.text);
      const masked = text
        .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
        .replace(
          /((?:token|ticket|auth|secret|password|api_?key)[=:\s]+["']?)[a-zA-Z0-9_.-]{8,}/gi,
          '$1[REDACTED]',
        );
      const accepted = this.engine.store.transcripts.append(record.id, {
        ...event,
        text: masked,
        tool: event.tool
          ? sanitizeMessage(clean(event.tool)).slice(0, 160)
          : undefined,
        callId: event.callId ? clean(event.callId).slice(0, 200) : undefined,
        key: event.key ? clean(event.key).slice(0, 200) : undefined,
      });
      if (tooLarge)
        this.engine.store.transcripts.noteOmission(
          record.id,
          'Oversized capture input omitted',
        );
      if (!accepted)
        record.transcriptError =
          'Transcript capture limited by storage capacity';
      else record.transcriptError = undefined;
    } catch {
      record.transcriptError =
        'Transcript content omitted: storage or protected-value redaction unavailable';
      try {
        this.engine.store.transcripts.noteOmission(
          record.id,
          record.transcriptError,
        );
      } catch {
        /* Disk may be full. */
      }
    }
  }
  finish(record: ManagedExecution) {
    if (!record.endedAt) return;
    try {
      this.engine.store.transcripts.finish(record.id, record.endedAt);
    } catch {
      /* Execution remains authoritative. */
    }
  }
  tick() {
    try {
      this.engine.store.transcripts.sweep();
    } catch {
      /* Retry on the next bounded sweep. */
    }
  }
}
