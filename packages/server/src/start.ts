import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { createApp } from './app.js';
import { seed } from './seed.js';
import type { ConnectionConfig } from './connection.js';
import { checkPort, startupError } from './startup.js';

export async function startServer(options: {
  database: string;
  workdir: string;
  ui: string;
  port: number;
  connection: ConnectionConfig;
}) {
  await checkPort(options.port);
  let store: Store;
  try {
    store = new Store(options.database);
  } catch (error) {
    throw startupError(error, options.database);
  }
  if (store.migration.backup)
    console.log(
      `Database upgraded from schema ${store.migration.from} to ${store.migration.to}. Backup: ${store.migration.backup}`,
    );
  let engine: Engine | undefined;
  try {
    engine = new Engine(store, options.workdir);
    seed(engine);
    engine.pump();
  } catch (error) {
    engine?.stop();
    store.close();
    throw startupError(error, options.database);
  }
  const app = createApp(engine, options.connection);
  app.get('*', serveStatic({ root: options.ui }));
  app.get('*', serveStatic({ path: resolve(options.ui, 'index.html') }));
  const timer = setInterval(() => engine.pump(), 1000);
  const server = serve(
    { fetch: app.fetch, hostname: '127.0.0.1', port: options.port },
    () =>
      console.log(`Interlock is running at ${options.connection.engineUrl}`),
  );
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${options.port} is already in use. Open ${options.connection.engineUrl} or choose --port.`
        : error.message,
    );
    clearInterval(timer);
    engine.stop();
    store.close();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      clearInterval(timer);
      engine.stop();
      server.close(() => {
        store.close();
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 1000).unref();
    });
}
