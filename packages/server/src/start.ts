import { serve } from '@hono/node-server';
import { dirname, join } from 'node:path';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { JsonLog, parseLogLevel } from '@interlock/runtime/log';
import { createApp, serveUi } from './app.js';
import { isLoopback, parseRequireToken } from './apiToken.js';
import { apiTokenPath, ensureApiToken } from '@interlock/core/apiToken';
import type { ConnectionConfig } from './connection.js';
import { checkPort, lockDatabase, startupError } from './startup.js';
import { nativeAdapters } from '../../runtime/src/executors/native.js';

export function parseAllowedRoots(value?: string): string[] | undefined {
  if (!value || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed))
        return parsed
          .map(String)
          .map((s) => s.trim())
          .filter(Boolean);
    } catch {
      // Fall through to delimiter splitting
    }
  }
  return trimmed
    .split(/[,:]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Adds the per-install token. It is required when INTERLOCK_REQUIRE_TOKEN is set
 * or the server listens beyond loopback; a token that cannot be created only
 * fails startup when required.
 */
export function withApiToken(
  connection: ConnectionConfig,
  hostname = '127.0.0.1',
): ConnectionConfig {
  const requireToken = parseRequireToken() || !isLoopback(hostname);
  try {
    return { ...connection, token: ensureApiToken(), requireToken };
  } catch (error) {
    const message = `Cannot use the API token file ${apiTokenPath()}: ${error instanceof Error ? error.message : String(error)}`;
    if (requireToken) throw new Error(message, { cause: error });
    console.warn(`${message} Continuing without a token.`);
    return { ...connection, requireToken };
  }
}

export async function startServer(options: {
  database: string;
  workdir: string;
  ui: string;
  port: number;
  connection: ConnectionConfig;
  allowedRoots?: string[];
  /** Listen address. Not user-configurable yet; a non-loopback address requires the API token. */
  hostname?: string;
}) {
  const hostname = options.hostname ?? '127.0.0.1';
  await checkPort(options.port);
  const connection = withApiToken(options.connection, hostname);
  const unlock = lockDatabase(options.database);
  let store: Store;
  try {
    store = new Store(options.database);
  } catch (error) {
    unlock();
    throw startupError(error, options.database);
  }
  if (store.migration.backup)
    console.log(
      `Database upgraded from schema ${store.migration.from} to ${store.migration.to}. Backup: ${store.migration.backup}`,
    );
  let engine: Engine | undefined;
  try {
    const allowedRoots =
      options.allowedRoots ??
      parseAllowedRoots(process.env.INTERLOCK_ALLOWED_ROOTS);
    engine = new Engine(store, options.workdir, {
      ...(allowedRoots ? { allowedRoots } : {}),
    });
    engine.executors.errors.attach(
      new JsonLog(
        join(dirname(options.database), 'logs'),
        parseLogLevel(process.env.INTERLOCK_LOG_LEVEL),
      ),
    );
    engine.executors.start(nativeAdapters);
    engine.pump();
  } catch (error) {
    engine?.stop();
    store.close();
    unlock();
    throw startupError(error, options.database);
  }
  const app = createApp(engine, connection);
  serveUi(app, options.ui, connection);
  const timer = setInterval(() => engine.pump(), 1000);
  const server = serve({ fetch: app.fetch, hostname, port: options.port }, () =>
    console.log(
      connection.requireToken
        ? `Interlock is running at ${connection.engineUrl}/?token=${connection.token}\nAPI token required. Open this link to use the UI.`
        : `Interlock is running at ${connection.engineUrl}`,
    ),
  );
  const onError =
    (port: number, option: string) => (error: NodeJS.ErrnoException) => {
      console.error(
        error.code === 'EADDRINUSE'
          ? `Port ${port} is already in use. Choose ${option} or stop the process using that port.`
          : error.message,
      );
      clearInterval(timer);
      server.close();
      engine.stop();
      store.close();
      unlock();
      process.exitCode = 1;
    };
  server.on('error', onError(options.port, '--port'));
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      // Persist uncertainty immediately; bound shutdown even if a native transport stalls.
      setTimeout(() => process.exit(0), 6000).unref();
      clearInterval(timer);
      await engine.executors.stop();
      engine.stop();
      server.close(() => {
        store.close();
        unlock();
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 1000).unref();
    });
}
