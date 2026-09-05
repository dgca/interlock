import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { createApp } from './app.js';
import { seed } from './seed.js';
export type { AppRouter } from './router.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const store = new Store(
  process.env.INTERLOCK_DB ?? resolve(root, '.interlock/interlock.db'),
);
const engine = new Engine(store, process.env.INTERLOCK_WORKDIR ?? root);
seed(engine);
const app = createApp(engine);
const ui = fileURLToPath(new URL('../../ui/dist', import.meta.url));
app.get('*', serveStatic({ root: ui }));
app.get('*', serveStatic({ path: resolve(ui, 'index.html') }));
engine.pump();
const timer = setInterval(() => engine.pump(), 1000);
const server = serve(
  { fetch: app.fetch, hostname: '127.0.0.1', port: 4310 },
  () => console.log('Interlock is running at http://127.0.0.1:4310'),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    clearInterval(timer);
    engine.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
