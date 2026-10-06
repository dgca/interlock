import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readPath, InterlockError, type RunQuery } from '@interlock/core';
import { migrate, type MigrationResult } from './migrations.js';
import { continuationState } from './continuation.js';
import type {
  Run,
  RunAncestry,
  WorkRequest,
  Workflow,
  WorkflowVersion,
  RunEvent,
  SavedPrompt,
} from '@interlock/core';

/** One service owns the database. Each runtime operation commits as one transaction. */
export class Store {
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
  continuation(id: string) {
    return continuationState(this.db, id);
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
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.migration = migrate(this.db, path);
      this.db.exec('PRAGMA journal_mode = WAL;');
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
  list<T>(collection: string): T[] {
    return this.db
      .prepare(
        'SELECT value FROM documents WHERE collection = ? ORDER BY rowid',
      )
      .all(collection)
      .map((row) => JSON.parse(row.value as string) as T);
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
  workflows() {
    return this.list<Workflow>('workflows').map((w) => ({
      ...w,
      ownerWorkflowId: w.ownerWorkflowId ?? null,
    }));
  }
  runs() {
    return this.list<Run>('runs');
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
    if (query.workflowId !== undefined) {
      filters.push("json_extract(value, '$.workflowId') = ?");
      parameters.push(query.workflowId);
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
      });
      if (result.length === query.limit) break;
    }
    return result;
  }
  work() {
    return this.list<WorkRequest>('work');
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
  savePrompt(prompt: SavedPrompt) {
    const key = `${prompt.id}:${prompt.revision}`;
    const previous = this.get<SavedPrompt>('promptRevisions', key);
    if (
      previous &&
      !isDeepStrictEqual(
        {
          name: previous.name,
          description: previous.description,
          content: previous.content,
        },
        {
          name: prompt.name,
          description: prompt.description,
          content: prompt.content,
        },
      )
    )
      throw new InterlockError(`Prompt revision conflict for ${key}`);
    this.put('prompts', prompt);
    if (!previous)
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
