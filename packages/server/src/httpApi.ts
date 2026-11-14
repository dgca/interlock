import { Hono, type Context } from 'hono';
import { TRPCError } from '@trpc/server';
import { ZodError, z } from 'zod';
import {
  InterlockError,
  RunStartConflict,
  runStartSchema,
} from '@interlock/core';
import { LauncherClientError } from '@interlock/core/launcherClient';
import type { Engine } from '@interlock/runtime';
import { appRouter } from './router.js';
import type { ConnectionConfig } from './connection.js';

/** The supported start fields; other start options stay with MCP, tRPC and the CLI. */
const startBody = runStartSchema
  .pick({
    workflowId: true,
    version: true,
    input: true,
    requestId: true,
    title: true,
    tags: true,
  })
  .strict();
const resultQuery = z.object({
  path: z.string().optional(),
  maxBytes: z.coerce.number().optional(),
});

type Status = 400 | 403 | 404 | 409 | 429;
const launcherStatus: Record<LauncherClientError['code'], Status> = {
  launcher_credential_invalid: 403,
  launcher_client_conflict: 409,
  launcher_lease_invalid: 409,
  launcher_operation_not_found: 404,
  launcher_poll_busy: 429,
};
const failure = (
  c: Context,
  status: Status,
  code: string,
  error: string,
  extra: Record<string, unknown> = {},
) => c.json({ error, code, ...extra }, status);
const issues = (error: ZodError) =>
  error.issues.map(({ path, message }) => ({ path: path.join('.'), message }));

/** Maps shared-operation errors onto HTTP statuses; anything else is a 500. */
function rejection(c: Context, error: unknown) {
  const cause = error instanceof TRPCError ? error.cause : error;
  if (cause instanceof ZodError)
    return failure(c, 400, 'invalid_request', 'Invalid request', {
      issues: issues(cause),
    });
  if (cause instanceof LauncherClientError)
    return failure(c, launcherStatus[cause.code], cause.code, cause.message);
  if (cause instanceof RunStartConflict)
    return failure(c, 409, 'conflict', cause.message);
  if (cause instanceof InterlockError)
    return failure(c, 400, 'invalid_request', cause.message);
  throw error;
}

/**
 * Plain JSON routes for scripts and ordinary HTTP clients. Every route calls
 * the same router procedures as the UI, CLI and MCP, so validation and
 * execution rules are shared; this module only maps shapes and statuses.
 */
