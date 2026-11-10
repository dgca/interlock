import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import {
  InterlockError,
  transcriptLimits,
  type MessageReceipt,
  type TranscriptEntry,
  type TranscriptEvent,
  type TranscriptQuery,
} from '@interlock/core';

type Limits = { [K in keyof typeof transcriptLimits]: number };
type Meta = {
  execution_id: string;
  run_id: string;
  capability: 'conversation' | 'partial';
  ended_at: number | null;
  omitted: number;
  reason: string | null;
  receipts_pruned: number;
  pressure_gap: number;
};

/** Indexed payload storage. Accounting and eviction share the caller's SQLite transaction. */
export class Transcripts {
  private lastSweep = 0;
  private pressure = false;
  constructor(
    private db: DatabaseSync,
    private path: string,
    private transaction: <T>(fn: () => T) => T,
    private limits: Limits = transcriptLimits,
  ) {}

  private writable() {
    if (this.path === ':memory:') return true;
    try {
      if (statSync(`${this.path}-wal`).size > this.limits.walBytes) {
        const checkpoint = this.db
          .prepare('PRAGMA wal_checkpoint(PASSIVE)')
          .get()!;
        this.pressure =
          Number(checkpoint.log) > Number(checkpoint.checkpointed);
        return !this.pressure;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.pressure = false;
    return true;
  }
  register(executionId: string, runId: string, capability: Meta['capability']) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO transcript_executions(execution_id,run_id,capability) VALUES (?,?,?)',
      )
      .run(executionId, runId, capability);
  }
  finish(executionId: string, endedAt: string) {
    this.db
      .prepare(
        'UPDATE transcript_executions SET ended_at = coalesce(ended_at, ?) WHERE execution_id = ?',
      )
      .run(Date.parse(endedAt), executionId);
  }
  private meta(executionId: string) {
    return this.db
      .prepare('SELECT * FROM transcript_executions WHERE execution_id = ?')
      .get(executionId) as Meta | undefined;
  }
  private usage(executionId: string) {
    const r = this.db
      .prepare(
        'SELECT retained_entries AS count, retained_bytes AS bytes FROM transcript_executions WHERE execution_id = ?',
      )
      .get(executionId);
    return { count: Number(r?.count ?? 0), bytes: Number(r?.bytes ?? 0) };
  }
  bytes() {
    return Number(
      this.db.prepare('SELECT bytes FROM transcript_size WHERE id = 1').get()!
        .bytes,
    );
  }
  private omit(executionId: string, reason: string) {
    this.db
      .prepare(
        'UPDATE transcript_executions SET omitted = omitted + 1, reason = ? WHERE execution_id = ?',
      )
      .run(reason, executionId);
  }
  noteOmission(executionId: string, reason: string) {
    this.omit(executionId, reason);
  }
  private evict(sequence: number, executionId: string, reason: string) {
    this.db
      .prepare('DELETE FROM transcript_entries WHERE sequence = ?')
      .run(sequence);
    this.omit(executionId, reason);
  }
  private room(bytes: number) {
    while (this.bytes() + bytes > this.limits.totalBytes) {
      const row = this.db
        .prepare(
          `SELECT sequence,execution_id FROM transcript_entries WHERE execution_id = (
        SELECT e.execution_id FROM transcript_executions e WHERE ended_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM transcript_entries t WHERE t.execution_id = e.execution_id)
        ORDER BY ended_at,execution_id LIMIT 1) ORDER BY sequence LIMIT 1`,
        )
        .get();
      if (row) {
        this.evict(
          Number(row.sequence),
          String(row.execution_id),
          'Library transcript budget',
        );
        continue;
      }
      const receipt = this.db
        .prepare(
          `SELECT r.execution_id, r.request_id FROM transcript_receipts r
        JOIN transcript_executions e ON e.execution_id = r.execution_id
        WHERE e.ended_at IS NOT NULL ORDER BY e.ended_at LIMIT 1`,
        )
        .get();
      if (receipt) {
        this.db
          .prepare(
            'DELETE FROM transcript_receipts WHERE execution_id = ? AND request_id = ?',
          )
          .run(String(receipt.execution_id), String(receipt.request_id));
        this.db
          .prepare(
            'UPDATE transcript_executions SET receipts_pruned = 1 WHERE execution_id = ?',
          )
          .run(String(receipt.execution_id));
        continue;
      }
      const active = this.db
        .prepare(
          'SELECT sequence,execution_id FROM transcript_entries ORDER BY sequence LIMIT 1',
        )
        .get();
      if (!active) return false;
      this.evict(
        Number(active.sequence),
        String(active.execution_id),
        'Library transcript budget',
      );
    }
    return true;
  }
  append(executionId: string, event: TranscriptEvent) {
    if (!this.writable()) {
      // One small durable marker per execution, never one write per rejected
      // entry. This stays bounded even while a reader keeps the journal pinned.
      this.db
        .prepare(
          "UPDATE transcript_executions SET pressure_gap = 1, omitted = omitted + 1, reason = 'Content omitted while SQLite journal was pinned' WHERE execution_id = ? AND pressure_gap = 0",
        )
        .run(executionId);
      return false;
    }
    return this.transaction(() => {
      if (!this.meta(executionId)) return false;
      if (
        event.key &&
        this.db
          .prepare(
            'SELECT 1 FROM transcript_entries WHERE execution_id = ? AND entry_key = ?',
          )
          .get(executionId, event.key)
      )
        return true;
      const originalBytes = Buffer.byteLength(event.text);
      // Reserve room for bounded metadata and the sequence added to read responses.
      let text = event.text;
      const budget = Math.max(0, this.limits.entryBytes - 1024);
      if (originalBytes > budget)
        text = new TextDecoder()
          .decode(Buffer.from(text).subarray(0, budget))
          .replace(/\uFFFD$/u, '');
      const at = new Date().toISOString();
      const encode = () =>
        JSON.stringify({
          kind: event.kind,
          text,
          at,
          ...(event.tool ? { tool: event.tool.slice(0, 160) } : {}),
          ...(event.callId ? { callId: event.callId.slice(0, 200) } : {}),
          ...(text !== event.text ? { truncated: true, originalBytes } : {}),
        });
      const key = event.key?.slice(0, 200) ?? null;
      const overhead =
        Buffer.byteLength(executionId) + Buffer.byteLength(key ?? '') + 64;
      let value = encode();
      while (
        Buffer.byteLength(value) + overhead > this.limits.entryBytes &&
        text.length
      ) {
        text = text
          .slice(0, Math.floor(text.length / 2))
          .replace(/[\uD800-\uDBFF]$/u, '');
        value = encode();
      }
      const bytes = Buffer.byteLength(value) + overhead;
      if (
        bytes > this.limits.entryBytes ||
        bytes > this.limits.executionBytes ||
        !this.room(bytes)
      ) {
        this.omit(executionId, 'Transcript capacity exhausted');
        return false;
      }
      let usage = this.usage(executionId);
      while (
        usage.count >= this.limits.executionEntries ||
        usage.bytes + bytes > this.limits.executionBytes
      ) {
        const oldest = this.db
          .prepare(
            'SELECT sequence FROM transcript_entries WHERE execution_id = ? ORDER BY sequence LIMIT 1',
          )
          .get(executionId);
        if (!oldest) break;
        this.evict(
          Number(oldest.sequence),
          executionId,
          'Execution transcript limit',
        );
        usage = this.usage(executionId);
      }
      this.db
        .prepare(
          'INSERT INTO transcript_entries(execution_id,entry_key,value,bytes) VALUES (?,?,?,?)',
        )
        .run(executionId, key, value, bytes);
      return true;
    });
  }
  page(q: TranscriptQuery) {
    const meta = this.meta(q.executionId);
    const usage = this.usage(q.executionId);
    const rows = this.db
      .prepare(
        `SELECT sequence,value FROM transcript_entries WHERE execution_id = ?
      ${q.before !== undefined ? 'AND sequence < ?' : q.after !== undefined ? 'AND sequence > ?' : ''}
      ORDER BY sequence ${q.after !== undefined ? 'ASC' : 'DESC'} LIMIT ?`,
      )
      .all(
        q.executionId,
        ...(q.before !== undefined
          ? [q.before]
          : q.after !== undefined
            ? [q.after]
            : []),
        q.limit,
      );
    let bytes = 2048;
    const items: TranscriptEntry[] = [];
    for (const row of rows) {
      const entry = {
        ...JSON.parse(String(row.value)),
        sequence: Number(row.sequence),
      } as TranscriptEntry;
      const size = Buffer.byteLength(JSON.stringify(entry));
      if (bytes + size > this.limits.pageBytes) break;
      bytes += size;
      items.push(entry);
    }
    if (q.after === undefined) items.reverse();
    const first = items[0]?.sequence ?? q.after,
      last = items.at(-1)?.sequence ?? q.before;
    const older =
      first &&
      this.db
        .prepare(
          'SELECT 1 FROM transcript_entries WHERE execution_id = ? AND sequence < ? LIMIT 1',
        )
        .get(q.executionId, first)
        ? first
        : null;
    const newer =
      last &&
      this.db
        .prepare(
          'SELECT 1 FROM transcript_entries WHERE execution_id = ? AND sequence > ? LIMIT 1',
        )
        .get(q.executionId, last)
        ? last
        : null;
    return {
      items,
      retainedBytes: usage.bytes,
      retainedEntries: usage.count,
      omitted: meta?.omitted ?? 0,
      gap: !!meta?.omitted,
      reason: this.pressure
        ? 'Capture paused by SQLite journal pressure'
        : meta?.pressure_gap
          ? `${meta.reason ?? 'Some content omitted'}. Journal pressure also caused capture gaps.`
          : (meta?.reason ?? undefined),
      older,
      newer,
      limits: transcriptLimits,
      capability: meta?.capability ?? ('unavailable' as const),
    };
  }
  receipt(executionId: string, requestId: string) {
    const row = this.db
      .prepare(
        'SELECT hash,value FROM transcript_receipts WHERE execution_id = ? AND request_id = ?',
      )
      .get(executionId, requestId);
    return row
      ? {
          hash: String(row.hash),
          receipt: JSON.parse(String(row.value)) as MessageReceipt,
        }
      : undefined;
  }
  receiptsPruned(executionId: string) {
    return !!this.meta(executionId)?.receipts_pruned;
  }
  begin(receipt: MessageReceipt, hash: string) {
    if (!this.writable())
      throw new InterlockError(
        'Message not sent: transcript journal capacity unavailable',
      );
    return this.transaction(() => {
      const count = Number(
        this.db
          .prepare(
            'SELECT count(*) AS n FROM transcript_receipts WHERE execution_id = ?',
          )
          .get(receipt.executionId)!.n,
      );
      if (count >= this.limits.messageCount)
        throw new InterlockError('Message limit reached for this execution');
      const value = JSON.stringify(receipt),
        bytes = Buffer.byteLength(value) + hash.length + 512;
      if (!this.room(bytes))
        throw new InterlockError(
          'Message not sent: transcript capacity exhausted',
        );
      this.db
        .prepare('INSERT INTO transcript_receipts VALUES (?,?,?,?,?)')
        .run(receipt.executionId, receipt.requestId, hash, value, bytes);
    });
  }
  settle(receipt: MessageReceipt) {
    // begin reserves room for all bounded outcome metadata.
    this.db
      .prepare(
        'UPDATE transcript_receipts SET value = ? WHERE execution_id = ? AND request_id = ?',
      )
      .run(JSON.stringify(receipt), receipt.executionId, receipt.requestId);
  }
  recover() {
    for (const row of this.db
      .prepare(
        "SELECT value FROM transcript_receipts WHERE json_extract(value,'$.status') = 'pending'",
      )
      .iterate()) {
      const r = JSON.parse(String(row.value)) as MessageReceipt;
      this.settle({
        ...r,
        status: 'unknown',
        updatedAt: new Date().toISOString(),
        reason: 'Server restarted before delivery was confirmed',
      });
    }
  }
  hasPending(runIds: Set<string>) {
    return !!this.db
      .prepare(
        `SELECT 1 FROM transcript_receipts r JOIN transcript_executions e ON e.execution_id = r.execution_id
      WHERE e.run_id IN (SELECT value FROM json_each(?)) AND json_extract(r.value,'$.status') = 'pending' LIMIT 1`,
      )
      .get(JSON.stringify([...runIds]));
  }
  sweep(at = Date.now()) {
    if (at - this.lastSweep < 60_000) return;
    this.lastSweep = at;
    this.transaction(() => {
      const expired = this.db
        .prepare(
          'SELECT execution_id FROM transcript_executions WHERE ended_at < ? AND (EXISTS (SELECT 1 FROM transcript_entries t WHERE t.execution_id = transcript_executions.execution_id) OR EXISTS (SELECT 1 FROM transcript_receipts r WHERE r.execution_id = transcript_executions.execution_id)) LIMIT 100',
        )
        .all(at - this.limits.ageMs);
      for (const row of expired) {
        const id = String(row.execution_id),
          count = this.usage(id).count;
        this.db
          .prepare('DELETE FROM transcript_entries WHERE execution_id = ?')
          .run(id);
        this.db
          .prepare('DELETE FROM transcript_receipts WHERE execution_id = ?')
          .run(id);
        this.db
          .prepare(
            "UPDATE transcript_executions SET omitted = omitted + ?, reason = 'Transcript expired', receipts_pruned = 1 WHERE execution_id = ?",
          )
          .run(count, id);
      }
    });
    if (this.path !== ':memory:')
      this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  }
}
