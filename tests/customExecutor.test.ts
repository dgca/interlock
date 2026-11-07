import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  executorProfileSchema,
  type Json,
  InterlockError,
} from '@interlock/core';
import { nativeAdapters } from '../packages/runtime/src/executors/native';

const engines: Engine[] = [];
const dirs: string[] = [];
const referenceFixture = resolve(
  __dirname,
  '../packages/runtime/test/fixtures/custom-harness-reference.js',
);

const create = (path = ':memory:') => {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
};

afterEach(async () => {
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function workflow(
  e: Engine,
  executor?: string,
  extra: Record<string, unknown> = {},
) {
  const d = blankDefinition();
  d.executor = executor;
  const node = d.nodes.find((n) => n.kind === 'agent')!;
  Object.assign(node, extra);
  const w = e.create('Custom Harness Workflow', '', definitionSchema.parse(d));
  e.publish(w.id);
  return w;
}

it('saves and lists custom harness profiles with direct and launcher modes', async () => {
  const e = create();
  const directProfile = e.executors.saveProfile({
    id: 'my-custom-direct',
    harness: 'custom',
    name: 'Custom Direct CLI',
    enabled: true,
    expectedRevision: 0,
    mode: 'direct',
    transport: 'subprocess',
    turnCommand: `node ${referenceFixture} --turn`,
    timeoutSeconds: 60,
    env: { AGENT_MODE: 'test' },
  });

  expect(directProfile.id).toBe('my-custom-direct');
  expect(directProfile.harness).toBe('custom');
  expect(directProfile.mode).toBe('direct');
  expect(directProfile.revision).toBe(1);

  const launcherProfile = e.executors.saveProfile({
    id: 'my-custom-launcher',
    harness: 'custom',
    name: 'Custom Launcher Daemon',
    enabled: true,
    expectedRevision: 0,
    mode: 'launcher',
    transport: 'subprocess',
    launchCommand: `node ${referenceFixture} launch`,
    statusCommand: `node ${referenceFixture} status`,
    archiveCommand: `node ${referenceFixture} archive`,
  });

  expect(launcherProfile.id).toBe('my-custom-launcher');
  expect(launcherProfile.mode).toBe('launcher');

  const profiles = e.executors.profiles();
  expect(profiles.some((p) => p.id === 'my-custom-direct')).toBe(true);
  expect(profiles.some((p) => p.id === 'my-custom-launcher')).toBe(true);
});

it('executes direct turn mode via subprocess CLI and submits result envelope', async () => {
  const e = create();
  e.executors.saveProfile({
    id: 'custom-cli',
    harness: 'custom',
    name: 'Custom Direct CLI',
    enabled: true,
    expectedRevision: 0,
    mode: 'direct',
    transport: 'subprocess',
    turnCommand: `node ${referenceFixture} --turn`,
  });

  e.executors.start(nativeAdapters);

  const w = workflow(e, 'custom-cli');
  const run = e.start(w.id, { testInput: 'hello from interlock' }).run;

  await vi.waitFor(
    () => {
      const currentRun = e.run(run.id);
      expect(currentRun.status).toBe('completed');
    },
    { timeout: 8000 },
  );

  const finalRun = e.run(run.id);
  expect(finalRun.status).toBe('completed');
  const agentExecution = finalRun.executions.find((x) => x.nodeId === 'agent');
  expect(agentExecution?.output).toBeDefined();
  const output = agentExecution?.output as any;
  expect(output.handled).toBe(true);
  expect(output.echo).toEqual({ testInput: 'hello from interlock' });
});

it('executes direct turn mode via HTTP POST and handles result envelope', async () => {
  let receivedPayload: any = null;
  const server = createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        receivedPayload = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            output: { httpHandled: true, echoed: receivedPayload.input },
            sessionId: 'http-session-99',
            model: 'remote-http-agent',
            usage: [
              {
                provider: 'http-provider',
                model: 'remote-http-agent',
                inputTokens: 50,
                outputTokens: 75,
              },
            ],
          }),
        );
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as any;
  const port = address.port;

  try {
    const e = create();
    e.executors.saveProfile({
      id: 'custom-http',
      harness: 'custom',
      name: 'Custom HTTP Agent',
      enabled: true,
      expectedRevision: 0,
      mode: 'direct',
      transport: 'http',
      turnUrl: `http://127.0.0.1:${port}/api/turn`,
    });

    e.executors.start(nativeAdapters);

    const w = workflow(e, 'custom-http');
    const run = e.start(w.id, { payloadMsg: 'network agent test' }).run;

    await vi.waitFor(
      () => {
        const currentRun = e.run(run.id);
        expect(currentRun.status).toBe('completed');
      },
      { timeout: 8000 },
    );

    expect(receivedPayload).toBeDefined();
    expect(receivedPayload.input).toEqual({
      payloadMsg: 'network agent test',
    });

    const finalRun = e.run(run.id);
    const agentExecution = finalRun.executions.find(
      (x) => x.nodeId === 'agent',
    );
    expect(agentExecution?.output).toEqual({
      httpHandled: true,
      echoed: { payloadMsg: 'network agent test' },
    });
  } finally {
    server.close();
  }
});

