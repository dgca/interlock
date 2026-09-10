import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readPath, type RunQuery } from '@interlock/core';
import { migrate, type MigrationResult } from './migrations.js';
import type {
  Run,
  WorkRequest,
  Workflow,
  WorkflowVersion,
  RunEvent,
} from '@interlock/core';

/** One service owns the database. Each runtime operation commits as one transaction. */
export class Store {
  private db: DatabaseSync;
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
  }
  remove(collection: string, id: string) {
    this.db
      .prepare('DELETE FROM documents WHERE collection = ? AND id = ?')
      .run(collection, id);
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
    const result: Pick<
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
    >[] = [];
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
  events(runId: string) {
    return this.list<RunEvent>('events').filter((e) => e.runId === runId);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
