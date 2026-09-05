import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { createApp } from './app.js';
import { seed } from './seed.js';
import type { ConnectionConfig } from './connection.js';

export function startServer(options: {
  database: string;
  workdir: string;
  ui: string;
  port: number;
  connection: ConnectionConfig;
}) {
  const store = new Store(options.database);
  const engine = new Engine(store, options.workdir);
  seed(engine);
  const app = createApp(engine, options.connection);
  app.get('*', serveStatic({ root: options.ui }));
  app.get('*', serveStatic({ path: resolve(options.ui, 'index.html') }));
  engine.pump();
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
