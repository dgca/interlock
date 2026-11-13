import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, definitionSchema } from '@interlock/core';
import { nativeAdapters } from '../packages/runtime/src/executors/native';
import * as customCommands from '../packages/runtime/src/executors/custom';
import { HarnessCleanupError } from '../packages/runtime/src/executors/contracts';
import { JsonLog } from '../packages/runtime/src/log';

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

async function launched(id: string, commands: Record<string, string>) {
  const e = create();
  const profile = e.executors.saveProfile({
    id,
    harness: 'custom',
    name: id,
    enabled: true,
    expectedRevision: 0,
    mode: 'launcher',
    transport: 'subprocess',
    launchCommand: 'printf \'{"sessionId":"session"}\'',
    ...commands,
  });
  const run = e.start(workflow(e, profile.id).id, {}).run;
  const work = e.available(run.id)[0];
  const session = (await (e.executors as any).launchCustom(
    work,
    profile,
    process.cwd(),
    'logical-session',
  )) as { claimTicket: string; archived: boolean };
  return { e, run, work, session };
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

it('projects a busy launcher slot during inspection without parsing the occupying assignment', async () => {
  const e = create();
  const profile = e.executors.saveProfile({
    id: 'inspection-limited-launcher',
    name: 'Inspection limited launcher',
    harness: 'custom',
    enabled: true,
    expectedRevision: 0,
    concurrency: 1,
    mode: 'launcher',
    transport: 'subprocess',
    launchCommand: `node ${referenceFixture} launch`,
  });
  e.executors.start(nativeAdapters);
  const w = workflow(e, profile.id);
  const marker = 'UNRELATED_LIVE_LAUNCH_PAYLOAD';
  const first = e.start(w.id, { payload: marker + 'x'.repeat(4096) });
  await vi.waitFor(() =>
    expect(e.executors.inspect(first.work[0].id).items[0]?.state).toBe(
      'running',
    ),
  );
  const queued = e.start(w.id, { payload: 'selected run' });

  let unrelatedParses = 0;
  const parse = JSON.parse;
  const spy = vi.spyOn(JSON, 'parse').mockImplementation((value, reviver) => {
    if (typeof value === 'string' && value.includes(marker)) unrelatedParses++;
    return parse(value, reviver);
  });
  let result: ReturnType<typeof e.inspect>;
  try {
    result = e.inspect(queued.run.id);
  } finally {
    spy.mockRestore();
  }
  expect(unrelatedParses).toBe(0);
  const reason = 'Waiting for this profile assignment slot';
  expect(result.run.waiting?.detail.message).toBe(reason);
  expect(result.work[0].managedExecution).toMatchObject({
    state: 'queued',
    reason,
  });
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

it.each(['limit', 'cancel'] as const)(
  'rechecks %s and profile occupancy after an awaited launcher response',
  async (change) => {
    const requests: { workId: string; runId: string }[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        requests.push(JSON.parse(body));
        if (requests.length === 1) await pending;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId: `launch-${requests.length}` }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const e = create();
    const scans = vi.spyOn(e.executors as any, 'scan');
    try {
      const base = {
        harness: 'custom' as const,
        name: 'Limited launcher',
        enabled: true,
        expectedRevision: 0,
        mode: 'launcher' as const,
        transport: 'http' as const,
        launchUrl: `http://127.0.0.1:${address.port}/launch`,
      };
      const profile = e.executors.saveProfile({
        ...base,
        id: 'limited-launch',
        concurrency: 2,
      });
      e.executors.saveProfile({ ...base, id: 'other-launch', concurrency: 1 });
      e.executors.start(nativeAdapters);
      const a = workflow(e, 'limited-launch'),
        b = workflow(e, 'other-launch');
      const first = e.start(a.id, {}).run,
        second = e.start(a.id, {}).run,
        other = e.start(b.id, {}).run;
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      if (change === 'limit') {
        const { revision, ...fields } = profile;
        e.executors.saveProfile({
          ...fields,
          expectedRevision: revision,
          concurrency: 1,
        });
      } else e.cancel(second.id);
      release();
      await scans.mock.results[0].value;
      expect(requests.map((r) => r.runId)).toEqual([first.id, other.id]);
      if (change === 'limit') {
        expect(e.available(second.id)[0].managedExecution?.reason).toContain(
          'profile assignment slot',
        );
        e.cancel(first.id);
        await vi.waitFor(() =>
          expect(requests.map((r) => r.runId)).toContain(second.id),
        );
      }
      e.cancel(first.id);
      e.cancel(second.id);
      e.cancel(other.id);
    } finally {
      release();
      await e.executors.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it.each(['library', 'workflow'] as const)(
  'rechecks %s pauses between awaited custom launcher dispatches',
  async (scope) => {
    const requests: { workId: string; runId: string }[] = [];
    let finishFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        requests.push(JSON.parse(body));
        if (requests.length === 1) await firstResponse;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId: `session-${requests.length}` }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No server port');
    const e = create();
    // Observe the real scan promise only to await its boundary deterministically.
    // All admission, transport and launch behavior runs without substitution.
    const scans = vi.spyOn(e.executors as any, 'scan');
    try {
      e.executors.saveProfile({
        id: 'pause-scan-launcher',
        harness: 'custom',
        name: 'Pause scan launcher',
        enabled: true,
        expectedRevision: 0,
        mode: 'launcher',
        transport: 'http',
        launchUrl: `http://127.0.0.1:${address.port}/launch`,
      });
      const firstWorkflow = workflow(e, 'pause-scan-launcher');
      const pausedWorkflow = workflow(e, 'pause-scan-launcher');
      const otherWorkflow = workflow(e, 'pause-scan-launcher');
      e.executors.start(nativeAdapters);
      const first = e.start(firstWorkflow.id, null).run;
      const paused = e.start(pausedWorkflow.id, null).run;
      const other = e.start(otherWorkflow.id, null).run;
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0].runId).toBe(first.id);
      const hold = e.pauses.create({
        target:
          scope === 'library'
            ? { scope }
            : { scope, workflowId: pausedWorkflow.id },
        actor: 'incident',
        reason: 'Pause while the preceding launch response is pending',
      });
      expect(e.available(paused.id)).toEqual([]);
      finishFirst();
      await scans.mock.results[0].value;
      expect(requests.map((r) => r.runId)).toEqual(
        scope === 'library' ? [first.id] : [first.id, other.id],
      );
      expect(e.inspect(first.id).work[0].managedExecution?.state).toBe(
        'running',
      );
      const pending = e.inspect(paused.id).work[0];
      expect(pending.status).toBe('available');
      expect(pending.attempt).toBe(0);
      expect(pending.managedExecution?.state).toBe('queued');
      expect(e.executors.inspect(pending.id).items).toEqual([]);
      e.pauses.resume(hold.id);
      e.pump();
      await vi.waitFor(() => {
        expect(e.inspect(paused.id).work[0].managedExecution?.state).toBe(
          'running',
        );
        expect(e.inspect(other.id).work[0].managedExecution?.state).toBe(
          'running',
        );
      });
      expect(requests).toHaveLength(3);
      expect(new Set(requests.map((r) => r.workId)).size).toBe(3);
    } finally {
      finishFirst();
      await e.executors.stop();
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      server.closeAllConnections();
      await closed;
    }
  },
);

it('keeps a delegated background session alive after its launch command succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'interlock-launch-session-'));
  dirs.push(root);
  const marker = join(root, 'session-alive');
  const child = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'),300)`;
  const script = `process.stdin.resume(); const child = require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'}); child.unref(); console.log(JSON.stringify({sessionId:'background-session'}));`;
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const e = create();
  const profile = e.executors.saveProfile({
    id: 'background-launcher',
    harness: 'custom',
    name: 'Background launcher',
    enabled: true,
    expectedRevision: 0,
    mode: 'launcher',
    transport: 'subprocess',
    launchCommand: `node -e ${quote(script)}`,
  });
  const w = workflow(e, profile.id);
  const run = e.start(w.id, {}).run;
  const offered = e.available(run.id)[0];
  const session = await (e.executors as any).launchCustom(
    offered,
    profile,
    root,
    'logical-session',
  );
  expect(session.sessionId).toBe('background-session');
  await vi.waitFor(() => expect(existsSync(marker)).toBe(true));
});

it.each(['message', 'archive', 'stop', 'status'] as const)(
  'passes literal token data through launcher %s commands',
  async (operation) => {
    const root = mkdtempSync(join(tmpdir(), 'interlock-launch-operation-'));
    dirs.push(root);
    const marker = join(root, 'operation-argument');
    const literal = '$(printf shell-evaluated) `printf also-evaluated` "quote"';
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    const script = `process.stdin.resume(); require('node:fs').writeFileSync(${JSON.stringify(marker)},process.argv[1]); console.log(JSON.stringify({status:'active'}));`;
    const command = `node -e ${quote(script)} "$INTERLOCK_SESSION_ID"`;
    const e = create();
    const session = {
      workId: 'work',
      runId: 'run',
      cwd: root,
      claimTicket: 'ticket',
      sessionId: literal,
      profile: { [operation + 'Command']: command },
    };
    if (operation === 'message')
      await (e.executors as any).sendLauncherMessage(session, 'continue');
    if (operation === 'archive')
      await (e.executors as any).archiveLauncherSession(session);
    if (operation === 'stop')
      await (e.executors as any).stopLauncherSession(session);
    if (operation === 'status')
      await (e.executors as any).pollLauncherStatus(session);
    expect(readFileSync(marker, 'utf8')).toBe(literal);
  },
);

it.each(['status', 'archive', 'message', 'stop'] as const)(
  'preserves launcher uncertainty when %s command cleanup fails',
  async (operation) => {
    const e = create();
    const profile = e.executors.saveProfile({
      id: 'uncertain-launcher',
      harness: 'custom',
      name: 'Uncertain launcher',
      enabled: true,
      expectedRevision: 0,
      mode: 'launcher',
      transport: 'subprocess',
      launchCommand: 'printf \'{"sessionId":"session"}\'',
      [operation + 'Command']: 'exit 0',
    });
    const w = workflow(e, profile.id);
    const run = e.start(w.id, {}).run;
    const work = e.available(run.id)[0];
    const session = await (e.executors as any).launchCustom(
      work,
      profile,
      process.cwd(),
      'logical-session',
    );
    const ticket = session.claimTicket;
    const command = vi
      .spyOn(customCommands, 'executeCustomCommand')
      .mockRejectedValue(new HarnessCleanupError('termination not confirmed'));
    if (operation === 'status')
      await (e.executors as any).pollLauncherStatus(session);
    if (operation === 'archive')
      await (e.executors as any).archiveLauncherSession(session);
    if (operation === 'message')
      await expect(
        (e.executors as any).sendLauncherMessage(session, 'continue'),
      ).rejects.toBeInstanceOf(HarnessCleanupError);
    if (operation === 'stop')
      await expect(
        (e.executors as any).requestLauncherStop(session),
      ).rejects.toBeInstanceOf(HarnessCleanupError);
    expect(e.executors.inspect(work.id).items[0].state).toBe('interrupted');
    expect(session.cleanupFailed).toBe(true);
    expect(() =>
      e.claim(work.id, {
        workerId: 'late remote agent',
        freshContext: false,
        tools: [],
        skills: [],
        claimTicket: ticket,
      }),
    ).toThrow();
    await (e.executors as any).pollLauncherStatus(session);
    (e.executors as any).checkJobs();
    await Promise.resolve();
    expect(command).toHaveBeenCalledTimes(1);
  },
);

it('does not reconcile an interrupted launcher while another command is pending', async () => {
  const { e, work, session } = await launched('pending-launcher', {
    statusCommand: 'exit 0',
  });
  let resolveCommand!: (value: string) => void;
  vi.spyOn(customCommands, 'executeCustomCommand').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveCommand = resolve;
      }),
  );
  const pending = (e.executors as any).pollLauncherStatus(session);
  const record = e.executors.inspect(work.id).items[0];
  (e.executors as any).interrupted(record, 'test cancellation');
  expect(() => e.executors.confirmStopped(record.id, true)).toThrow(
    'still stopping',
  );
  resolveCommand('{"status":"ended"}');
  await pending;
  expect(() => e.executors.confirmStopped(record.id, true)).not.toThrow();
});

