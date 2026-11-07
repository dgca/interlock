import { Hono } from 'hono';
import type { Engine } from '@interlock/runtime';

/** This app deliberately has no local API, static files, events or MCP routes. */
export function createHooksApp(engine: Engine) {
  const app = new Hono();
  app.post('/hooks/:triggerId', async (c) => {
    const id = c.req.param('triggerId');
    const limit = engine.webhooks.bodyLimit(id);
    if (limit === undefined) return c.json({ code: 'trigger_not_found' }, 404);
    const respond = (result: { status: number; code: string }) =>
      new Response(JSON.stringify(result), {
        status: result.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    const length = c.req.header('content-length');
    if (length !== undefined && Number(length) > limit)
      return respond(engine.webhooks.rejectBody(id));
    const reader = c.req.raw.body?.getReader();
    let size = 0;
    const chunks: Buffer[] = [];
    if (reader) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) {
            await reader.cancel();
            return respond(engine.webhooks.rejectBody(id));
          }
          chunks.push(Buffer.from(value));
        }
      } catch {
        return c.json({ code: 'body_read_failed' }, 400);
      } finally {
        reader.releaseLock();
      }
    }
    return respond(
      engine.webhooks.receive(
        id,
        Buffer.concat(chunks, size),
        Object.fromEntries(c.req.raw.headers),
      ),
    );
  });
  return app;
}