export function createHttpApi(
  engine: Engine,
  connection: ConnectionConfig | undefined,
) {
  const api = new Hono();
  const caller = (c: Context) =>
    appRouter.createCaller({ engine, connection, signal: c.req.raw.signal });
  const missingRun = (c: Context) =>
    engine.store.currentRun(c.req.param('id')!)
      ? undefined
      : failure(c, 404, 'not_found', 'Run not found');
  const status = async (c: Context, id: string) => {
    const { run } = await caller(c).runs.briefing({ id, limit: 1 });
    return {
      runId: run.id,
      workflowId: run.workflowId,
      version: run.version,
      status: run.status,
      stage: run.stage,
      waiting: run.waiting,
      actor: run.actor,
      ...(run.title !== undefined ? { title: run.title } : {}),
      ...(run.tags !== undefined ? { tags: run.tags } : {}),
      ...(run.startRequestId !== undefined
        ? { requestId: run.startRequestId }
        : {}),
      ...(run.error !== undefined ? { error: run.error } : {}),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  };

  api.get('/workflows', async (c) => {
    try {
      const catalog = await caller(c).workflows.catalog();
      const archived = new Set(
        catalog.filter((w) => w.archived).map((w) => w.id),
      );
      const items = catalog
        .filter(
          (w) =>
            w.latestVersion > 0 &&
            !archived.has(w.id) &&
            !(w.ownerWorkflowId && archived.has(w.ownerWorkflowId)),
        )
        .map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          ownerWorkflowId: w.ownerWorkflowId,
          latestVersion: w.latestVersion,
          // A deleted latest version has no retained contract to report.
          inputSchema:
            engine.store.getVersion(w.id, w.latestVersion)?.definition
              .inputSchema ?? null,
        }));
      return c.json({ items });
    } catch (error) {
      return rejection(c, error);
    }
  });

  api.post('/runs', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return failure(c, 400, 'invalid_request', 'Body must be JSON');
    }
    const parsed = startBody.safeParse(body);
    if (!parsed.success)
      return failure(c, 400, 'invalid_request', 'Invalid request', {
        issues: issues(parsed.error),
      });
    const key = c.req.header('idempotency-key');
    if (
      key !== undefined &&
      parsed.data.requestId !== undefined &&
      key !== parsed.data.requestId
    )
      return failure(
        c,
        400,
        'invalid_request',
        'Idempotency-Key and requestId differ; send one of them',
      );
    if (!engine.store.get('workflows', parsed.data.workflowId))
      return failure(c, 404, 'not_found', 'Workflow not found');
    try {
      const started = await caller(c).runs.startSummary({
        ...parsed.data,
        ...(key !== undefined ? { requestId: key } : {}),
        limit: 1,
      });
      c.header('Location', `/api/runs/${started.runId}`);
      const cost =
        'costProjection' in started
          ? { costProjection: started.costProjection }
          : {};
      return c.json({ ...(await status(c, started.runId)), ...cost }, 202);
    } catch (error) {
      return rejection(c, error);
    }
  });

  api.get('/runs/:id', async (c) => {
    try {
      return missingRun(c) ?? c.json(await status(c, c.req.param('id')));
    } catch (error) {
      return rejection(c, error);
    }
  });

  api.get('/runs/:id/result', async (c) => {
    const missing = missingRun(c);
    if (missing) return missing;
    const id = c.req.param('id');
    const query = resultQuery.safeParse(c.req.query());
    if (!query.success)
      return failure(c, 400, 'invalid_request', 'Invalid request', {
        issues: issues(query.error),
      });
    try {
      const run = await status(c, id);
      if (run.status !== 'completed')
        return failure(
          c,
          409,
          'run_not_completed',
          `Run is ${run.status}; a result exists only after it completes`,
          { run },
        );
      const { value, path, bytes } = await caller(c).runs.result({
        id,
        ...query.data,
      });
      return c.json({ runId: id, path, bytes, value });
    } catch (error) {
      return rejection(c, error);
    }
  });

  api.post('/runs/:id/cancel', async (c) => {
    const missing = missingRun(c);
    if (missing) return missing;
    const id = c.req.param('id');
    try {
      await caller(c).runs.cancel({ id });
      return c.json(await status(c, id));
    } catch (error) {
      return rejection(c, error);
    }
  });

  // Pull launcher clients: the profile credential travels in its own header
  // because Authorization carries the API token when one is required.
  const launcherCall = async (
    c: Context,
    call: (
      launcher: ReturnType<typeof caller>['launcher'],
      input: Record<string, unknown>,
    ) => Promise<unknown>,
  ) => {
    let body: unknown = {};
    try {
      const raw = await c.req.text();
      if (raw.trim()) body = JSON.parse(raw);
    } catch {
      return failure(c, 400, 'invalid_request', 'Body must be JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return failure(c, 400, 'invalid_request', 'Body must be a JSON object');
    try {
      const input = {
        ...body,
        profileId: c.req.param('profileId'),
        credential: c.req.header('x-interlock-launcher-credential') ?? '',
        ...(c.req.param('operationId')
          ? { operationId: c.req.param('operationId') }
          : {}),
      };
      return c.json(await call(caller(c).launcher, input));
    } catch (error) {
      return rejection(c, error);
    }
  };
  api.post('/launchers/:profileId/poll', (c) =>
    launcherCall(c, (launcher, input) => launcher.poll(input as never)),
  );
  api.post('/launchers/:profileId/operations/:operationId/complete', (c) =>
    launcherCall(c, (launcher, input) => launcher.complete(input as never)),
  );
  api.post('/launchers/:profileId/operations/:operationId/fail', (c) =>
    launcherCall(c, (launcher, input) => launcher.fail(input as never)),
  );

  // Keep unknown API paths out of the UI's fallback page.
  api.all('*', (c) => failure(c, 404, 'not_found', 'Unknown API route'));
  return api;
}