it('still requests remote stop after status-command cleanup becomes uncertain', async () => {
  const { e, run, session } = await launched('cancel-uncertain-launcher', {
    statusCommand: 'exit 0',
    stopCommand: 'printf stopped',
  });
  const command = vi
    .spyOn(customCommands, 'executeCustomCommand')
    .mockRejectedValueOnce(new HarnessCleanupError('termination not confirmed'))
    .mockResolvedValue('stopped');
  const logDir = mkdtempSync(join(tmpdir(), 'interlock-log-'));
  dirs.push(logDir);
  e.executors.errors.attach(new JsonLog(logDir));
  await (e.executors as any).pollLauncherStatus(session);
  // Previously discarded: the failure reaches doctor (with a time) and the log.
  const { checks } = await e.doctor();
  expect(checks.find((c) => c.name === 'Scheduler errors')).toMatchObject({
    status: 'warn',
    details: { source: 'launcher status', at: expect.any(String) },
  });
  const log = readFileSync(join(logDir, 'interlock.log'), 'utf8');
  expect(log).toContain('"event":"scheduler.error"');
  e.cancel(run.id);
  (e.executors as any).checkJobs();
  await vi.waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'printf stopped' }),
    ),
  );
});

it('stops an in-flight launch process group before server shutdown finishes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'interlock-stop-launch-'));
  dirs.push(root);
  const ready = join(root, 'ready'),
    marker = join(root, 'after-stop');
  const script = `process.stdin.resume();require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'alive');console.log(JSON.stringify({sessionId:'session'}));},500);`;
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const e = create();
  const profile = e.executors.saveProfile({
    id: 'stop-launcher',
    harness: 'custom',
    name: 'Stop launcher',
    enabled: true,
    expectedRevision: 0,
    mode: 'launcher',
    transport: 'subprocess',
    launchCommand: `node -e ${quote(script)}; :`,
  });
  e.executors.start(nativeAdapters);
  const w = workflow(e, profile.id);
  const run = e.start(w.id, {}).run;
  await vi.waitFor(() => expect(existsSync(ready)).toBe(true));
  await e.executors.stop();
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(existsSync(marker)).toBe(false);
  await vi.waitFor(() =>
    expect(e.executors.inspect(e.available(run.id)[0].id).items[0].state).toBe(
      'interrupted',
    ),
  );
});