it('dispatches delegated launcher mode, enforces claim ticket, supports idempotency and archives on completion', async () => {
  const e = create();
  e.executors.saveProfile({
    id: 'custom-launcher',
    harness: 'custom',
    name: 'Custom Launcher Daemon',
    enabled: true,
    expectedRevision: 0,
    mode: 'launcher',
    transport: 'subprocess',
    launchCommand: `node ${referenceFixture} launch`,
    statusCommand: `node ${referenceFixture} status`,
    archiveCommand: `node ${referenceFixture} archive`,
  });

  e.executors.start(nativeAdapters);

  const w = workflow(e, 'custom-launcher');
  const run = e.start(w.id, { task: 'delegated work' }).run;

  // Wait until launcher runs and ticket is issued
  let availableWork: any;
  await vi.waitFor(
    () => {
      const items = e.available(run.id);
      expect(items.length).toBeGreaterThan(0);
      availableWork = items[0];
      const managed = (e.executors as any).claimTickets.get(availableWork.id);
      expect(managed).toBeDefined();
      expect(managed.ticket).toBeDefined();
    },
    { timeout: 5000 },
  );

  const ticketRecord = (e.executors as any).claimTickets.get(availableWork.id);
  const legitimateTicket = ticketRecord.ticket;

  // Rogue claim attempt without ticket must be rejected
  expect(() =>
    e.claim(availableWork.id, {
      workerId: 'rogue-worker',
      freshContext: true,
      tools: [],
      skills: [],
    }),
  ).toThrowError(/claim ticket is required/i);

  // Rogue claim attempt with invalid ticket must be rejected
  expect(() =>
    e.claim(availableWork.id, {
      workerId: 'rogue-worker',
      freshContext: true,
      tools: [],
      skills: [],
      claimTicket: 'invalid-ticket-12345',
    }),
  ).toThrowError(/invalid claim ticket/i);

  // Legitimate claimant presenting the claimTicket succeeds
  const claimed = e.claim(availableWork.id, {
    workerId: 'launched-agent-daemon',
    freshContext: true,
    tools: [],
    skills: [],
    claimTicket: legitimateTicket,
  });

  expect(claimed.status).toBe('claimed');
  expect(claimed.workerId).toBe('launched-agent-daemon');

  // Submit result from the launched session
  e.submit(claimed.id, claimed.token!, {
    completedByDaemon: true,
    ticketUsed: legitimateTicket,
  });

  await vi.waitFor(
    () => {
      const currentRun = e.run(run.id);
      expect(currentRun.status).toBe('completed');
    },
    { timeout: 5000 },
  );

  const finalRun = e.run(run.id);
  expect(finalRun.status).toBe('completed');
});

