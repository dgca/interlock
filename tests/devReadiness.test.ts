import { afterEach, expect, it } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import { waitForEngine } from '../scripts/wait-for-engine';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
});
async function serve(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  return `http://127.0.0.1:${address.port}/health`;
}
it('keeps the UI gate closed through unavailable and non-ready health responses', async () => {
  let status = 503,
    ready = false,
    reached!: () => void;
  const firstRequest = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const url = await serve((_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: ready }));
    reached();
  });
  let started = false;
  const waiting = waitForEngine(url, 2000).then(() => {
    started = true;
  });
  await firstRequest;
  expect(started).toBe(false);
  status = 200;
  const nonReadyRequest = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await nonReadyRequest;
  expect(started).toBe(false);
  ready = true;
  await waiting;
  expect(started).toBe(true);
});
it('reports an unhealthy engine instead of waiting forever', async () => {
  const url = await serve((_request, response) => {
    response.writeHead(503);
    response.end();
  });
  await expect(waitForEngine(url, 100)).rejects.toThrow(
    `Timed out waiting for Interlock at ${url}`,
  );
});
it('bounds a health request that never responds', async () => {
  const url = await serve(() => {});
  await expect(waitForEngine(url, 100)).rejects.toThrow(
    'Check the server output',
  );
});
