import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { JsonLog, parseLogLevel } from '@interlock/runtime/log';
import { createApp, serveUi } from './app.js';
import { isLoopback, parseRequireToken } from './apiToken.js';
import { ensureApiToken } from '@interlock/core/apiToken';
import {
  resolveDataPaths,
  type DataPaths,
  type ResolvedPath,
} from '@interlock/core/dataPaths';
import { prepareDataDirectory } from './dataDirectory.js';
import type { ConnectionConfig } from './connection.js';
import { checkPort, lockDatabase, startupError } from './startup.js';
export { isDatabaseLocked, probeHealthyServer } from './startup.js';
export { prepareDataDirectory } from './dataDirectory.js';
import { nativeAdapters } from '@interlock/runtime/executors/native';
import {
  startWorkflowSync,
  type WorkflowSync,
} from '@interlock/runtime/workflowSync';
import { traceExportConfig } from '@interlock/runtime/traceExportConfig';
import type { TraceExport } from '@interlock/runtime/traceExport';

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
  paths = resolveDataPaths(),
): ConnectionConfig {
  const requireToken = parseRequireToken() || !isLoopback(hostname);
  const env = paths.tokenEnv;
  const config = Object.keys(env).length
    ? { ...connection, env: { ...connection.env, ...env } }
    : connection;
  try {
    return { ...config, token: ensureApiToken(paths.token.path), requireToken };
  } catch (error) {
    const message = `Cannot use the API token file ${paths.token.path}: ${error instanceof Error ? error.message : String(error)}`;
    if (requireToken) throw new Error(message, { cause: error });
    console.warn(`${message} Continuing without a token.`);
    return { ...config, requireToken };
  }
}

export async function startServer(options: {
  database?: string;
  defaultDatabase?: ResolvedPath;
  paths?: DataPaths;
  workdir: string;
  ui: string;
  port: number;
  connection: ConnectionConfig;
  allowedRoots?: string[];
  /** Folder of workflow bundles to sync with. Off when unset. */
  syncDir?: string;
  /** Listen address. Not user-configurable yet; a non-loopback address requires the API token. */
  hostname?: string;
  handleSignals?: boolean;
}) {
  const paths =
    options.paths ??
    resolveDataPaths({
      database:
        options.database === undefined
          ? undefined
          : { path: options.database, source: 'explicit server option' },
      defaultDatabase: options.defaultDatabase,
    });
  const database = paths.database.path;
  prepareDataDirectory(paths);
  const hostname = options.hostname ?? '127.0.0.1';
  await checkPort(options.port);
  const connection = withApiToken(options.connection, hostname, paths);
  const unlock = lockDatabase(database);
  let store: Store;
  try {
    store = new Store(database, { paths });
  } catch (error) {
    unlock();
    throw startupError(error, database);
  }
  if (store.migration.backup)
    console.log(
      `Database upgraded from schema ${store.migration.from} to ${store.migration.to}. Backup: ${store.migration.backup}`,
    );
  let engine!: Engine;
  let sync: WorkflowSync | undefined;
  let traces: TraceExport | undefined;
  try {
    const allowedRoots =
      options.allowedRoots ??
      parseAllowedRoots(process.env.INTERLOCK_ALLOWED_ROOTS);
    engine = new Engine(store, options.workdir, {
      ...(allowedRoots ? { allowedRoots } : {}),
    });
    engine.executors.mcpUrl = new URL(
      '/mcp/execute',
      options.connection.engineUrl,
    ).href;
    if (connection.requireToken) engine.executors.apiToken = connection.token;
    engine.executors.errors.attach(
      new JsonLog(
        paths.logRoot,
        parseLogLevel(process.env.INTERLOCK_LOG_LEVEL),
      ),
    );
    engine.executors.start(nativeAdapters);
    const syncDir = options.syncDir ?? process.env.INTERLOCK_SYNC_DIR?.trim();
    if (syncDir) sync = startWorkflowSync(engine, resolve(syncDir));
    // The exporter module loads only when INTERLOCK_OTEL_TRACES is on.
    const traceConfig = traceExportConfig();
    if (traceConfig)
      traces = (
        await import('@interlock/runtime/traceExport')
      ).startTraceExport(store, traceConfig);
    engine.pump();
  } catch (error) {
    sync?.stop();
    await traces?.stop(0);
    engine?.stop();
    store.close();
    unlock();
    throw startupError(error, database);
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
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    sync?.stop();
    await engine.executors.stop();
    await traces?.stop(2000);
    engine.stop();
    await new Promise<void>((resolve) => {
      const fallback = setTimeout(() => resolve(), 1000);
      fallback.unref();
      try {
        server.close(() => {
          clearTimeout(fallback);
          resolve();
        });
      } catch {
        clearTimeout(fallback);
        resolve();
      }
    });
    store.close();
    unlock();
  };
  const onError =
    (port: number, option: string) => (error: NodeJS.ErrnoException) => {
      console.error(
        error.code === 'EADDRINUSE'
          ? `Port ${port} is already in use. Choose ${option} or stop the process using that port.`
          : error.message,
      );
      void stop();
      process.exitCode = 1;
    };
  server.on('error', onError(options.port, '--port'));
  if (options.handleSignals !== false) {
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.on(signal, async () => {
        // Persist uncertainty immediately; bound shutdown even if a native transport stalls.
        setTimeout(() => process.exit(0), 6000).unref();
        await stop();
        process.exit(0);
      });
  }
  return { engine, store, server, connection, stop };
}
