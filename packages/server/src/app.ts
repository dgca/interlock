import { Hono, type Context } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@interlock/mcp';
import { streamSSE } from 'hono/streaming';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { bodyLimit } from 'hono/body-limit';
import type { Engine } from '@interlock/runtime';
import { appRouter } from './router.js';
import type { ConnectionConfig } from './connection.js';
import { largeQueryProcedures } from './transport.js';
import { pageWithApiToken, requireApiToken } from './apiToken.js';
import { createHttpApi } from './httpApi.js';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const largeQueryPaths = largeQueryProcedures.map(
  (procedure) => `/trpc/${procedure}`,
);

export function createApp(engine: Engine, connection?: ConnectionConfig) {
  const app = new Hono();
  const trustedOrigins = [
    'http://127.0.0.1:4310',
    'http://localhost:4310',
    // The Vite development server proxies the UI only from a checkout.
    ...((connection?.development ?? true)
      ? ['http://127.0.0.1:5173', 'http://localhost:5173']
      : []),
  ];
  app.use(
    '*',
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) =>
        c.text(
          'Request body exceeds the 2 MiB limit. Reduce the request size.',
          413,
          // Do not reuse a socket while the adapter drains the rejected body.
          { 'Keep-Alive': 'timeout=0' },
        ),
    }),
  );
  app.use('*', async (c, next) => {
    const host = new URL(c.req.url).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host))
      return c.json({ error: 'Local requests only' }, 403);
    const origin = c.req.header('origin');
    // Read engineUrl per request: callers may set it after binding a port.
    if (
      origin &&
      origin !== connection?.engineUrl &&
      !trustedOrigins.includes(origin)
    )
      return c.json({ error: 'Untrusted origin' }, 403);
    await next();
  });
  app.use('/mcp', requireApiToken(connection));
  app.use('/mcp/*', requireApiToken(connection));
  app.use('/trpc/*', requireApiToken(connection));
  app.use('/api', requireApiToken(connection));
  app.use('/api/*', requireApiToken(connection));
  // EventSource cannot send headers, so the stream also accepts ?token=.
  app.use('/events', requireApiToken(connection, { query: true }));
  app.all('/mcp/:profile?', async (c) => {
    // There are no server-initiated messages or transport sessions to retain.
    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST');
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed' },
          id: null,
        },
        405,
      );
    }
    const path = c.req.param('profile');
    const header = c.req.header('x-interlock-mcp-profile');
    let mcp: ReturnType<typeof createMcpServer>;
    try {
      if (path && header && path !== header)
        throw new Error('The MCP profile path and header disagree.');
      mcp = createMcpServer(
        appRouter.createCaller({
          engine,
          connection,
          signal: c.req.raw.signal,
          author: 'agent',
        }),
        path ?? header,
      );
    } catch (error) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: (error as Error).message },
          id: null,
        },
        path && !header ? 404 : 400,
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await mcp.connect(transport);
      return await transport.handleRequest(c.req.raw);
    } finally {
      // JSON mode completes the response before handleRequest resolves.
      await mcp.close();
    }
  });
  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/api', createHttpApi(engine, connection));
  app.all('/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/trpc',
      req: c.req.raw,
      router: appRouter,
      // Keep the query contract and legacy GET callers while accepting large bodies.
      allowMethodOverride: largeQueryPaths.includes(c.req.path),
      createContext: () => ({
        engine,
        connection,
        signal: c.req.raw.signal,
        // The stdio MCP bridge identifies itself; other callers are people.
        ...(c.req.header('x-interlock-author') === 'agent'
          ? { author: 'agent' as const }
          : {}),
      }),
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

/** Serves the UI build; the page carries the API token as permitted by the connection. */
export function serveUi(
  app: Hono,
  ui: string,
  connection: ConnectionConfig | undefined,
) {
  const page = async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    return c.html(
      pageWithApiToken(
        await readFile(resolve(ui, 'index.html'), 'utf8'),
        c.req.raw,
        connection,
      ),
    );
  };
  app.get('/', page);
  app.get('/index.html', page);
  app.get('*', serveStatic({ root: ui }));
  app.get('*', page);
}