it('blocks dynamic cwd binding if resolving outside profile allowedRoots', async () => {
  const allowedDir = mkdtempSync(join(tmpdir(), 'allowed-'));
  const forbiddenDir = mkdtempSync(join(tmpdir(), 'forbidden-'));
  dirs.push(allowedDir, forbiddenDir);

  const e = create();
  e.executors.saveProfile({
    id: 'restricted-custom',
    harness: 'custom',
    name: 'Restricted Custom',
    enabled: true,
    expectedRevision: 0,
    mode: 'direct',
    transport: 'subprocess',
    cwd: allowedDir,
    allowedRoots: [allowedDir],
    turnCommand: `node ${referenceFixture} --turn`,
  });

  e.executors.start(nativeAdapters);

  // Create workflow that resolves cwd outside allowedRoots
  const w = workflow(e, 'restricted-custom', { cwd: forbiddenDir });
  const run = e.start(w.id, {}).run;

  await vi.waitFor(() => {
    const allWork = e.store.work();
    const workItem = allWork.find((w) => w.runId === run.id);
    expect(workItem?.cwdBlocked).toBeDefined();
    expect(workItem?.cwdBlocked?.reason).toContain('outside allowed roots');
  });
});

it('preserves delegated launch and one-time ticket rules across independent pause holds', async () => {
  let launched: { workId: string; claimTicket: string } | undefined;
  let launches = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      launches++;
      launched = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId: 'paused-launcher-session' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No listener');
  const e = create();
  try {
    e.executors.saveProfile({
      id: 'paused-launcher',
      harness: 'custom',
      name: 'Paused launcher',
      enabled: true,
      expectedRevision: 0,
      mode: 'launcher',
      transport: 'http',
      launchUrl: `http://127.0.0.1:${address.port}/launch`,
    });
    e.executors.start(nativeAdapters);
    const w = workflow(e, 'paused-launcher');
    const library = e.pauses.create({
      target: { scope: 'library' },
      actor: 'deploy',
      reason: 'Before dispatch',
    });
    const run = e.start(w.id, null).run;
    expect(e.run(run.id).executions).toHaveLength(0);
    expect(e.available(run.id)).toEqual([]);
    expect(launches).toBe(0);
    e.pauses.resume(library.id);
    e.pump();
    await vi.waitFor(() => expect(launched?.claimTicket).toBeTruthy(), {
      timeout: 5000,
    });
    const workId = launched!.workId,
      claimTicket = launched!.claimTicket;
    // Wait for the successful launch response to become claimable.
    await vi.waitFor(() =>
      expect(e.inspect(run.id).work[0].managedExecution?.state).toBe('running'),
    );
    const local = e.pauses.create({
      target: { scope: 'workflow', workflowId: w.id },
      actor: 'incident',
      reason: 'After launch',
    });
    expect(() =>
      e.claim(workId, {
        workerId: 'delegated',
        freshContext: true,
        tools: [],
        skills: [],
        claimTicket,
      }),
    ).toThrow(/paused/);
    expect(e.store.get<any>('work', workId).attempt).toBe(0);
    e.pauses.resume(local.id);
    e.pump();
    expect(() =>
      e.claim(workId, {
        workerId: 'rogue',
        freshContext: true,
        tools: [],
        skills: [],
      }),
    ).toThrow(/claim ticket is required/i);
    const claimed = e.claim(workId, {
      workerId: 'delegated',
      freshContext: true,
      tools: [],
      skills: [],
      claimTicket,
    });
    e.submit(workId, claimed.token!, { done: true });
    expect(e.run(run.id).status).toBe('completed');
    expect(launches).toBe(1);
  } finally {
    await e.executors.stop();
    const closed = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    server.closeAllConnections();
    await closed;
  }
});
