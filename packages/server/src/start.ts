import { once } from 'node:events';
import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import type { StartupSettings } from '@interlock/core';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { JsonLog } from '@interlock/runtime/log';
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
import {
  checkPort,
  confirmInternalAddress,
  listenError,
  lockDatabase,
  startupError,
} from './startup.js';
export { isDatabaseLocked, probeHealthyServer } from './startup.js';
export { internalEngineUrl } from './listenAddress.js';
export { loadOperatorConfig } from './operatorConfig.js';
import { nativeAdapters } from '@interlock/runtime/executors/native';
import {
  startWorkflowSync,
  type WorkflowSync,
} from '@interlock/runtime/workflowSync';
import { traceExportConfig } from '@interlock/runtime/traceExportConfig';
import type { TraceExport } from '@interlock/runtime/traceExport';
import { loadOperatorConfig, type StartupOptions } from './operatorConfig.js';
import {
  canonicalHostHeader,
  defaultHost,
  internalEngineUrl,
  isWildcardHost,
  urlHostname,
} from './listenAddress.js';

/**
 * Adds the per-install token. Startup requires a usable token when startup
 * settings or the listener's address require authentication.
 */
export function withApiToken(
  connection: ConnectionConfig,
  hostname = defaultHost,
  paths = resolveDataPaths(),
  configuredRequirement = parseRequireToken(),
): ConnectionConfig {
  const requireToken = configuredRequirement || !isLoopback(hostname);
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

export async function startServer(
  options: StartupOptions & {
    database?: string;
    defaultDatabase?: ResolvedPath;
    paths?: DataPaths;
    workdir: string;
    ui: string;
    port: number;
    connection: ConnectionConfig;
    /** Startup snapshot already resolved for the CLI's health probe. */
    startupSettings?: StartupSettings;
    handleSignals?: boolean;
  },
) {
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
  const startupSettings =
    options.startupSettings ?? loadOperatorConfig(paths, options);
  const hostname = startupSettings.host.value;
  const publicUrl = startupSettings.publicUrl.value;
  prepareDataDirectory(paths);
  await checkPort(options.port, hostname);
  const connection = withApiToken(
    options.connection,
    hostname,
    paths,
    startupSettings.requireToken.value,
  );
  let app: ReturnType<typeof createApp> | undefined;
  const listener = getRequestListener(
    (request) =>
      app?.fetch(request) ??
      new Response('Interlock is starting.', {
        status: 503,
        headers: { Connection: 'close' },
      }),
    { hostname },
  );
  const server = createServer((request, response) => {
    const host = request.headers.host;
    if (host) request.headers.host = canonicalHostHeader(host);
    void listener(request, response);
  });
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
  let internalUrl: string;
  try {
    server.listen(options.port, hostname);
    await once(server, 'listening').catch((error: NodeJS.ErrnoException) => {
      throw listenError(error, hostname, options.port);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing Interlock listener address.');
    internalUrl = internalEngineUrl(hostname, address.port);
    if (isWildcardHost(urlHostname(hostname)))
      await confirmInternalAddress(server, internalUrl);
    connection.engineUrl = publicUrl ?? internalUrl;
    if (publicUrl) connection.publicUrlConfigured = true;
    if (
      connection.env?.INTERLOCK_URL !== undefined ||
      internalUrl !== internalEngineUrl(defaultHost, 4310)
    )
      connection.env = { ...connection.env, INTERLOCK_URL: internalUrl };
    engine = new Engine(store, options.workdir, {
      startupSettings,
    });
    engine.executors.mcpUrl = new URL('/mcp/execute', internalUrl).href;
    if (publicUrl)
      engine.executors.publicMcpUrl = new URL('/mcp/execute', publicUrl).href;
    if (connection.requireToken) engine.executors.apiToken = connection.token;
    engine.executors.errors.attach(
      new JsonLog(paths.logRoot, startupSettings.logLevel.value),
    );
    engine.executors.start(nativeAdapters);
    const syncDir = startupSettings.syncDir.value;
    if (syncDir) sync = startWorkflowSync(engine, syncDir);
    // The exporter module loads only when INTERLOCK_OTEL_TRACES is on.
    const traceConfig = traceExportConfig();
    if (traceConfig)
      traces = (
        await import('@interlock/runtime/traceExport')
      ).startTraceExport(store, traceConfig);
    const readyApp = createApp(engine, connection, {
      host: hostname,
      internalOrigin: new URL(internalUrl).origin,
      publicUrl,
    });
    serveUi(readyApp, options.ui, connection);
    engine.pump();
    app = readyApp;
  } catch (error) {
    if (server.listening) server.close();
    sync?.stop();
    await traces?.stop(0);
    await engine?.executors.stop();
    engine?.stop();
    store.close();
    unlock();
    throw startupError(error, database);
  }
  const timer = setInterval(() => engine.pump(), 1000);
  console.log(
    connection.requireToken
      ? `Interlock is running at ${internalUrl}/?token=${connection.token}\nAPI token required. Open this link to use the UI.`
      : `Interlock is running at ${internalUrl}`,
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
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(listenError(error, hostname, options.port).message);
    void stop();
    process.exitCode = 1;
  });
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
