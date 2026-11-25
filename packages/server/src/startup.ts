import { createServer } from 'node:net';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaultHost } from './listenAddress.js';

/**
 * Hold an exclusive SQLite lock on a sidecar file for the server's lifetime.
 * The operating system releases it when the process exits, so a crashed
 * server never leaves a stale lock behind.
 */
export function lockDatabase(database: string): () => void {
  if (database === ':memory:') return () => {};
  const path = `${database}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const lock = new DatabaseSync(path);
  try {
    lock.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE');
  } catch (error) {
    lock.close();
    if (!/locked|busy/i.test(error instanceof Error ? error.message : ''))
      throw error;
    throw new Error(
      `Another Interlock server is already using database ${database}. Stop that server before starting another one, or choose a different --db. Use lsof ${JSON.stringify(path)} to find the process.`,
      { cause: error },
    );
  }
  return () => lock.close();
}

export function isDatabaseLocked(database: string): boolean {
  if (database === ':memory:') return false;
  const path = `${database}.lock`;
  if (!existsSync(path)) return false;
  const lock = new DatabaseSync(path, { readOnly: true });
  try {
    lock.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE; ROLLBACK');
    return false;
  } catch (error) {
    if (/locked|busy/i.test(error instanceof Error ? error.message : ''))
      return true;
    throw error;
  } finally {
    lock.close();
  }
}

export async function probeHealthyServer(
  engineUrl: string,
  timeoutMs = 1000,
): Promise<boolean> {
  try {
    const response = await fetch(`${engineUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as unknown;
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as Record<string, unknown>).ok === true
    );
  } catch {
    return false;
  }
}

export function listenError(
  error: NodeJS.ErrnoException,
  host: string,
  port: number,
) {
  return new Error(
    error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use at ${host}. Another Interlock instance may be running. Find the process with lsof -nP -iTCP:${port} -sTCP:LISTEN and stop that instance, or select --port with a different --db. If the process is suspended, resume it with kill -CONT <pid> so it can handle a pending termination signal.`
      : `Cannot listen on ${host} at port ${port}. ${error.message}`,
    { cause: error },
  );
}

export function checkPort(port: number, host = defaultHost): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once('error', (error: NodeJS.ErrnoException) =>
      reject(listenError(error, host, port)),
    );
    listener.listen(port, host, () =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  });
}

export function startupError(error: unknown, database: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /database (?:is )?(?:locked|busy)|SQLITE_BUSY|SQLITE_LOCKED/i.test(message)
  )
    return new Error(
      `Cannot start Interlock using database ${database}. Another process may be using this database. Stop other Interlock instances before retrying. Use lsof ${JSON.stringify(database)} to find the process. If it is suspended, use kill -CONT <pid> to let it handle a pending termination signal. ${message}`,
      { cause: error },
    );
  return error instanceof Error ? error : new Error(message);
}
