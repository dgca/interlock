import { attentionWork, attentionAncestors } from './runAttention.js';
import { ProtectedValues } from './protectedValues.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  readPath,
  InterlockError,
  samePromptContent,
  type RunQuery,
  type ReportFilter,
} from '@interlock/core';
import { migrate, type MigrationResult } from './migrations.js';
import { continuationState } from './continuation.js';
import { runSummaries } from './runSummaries.js';
import { runsForReport } from './report.js';
export { runsForReport } from './report.js';
export type { HistoryRun } from './history.js';
import {
  historyRuns,
  historyInventory,
  historyReferences,
  deleteHistoryDocuments,
  storageSpace,
} from './history.js';
import type {
  Run,
  RunSummaryQuery,
  RunAncestry,
  WorkRequest,
  Workflow,
  WorkflowVersion,
  RunEvent,
  SavedPrompt,
  DeletedWorkflowVersion,
  WorkflowComparison,
  ResourceReservation,
} from '@interlock/core';

/** One service owns the database. Each runtime operation commits as one transaction. */
export class Store {
  readonly protectedValues: ProtectedValues;
  private db: DatabaseSync;
  private transactionDepth = 0;
  private listeners = new Set<() => void>();
  private notificationPending = false;
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed(collection: string) {
    if (
      (collection === 'runs' || collection === 'work') &&
      !this.notificationPending
    ) {
      this.notificationPending = true;
      queueMicrotask(() => {
        this.notificationPending = false;
        this.listeners.forEach((listener) => listener());
      });
    }
  }
  /** Advance a run cursor for state retained outside run/work documents. */
  touchRun(id: string) {
    this.transaction(() => {
      if (
        !this.db
          .prepare(
            "SELECT id FROM documents WHERE collection = 'runs' AND id = ?",
          )
          .get(id)
      )
        return;
      this.db
        .prepare(
          'UPDATE continuation_sequence SET revision = revision + 1 WHERE id = 1',
        )
        .run();
      this.db
        .prepare(
          'INSERT INTO run_revisions(run_id, revision) SELECT ?, revision FROM continuation_sequence WHERE id = 1 ON CONFLICT(run_id) DO UPDATE SET revision = excluded.revision',
        )
        .run(id);
      this.changed('runs');
    });
  }
  currentStalls(runId?: string): import('@interlock/core').StallRecord[] {
    const scoped =
      runId === undefined ? '' : " AND json_extract(value, '$.runId') = ?";
    return this.db
      .prepare(
        "SELECT value FROM documents INDEXED BY stalls_unresolved WHERE collection = 'stalls' AND json_extract(value, '$.resolvedAt') IS NULL" +
          scoped,
      )
      .all(...(runId === undefined ? [] : [runId]))
      .map((row) => JSON.parse(row.value as string));
  }
  continuation(id: string) {
    return continuationState(this.db, id);
  }
  attentionWork() {
    return attentionWork(this.db);
  }
  attentionAncestors(ids: Set<string>) {
    return attentionAncestors(this.db, ids);
  }
  historyRuns() {
    return historyRuns(this.db);
  }
  historyInventory(ids: Set<string>) {
    return historyInventory(this.db, ids);
  }
  historyReferences(ids: Set<string>) {
    return historyReferences(this.db, ids);
  }
  storageSpace() {
    return storageSpace(this.db);
  }
  quickCheck(): string[] {
    const rows = this.db.prepare('PRAGMA quick_check').all() as {
      quick_check?: string;
    }[];
    return rows.map((r) => r.quick_check ?? String(r));
  }
  deleteHistoryDocuments(ids: Set<string>) {
    deleteHistoryDocuments(this.db, ids);
    this.changed('runs');
  }
  batchSize(id: string, executionId: string, path: string) {
    const keys =
      !path || path === '$' ? [] : path.replace(/^\$\./, '').split('.');
    let value = "json_quote(json_extract(e.value, '$.input'))";
    for (const _key of keys)
      value = `(SELECT CASE WHEN j.type IN ('array', 'object') THEN json(j.value) ELSE json_quote(j.value) END FROM json_each(${value}) j WHERE CAST(j.key AS TEXT) = ?)`;
    const row = this.db
      .prepare(
        `SELECT coalesce(json_array_length(${value}), 0) AS size
      FROM documents d, json_each(d.value, '$.executions') e
      WHERE d.collection = 'runs' AND d.id = ? AND json_extract(e.value, '$.id') = ?`,
      )
      .get(...keys, id, executionId);
    return Number(row?.size ?? 0);
  }
  readonly migration: MigrationResult;
  constructor(
    readonly path: string,
    options: { secretKeyFile?: string } = {},
  ) {
    this.protectedValues = new ProtectedValues(
      this,
      path,
      options.secretKeyFile ??
        (path === ':memory:'
          ? undefined
          : process.env.INTERLOCK_SECRET_KEY_FILE),
    );
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.migration = migrate(this.db, path);
      const journalMode = this.db.prepare('PRAGMA journal_mode = WAL;').get();
      if (journalMode?.journal_mode === 'wal') {
        this.db.exec('PRAGMA synchronous = NORMAL;');
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  get<T>(collection: string, id: string): T | undefined {
    const row = this.db
      .prepare('SELECT value FROM documents WHERE collection = ? AND id = ?')
      .get(collection, id);
    return row ? (JSON.parse(row.value as string) as T) : undefined;
  }
  workflowTriggers(
    workflowId?: string,
  ): import('@interlock/core').WorkflowTrigger[] {
    return this.db
      .prepare(
        `SELECT value FROM documents WHERE collection = 'workflowTriggers' ${workflowId ? "AND json_extract(value, '$.workflowId') = ?" : ''} ORDER BY rowid`,
      )
      .all(...(workflowId ? [workflowId] : []))
      .map((row) => JSON.parse(row.value as string));
  }
  eventDeliveries(triggerId: string, offset = 0, limit = 20) {
    const total = Number(
      this.db
        .prepare(
          "SELECT count(*) AS total FROM documents WHERE collection = 'eventDeliveries' AND json_extract(value, '$.triggerId') = ?",
        )
        .get(triggerId)!.total,
    );
    const items = this.db
      .prepare(
        "SELECT value FROM documents WHERE collection = 'eventDeliveries' AND json_extract(value, '$.triggerId') = ? ORDER BY json_extract(value, '$.createdAt') DESC, rowid DESC LIMIT ? OFFSET ?",
      )
      .all(triggerId, limit, offset)
      .map(
        (row) =>
          JSON.parse(
            row.value as string,
          ) as import('@interlock/core').EventDelivery,
      );
    return {
      items,
      total,
      nextOffset: offset + items.length < total ? offset + items.length : null,
    };
  }
  pendingEventDeliveries(): import('@interlock/core').EventDelivery[] {
    return this.db
      .prepare(
        "SELECT value FROM documents WHERE collection = 'eventDeliveries' AND coalesce(json_extract(value, '$.settled'), 0) = 0 ORDER BY json_extract(value, '$.createdAt'), rowid",
      )
      .all()
      .map((row) => JSON.parse(row.value as string));
  }
  trimEventDeliveries(triggerId: string, keep = 200) {
    this.db
      .prepare(
        "DELETE FROM documents WHERE collection = 'eventDeliveries' AND id IN (SELECT id FROM documents WHERE collection = 'eventDeliveries' AND json_extract(value, '$.triggerId') = ? AND json_extract(value, '$.settled') = 1 ORDER BY json_extract(value, '$.createdAt') DESC, rowid DESC LIMIT -1 OFFSET ?)",
      )
      .run(triggerId, keep);
  }
  deleteEventHistory(triggerId: string) {
    // Receipts outlive visible history, including disable/delete/import cycles.
    this.db
      .prepare(
        "DELETE FROM documents WHERE collection = 'eventDeliveries' AND json_extract(value, '$.triggerId') = ?",
      )
      .run(triggerId);
  }
  terminalBackgroundRuns(): Run[] {
    return this.db
      .prepare(
        `
      SELECT d.value FROM active_background_runs b JOIN documents d
        ON d.collection = 'runs' AND d.id = b.run_id
      WHERE json_extract(d.value, '$.status') IN ('completed', 'failed', 'cancelled')
    `,
      )
      .all()
      .map((row) => JSON.parse(row.value as string));
  }
  /** Source run, descendants including detached runs, and their continuations. */
  sourceRunTree(runId: string): Run[] {
    return this.db
      .prepare(
        `
      WITH RECURSIVE tree(id) AS (
        SELECT ?
        UNION
        SELECT d.id FROM documents d JOIN tree t
          ON json_extract(d.value, '$.parentRunId') = t.id
          WHERE d.collection = 'runs'
        UNION
        SELECT json_extract(d.value, '$.chain.nextRunId')
          FROM documents d JOIN tree t ON d.id = t.id
          WHERE d.collection = 'runs' AND json_type(d.value, '$.chain.nextRunId') = 'text'
      )
      SELECT d.value FROM documents d JOIN tree t ON d.id = t.id
        WHERE d.collection = 'runs'
    `,
      )
      .all(runId)
      .map((row) => JSON.parse(row.value as string));
  }
  scheduleFires(triggerId: string, offset = 0, limit = 20) {
    const total = Number(
      this.db
        .prepare(
          "SELECT count(*) AS total FROM documents WHERE collection = 'scheduleFires' AND json_extract(value, '$.triggerId') = ?",
        )
        .get(triggerId)!.total,
    );
    const items = this.db
      .prepare(
        "SELECT value FROM documents WHERE collection = 'scheduleFires' AND json_extract(value, '$.triggerId') = ? ORDER BY json_extract(value, '$.scheduledAt') DESC LIMIT ? OFFSET ?",
      )
      .all(triggerId, limit, offset)
      .map(
        (row) =>
          JSON.parse(
            row.value as string,
          ) as import('@interlock/core').ScheduleFire,
      );
    return {
      items,
      total,
      nextOffset: offset + items.length < total ? offset + items.length : null,
    };
  }
  pendingScheduleLag(triggerId: string, at: number): number {
    const row = this.db
      .prepare(
        "SELECT min(json_extract(value, '$.scheduledAt')) AS slot FROM documents WHERE collection = 'scheduleFires' AND json_extract(value, '$.triggerId') = ? AND json_extract(value, '$.settled') = 0 AND json_type(value, '$.admittedAt') IS NULL",
      )
      .get(triggerId);
    return row?.slot ? Math.max(0, at - Date.parse(row.slot as string)) : 0;
  }
  pendingScheduleFires(): import('@interlock/core').ScheduleFire[] {
    return this.db
      .prepare(
        "SELECT value FROM documents WHERE collection = 'scheduleFires' AND json_extract(value, '$.settled') = 0 ORDER BY json_extract(value, '$.scheduledAt'), rowid",
      )
      .all()
      .map((row) => JSON.parse(row.value as string));
  }
  trimScheduleFires(triggerId: string, keep = 200) {
    this.db
      .prepare(
        "DELETE FROM documents WHERE collection = 'scheduleFires' AND id IN (SELECT id FROM documents WHERE collection = 'scheduleFires' AND json_extract(value, '$.triggerId') = ? AND json_extract(value, '$.settled') = 1 ORDER BY json_extract(value, '$.scheduledAt') DESC LIMIT -1 OFFSET ?)",
      )
      .run(triggerId, keep);
  }
  deleteScheduleFires(triggerId: string) {
    this.db
      .prepare(
        "DELETE FROM documents WHERE collection = 'scheduleFires' AND json_extract(value, '$.triggerId') = ?",
      )
      .run(triggerId);
  }
  pauseHolds(
    workflowId?: string,
    includeReleased = false,
  ): import('@interlock/core').PauseHold[] {
    return this.db
      .prepare(
        `SELECT value FROM documents WHERE collection = 'pauseHolds'
      AND (? OR json_type(value, '$.releasedAt') IS NULL)
      AND (json_extract(value, '$.scope') = 'library' OR json_extract(value, '$.workflowId') = ?)
      ORDER BY json_extract(value, '$.createdAt'), id`,
      )
      .all(includeReleased ? 1 : 0, workflowId ?? null)
      .map((row) => JSON.parse(row.value as string));
  }
  list<T>(collection: string): T[] {
    return this.db
      .prepare(
        'SELECT value FROM documents WHERE collection = ? ORDER BY rowid',
      )
      .all(collection)
      .map((row) => JSON.parse(row.value as string) as T);
  }
  forRuns<T>(collection: string, runIds: Set<string>): T[] {
    if (!runIds.size) return [];
    return this.db
      .prepare(
        `SELECT value FROM documents WHERE collection = ?
      AND json_extract(value, '$.runId') IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
      )
      .all(collection, JSON.stringify([...runIds]))
      .map((row) => JSON.parse(row.value as string) as T);
  }
  forWork<T>(collection: string, workId: string): T[] {
    return this.db
      .prepare(
        "SELECT value FROM documents WHERE collection = ? AND json_extract(value, '$.workId') = ? ORDER BY rowid",
      )
      .all(collection, workId)
      .map((row) => JSON.parse(row.value as string) as T);
  }
  eventTimesForRuns(
    runIds: Set<string>,
  ): Pick<RunEvent, 'runId' | 'type' | 'at'>[] {
    if (!runIds.size) return [];
    return this.db
      .prepare(
        `SELECT json_extract(value, '$.runId') AS runId,
      json_extract(value, '$.type') AS type, json_extract(value, '$.at') AS at
      FROM documents WHERE collection = 'events'
      AND json_extract(value, '$.runId') IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
      )
      .all(JSON.stringify([...runIds]))
      .map((row) => ({
        runId: row.runId as string,
        type: row.type as string,
        at: row.at as string,
      }));
  }
  put<T extends { id: string }>(collection: string, value: T): void {
    this.db
      .prepare(
        'INSERT INTO documents VALUES (?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET value = excluded.value',
      )
      .run(collection, value.id, JSON.stringify(value));
    this.changed(collection);
  }
  remove(collection: string, id: string) {
    this.db
      .prepare('DELETE FROM documents WHERE collection = ? AND id = ?')
      .run(collection, id);
    this.changed(collection);
  }
  version(value: WorkflowVersion) {
    this.put('versions', {
      ...value,
      id: `${value.workflowId}:${value.version}`,
    });
  }
  getVersion(workflowId: string, version: number) {
    return this.get<WorkflowVersion>('versions', `${workflowId}:${version}`);
  }
  listVersions(workflowId?: string) {
    return this.list<WorkflowVersion>('versions')
      .filter((v) => workflowId === undefined || v.workflowId === workflowId)
      .sort(
        (a, b) =>
          a.workflowId.localeCompare(b.workflowId) || a.version - b.version,
      );
  }
  deletedVersion(workflowId: string, version: number) {
    return this.get<DeletedWorkflowVersion>(
      'deletedVersions',
      `${workflowId}:${version}`,
    );
  }
  recordDeletedVersion(value: DeletedWorkflowVersion) {
    this.put('deletedVersions', {
      ...value,
      id: `${value.workflowId}:${value.version}`,
    });
  }
  deleteVersion(value: DeletedWorkflowVersion) {
    this.recordDeletedVersion(value);
    this.remove('versions', `${value.workflowId}:${value.version}`);
  }
  workflows() {
    return this.list<Workflow>('workflows').map((w) => ({
      ...w,
      ownerWorkflowId: w.ownerWorkflowId ?? null,
    }));
  }
  runs() {
    return this.list<Run>('runs');
  }
  runSummaries(query: RunSummaryQuery, attentionIds: string[]) {
    return runSummaries(this.db, query, attentionIds);
  }
  runsForReport(filter: ReportFilter): Run[] {
    return runsForReport(this.db, filter);
  }
  queuedRuns(): Run[] {
    return this.db
      .prepare(
        `SELECT value FROM documents INDEXED BY runs_admission_queue
      WHERE collection = 'runs' AND json_extract(value, '$.status') = 'queued'
      ORDER BY coalesce(json_extract(value, '$.admission.priority'), 0) DESC, rowid`,
      )
      .all()
      .map((row) => JSON.parse(row.value as string));
  }
  activeRuns(): Run[] {
    // Separate equalities keep SQLite on the status index even without ANALYZE.
    // An IN predicate can otherwise choose a scan of every run document.
    return this.db
      .prepare(
        `SELECT value, rowid AS position FROM documents WHERE collection = 'runs' AND json_extract(value, '$.status') = 'queued'
        UNION ALL
        SELECT value, rowid AS position FROM documents WHERE collection = 'runs' AND json_extract(value, '$.status') = 'running'
        UNION ALL
        SELECT value, rowid AS position FROM documents WHERE collection = 'runs' AND json_extract(value, '$.status') = 'waiting'
        ORDER BY position`,
      )
      .all()
      .map((row) => JSON.parse(row.value as string));
  }
  /** Ancestors include detached parents; callers decide which policies govern. */
  runAncestors(ids: Set<string>): Run[] {
    if (!ids.size) return [];
    return this.db
      .prepare(
        `
      WITH RECURSIVE lineage(id) AS (
        SELECT value FROM json_each(?)
        UNION
        SELECT json_extract(d.value, '$.parentRunId') FROM documents d
        JOIN lineage ON d.id = lineage.id WHERE d.collection = 'runs'
        AND json_extract(d.value, '$.parentRunId') IS NOT NULL
      ) SELECT d.value FROM lineage CROSS JOIN documents d ON d.collection = 'runs' AND d.id = lineage.id
    `,
      )
      .all(JSON.stringify([...ids]))
      .map((row) => JSON.parse(row.value as string));
  }
  chainRuns(roots: Set<string>): Run[] {
    if (!roots.size) return [];
    return this.db
      .prepare(
        `SELECT value FROM documents WHERE collection = 'runs'
      AND json_extract(value, '$.chain.rootRunId') IN (SELECT value FROM json_each(?)) ORDER BY rowid
    `,
      )
      .all(JSON.stringify([...roots]))
      .map((row) => JSON.parse(row.value as string));
  }
  runTrees(ids: Set<string>): Run[] {
    if (!ids.size) return [];
    // Match continuation's indexed descendant traversal, including JSON affinity.
    return this.db
      .prepare(
        `
      WITH RECURSIVE tree(id) AS (
        SELECT value FROM json_each(?)
        UNION
        SELECT d.id FROM tree CROSS JOIN documents d ON json_extract(d.value, '$.parentRunId') = +tree.id
        WHERE d.collection = 'runs'
      ) SELECT d.value FROM tree CROSS JOIN documents d ON d.collection = 'runs' AND d.id = tree.id ORDER BY d.rowid
    `,
      )
      .all(JSON.stringify([...ids]))
      .map((row) => JSON.parse(row.value as string));
  }
  /** Nearest held run, stopping at the detached boundary. */
  externalInputHoldOwner(id: string): string | undefined {
    return this.externalInputHold(id)?.runId;
  }
  externalInputHold(id: string): { runId: string; heldAt: string } | undefined {
    const row = this.db
      .prepare(
        `WITH RECURSIVE lineage(id, parentId, mode, heldAt, depth) AS (
        SELECT id, json_extract(value, '$.parentRunId'), json_extract(value, '$.parentMode'),
          json_extract(value, '$.externalInputHold.heldAt'), 0
        FROM documents WHERE collection = 'runs' AND id = ?
        UNION ALL
        SELECT d.id, json_extract(d.value, '$.parentRunId'), json_extract(d.value, '$.parentMode'),
          json_extract(d.value, '$.externalInputHold.heldAt'), lineage.depth + 1
        FROM lineage JOIN documents d ON d.collection = 'runs' AND d.id = lineage.parentId
        WHERE lineage.mode IS NOT 'detached'
      )
      SELECT id, heldAt FROM lineage WHERE heldAt IS NOT NULL
      ORDER BY depth LIMIT 1`,
      )
      .get(id);
    return row
      ? { runId: row.id as string, heldAt: row.heldAt as string }
      : undefined;
  }
  /** Waiting runs whose effective hold can change when an ancestor changes. */
  attachedExternalInputWaits(id: string): string[] {
    return this.db
      .prepare(
        `WITH RECURSIVE attached(id) AS (
        SELECT ?
        UNION ALL
        SELECT d.id FROM attached CROSS JOIN documents d
          ON json_extract(d.value, '$.parentRunId') = +attached.id
        WHERE d.collection = 'runs' AND json_extract(d.value, '$.parentMode') IS NOT 'detached'
      )
      SELECT d.id FROM attached JOIN documents d ON d.collection = 'runs' AND d.id = attached.id
      WHERE json_extract(d.value, '$.status') = 'waiting'
        AND json_extract(d.value, '$.executions[#-1].kind') = 'input'`,
      )
      .all(id)
      .map((row) => row.id as string);
  }
  runAncestry(id: string, cache = new Map<string, RunAncestry>()): RunAncestry {
    const cached = cache.get(id);
    if (cached) return cached;
    // Select identity only: execution history is not needed to route work.
    const row = this.db
      .prepare(
        `
      SELECT json_extract(value, '$.workflowId') AS workflowId,
             json_extract(value, '$.parentRunId') AS parentRunId,
             json_extract(value, '$.parentMode') AS parentMode
      FROM documents WHERE collection = 'runs' AND id = ?
    `,
      )
      .get(id);
    if (!row) throw new Error(`Run ${id} not found`);
    const workflowId = row.workflowId as string;
    const parentRunId = (row.parentRunId as string | null) ?? undefined;
    const parent = parentRunId
      ? this.runAncestry(parentRunId, cache)
      : undefined;
    const ancestry = {
      workflowId,
      parentRunId,
      ...(row.parentMode === 'detached'
        ? { parentMode: 'detached' as const }
        : {}),
      rootRunId: parent?.rootRunId ?? id,
      rootWorkflowId: parent?.rootWorkflowId ?? workflowId,
    };
    cache.set(id, ancestry);
    return ancestry;
  }
  findRuns(query: RunQuery) {
    const filters = ["collection = 'runs'"];
    const parameters: string[] = [];
    for (const [key, value] of Object.entries(query.tags ?? {})) {
      filters.push(
        'id IN (SELECT run_id FROM run_tags WHERE tag_key = ? AND tag_value = ?)',
      );
      parameters.push(key, value);
    }
    if (query.requestId !== undefined) {
      filters.push("json_extract(value, '$.startRequestId') = ?");
      parameters.push(query.requestId);
    }
    if (query.externalTask) {
      filters.push(
        "json_extract(value, '$.externalTask.system') = ? AND json_extract(value, '$.externalTask.id') = ?",
      );
      parameters.push(query.externalTask.system, query.externalTask.id);
    }
    if (query.workflowId !== undefined) {
      filters.push("json_extract(value, '$.workflowId') = ?");
      parameters.push(query.workflowId);
    }
    if (query.chainRootRunId !== undefined) {
      filters.push("json_extract(value, '$.chain.rootRunId') = ?");
      parameters.push(query.chainRootRunId);
    }
    if (query.status !== undefined) {
      filters.push("json_extract(value, '$.status') = ?");
      parameters.push(query.status);
    }
    if (query.rootOnly)
      filters.push("json_extract(value, '$.parentRunId') IS NULL");
    const rows = this.db
      .prepare(
        `SELECT value FROM documents WHERE ${filters.join(' AND ')} ORDER BY json_extract(value, '$.createdAt') DESC, rowid DESC`,
      )
      .iterate(...parameters);
    const ancestry = new Map<string, RunAncestry>();
    const result: (Pick<
      Run,
      | 'id'
      | 'workflowId'
      | 'workflowName'
      | 'version'
      | 'status'
      | 'createdAt'
      | 'updatedAt'
      | 'cursor'
      | 'input'
      | 'parentRunId'
      | 'batchNodeId'
      | 'comparison'
      | 'chain'
      | 'startRequestId'
      | 'externalTask'
      | 'tags'
    > &
      RunAncestry)[] = [];
    for (const row of rows) {
      const run: Run = JSON.parse(row.value as string);
      if (query.inputMatch) {
        try {
          if (
            !isDeepStrictEqual(
              readPath(run.input, query.inputMatch.path),
              query.inputMatch.equals,
            )
          )
            continue;
        } catch {
          continue;
        } // Missing paths do not match, including JSON null.
      }
      const {
        id,
        workflowId,
        workflowName,
        version,
        status,
        createdAt,
        updatedAt,
        cursor,
        input,
        parentRunId,
        batchNodeId,
        comparison,
      } = run;
      result.push({
        ...this.runAncestry(id, ancestry),
        id,
        workflowId,
        workflowName,
        version,
        status,
        createdAt,
        updatedAt,
        cursor,
        input,
        parentRunId,
        batchNodeId,
        ...(comparison ? { comparison } : {}),
        ...(run.startRequestId !== undefined
          ? { startRequestId: run.startRequestId }
          : {}),
        ...(run.externalTask ? { externalTask: run.externalTask } : {}),
        ...(run.tags !== undefined ? { tags: run.tags } : {}),
        ...(run.chain ? { chain: run.chain } : {}),
      });
      if (result.length === query.limit) break;
    }
    return result;
  }
  work(status?: WorkRequest['status'], runId?: string): WorkRequest[] {
    if (status !== undefined || runId !== undefined)
      return this.db
        .prepare(
          `SELECT value FROM documents WHERE collection = 'work'
        ${status === undefined ? '' : "AND json_extract(value, '$.status') = ?"}
        ${runId === undefined ? '' : "AND json_extract(value, '$.runId') = ?"} ORDER BY rowid
      `,
        )
        .all(
          ...(status === undefined ? [] : [status]),
          ...(runId === undefined ? [] : [runId]),
        )
        .map((row) => JSON.parse(row.value as string));
    return this.list<WorkRequest>('work');
  }
  resourceAdmissionWork(): WorkRequest[] {
    return this.db
      .prepare(
        `SELECT value FROM documents WHERE collection = 'work'
      AND (json_extract(value, '$.status') = 'available' OR json_type(value, '$.resourceBlocked') IS NOT NULL) = 1
      ORDER BY rowid
    `,
      )
      .all()
      .map((row) => JSON.parse(row.value as string));
  }
  scheduledComparisons(includeTrials = false): WorkflowComparison[] {
    return this.db
      .prepare(
        `WITH pending(id) AS (
      SELECT comparison_id FROM comparison_schedule WHERE execution_pending = 1
      UNION SELECT comparison_id FROM active_comparison_runs
      ${includeTrials ? 'UNION SELECT comparison_id FROM comparison_schedule WHERE trial_pending = 1' : ''}
    ) SELECT d.value FROM pending CROSS JOIN documents d
      ON d.collection = 'comparisons' AND d.id = pending.id ORDER BY d.rowid
    `,
      )
      .all()
      .map((row) => JSON.parse(row.value as string));
  }
  resourcesForReconciliation(): ResourceReservation[] {
    return this.db
      .prepare(
        `SELECT value FROM documents WHERE collection = 'workResources'
      AND json_extract(value, '$.state') = 'claimed' ORDER BY rowid
    `,
      )
      .all()
      .map((row) => JSON.parse(row.value as string));
  }
  latestPromptRevision(id: string): number {
    const row = this.db
      .prepare(
        `
      SELECT MAX(json_extract(value, '$.revision')) AS revision
      FROM documents
      WHERE collection = 'promptRevisions' AND json_extract(value, '$.promptId') = ?
    `,
      )
      .get(id) as { revision: number | null };
    return row.revision ?? 0;
  }
  promptRevision(id: string, revision: number): SavedPrompt | undefined {
    const record = this.get<SavedPrompt>(
      'promptRevisions',
      `${id}:${revision}`,
    );
    if (!record) return undefined;
    const { name, description, content, createdAt, updatedAt } = record;
    return { id, revision, name, description, content, createdAt, updatedAt };
  }
  promptHistory(id: string, offset: number, limit: number) {
    const where =
      "collection = 'promptRevisions' AND json_extract(value, '$.promptId') = ?";
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM documents WHERE ${where}`)
        .get(id) as { total: number }
    ).total;
    const items = this.db
      .prepare(
        `SELECT json_extract(value, '$.revision') AS revision, json_extract(value, '$.name') AS name FROM documents WHERE ${where} ORDER BY json_extract(value, '$.revision') DESC LIMIT ? OFFSET ?`,
      )
      .all(id, limit, offset) as { revision: number; name: string }[];
    return {
      items,
      total,
      offset,
      nextOffset: offset + items.length < total ? offset + items.length : null,
    };
  }
  savePrompt(prompt: SavedPrompt) {
    this.retainPromptRevision(prompt);
    this.put('prompts', prompt);
  }
  /** Retain an exact historical identity without changing the current edit revision. */
  retainPromptRevision(prompt: SavedPrompt) {
    const key = `${prompt.id}:${prompt.revision}`;
    const current = this.get<SavedPrompt>('prompts', prompt.id);
    const previous =
      this.promptRevision(prompt.id, prompt.revision) ??
      (current?.revision === prompt.revision ? current : undefined);
    if (previous && !samePromptContent(previous, prompt))
      throw new InterlockError(`Prompt revision conflict for ${key}`);
    if (!this.get('promptRevisions', key))
      this.put('promptRevisions', { ...prompt, promptId: prompt.id, id: key });
  }
  events(runId: string) {
    return this.list<RunEvent>('events').filter((e) => e.runId === runId);
  }
  transaction<T>(fn: () => T): T {
    const depth = this.transactionDepth;
    const savepoint = `interlock_${depth}`;
    this.db.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const result = fn();
      this.db.exec(depth ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      if (depth) {
        this.db.exec(`ROLLBACK TO ${savepoint}`);
        this.db.exec(`RELEASE ${savepoint}`);
      } else this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  close() {
    this.db.close();
  }
}

export {
  BackgroundFiles,
  type BackgroundJob,
  type SupervisorReceipt,
} from './backgroundScripts.js';
