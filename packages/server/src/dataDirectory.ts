import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DataPaths } from '@interlock/core/dataPaths';
import type { ManagedWorkspace } from '@interlock/core';
import type { Store } from '@interlock/storage';

interface DatabaseBinding {
  database: string;
  id: string;
}

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!missing(error)) throw error;
    const parent = dirname(path);
    return join(canonicalPath(parent), relative(parent, path));
  }
}

function databaseBinding(dataDir: string, database: string) {
  if (!database || database === ':memory:' || database.startsWith('file:'))
    throw new Error('A file-backed database is required.');
  const path = canonicalPath(resolve(database));
  const local = relative(realpathSync(dataDir), path);
  return !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`)
    ? local
    : path;
}

function readBinding(marker: string, database: string) {
  let saved: unknown;
  try {
    const stat = lstatSync(marker);
    if (!stat.isFile() || stat.size > 32768)
      throw new Error(`Invalid database binding at ${marker}.`);
    saved = JSON.parse(readFileSync(marker, 'utf8'));
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  if (
    !saved ||
    typeof saved !== 'object' ||
    !('database' in saved) ||
    typeof saved.database !== 'string' ||
    !('id' in saved) ||
    typeof saved.id !== 'string'
  )
    throw new Error(`Invalid database binding at ${marker}.`);
  if (saved.database !== database)
    throw new Error(
      `This directory is bound to database ${JSON.stringify(saved.database)}. Use that database or choose a different data directory.`,
    );
  return saved as DatabaseBinding;
}

function useDataDirectory(
  paths: DataPaths,
  use: (directory: string, marker: string, database: string) => void,
) {
  const directory = paths.dataDir;
  if (directory === undefined) return;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    accessSync(directory, constants.W_OK | constants.X_OK);
    const database = databaseBinding(directory, paths.database.path);
    use(directory, join(directory, '.interlock-database'), database);
  } catch (error) {
    throw new Error(
      `Cannot use INTERLOCK_DATA_DIR ${directory}. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function prepareDataDirectory(paths: DataPaths) {
  useDataDirectory(paths, (_directory, marker, database) => {
    readBinding(marker, database);
  });
}

export function bindDataDirectory(paths: DataPaths, store: Store) {
  useDataDirectory(paths, (directory, marker, database) => {
    const saved = readBinding(marker, database);
    const identity = store.get<{ id: string; value: string }>(
      'installation',
      'data-directory',
    );
    function assertIdentity(
      binding: DatabaseBinding | undefined,
      id: string | undefined,
    ) {
      if (binding?.id !== id || id === undefined)
        throw new Error(
          'The database at this path does not match the directory binding. Restore the original database or use a different data directory.',
        );
    }
    if (saved) {
      assertIdentity(saved, identity?.value);
      return;
    }

    // Before adopting a legacy directory, protect worktrees from another DB.
    const workspaces = paths.workspaces.path;
    const names = existsSync(workspaces) ? readdirSync(workspaces) : [];
    if (
      names.some((name) => {
        const id = /^([a-zA-Z0-9][a-zA-Z0-9-]{0,127})\.owner\.json$/.exec(
          name,
        )?.[1];
        if (id === undefined) return false;
        const workspace = store.get<ManagedWorkspace>('workspaces', id);
        return !workspace || workspace.state === 'removed';
      })
    )
      throw new Error(
        'Existing managed worktrees do not belong to this database. Choose a new data directory or preserve them before moving the database.',
      );

    // Publish a complete binding atomically even if two databases start together.
    const id = identity?.value ?? randomUUID();
    if (!identity)
      store.put('installation', { id: 'data-directory', value: id });
    const temporary = join(directory, `.interlock-database-${randomUUID()}`);
    try {
      writeFileSync(temporary, `${JSON.stringify({ database, id })}\n`, {
        mode: 0o600,
        flag: 'wx',
        flush: true,
      });
      try {
        linkSync(temporary, marker);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        assertIdentity(readBinding(marker, database), id);
      }
    } finally {
      rmSync(temporary, { force: true });
    }
  });
}
