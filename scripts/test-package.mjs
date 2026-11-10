import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const { version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

const temp = await mkdtemp(join(tmpdir(), 'interlock-package-'));
let server;
let client;
let logs = '';
async function stop() {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    process.kill(-server.pid, 'SIGTERM');
    await exited;
  }
}
try {
  const [packed] = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', temp],
      { encoding: 'utf8' },
    ),
  );
  assert(packed.files.some((file) => file.path === 'dist/cli.js'));
  assert(packed.files.some((file) => file.path === 'workflows/sdlc.json'));
  assert(packed.files.some((file) => file.path === 'workflows/evaluate.json'));
  for (const path of [
    'interlock-migrate-workflows/SKILL.md',
    'interlock-migrate-workflows/references/fold-a-branch.md',
    'interlock-compare-workflows/SKILL.md',
    'interlock-compare-workflows/references/evaluate-artifacts.md',
  ]) {
    assert(packed.files.some((file) => file.path === `skill/${path}`));
  }
  assert(
    !packed.files.some(
      (file) =>
        file.path.startsWith('.interlock/') ||
        file.path.startsWith('node_modules/') ||
        file.path.startsWith('docs/research/'),
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
  const env = {
    ...process.env,
    PATH: `${join(prefix, 'bin')}:${process.env.PATH}`,
    INTERLOCK_SECRET_KEY_FILE: join(temp, 'secret.key'),
  };
  assert.equal(
    execFileSync(bin, ['--version'], {
      cwd: workdir,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
    version,
  );
  const futurePath = join(temp, 'future.db');
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const future = new DatabaseSync(futurePath);
  future.exec(
    'CREATE TABLE migrations (version INTEGER PRIMARY KEY); INSERT INTO migrations VALUES (999);',
  );
  future.close();
  const before = await readFile(futurePath);
  const refused = spawnSync(bin, ['--db', futurePath, '--port', String(port)], {
    cwd: workdir,
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /schema 999 is newer/);
  assert(!refused.stdout.includes('Interlock is running'));
  assert.deepEqual(await readFile(futurePath), before);
  const url = `http://127.0.0.1:${port}`;
  const start = async (launch = 'global') => {
    const args = [
      '--port',
      String(port),
      '--db',
      join(temp, 'data/interlock.db'),
    ];
    server = spawn(
      launch === 'global' ? bin : 'npx',
      launch === 'global'
        ? args
        : [
            '--yes',
            '--cache',
            join(temp, 'npm-cache'),
            '--package',
            join(temp, packed.filename),
            '--',
            'interlock',
            ...args,
          ],
      { cwd: workdir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    server.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    server.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(`Server exited: ${logs}`);
      if (
        await fetch(`${url}/health`)
          .then((r) => r.ok)
          .catch(() => false)
      )
        return;
      await delay(100);
    }
    throw new Error(`Server failed to start: ${logs}`);
  };
  await start();
  const html = await fetch(url).then((r) => r.text());
  for (const path of [
    '/workflows',
    '/workflows/example',
    '/runs?tab=history',
    '/runs/example',
  ]) {
    const response = await fetch(`${url}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(await response.text(), html);
  }
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert.match(
    await fetch(new URL(asset, url)).then((r) => r.text()),
    /Connect with MCP/,
  );
  const connection = (
    await fetch(`${url}/trpc/connection`).then((r) => r.json())
  ).result.data;
  assert.equal(connection.mcpUrl, `${url}/mcp`);
  assert.equal(connection.command, 'interlock');
  assert.deepEqual(connection.args, ['mcp']);
  assert.equal(connection.env.INTERLOCK_URL, url);
  assert.equal(connection.development, false);
  const assertInvalidReportBounds = async () => {
    for (const bounds of [
      { since: '2026-11-03T00:00:00+24:00' },
      { until: '9999-12-31T23:59:59-01:00' },
      { since: '9999-12-31T23:59:59.9999Z' },
    ]) {
      const rejected = await client.callTool({
        name: 'workflow_report',
        arguments: bounds,
      });
      assert.equal(rejected.isError, true);
      assert.match(JSON.stringify(rejected.content), /valid datetime/i);
      assert.doesNotMatch(
        JSON.stringify(rejected.content),
        /RangeError|Invalid time value/,
      );
    }
  };
  client = new Client({ name: 'package-smoke', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: bin,
      args: ['mcp'],
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      stderr: 'pipe',
    }),
  );
  assert.equal(client.getServerVersion().version, version);
  assert(
    (await client.listTools()).tools.some((tool) => tool.name === 'claim_work'),
  );
  const stdioWorkflows = await client.callTool({
    name: 'list_workflows',
    arguments: {},
  });
  assert(!stdioWorkflows.isError, JSON.stringify(stdioWorkflows));
  const starters = JSON.parse(stdioWorkflows.content[0].text);
  assert.deepEqual(starters, []);
  await assertInvalidReportBounds();
  await client.close();
  client = new Client({ name: 'package-http-smoke', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(connection.mcpUrl)),
  );
  assert.equal(client.getServerVersion().version, version);
  await assertInvalidReportBounds();
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert(!response.isError, JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  };
  // Exercise the installed bundle's native transports without accounts or models.
  const harnessFixture = fileURLToPath(
    new URL('../tests/fixtures/managed-harness.mjs', import.meta.url),
  );
  for (const harness of ['claude-code', 'codex']) {
    await call('manage_executors', {
      request: {
        action: 'save',
        profile: {
          id: harness,
          harness,
          name: harness,
          enabled: true,
          command: harnessFixture,
          expectedRevision: 0,
        },
      },
    });
    const managed = await call('create_workflow', {
      name: 'Packaged ' + harness,
    });
    const definition = managed.draft;
    definition.executor = harness;
    await call('update_workflow', {
      id: managed.id,
      draft: definition,
      draftRevision: managed.draftRevision,
    });
    await call('publish_workflow', { id: managed.id });
    const run = await call('start_run', {
      workflowId: managed.id,
      input: { test: true },
    });
    let pending;
    for (let attempt = 0; attempt < 100; attempt++) {
      const inspection = await call('get_run', { id: run.runId });
      const assignment = inspection.work[0];
      if (assignment) {
        const detail = await call('manage_executors', {
          request: { action: 'inspect', workId: assignment.id },
        });
        if (detail.items[0]?.state === 'needs_human') {
          pending = detail.items[0];
          break;
        }
      }
      await delay(50);
    }
    assert(pending, 'Packaged ' + harness + ' did not request approval');
    await call('manage_executors', {
      request: {
        action: 'respond',
        executionId: pending.id,
        requestId: pending.requests[0].id,
        answer: { allow: false },
      },
    });
    let finished;
    for (let attempt = 0; attempt < 100; attempt++) {
      finished = await call('get_run', { id: run.runId });
      if (finished.run.status === 'completed') break;
      await delay(50);
    }
    assert.equal(finished.run.status, 'completed');
    assert.deepEqual(finished.run.output, { ok: false });
  }
  const profiles = JSON.parse(
    execFileSync(bin, ['executors'], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
    }),
  );
  assert.equal(profiles.length, 3);
  assert.ok(
    profiles.some((p) => p.id === 'pi' && p.harness === 'pi' && !p.enabled),
  );
  const choices = await call('list_workflows', { source: 'starters' });
  assert.deepEqual(
    choices.map((s) => s.id),
    ['sdlc', 'evaluate-comparison'],
  );
  const cliStarters = JSON.parse(
    execFileSync(bin, ['starters'], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
    }),
  );
  assert.deepEqual(cliStarters, choices);
  const addedSdlc = await call('import_workflows', {
    starterId: 'sdlc',
    requestId: 'package-sdlc',
  });
  assert.equal(addedSdlc.created, true);
  const repeatSdlc = await call('import_workflows', {
    starterId: 'sdlc',
    requestId: 'package-sdlc',
  });
  assert.equal(repeatSdlc.workflow.id, addedSdlc.workflow.id);
  const starter = await call('get_workflow', { id: addedSdlc.workflow.id });
  assert.equal(starter.latestVersion, 1);
  assert.deepEqual(starter.draft.inputSchema.required, ['request']);
  assert.equal(
    starter.draft.nodes.find((node) => node.id === 'review').context.mode,
    'fresh',
  );
  const starterRun = await call('start_run', {
    workflowId: starter.id,
    input: {
      request:
        "Improve this project's setup instructions and verify the documented commands.",
    },
  });
  assert.equal(starterRun.runStatus, 'waiting');
  const starterWork = await call('list_work', { runId: starterRun.runId });
  assert.equal(starterWork.length, 1);
  assert.equal(starterWork[0].nodeId, 'configure');
  await call('cancel_run', { id: starterRun.runId });
  const starterFile = join(
    prefix,
    'lib/node_modules/@type_of/interlock/workflows/sdlc.json',
  );
  const importedStarter = JSON.parse(
    execFileSync(bin, ['import', `@${starterFile}`], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.notEqual(importedStarter.id, starter.id);
  assert.equal(importedStarter.latestVersion, 0);
  assert.deepEqual(importedStarter.draft, starter.draft);
  const publishedStarter = JSON.parse(
    execFileSync(bin, ['publish', importedStarter.id], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.equal(publishedStarter.latestVersion, 1);
  const addedEvaluator = JSON.parse(
    execFileSync(
      bin,
      [
        'import-starter',
        'evaluate-comparison',
        '--request-id',
        'package-evaluator',
      ],
      { cwd: workdir, env: { ...env, INTERLOCK_URL: url }, encoding: 'utf8' },
    ),
  );
  assert.equal(addedEvaluator.workflow.latestVersion, 1);
  await call('delete_workflow', { id: addedEvaluator.workflow.id });
  const evaluatorFile = join(
    prefix,
    'lib/node_modules/@type_of/interlock/workflows/evaluate.json',
  );
  const evaluator = JSON.parse(
    execFileSync(bin, ['import', `@${evaluatorFile}`], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  const publishedEvaluator = JSON.parse(
    execFileSync(bin, ['publish', evaluator.id], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.equal(publishedEvaluator.latestVersion, 1);
  assert.equal(publishedEvaluator.name, 'Evaluate workflow comparison');

  const scheduleWorkflow = await call('create_workflow', {
    name: 'Packaged schedule',
  });
  const cliSchedule = (request) =>
    JSON.parse(
      execFileSync(bin, ['schedules', 'manage', JSON.stringify(request)], {
        cwd: workdir,
        env: { ...env, INTERLOCK_URL: url },
        encoding: 'utf8',
      }),
    );
  const packagedSchedule = cliSchedule({
    action: 'create',
    workflowId: scheduleWorkflow.id,
    config: {
      name: 'Packaged heartbeat',
      timing: {
        type: 'cron',
        expression: '0 9 * * 1-5',
        timeZone: 'America/Denver',
      },
    },
  }).trigger;
  assert.equal(packagedSchedule.enabled, false);
  const preview = await call('read_workflow_triggers', {
    request: { action: 'preview', timing: packagedSchedule.timing },
  });
  assert.equal(preview.upcoming.length, 3);
  const config = await call('read_workflow_triggers', {
    request: { action: 'inspect', id: packagedSchedule.id },
  });
  assert.equal(config.trigger.name, 'Packaged heartbeat');
  cliSchedule({
    action: 'delete',
    id: packagedSchedule.id,
    expectedRevision: packagedSchedule.revision,
  });
  const workflow = await call('create_workflow', {
    name: 'Packed install smoke',
    layout: 'tidy',
    definition: {
      nodes: [
        {
          id: 'entry',
          kind: 'entry',
          label: 'Input',
          position: { x: 0, y: 0 },
        },
        {
          id: 'script',
          kind: 'script',
          label: 'Double',
          position: { x: 300, y: 0 },
          language: 'javascript',
          command:
            'return { number: await Promise.resolve(input * 2), cwd: process.cwd() };',
        },
        {
          id: 'exit',
          kind: 'exit',
          label: 'Output',
          position: { x: 600, y: 0 },
        },
      ],
      edges: [
        { id: 'a', source: 'entry', target: 'script' },
        { id: 'b', source: 'script', target: 'exit' },
      ],
    },
  });
  assert.deepEqual(workflow.draft.nodes[0].position, { x: 60, y: 160 });
  const cliTidy = JSON.parse(
    execFileSync(
      bin,
      [
        'update',
        workflow.id,
        JSON.stringify({
          draftRevision: workflow.draftRevision,
          layout: 'tidy',
        }),
      ],
      {
        cwd: workdir,
        env: { ...env, INTERLOCK_URL: url },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  );
  assert.equal(cliTidy.draftRevision, workflow.draftRevision);
  assert.deepEqual(cliTidy.draft, workflow.draft);
  assert.equal(cliTidy.latestVersion, workflow.latestVersion);
  const cliEdit = JSON.parse(
    execFileSync(
      bin,
      [
        'edit',
        workflow.id,
        JSON.stringify({
          draftRevision: cliTidy.draftRevision,
          edits: [],
          layout: 'tidy',
        }),
      ],
      {
        cwd: workdir,
        env: { ...env, INTERLOCK_URL: url },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  );
  assert.equal(cliEdit.applied, true);
  assert.equal(cliEdit.draftRevision, cliTidy.draftRevision);
  await call('publish_workflow', { id: workflow.id });
  const started = await call('start_run', {
    workflowId: workflow.id,
    input: 21,
    tags: { repo: 'package-smoke', batch: 'report=7' },
  });
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    result = await call('get_run', { id: started.runId });
    if (result.run.status === 'completed' || result.run.status === 'failed')
      break;
    await delay(100);
  }
  assert.equal(result.run.status, 'completed', JSON.stringify(result));
  assert.equal(result.run.output.number, 42);
  const taggedReport = JSON.parse(
    execFileSync(
      bin,
      [
        'report',
        '--since',
        new Date(Date.parse(result.run.createdAt) + 60 * 60 * 1000)
          .toISOString()
          .replace('Z', '+01:00'),
        '--until',
        result.run.createdAt,
        '--tag',
        'repo=package-smoke',
        '--tag',
        'batch=report=7',
        '--limit',
        '1',
        '--json',
      ],
      {
        cwd: workdir,
        env: { ...env, INTERLOCK_URL: url },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  );
  assert.equal(taggedReport.summary.totalRuns, 1);
  assert.deepEqual(
    taggedReport.usage.byRun.map((run) => run.runId),
    [started.runId],
  );
  assert.deepEqual(taggedReport.filter.tags, {
    repo: 'package-smoke',
    batch: 'report=7',
  });

  for (const bound of [
    '2026-11-03T00:00:00+24:00',
    '9999-12-31T23:59:59-01:00',
    '9999-12-31T23:59:59.9999Z',
  ]) {
    const invalidReport = spawnSync(
      bin,
      ['report', '--since', bound, '--json'],
      { cwd: workdir, env: { ...env, INTERLOCK_URL: url }, encoding: 'utf8' },
    );
    assert.equal(invalidReport.status, 1);
    assert.match(invalidReport.stderr, /valid datetime/i);
    assert.doesNotMatch(invalidReport.stderr, /RangeError|Invalid time value/);
  }

  // macOS resolves /var to /private/var for the working directory.
  const { realpath } = await import('node:fs/promises');
  assert.equal(result.run.output.cwd, await realpath(workdir));
  const agentWorkflow = await call('create_workflow', {
    name: 'HTTP restart assignment',
  });
  await call('publish_workflow', { id: agentWorkflow.id });
  const agentRun = await call('start_run', {
    workflowId: agentWorkflow.id,
    input: 21,
  });
  const [work] = await call('list_work', { runId: agentRun.runId });
  const [summary] = JSON.parse(
    execFileSync(bin, ['work', agentRun.runId, '--summary'], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
    }),
  );
  assert.equal(summary.rootRunId, agentRun.runId);
  assert.equal(summary.rootWorkflowId, agentWorkflow.id);
  assert.equal(summary.workflowId, agentWorkflow.id);
  // These inspection commands must also be accepted by the packaged entrypoint.
  for (const [command, input] of [
    ['work-resources', { action: 'inspect', workId: work.id }],
    ['work-hold', { action: 'history', workId: work.id }],
    ['assignment-size', { workId: work.id }],
  ]) {
    const inspection = JSON.parse(
      execFileSync(bin, [command, JSON.stringify(input)], {
        cwd: workdir,
        env: { ...env, INTERLOCK_URL: url },
        encoding: 'utf8',
      }),
    );
    assert.equal(inspection.workId, work.id);
  }
  const claim = await call('claim_work', {
    workId: work.id,
    workerId: 'package-http-smoke',
    leaseSeconds: 3600,
  });
  const backgroundWorkflow = await call('create_workflow', {
    name: 'Packed background recovery',
    definition: {
      nodes: [
        { id: 'entry', kind: 'entry', label: 'Input' },
        {
          id: 'script',
          kind: 'script',
          label: 'Offline work',
          language: 'javascript',
          executionMode: 'background',
          timeoutMs: 10000,
          command:
            "require('node:fs').appendFileSync('background-effects','x'); await new Promise(r=>setTimeout(r,500)); return {recovered:true};",
        },
        { id: 'exit', kind: 'exit', label: 'Output' },
      ],
      edges: [
        { id: 'a', source: 'entry', target: 'script' },
        { id: 'b', source: 'script', target: 'exit' },
      ],
    },
  });
  await call('publish_workflow', { id: backgroundWorkflow.id });
  const backgroundRun = await call('start_run', {
    workflowId: backgroundWorkflow.id,
    input: null,
    detail: 'full',
  });
  const backgroundExecution = backgroundRun.run.executions.find(
    (step) => step.kind === 'script',
  );
  let backgroundState;
  for (let attempt = 0; attempt < 100; attempt++) {
    backgroundState = await call('manage_script', {
      request: {
        action: 'inspect',
        runId: backgroundRun.run.id,
        executionId: backgroundExecution.id,
      },
    });
    if (backgroundState.background.state === 'running') break;
    await delay(50);
  }
  assert.equal(backgroundState.background.state, 'running');
  const cliBackground = JSON.parse(
    execFileSync(
      bin,
      [
        'script',
        JSON.stringify({
          action: 'inspect',
          runId: backgroundRun.run.id,
          executionId: backgroundExecution.id,
        }),
      ],
      { cwd: workdir, env: { ...env, INTERLOCK_URL: url }, encoding: 'utf8' },
    ),
  );
  assert.equal(cliBackground.executionId, backgroundExecution.id);
  await stop();
  await start('npx');
  let recoveredBackground;
  for (let attempt = 0; attempt < 100; attempt++) {
    recoveredBackground = await call('get_run', { id: backgroundRun.run.id });
    if (recoveredBackground.run.status === 'completed') break;
    await delay(50);
  }
  assert.equal(
    recoveredBackground.run.status,
    'completed',
    JSON.stringify(recoveredBackground.run),
  );
  assert.deepEqual(recoveredBackground.run.output, { recovered: true });
  assert.equal(
    recoveredBackground.run.executions.filter((step) => step.kind === 'script')
      .length,
    1,
  );
  assert.equal(
    await readFile(join(workdir, 'background-effects'), 'utf8'),
    'x',
  );
  const restartedConnection = (
    await fetch(`${url}/trpc/connection`).then((r) => r.json())
  ).result.data;
  assert.equal(restartedConnection.mcpUrl, connection.mcpUrl);
  assert(
    restartedConnection.fallback.args[0].startsWith(
      join(await realpath(temp), 'npm-cache', '_npx'),
    ),
    `Expected npx cached installation, got ${restartedConnection.fallback.args[0]}`,
  );
  const afterRestart = await call('list_workflows');
  assert(!afterRestart.some((w) => w.id === addedEvaluator.workflow.id));
  assert.equal(
    afterRestart.filter((w) => w.name === 'Evaluate workflow comparison')
      .length,
    1,
  );
  // The installed CLI preserves the original lease duration after restart.
  const renewed = JSON.parse(
    execFileSync(bin, ['renew', work.id, claim.token], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
    }),
  );
  assert(Date.parse(renewed.leaseUntil) >= Date.parse(claim.leaseUntil));
  const overridden = JSON.parse(
    execFileSync(bin, ['renew', work.id, claim.token, '{"leaseSeconds":300}'], {
      cwd: workdir,
      env: { ...env, INTERLOCK_URL: url },
      encoding: 'utf8',
    }),
  );
  assert(Date.parse(overridden.leaseUntil) < Date.parse(renewed.leaseUntil));
  // The existing HTTP client and persisted claim still work after restart.
  const submitted = await call('submit_result', {
    workId: work.id,
    token: claim.token,
    output: 42,
  });
  assert.equal(submitted.runStatus, 'completed');
  assert.equal(submitted.nextCall.tool, 'get_run_result');
  const observerReport = {
    source: 'observer',
    workId: work.id,
    attempt: claim.attempt,
    snapshot: {
      sequence: 1,
      final: true,
      models: [
        {
          provider: 'smoke',
          model: 'measured',
          inputTokens: 100,
          outputTokens: 20,
        },
      ],
    },
  };
  const usageOptions = {
    cwd: workdir,
    env: { ...env, INTERLOCK_URL: url },
    encoding: 'utf8',
  };
  const usageAck = JSON.parse(
    execFileSync(
      bin,
      ['report-usage', JSON.stringify(observerReport)],
      usageOptions,
    ),
  );
  assert.equal(usageAck.applied, true);
  assert.equal(usageAck.source, 'observer');
  const usage = JSON.parse(
    execFileSync(
      bin,
      ['usage', agentRun.runId, '{"groupBy":"attempt"}'],
      usageOptions,
    ),
  );
  assert.equal(usage.totals.tokens.inputTokens.value, 100);
  assert.equal(usage.groups[0].source, 'observer');
  const recurring = await call('create_workflow', {
    name: 'Packaged continuation',
    definition: {
      nodes: [
        { id: 'entry', kind: 'entry', label: 'Input' },
        { id: 'agent', kind: 'agent', label: 'Work', prompt: 'Use checkpoint' },
        {
          id: 'exit',
          kind: 'exit',
          label: 'Continue',
          continueAsNew: { maxRuns: 2 },
        },
      ],
      edges: [
        { id: 'in', source: 'entry', target: 'agent' },
        { id: 'out', source: 'agent', target: 'exit' },
      ],
    },
  });
  await call('publish_workflow', { id: recurring.id });
  const chainStart = await call('start_run', {
    workflowId: recurring.id,
    input: {},
    budget: {
      scope: 'run',
      unknownUsage: 'allow',
      limits: { claims: { max: 1 } },
    },
  });
  const chainClaim = await call('claim_work', {
    workId: chainStart.nextWork.items[0].id,
    workerId: 'package-test',
  });
  const chainSubmit = await call('submit_result', {
    workId: chainClaim.id,
    token: chainClaim.token,
    output: { cursor: 1 },
  });
  assert.equal(chainSubmit.next, 'continue_as_new');
  assert.equal(chainSubmit.nextCall.arguments.id, chainSubmit.chain.nextRunId);
  const chainMembers = JSON.parse(
    execFileSync(bin, ['runs', '--chain', chainStart.runId], usageOptions),
  );
  assert.equal(chainMembers.length, 2);
  const chainBudget = JSON.parse(
    execFileSync(bin, ['budget', chainSubmit.chain.nextRunId], usageOptions),
  );
  assert.equal(chainBudget.governing[0].attempts, 1);
  assert.equal(chainBudget.governing[0].state, 'blocked');
  const cancelledChain = JSON.parse(
    execFileSync(bin, ['cancel', chainStart.runId, '--chain'], usageOptions),
  );
  assert(cancelledChain.chain.cancelledAt);
  assert.equal(
    (await call('get_run', { id: chainSubmit.chain.nextRunId })).run.status,
    'cancelled',
  );
  const recoveryChild = await call('create_workflow', {
    name: 'Packaged failure child',
    definition: {
      nodes: [
        { id: 'entry', kind: 'entry', label: 'Input' },
        {
          id: 'agent',
          kind: 'agent',
          label: 'Work',
          prompt: 'Work',
          maxAttempts: 1,
        },
        { id: 'exit', kind: 'exit', label: 'Result' },
      ],
      edges: [
        { id: 'in', source: 'entry', target: 'agent' },
        { id: 'out', source: 'agent', target: 'exit' },
      ],
    },
  });
  await call('publish_workflow', { id: recoveryChild.id });
  const recoveryParent = await call('create_workflow', {
    name: 'Packaged failure recovery',
    definition: {
      nodes: [
        { id: 'entry', kind: 'entry', label: 'Input' },
        {
          id: 'call',
          kind: 'workflow',
          label: 'Call',
          workflowId: recoveryChild.id,
          version: 1,
          onFailure: 'route',
        },
        { id: 'exit', kind: 'exit', label: 'Result' },
      ],
      edges: [
        { id: 'in', source: 'entry', target: 'call' },
        { id: 'out', source: 'call', target: 'exit' },
        { id: 'failed', source: 'call', target: 'exit', port: 'failed' },
      ],
    },
  });
  await call('publish_workflow', { id: recoveryParent.id });
  const recoveryRun = await call('start_run', {
    workflowId: recoveryParent.id,
    input: { topic: 'smoke' },
  });
  const recoveryWork = await call('claim_work', {
    workId: recoveryRun.nextWork.items[0].id,
    workerId: 'package-test',
  });
  execFileSync(
    bin,
    ['fail', recoveryWork.id, recoveryWork.token, 'Measured test failure'],
    usageOptions,
  );
  const recovered = JSON.parse(
    execFileSync(bin, ['run', recoveryRun.runId], usageOptions),
  );
  assert.equal(recovered.run.status, 'completed');
  assert.equal(recovered.run.output.error.category, 'child');
  assert.equal(recovered.run.output.error.child.runId, recoveryWork.runId);
  assert.equal(
    (await call('get_run', { id: recoveryWork.runId })).handledFailure.runId,
    recoveryRun.runId,
  );
  const finalResult = await call(
    submitted.nextCall.tool,
    submitted.nextCall.arguments,
  );
  assert.equal(finalResult.value, 42);
  const fullReplay = await call('submit_result', {
    workId: work.id,
    token: claim.token,
    output: 42,
    detail: 'full',
  });
  assert.equal(fullReplay.run.output, 42);
  await client.close();
  client = new Client({ name: 'package-http-reconnect', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(connection.mcpUrl)),
  );
  assert.equal(client.getServerVersion().version, version);
  assert(
    (await call('list_workflows')).some((item) => item.id === agentWorkflow.id),
  );
  assert.equal(
    (await call('get_run', { id: started.runId })).run.output.number,
    42,
  );
  const historyPreview = JSON.parse(
    execFileSync(
      bin,
      [
        'run-history',
        JSON.stringify({ action: 'preview', rootRunIds: [started.runId] }),
      ],
      {
        cwd: workdir,
        env: { ...env, INTERLOCK_URL: url },
        encoding: 'utf8',
      },
    ),
  );
  assert.equal(historyPreview.items[0].canDelete, true);
  const historyRemoved = await call('manage_run_history', {
    request: {
      action: 'delete',
      roots: [
        {
          runId: started.runId,
          confirmation: historyPreview.items[0].confirmation,
        },
      ],
      acknowledgeHistoryLoss: true,
    },
  });
  assert.equal(historyRemoved.deletedRoots, 1);
  assert.equal(
    (
      await client.callTool({
        name: 'get_run',
        arguments: { id: started.runId },
      })
    ).isError,
    true,
  );
  assert(
    (await call('list_workflows')).some((item) => item.id === workflow.id),
  );
  console.log(
    'Packed global and npx installs passed: CLI, UI assets, HTTP and stdio MCP, assignments across restart, JavaScript execution, supervised background recovery without replay, persistence, and reviewed history cleanup.',
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await client?.close();
  await stop();
  await rm(temp, { recursive: true, force: true });
}
