import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { transcriptLimits, type MessageReceipt } from '@interlock/core';
import { migrate } from '../packages/storage/src/migrations';
import { Transcripts } from '../packages/storage/src/transcripts';

const databases: DatabaseSync[] = [],
  dirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function setup(
  path = ':memory:',
  overrides: Partial<Record<keyof typeof transcriptLimits, number>> = {},
) {
  const db = new DatabaseSync(path);
  databases.push(db);
  migrate(db, path);
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA journal_size_limit = 65536; PRAGMA busy_timeout = 1;',
  );
  const limits = {
    ...transcriptLimits,
    entryBytes: 2048,
    executionEntries: 3,
    executionBytes: 4096,
    totalBytes: 8192,
    ...overrides,
  };
  const t = new Transcripts(
    db,
    path,
    (fn) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    limits,
  );
  const page = (id = 'a', query = {}) =>
    t.page({ executionId: id, limit: 100, ...query });
  t.register('a', 'run-a', 'conversation');
  return { db, t, page, limits };
}
function receipt(id = 'one'): MessageReceipt {
  return {
    executionId: 'a',
    requestId: id,
    status: 'pending',
    source: 'ui',
    operator: 'local-user',
    at: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

it('enforces byte/count caps with valid Unicode and escaped controls, retaining recent content', () => {
  const { t, page, limits } = setup();
  t.append('a', { kind: 'assistant', text: 'control' });
  expect(page().items[0].text).toBe('control');
  t.append('a', {
    kind: 'tool_result',
    text: '🐢'.repeat(10000),
    key: 'unicode',
  });
  const unicode = page().items.at(-1)!;
  expect(unicode.truncated).toBe(true);
  expect(unicode.text).not.toMatch(/[\uD800-\uDBFF]$/u);
  expect(unicode.text).not.toContain('�');
  t.append('a', { kind: 'assistant', text: '\u0001'.repeat(10000) });
  expect(page().items.at(-1)!.truncated).toBe(true);
  for (let i = 0; i < 100; i++)
    t.append('a', { kind: 'assistant', text: `recent-${i}` });
  expect(page().retainedEntries).toBeLessThanOrEqual(limits.executionEntries);
  expect(page().retainedBytes).toBeLessThanOrEqual(limits.executionBytes);
  expect(page().items.at(-1)?.text).toBe('recent-99');
  expect(page().gap).toBe(true);
});
it('evicts ended transcripts before active content and includes protected receipts in the library budget', () => {
  const { t, page, limits } = setup(':memory:', {
    totalBytes: 2400,
    executionEntries: 20,
    executionBytes: 10000,
  });
  t.register('b', 'run-b', 'conversation');
  t.append('a', { kind: 'assistant', text: 'old'.repeat(300) });
  t.finish('a', new Date().toISOString());
  t.append('b', { kind: 'assistant', text: 'active'.repeat(150) });
  t.begin({ ...receipt(), executionId: 'b' }, 'hash');
  expect(t.bytes()).toBeLessThanOrEqual(limits.totalBytes);
  expect(page('a').items).toEqual([]);
  expect(page('b').items.length).toBe(1);
  expect(t.receipt('b', 'one')).toBeDefined();
});
it('caps receipt count and rolls back a failed reservation without dispatch authority', () => {
  const { t, db } = setup(':memory:', { messageCount: 2 });
  t.begin(receipt(), 'hash');
  t.begin(receipt('two'), 'hash-2');
  const before = t.bytes();
  expect(() => t.begin(receipt('three'), 'hash-3')).toThrow('Message limit');
  expect(t.bytes()).toBe(before);
  expect(t.receipt('a', 'three')).toBeUndefined();
  db.exec(
    "CREATE TRIGGER break_receipt BEFORE INSERT ON transcript_receipts BEGIN SELECT RAISE(ABORT,'injected'); END;",
  );
  t.register('b', 'run-b', 'partial');
  expect(() => t.begin({ ...receipt(), executionId: 'b' }, 'hash')).toThrow(
    'injected',
  );
  expect(t.bytes()).toBe(before);
  expect(t.receipt('b', 'one')).toBeUndefined();
});
it('pages only one execution and reports gaps after pruning between requests', () => {
  const { t, page } = setup();
  for (let i = 0; i < 3; i++)
    t.append('a', { kind: 'assistant', text: String(i), key: `a-${i}` });
  t.register('b', 'run-b', 'partial');
  t.append('b', { kind: 'assistant', text: 'foreign' });
  const latest = page('a', { limit: 1 });
  expect(latest.items.map((x) => x.text)).toEqual(['2']);
  t.append('a', { kind: 'assistant', text: '3' });
  const older = page('a', { before: latest.older!, limit: 2 });
  expect(older.items.map((x) => x.text)).toEqual(['1']);
  expect(older.gap).toBe(true);
  expect(JSON.stringify(older)).not.toContain('foreign');
  t.append('a', { kind: 'assistant', text: '2', key: 'a-2' });
  expect(page().retainedEntries).toBe(3);
});
it('bounds page bytes independently of the count limit', () => {
  const { t, page } = setup(':memory:', {
    executionEntries: 100,
    executionBytes: 100000,
    totalBytes: 200000,
    pageBytes: 4000,
  });
  for (let i = 0; i < 20; i++)
    t.append('a', { kind: 'assistant', text: 'x'.repeat(1000) });
  const result = page();
  expect(result.items.length).toBeLessThan(20);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4000);
  expect(result.older).not.toBeNull();
});
it('expires ended content independently, preserves recent and active data, and deletes on managed-history removal', () => {
  const { db, t, page } = setup();
  t.append('a', { kind: 'assistant', text: 'expired' });
  t.begin(receipt(), 'hash');
  t.finish(
    'a',
    new Date(Date.now() - transcriptLimits.ageMs - 1000).toISOString(),
  );
  t.register('b', 'run-b', 'conversation');
  t.append('b', { kind: 'assistant', text: 'active' });
  t.sweep();
  expect(page().items).toEqual([]);
  expect(page().reason).toBe('Transcript expired');
  expect(t.receipt('a', 'one')).toBeUndefined();
  expect(page('b').items[0].text).toBe('active');
  db.prepare('INSERT INTO documents VALUES (?,?,?)').run(
    'managedExecutions',
    'b',
    '{"id":"b"}',
  );
  db.prepare(
    "DELETE FROM documents WHERE collection='managedExecutions' AND id='b'",
  ).run();
  expect(page('b').items).toEqual([]);
  expect(t.bytes()).toBe(0);
});
it('preserves accounting and uncertain receipts across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-transcripts-'));
  dirs.push(dir);
  const file = join(dir, 'library.db');
  const first = setup(file);
  first.t.append('a', { kind: 'assistant', text: 'durable' });
  first.t.begin(receipt(), 'hash');
  const bytes = first.t.bytes();
  first.t.register('expired', 'expired-run', 'conversation');
  first.t.append('expired', { kind: 'assistant', text: 'old' });
  first.t.finish(
    'expired',
    new Date(Date.now() - transcriptLimits.ageMs - 1000).toISOString(),
  );
  const second = setup(file);
  second.t.recover();
  expect(second.t.bytes()).toBeGreaterThan(bytes);
  second.t.sweep();
  expect(second.page('expired').items).toEqual([]);
  expect(second.t.bytes()).toBe(bytes);
  expect(second.page().items[0].text).toBe('durable');
  expect(second.t.receipt('a', 'one')?.receipt.status).toBe('unknown');
});
it('reuses file allocation over repeated pruning cycles and yields under a pinned-reader WAL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-transcript-growth-'));
  dirs.push(dir);
  const file = join(dir, 'library.db');
  const { t, db, limits } = setup(file, { walBytes: 65536 });
  for (let i = 0; i < 100; i++)
    t.append('a', { kind: 'assistant', text: 'a'.repeat(1000) });
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const size = statSync(file).size;
  for (let i = 0; i < 300; i++)
    t.append('a', { kind: 'assistant', text: 'b'.repeat(1000) });
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  expect(statSync(file).size).toBeLessThanOrEqual(size + 8192);
  const reader = new DatabaseSync(file);
  databases.push(reader);
  reader.exec('BEGIN');
  reader.prepare('SELECT count(*) FROM transcript_entries').get();
  let rejected = false;
  for (let i = 0; i < 200; i++)
    if (!t.append('a', { kind: 'assistant', text: 'c'.repeat(1000) })) {
      rejected = true;
      break;
    }
  expect(rejected).toBe(true);
  expect(t.page({ executionId: 'a', limit: 50 }).gap).toBe(true);
  const wal = statSync(`${file}-wal`).size;
  for (let i = 0; i < 50; i++)
    expect(t.append('a', { kind: 'assistant', text: 'blocked' })).toBe(false);
  expect(statSync(`${file}-wal`).size).toBe(wal);
  expect(wal).toBeLessThan(limits.walBytes + 64 * 1024);
  reader.exec('ROLLBACK');
  expect(t.append('a', { kind: 'assistant', text: 'resumed' })).toBe(true);
  const reopened = setup(file);
  expect(reopened.page().gap).toBe(true);
  expect(reopened.page().omitted).toBeGreaterThan(0);
  expect(reopened.page().reason).toContain('Journal pressure');
});
