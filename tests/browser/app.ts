import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { createApp } from '../../packages/server/src/app';
import { developmentConnection } from '../../packages/server/src/connection';

/** Serves the production UI build unless a test passes another build, such as the gallery build. */
export async function openBrowserApp({ ui = 'packages/ui/dist' } = {}) {
  const index = join(ui, 'index.html');
  await access(index).catch(() => {
    throw new Error('Run pnpm build before the browser tests.');
  });
  const workdir = await mkdtemp(join(tmpdir(), 'interlock-browser-'));
  const store = new Store(':memory:');
  const engine = new Engine(store, workdir);
  // No managed executors are started in browser tests.
  const connection = developmentConnection();
  const app = createApp(engine, connection);
  app.get('*', serveStatic({ root: ui }));
  app.get('*', serveStatic({ path: index }));
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  connection.engineUrl = `http://127.0.0.1:${address.port}`;
  return {
    engine,
    url: connection.engineUrl,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      engine.stop();
      store.close();
      await rm(workdir, { recursive: true, force: true });
    },
  };
}
