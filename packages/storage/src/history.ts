import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@interlock/core';

export type HistoryRun = Pick<
  Run,
  'id' | 'workflowId' | 'workflowName' | 'status' | 'createdAt' | 'updatedAt'
> & {
  parentRunId: string | null;
  chainRootRunId: string | null;
  comparisonId: string | null;
};

export function historyRuns(db: DatabaseSync): HistoryRun[] {
  return db
    .prepare(
      `SELECT id,
    json_extract(value, '$.workflowId') AS workflowId,
    json_extract(value, '$.workflowName') AS workflowName,
    json_extract(value, '$.status') AS status,
    json_extract(value, '$.createdAt') AS createdAt,
    json_extract(value, '$.updatedAt') AS updatedAt,
    json_extract(value, '$.parentRunId') AS parentRunId,
    json_extract(value, '$.chain.rootRunId') AS chainRootRunId,
    json_extract(value, '$.comparison.comparisonId') AS comparisonId
    FROM documents WHERE collection = 'runs' ORDER BY rowid`,
    )
    .all() as HistoryRun[];
}

// Keep start receipts as tombstones. Comparison evidence and resource ownership
// are protected by runtime policy rather than silently cascaded here.
const keyed = ['runs', 'runBudgets', 'runChains'];
const scoped = [
  'work',
  'events',
  'usageAttempts',
  'workHolds',
  'externalInputValues',
  'externalInputReceipts',
  'contextGroups',
  'contextEvents',
  'managedExecutions',
  'executorSessions',
];
const where = (direct: boolean) =>
  `collection = ? AND ${direct ? 'id' : "json_extract(value, '$.runId')"} IN (SELECT value FROM json_each(?))`;

export function historyInventory(db: DatabaseSync, ids: Set<string>) {
  const encoded = JSON.stringify([...ids].sort());
  const digest = createHash('sha256');
  const collections: Record<string, number> = {};
  let documentBytes = 0;
  for (const collection of [...keyed, ...scoped]) {
    let count = 0;
    for (const row of db
      .prepare(
        `SELECT id, value FROM documents WHERE ${where(keyed.includes(collection))} ORDER BY id`,
      )
      .iterate(collection, encoded)) {
      const id = row.id as string,
        value = row.value as string;
      const bytes = Buffer.byteLength(value);
      digest.update(JSON.stringify([collection, id, bytes])).update(value);
      documentBytes += bytes;
      count++;
    }
    collections[collection] = count;
  }
  return { collections, documentBytes, digest: digest.digest('hex') };
}

export function deleteHistoryDocuments(db: DatabaseSync, ids: Set<string>) {
  const encoded = JSON.stringify([...ids]);
  for (const collection of [
    ...scoped,
    ...keyed.filter((c) => c !== 'runs'),
    'runs',
  ])
    db.prepare(
      `DELETE FROM documents WHERE ${where(keyed.includes(collection))}`,
    ).run(collection, encoded);
}

export function historyReferences(db: DatabaseSync, ids: Set<string>) {
  const encoded = JSON.stringify([...ids]);
  const matches = (path: string) =>
    `${path} IN (SELECT value FROM json_each(?))`;
  const resource = db
    .prepare(
      `SELECT DISTINCT json_extract(value, '$.runId') AS runId
    FROM documents WHERE collection = 'workResources' AND ${matches("json_extract(value, '$.runId')")}`,
    )
    .all(encoded);
  const claimed = db
    .prepare(
      `SELECT DISTINCT json_extract(value, '$.runId') AS runId
    FROM documents WHERE collection = 'work' AND json_extract(value, '$.status') = 'claimed'
    AND ${matches("json_extract(value, '$.runId')")}`,
    )
    .all(encoded);
  const comparisons = db
    .prepare(
      `WITH selected(id) AS (SELECT value FROM json_each(?)), refs(runId) AS (
        SELECT json_extract(s.value, '$.runId') FROM documents d, json_each(d.value, '$.samples') s WHERE d.collection = 'comparisons'
        UNION ALL SELECT m.value FROM documents d, json_each(d.value, '$.samples') s, json_each(s.value, '$.measurement.runIds') m WHERE d.collection = 'comparisons'
        UNION ALL SELECT json_extract(j.value, '$.evaluation.runId') FROM documents d, json_each(d.value, '$.judgments') j WHERE d.collection = 'comparisons'
        UNION ALL SELECT json_extract(j.value, '$.evaluation.reviewerRunId') FROM documents d, json_each(d.value, '$.judgments') j WHERE d.collection = 'comparisons'
        UNION ALL SELECT json_extract(j.value, '$.evaluation.source.runId') FROM documents d, json_each(d.value, '$.judgments') j WHERE d.collection = 'comparisons'
      ) SELECT DISTINCT runId FROM refs WHERE runId IN (SELECT id FROM selected)`,
    )
    .all(encoded);
  return {
    resources: resource.length,
    claimed: claimed.length,
    comparisons: comparisons.length,
  };
}

export function storageSpace(db: DatabaseSync) {
  const size = Number(db.prepare('PRAGMA page_size').get()!.page_size);
  return {
    databaseBytes:
      size * Number(db.prepare('PRAGMA page_count').get()!.page_count),
    reusableBytes:
      size * Number(db.prepare('PRAGMA freelist_count').get()!.freelist_count),
  };
}
