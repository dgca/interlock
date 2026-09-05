import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { bodyLimit } from 'hono/body-limit';
import type { Engine } from '@interlock/runtime';
import { appRouter } from './router.js';
import type { ConnectionConfig } from './connection.js';

export function createApp(engine: Engine, connection?: ConnectionConfig) {
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  app.use('*', async (c, next) => {
    const host = new URL(c.req.url).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host))
      return c.json({ error: 'Local requests only' }, 403);
    const origin = c.req.header('origin');
    if (
      origin &&
      ![
        connection?.engineUrl,
        'http://127.0.0.1:4310',
        'http://localhost:4310',
        'http://127.0.0.1:5173',
        'http://localhost:5173',
      ].includes(origin)
    )
      return c.json({ error: 'Untrusted origin' }, 403);
    await next();
  });
  app.get('/health', (c) => c.json({ ok: true }));
  app.all('/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/trpc',
      req: c.req.raw,
      router: appRouter,
      createContext: () => ({ engine, connection }),
    }),
  );
  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const write = () => {
        void stream.writeSSE({ event: 'change', data: '{}' }).catch(() => {});
      };
      const unsubscribe = engine.subscribe(write);
      stream.onAbort(unsubscribe);
      await stream.writeSSE({ event: 'connected', data: '{}' });
      try {
        while (!stream.aborted) {
          await stream.sleep(15000);
          if (!stream.aborted)
            await stream.writeSSE({ event: 'heartbeat', data: '{}' });
        }
      } finally {
        unsubscribe();
      }
    }),
  );
  return app;
}
