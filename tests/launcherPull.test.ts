import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, definitionSchema } from '@interlock/core';
import { nativeAdapters } from '../packages/runtime/src/executors/native';

const engines: Engine[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await close(e);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function close(e: Engine) {
  await e.executors.stop();
  e.stop();
  e.store.close();
}

function setup(path = ':memory:', existing = false) {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  if (!existing)
    e.executors.saveProfile({
      id: 'plugin',
      harness: 'custom',
      name: 'Desktop plugin',
      enabled: true,
      expectedRevision: 0,
      mode: 'launcher',
      transport: 'pull',
      clientTimeoutSeconds: 5,
    });
  e.executors.start(nativeAdapters);
  return e;
}
function start(e: Engine) {
  const d = blankDefinition();
  d.executor = 'plugin';
  const w = e.create('Pull launcher', '', definitionSchema.parse(d));
  e.publish(w.id);
  return e.start(w.id, { task: 'pull' }).run;
}
const pull = (e: Engine) => e.executors.launcher.pull;
const rejection = (call: () => unknown) => {
  try {
    call();
  } catch (error) {
    return (error as { code?: string }).code;
  }
};
const operations = (e: Engine) =>
  e.store.list<{ id: string; kind: string; state: string }>(
    'launcherOperations',
  );

it('leases a launch to the credentialed client and accepts its result once', async () => {
  const e = setup();
  const { credential } = pull(e).rotateCredential({ profileId: 'plugin' });
  const listed = JSON.stringify(await e.executors.listProfiles());
  expect(listed).not.toContain(credential);
  const run = start(e);
  const client = { profileId: 'plugin', credential, clientId: 'plugin-1' };

  await expect(
    pull(e).poll({ ...client, credential: credential + 'x', waitMs: 0 }),
  ).rejects.toMatchObject({ code: 'launcher_credential_invalid' });
  const { operations: leased } = await pull(e).poll({
    ...client,
    waitMs: 5000,
  });
  expect(leased).toHaveLength(1);
  const [launch] = leased;
  expect(launch.kind).toBe('launch');
  expect(launch.payload.runId).toBe(run.id);
  expect(typeof launch.payload.idempotencyKey).toBe('string');
  expect(typeof launch.payload.claimTicket).toBe('string');
  const work = e.available(run.id)[0];
  expect(e.executors.inspect(work.id).items[0].state).toBe('starting');
  // Launch payloads carry claim tickets and are never written to storage.
  expect(JSON.stringify(operations(e))).not.toContain(
    launch.payload.claimTicket as string,
  );

  const done = {
    profileId: 'plugin',
    credential,
    operationId: launch.operationId,
    leaseToken: launch.leaseToken,
    result: {
      sessionHandle: 'app-session-1',
      deepLink: 'https://app.example/s/1',
    },
  };
  expect(
    rejection(() => pull(e).complete({ ...done, leaseToken: 'someone-else' })),
  ).toBe('launcher_lease_invalid');
  expect(pull(e).complete(done)).toMatchObject({ late: false });
  expect(rejection(() => pull(e).complete(done))).toBe(
    'launcher_operation_not_found',
  );
  await vi.waitFor(() =>
    expect(e.executors.inspect(work.id).items[0]).toMatchObject({
      state: 'running',
      sessionId: 'app-session-1',
      deepLink: 'https://app.example/s/1',
    }),
  );
  const claimed = e.claim(work.id, {
    workerId: 'app-session-1',
    freshContext: true,
    tools: [],
    skills: [],
    claimTicket: launch.payload.claimTicket as string,
  });
  expect(claimed.token).toBeTruthy();
});

it('returns an expired lease to the queue with the same launch and rejects the old lease', async () => {
  const e = setup();
  const { credential } = pull(e).rotateCredential({ profileId: 'plugin' });
  const run = start(e);
  const client = { profileId: 'plugin', credential, clientId: 'plugin-1' };
  const first = (await pull(e).poll({ ...client, waitMs: 5000 })).operations[0];
  // The client died holding the lease.
  const [stored] = operations(e);
  e.store.put('launcherOperations', {
    ...stored,
    leaseUntil: new Date(Date.now() - 1).toISOString(),
  });
  const second = (await pull(e).poll({ ...client, waitMs: 0 })).operations[0];
  expect(second.operationId).toBe(first.operationId);
  expect(second.payload).toEqual(first.payload);
  expect(second.leaseToken).not.toBe(first.leaseToken);
  const result = { sessionHandle: 'deduplicated-session' };
  expect(
    rejection(() =>
      pull(e).complete({
        profileId: 'plugin',
        credential,
        operationId: first.operationId,
        leaseToken: first.leaseToken,
        result,
      }),
    ),
  ).toBe('launcher_lease_invalid');
  pull(e).complete({
    profileId: 'plugin',
    credential,
    operationId: second.operationId,
    leaseToken: second.leaseToken,
    result,
  });
  const work = e.available(run.id)[0];
  await vi.waitFor(() =>
    expect(e.executors.inspect(work.id).items[0].state).toBe('running'),
  );
  expect(e.executors.inspect(work.id).total).toBe(1);
});

it('keeps work unclaimed while no client polls and allows one active client', async () => {
  const e = setup();
  const { credential } = pull(e).rotateCredential({ profileId: 'plugin' });
  const run = start(e);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  expect(operations(e)).toEqual([]);
  const managed = e.inspect(run.id).work[0].managedExecution;
  expect(managed?.reason).toContain('launcher_client_offline');
  expect(managed?.state).toBe('blocked');
  const client = { profileId: 'plugin', credential, waitMs: 0 };
  await pull(e).poll({ ...client, clientId: 'plugin-1' });
  await expect(
    pull(e).poll({ ...client, clientId: 'plugin-2' }),
  ).rejects.toMatchObject({ code: 'launcher_client_conflict' });
});

it('keeps cleanup across a restart and turns a late launch result into a stop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-pull-'));
  dirs.push(dir);
  const path = join(dir, 'interlock.db');
  const e = setup(path);
  const { credential } = pull(e).rotateCredential({ profileId: 'plugin' });
  start(e);
  const client = { profileId: 'plugin', credential, clientId: 'plugin-1' };
  const launch = (await pull(e).poll({ ...client, waitMs: 5000 }))
    .operations[0];
  engines.splice(engines.indexOf(e), 1);
  await close(e);

  const restarted = setup(path, true);
  const workId = launch.payload.workId as string;
  expect(restarted.executors.inspect(workId).items[0].state).toBe(
    'interrupted',
  );
  expect(operations(restarted)).toMatchObject([{ state: 'abandoned' }]);
  expect(
    pull(restarted).complete({
      profileId: 'plugin',
      credential,
      operationId: launch.operationId,
      leaseToken: launch.leaseToken,
      result: { sessionHandle: 'orphan' },
    }),
  ).toMatchObject({ late: true });
  const stop = (await pull(restarted).poll({ ...client, waitMs: 0 }))
    .operations[0];
  expect(stop).toMatchObject({
    kind: 'stop',
    payload: { workId, sessionId: 'orphan' },
  });
});
