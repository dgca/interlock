import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations.js';

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    const migration = migrate(db, path);
    const journalMode = db.prepare('PRAGMA journal_mode = WAL;').get();
    if (journalMode?.journal_mode === 'wal') {
      db.exec('PRAGMA synchronous = NORMAL;');
      db.exec('PRAGMA journal_size_limit = 16777216;');
    }
    return { db, migration };
  } catch (error) {
    db.close();
    throw error;
  }
}
