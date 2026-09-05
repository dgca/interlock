import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS documents (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(collection, id));
      INSERT OR IGNORE INTO migrations VALUES (1);`);
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
    return this.list<Workflow>('workflows');
  }
  runs() {
    return this.list<Run>('runs');
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
