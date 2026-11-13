// Crash-recovery check for the packed package: start the installed server,
// SIGKILL it while a foreground Script, a background Script and a managed
// Agent attempt are running, restart it on the same temporary database and
// assert the documented recovery state of each.
// Requires a completed `pnpm build`. Uses only temporary data.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const harnessFixture = fileURLToPath(
  new URL('../tests/fixtures/kill-harness.mjs', import.meta.url),
);
const temp = await mkdtemp(join(tmpdir(), 'interlock-kill-'));
const files = {
  db: join(temp, 'data/interlock.db'),
  harnessLog: join(temp, 'harness.log'),
  foregroundStarts: join(temp, 'foreground-starts'),
  backgroundStarts: join(temp, 'background-starts'),
  backgroundRelease: join(temp, 'background-release'),
};
let server;
let client;
let logs = '';
const orphans = new Set();

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const killQuietly = (pid, signal = 'SIGKILL') => {
  try {
    process.kill(pid, signal);
  } catch {}
};
const lines = async (path) =>
  existsSync(path)
    ? (await readFile(path, 'utf8')).split('\n').filter(Boolean)
    : [];
// Resolves with the first truthy result; an empty array counts as not ready.
async function until(label, check, attempts = 200, interval = 50) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await check();
    if (Array.isArray(value) ? value.length : value) return value;
    await delay(interval);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  const [packed] = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', temp],
      { encoding: 'utf8' },
    ),
  );
  const prefix = join(temp, 'install');
  execFileSync(
    'npm',
    [
      'install',
      '--global',
      '--prefix',
      prefix,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(temp, packed.filename),
    ],
    { stdio: 'pipe' },
  );
  const bin = join(prefix, 'bin/interlock');
  const workdir = join(temp, 'work');
  await mkdir(workdir);
  const env = { ...process.env };
  delete env.INTERLOCK_DB;
  delete env.INTERLOCK_URL;
  Object.assign(env, {
    PATH: `${join(prefix, 'bin')}:${process.env.PATH}`,
    INTERLOCK_SECRET_KEY_FILE: join(temp, 'secret.key'),
    INTERLOCK_KILL_TEST_HARNESS_LOG: files.harnessLog,
  });
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const url = `http://127.0.0.1:${port}`;

  const start = async () => {
    server = spawn(bin, ['--port', String(port), '--db', files.db], {
      cwd: workdir,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (chunk) => (logs += chunk));
    server.stderr.on('data', (chunk) => (logs += chunk));
    await until(
      'server health',
      async () => {
        if (server.exitCode !== null) throw new Error('Server exited');
        return fetch(`${url}/health`)
          .then((r) => r.ok)
          .catch(() => false);
      },
      150,
      100,
    );
    client = new Client({ name: 'kill-recovery', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${url}/mcp`)),
    );
  };
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert(!response.isError, `${name}: ${JSON.stringify(response)}`);
    return JSON.parse(response.content[0].text);
  };
  const scriptWorkflow = async (name, executionMode, command) => {
    const workflow = await call('create_workflow', {
      name,
      definition: {
        nodes: [
          { id: 'entry', kind: 'entry', label: 'Input' },
          {
            id: 'script',
            kind: 'script',
            label: name,
            language: 'javascript',
            executionMode,
            timeoutMs: 120000,
            command,
          },
          { id: 'exit', kind: 'exit', label: 'Output' },
        ],
        edges: [
          { id: 'a', source: 'entry', target: 'script' },
          { id: 'b', source: 'script', target: 'exit' },
        ],
      },
    });
    await call('publish_workflow', { id: workflow.id });
    return (await call('start_run', { workflowId: workflow.id, input: null }))
      .runId;
  };
  const inspectManaged = async (workId) =>
    (
      await call('manage_executors', {
        request: { action: 'inspect', workId },
      })
    ).items;

  await start();

  // Foreground Script: server-owned process, never replayed after a crash.
  const foregroundRunId = await scriptWorkflow(
    'Kill foreground',
    'foreground',
    `require('node:fs').appendFileSync(${JSON.stringify(files.foregroundStarts)}, process.pid + '\\n'); await new Promise((r) => setTimeout(r, 110000)); return { finished: true };`,
  );
  // Background Script: supervisor survives the crash; it finishes only once
  // released, which happens while the server is down.
  const backgroundRunId = await scriptWorkflow(
    'Kill background',
    'background',
    `const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(files.backgroundStarts)}, process.pid + ' ' + process.ppid + '\\n'); while (!fs.existsSync(${JSON.stringify(files.backgroundRelease)})) await new Promise((r) => setTimeout(r, 50)); return { recovered: true };`,
  );
  // Managed attempt: a fake claude-code harness whose turn never ends.
  await call('manage_executors', {
    request: {
      action: 'save',
      profile: {
        id: 'claude-code',
        harness: 'claude-code',
        name: 'Kill test harness',
        enabled: true,
        command: harnessFixture,
        model: 'wait',
        expectedRevision: 0,
      },
    },
  });
  const managed = await call('create_workflow', { name: 'Kill managed' });
  await call('update_workflow', {
    id: managed.id,
    draft: { ...managed.draft, executor: 'claude-code' },
    draftRevision: managed.draftRevision,
  });
  await call('publish_workflow', { id: managed.id });
  const managedRunId = (
    await call('start_run', { workflowId: managed.id, input: { test: true } })
  ).runId;
  const [managedWork] = await call('list_work', { runId: managedRunId });
  assert(managedWork, 'Managed run did not create an assignment');

  // Wait until all three are demonstrably mid-run.
  const [foregroundPid] = (
    await until('foreground Script start', () => lines(files.foregroundStarts))
  ).map(Number);
  orphans.add(foregroundPid);
  await until('foreground Script running', async () => {
    const { run } = await call('get_run', { id: foregroundRunId });
    return (
      run.status === 'running' &&
      run.executions.some(
        (step) => step.kind === 'script' && step.status === 'running',
      )
    );
  });
  const backgroundExecutionId = await until(
    'background Script running',
    async () => {
      const { run } = await call('get_run', { id: backgroundRunId });
      const step = run.executions.find((s) => s.kind === 'script');
      if (!step) return;
      const state = await call('manage_script', {
        request: {
          action: 'inspect',
          runId: backgroundRunId,
          executionId: step.id,
        },
      });
      return state.background?.state === 'running' && step.id;
    },
  );
  const [backgroundPid] = (
    await until('background Script start', () => lines(files.backgroundStarts))
  )[0]
    .split(' ')
    .map(Number);
  const managedBefore = await until('managed attempt', async () => {
    const [item] = await inspectManaged(managedWork.id);
    if (item?.state === 'needs_human' && item.requests?.[0]) {
      // Approve the fixture's tool request so the turn keeps running.
      await call('manage_executors', {
        request: {
          action: 'respond',
          executionId: item.id,
          requestId: item.requests[0].id,
          answer: { allow: true },
        },
      });
      return;
    }
    return item?.state === 'running' && item;
  });
  const harnessTurns = async () =>
    (await lines(files.harnessLog))
      .map((line) => JSON.parse(line))
      .filter((entry) => !entry.argv.includes('--version'));
  const turnsBefore = await until('managed harness launch', harnessTurns);
  for (const { pid } of turnsBefore) orphans.add(pid);

  // Crash: SIGKILL only the server process, as an abrupt process death would.
  const exited = once(server, 'exit');
  process.kill(server.pid, 'SIGKILL');
  const [, signal] = await exited;
  assert.equal(signal, 'SIGKILL');
  await client.close().catch(() => {});
  client = undefined;
  assert(alive(backgroundPid), 'Background Script did not survive the crash');
  await writeFile(files.backgroundRelease, '');
  await until(
    'background Script to finish offline',
    () => !alive(backgroundPid),
    200,
    50,
  );

  await start();

  // Foreground Script: restart marks the interrupted execution failed and the
  // run terminal; nothing replays it.
  const foreground = await call('get_run', { id: foregroundRunId });
  assert.equal(foreground.run.status, 'failed', JSON.stringify(foreground.run));
  const foregroundSteps = foreground.run.executions.filter(
    (step) => step.kind === 'script',
  );
  assert.equal(foregroundSteps.length, 1);
  assert.equal(foregroundSteps[0].status, 'failed');
  assert.match(
    JSON.stringify(foregroundSteps[0]),
    /Service interrupted during script execution/,
  );

  // Background Script: reconnects to the same execution, recovers the
  // supervisor's authenticated receipt and completes exactly once.
  const background = await until('background recovery', async () => {
    const result = await call('get_run', { id: backgroundRunId });
    return result.run.status === 'completed' && result;
  });
  assert.deepEqual(background.run.output, { recovered: true });
  const backgroundSteps = background.run.executions.filter(
    (step) => step.kind === 'script',
  );
  assert.equal(backgroundSteps.length, 1);
  assert.equal(backgroundSteps[0].id, backgroundExecutionId);
  assert.equal((await lines(files.backgroundStarts)).length, 1);

  // Managed attempt: treated as uncertain. The attempt is interrupted, the
  // assignment held and the run waiting; no new attempt starts.
  const [interrupted] = await until('managed interruption', async () => {
    const items = await inspectManaged(managedWork.id);
    return items[0]?.state === 'interrupted' && items;
  });
  assert.equal(interrupted.id, managedBefore.id);
  const managedAfter = await call('get_run', { id: managedRunId });
  assert.equal(managedAfter.run.status, 'waiting');
  const heldWork = managedAfter.work.find((w) => w.id === managedWork.id);
  assert.equal(heldWork?.status, 'held', JSON.stringify(managedAfter.work));

  // Give the restarted engine time to (wrongly) replay anything.
  await delay(1500);
  assert.equal((await lines(files.foregroundStarts)).length, 1);
  assert.equal((await harnessTurns()).length, turnsBefore.length);
  assert.equal((await inspectManaged(managedWork.id)).length, 1);
  assert.equal(
    (await call('get_run', { id: foregroundRunId })).run.status,
    'failed',
  );

  // Operator recovery: stop the orphaned harness, confirm, and a fresh attempt
  // starts on the same assignment.
  for (const { pid } of turnsBefore) killQuietly(pid);
  await until('orphaned harness exit', () =>
    turnsBefore.every(({ pid }) => !alive(pid)),
  );
  await call('manage_executors', {
    request: {
      action: 'reconcile',
      executionId: interrupted.id,
      confirmStopped: true,
    },
  });
  await until('fresh managed attempt', async () => {
    const turns = await harnessTurns();
    for (const { pid } of turns) orphans.add(pid);
    return turns.length > turnsBefore.length;
  });
  await call('cancel_run', { id: managedRunId });

  console.log(
    'Packed server SIGKILL recovery passed: foreground Script failed without replay, background Script recovered once, managed attempt held as interrupted until confirmed stopped.',
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await client?.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    killQuietly(-server.pid, 'SIGTERM');
    const stopped = await Promise.race([
      exited.then(() => true),
      delay(10000).then(() => false),
    ]);
    if (!stopped) killQuietly(-server.pid, 'SIGKILL');
  }
  // Every Script, supervisor and harness PID recorded on disk, so processes
  // started before an early failure are still stopped.
  const recorded = async (path) =>
    (await lines(path).catch(() => [])).flatMap((line) =>
      line.split(' ').map(Number),
    );
  for (const pid of await recorded(files.foregroundStarts)) orphans.add(pid);
  // Background lines hold the Script PID and its supervisor's PID.
  for (const pid of await recorded(files.backgroundStarts)) orphans.add(pid);
  for (const entry of await lines(files.harnessLog).catch(() => [])) {
    try {
      orphans.add(JSON.parse(entry).pid);
    } catch {}
  }
  for (const pid of orphans)
    if (Number.isInteger(pid) && pid > 1) killQuietly(pid);
  await rm(temp, { recursive: true, force: true });
}