it('does not turn a completed archived delegated session into an interruption on shutdown', async () => {
  const { e, work, session } = await launched('completed-launcher', {
    statusCommand: 'printf \'{"status":"ended"}\'',
    archiveCommand: 'exit 0',
  });
  const claimed = e.claim(work.id, {
    workerId: 'remote worker',
    freshContext: false,
    tools: [],
    skills: [],
    claimTicket: session.claimTicket,
  });
  e.submit(claimed.id, claimed.token!, {});
  await (e.executors as any).pollLauncherStatus(session);
  (e.executors as any).checkJobs();
  await vi.waitFor(() =>
    expect((e.executors as any).launcherCommands.size).toBe(0),
  );
  expect(session.archived).toBe(true);
  expect(e.executors.inspect(work.id).items[0].state).toBe('completed');
  await e.executors.stop();
  expect(e.executors.inspect(work.id).items[0].state).toBe('completed');
});

it.each(['direct', 'launcher'] as const)(
  'accepts a successful %s command that does not consume its large stdin payload',
  async (mode) => {
    const e = create();
    const command = `printf '{"output":{"ok":true},"sessionId":"no-stdin-session"}'`;
    const profile = e.executors.saveProfile({
      id: 'no-stdin-' + mode,
      harness: 'custom',
      name: 'No stdin ' + mode,
      enabled: true,
      expectedRevision: 0,
      mode,
      transport: 'subprocess',
      ...(mode === 'direct'
        ? { turnCommand: command }
        : { launchCommand: command }),
    });
    if (mode === 'direct') e.executors.start(nativeAdapters);
    const w = workflow(e, profile.id);
    const run = e.start(w.id, { input: 'x'.repeat(1_000_000) }).run;
    if (mode === 'direct') {
      await vi.waitFor(() => expect(e.run(run.id).status).toBe('completed'));
      expect(e.run(run.id).output).toEqual({ ok: true });
    } else {
      const work = e.available(run.id)[0];
      const session = await (e.executors as any).launchCustom(
        work,
        profile,
        process.cwd(),
        'logical-session',
      );
      expect(session.sessionId).toBe('no-stdin-session');
      expect((e.executors as any).claimTickets.get(work.id)).toBeDefined();
    }
  },
);
