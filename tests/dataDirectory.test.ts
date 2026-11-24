import { execFile, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@interlock/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  blankDefinition,
  doctorReportSchema,
  nodeSchema,
  type DoctorReport,
  type SavedVariable,
} from '@interlock/core';
import { resolveDataPaths } from '@interlock/core/dataPaths';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findExecutable } from '../packages/runtime/src/executors/process';
import { developmentConnection } from '../packages/server/src/connection';
import { startServer } from '../packages/server/src/start';

let root: string;
let home: string;
let dataDir: string;
let handle: Awaited<ReturnType<typeof startServer>> | undefined;
const cliArgs = ['--import', 'tsx', 'packages/cli/src/bin.ts'];
const exec = promisify(execFile);

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-data-')));
  home = join(root, 'home');
  mkdirSync(home);
  dataDir = join(root, 'engine');
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('INTERLOCK_DATA_DIR', dataDir);
  vi.stubEnv('INTERLOCK_SECRET_KEY_FILE', undefined);
  vi.stubEnv('INTERLOCK_DB', undefined);
  vi.stubEnv('INTERLOCK_REQUIRE_TOKEN', undefined);
  // Doctor probes installed harnesses. Keep those processes out of the test home.
  const git = findExecutable('git');
  if (!git) throw new Error('The data directory tests require Git on PATH.');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  symlinkSync(resolve(git), join(bin, 'git'));
  vi.stubEnv('PATH', bin);
});

afterEach(async () => {
  try {
    await handle?.stop();
  } finally {
    handle = undefined;
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

async function open(database?: string) {
  handle = await startServer({
    database,
    workdir: root,
    ui: root,
    port: 0,
    connection: { ...developmentConnection(), engineUrl: 'http://127.0.0.1:0' },
    handleSignals: false,
  });
  return handle;
}

function saveSecret(engine: NonNullable<typeof handle>['engine']) {
  return engine.variables.mutate({
    action: 'create',
    name: 'test_secret',
    kind: 'secret',
    value: 'fixture-private-value',
  }) as SavedVariable;
}

function runCli(args: string[], env = process.env) {
  return exec(process.execPath, [...cliArgs, ...args], { env, timeout: 8000 });
}

it.each([
  [
    'darwin',
    {},
    'Library/Application Support/Interlock/keys',
    'platform default',
  ],
  ['linux', {}, '.config/interlock/keys', 'platform default'],
  [
    'linux',
    { XDG_CONFIG_HOME: '/test/xdg' },
    '/test/xdg/interlock/keys',
    'XDG_CONFIG_HOME',
  ],
] as const)(
  'preserves the 0.3.0 paths on %s with %j',
  (platform, env, keys, source) => {
    const {
      dataDir: selected,
      database,
      token,
      keysDir,
      spool,
      workspaces,
      trialRoot,
      logRoot,
    } = resolveDataPaths({ platform, home, env });
    const keyPath = keys.startsWith('/') ? keys : join(home, keys);
    expect(selected).toBeUndefined();
    expect(database.path).toBe(join(home, '.interlock/interlock.db'));
    expect(keysDir).toEqual({ path: keyPath, source });
    expect(token).toEqual({ path: join(keyPath, 'api-token'), source });
    expect(spool.path).toBe(join(home, '.interlock/interlock.db.scripts'));
    expect(workspaces.path).toBe(join(home, '.interlock/workspaces'));
    expect(trialRoot).toBe(join(home, '.interlock/evaluation-trials'));
    expect(logRoot).toBe(join(home, '.interlock/logs'));

    const keyFile = join(root, 'custom/secret.key');
    const checkout = {
      path: join(root, 'checkout/.interlock/interlock.db'),
      source: 'checkout default',
    };
    const development = resolveDataPaths({
      platform,
      home,
      env: { ...env, INTERLOCK_SECRET_KEY_FILE: keyFile },
      defaultDatabase: checkout,
    });
    expect(development.database).toEqual(checkout);
    expect(development.token.path).toBe(join(root, 'custom/api-token'));
    expect(development.spool.path).toBe(`${checkout.path}.scripts`);
    expect(development.workspaces.path).toBe(
      join(root, 'checkout/.interlock/workspaces'),
    );
  },
);

it('keeps engine state together and leaves its worktrees alone when a second database shares the directory', async () => {
  const repository = join(root, 'repo');
  mkdirSync(repository);
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: repository,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
  git(['init', '-qb', 'main']);
  git([
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'Initial',
    '--allow-empty',
  ]);
  const { engine, store } = await open();
  expect(statSync(dataDir).mode & 0o777).toBe(0o700);
  expect(store.path).toBe(join(dataDir, 'interlock.db'));
  expect(existsSync(store.path)).toBe(true);
  expect(existsSync(join(dataDir, 'script-spool'))).toBe(false);
  expect(
    (await engine.doctor()).checks.find(
      (check) => check.name === 'Protected-value key path',
    )?.details,
  ).toEqual({
    path: join(dataDir, 'keys/<vault-id>.key'),
    source: 'INTERLOCK_DATA_DIR',
  });
  expect(readdirSync(join(dataDir, 'keys'))).toEqual(['api-token']);
  const secret = saveSecret(engine);
  expect(
    store.protectedValues.read(secret.id, 'secret', secret.valueRevision!),
  ).toBe('fixture-private-value');
  const key = store.protectedValues.info().keyFile!;
  expect(key).toBe(
    join(dataDir, 'keys', `${store.protectedValues.info().vaultId}.key`),
  );
  expect(statSync(key).mode & 0o777).toBe(0o600);
  expect(statSync(join(dataDir, 'keys/api-token')).mode & 0o777).toBe(0o600);
  const provisionedKey = (await engine.doctor()).checks.find(
    (check) => check.name === 'Protected-value key path',
  );
  expect(provisionedKey?.details).toEqual({
    path: key,
    source: 'INTERLOCK_DATA_DIR',
  });

  const definition = blankDefinition();
  definition.workspace = {
    repository,
    baseRef: 'HEAD',
    branch: 'data-dir/{runId}',
    retention: 'keep',
  };
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Background',
    kind: 'script',
    executionMode: 'background',
    language: 'javascript',
    command: 'return { cwd: process.cwd() };',
    timeoutMs: 5000,
  });
  const workflow = engine.create('Data directory test', '', definition);
  engine.publish(workflow.id);
  const runId = engine.start(workflow.id, null).run.id;
  const workspace = join(dataDir, 'workspaces', runId);
  await vi.waitFor(
    () => {
      engine.pump();
      expect(engine.workspaces.get(runId)?.state).toBe('retained');
    },
    { timeout: 8000 },
  );
  expect(engine.run(runId).output).toEqual({ cwd: workspace });
  const script = engine
    .run(runId)
    .executions.find((execution) => execution.kind === 'script');
  expect(readdirSync(join(dataDir, 'script-spool'))).toEqual([script?.id]);
  expect(readdirSync(home)).toEqual([]);
  await handle!.stop();
  handle = undefined;

  // A second database sharing the directory must leave the first one's worktree alone.
  const marker = `${workspace}.owner.json`;
  const other = await open(join(root, 'other.db'));
  expect(other.engine.workspaces.get(runId)).toBeUndefined();
  const jobs = (
    other.engine.workspaces as unknown as { jobs: Map<string, unknown> }
  ).jobs;
  other.engine.pump();
  expect(jobs.has('reconcile')).toBe(true);
  await vi.waitFor(() => expect(jobs.size).toBe(0), { timeout: 8000 });
  expect(existsSync(marker)).toBe(true);
  expect(existsSync(workspace)).toBe(true);
  await handle!.stop();
  handle = undefined;

  const reopened = await open();
  expect(reopened.engine.workspaces.get(runId)?.state).toBe('retained');
  expect(existsSync(workspace)).toBe(true);
});

it('leaves a legacy install intact and reads its data after a stopped copy', async () => {
  vi.stubEnv('INTERLOCK_DATA_DIR', undefined);
  const { engine, store, connection } = await open();
  const workflow = engine.create('Legacy workflow', '', blankDefinition());
  const secret = saveSecret(engine);
  const { keysDir, database } = store.paths;
  expect(
    (await engine.doctor()).checks.find(
      (check) => check.name === 'Data directory',
    )?.details,
  ).toEqual({ path: null, source: 'legacy defaults' });
  await handle!.stop();

  vi.stubEnv('INTERLOCK_DATA_DIR', dataDir);
  const fresh = await open();
  expect(fresh.store.get('workflows', workflow.id)).toBeUndefined();
  expect(existsSync(database.path)).toBe(true);
  expect(existsSync(keysDir.path)).toBe(true);
  await handle!.stop();

  const moved = join(root, 'moved');
  mkdirSync(moved, { mode: 0o700 });
  cpSync(database.path, join(moved, 'interlock.db'));
  cpSync(keysDir.path, join(moved, 'keys'), { recursive: true });
  vi.stubEnv('INTERLOCK_DATA_DIR', moved);
  const copied = await open();
  expect(copied.store.get('workflows', workflow.id)).toBeDefined();
  expect(copied.connection.token).toBe(connection.token);
  expect(
    copied.store.protectedValues.read(
      secret.id,
      'secret',
      secret.valueRevision!,
    ),
  ).toBe('fixture-private-value');
});

it('applies INTERLOCK_DB and the key override only to their own files', async () => {
  const database = join(root, 'external', 'db');
  const secretKeyFile = join(root, 'external', 'secret.key');
  vi.stubEnv('INTERLOCK_DB', database);
  vi.stubEnv('INTERLOCK_SECRET_KEY_FILE', secretKeyFile);
  const { engine, store } = await open();
  saveSecret(engine);
  expect(store.path).toBe(database);
  expect(store.protectedValues.info().keyFile).toBe(secretKeyFile);
  expect(existsSync(secretKeyFile)).toBe(true);
  expect(readdirSync(join(dataDir, 'keys'))).toEqual(['api-token']);
  expect(engine.workspaces.root).toBe(join(dataDir, 'workspaces'));
  expect(store.paths.spool.path).toBe(join(dataDir, 'script-spool'));
  expect(existsSync(join(dataDir, 'interlock.db'))).toBe(false);
});

it.each(['relative', '', 'regular file', 'unwritable'])(
  'rejects an invalid data directory (%s) before CLI startup writes',
  async (kind) => {
    let setting = kind;
    if (kind === 'regular file' || kind === 'unwritable') {
      setting = join(root, 'blocked');
      if (kind === 'regular file') writeFileSync(setting, 'not a directory');
      else {
        if (process.getuid?.() === 0) return;
        mkdirSync(setting, { mode: 0o500 });
      }
    }
    const db = join(root, 'overrides', 'db');
    const env = {
      ...process.env,
      INTERLOCK_DATA_DIR: setting,
      INTERLOCK_SECRET_KEY_FILE: join(root, 'overrides', 'key'),
    };
    try {
      const failed = runCli(['--db', db], env);
      await expect(failed).rejects.toHaveProperty('code', 1);
      await expect(failed).rejects.toThrow('INTERLOCK_DATA_DIR');
      expect(existsSync(join(root, 'overrides'))).toBe(false);
    } finally {
      if (kind === 'unwritable') chmodSync(setting, 0o700);
    }
  },
);

it('rejects invalid data directory settings from the checkout server entry point', async () => {
  const env = { ...process.env, INTERLOCK_DATA_DIR: 'relative' };
  const failed = exec(
    process.execPath,
    ['--import', 'tsx', 'packages/server/src/index.ts'],
    { env, timeout: 8000 },
  );
  await expect(failed).rejects.toHaveProperty('code', 1);
  await expect(failed).rejects.toThrow(
    'INTERLOCK_DATA_DIR must be an absolute path',
  );
  expect(readdirSync(home)).toEqual([]);
});

it('authenticates CLI and checkout stdio clients and reports the running engine paths over both MCP transports', async () => {
  mkdirSync(dataDir);
  const configPath = join(dataDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({ allowedRoots: [root], logLevel: 'warn' }),
  );
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  const database = join(root, 'flags', 'db');
  const env = {
    ...process.env,
    INTERLOCK_DB: join(root, 'unused-db'),
    INTERLOCK_REQUIRE_TOKEN: '1',
  };
  const server = spawn(
    process.execPath,
    [...cliArgs, '--port', String(port), '--db', database],
    { env, stdio: 'ignore' },
  );
  const exited = once(server, 'exit');
  const clients: Client[] = [];
  try {
    await vi.waitFor(
      async () => {
        expect(server.exitCode).toBeNull();
        expect((await fetch(`${url}/health`)).ok).toBe(true);
      },
      { timeout: 8000 },
    );
    const clientEnv = {
      ...process.env,
      INTERLOCK_URL: url,
      INTERLOCK_CONFIG: 'client-must-ignore.json',
    };
    const help = await runCli(['--help']);
    expect(help.stdout).toContain('INTERLOCK_DATA_DIR');
    expect(help.stdout).toContain('INTERLOCK_CONFIG');
    expect(JSON.parse((await runCli(['workflows'], clientEnv)).stdout)).toEqual(
      [],
    );
    expect((await fetch(`${url}/trpc/workflows.list`)).status).toBe(401);
    const refused = runCli(['workflows'], {
      ...clientEnv,
      INTERLOCK_DATA_DIR: join(root, 'wrong'),
    });
    await expect(refused).rejects.toHaveProperty('code', 1);
    await expect(refused).rejects.toThrow('Interlock API token required');
    expect(existsSync(join(root, 'wrong'))).toBe(false);
    expect(existsSync(env.INTERLOCK_DB)).toBe(false);
    const token = (await import('@interlock/core/apiToken')).readApiToken();
    if (!token) throw new Error('Missing fixture token');
    const text = await runCli(['doctor'], clientEnv);
    expect(text.stdout).toContain(`${database} (--db)`);
    const json = (await runCli(['doctor', '--json'], clientEnv)).stdout;
    const report = JSON.parse(json) as DoctorReport;
    const paths = report.checks.filter(
      (check) =>
        check.details && 'source' in check.details && 'path' in check.details,
    );
    expect(paths.map((check) => check.details)).toEqual([
      { path: dataDir, source: 'INTERLOCK_DATA_DIR' },
      { path: database, source: '--db' },
      {
        path: join(dataDir, 'keys/<vault-id>.key'),
        source: 'INTERLOCK_DATA_DIR',
      },
      { path: join(dataDir, 'keys/api-token'), source: 'INTERLOCK_DATA_DIR' },
      { path: join(dataDir, 'script-spool'), source: 'INTERLOCK_DATA_DIR' },
      { path: join(dataDir, 'workspaces'), source: 'INTERLOCK_DATA_DIR' },
    ]);
    const settings = new Map<string, object>([
      ['Config file', { path: configPath, found: true }],
      ['requireToken', { value: true, source: 'INTERLOCK_REQUIRE_TOKEN' }],
      [
        'allowedRoots',
        { value: [root], source: 'config file', controlledByConfig: true },
      ],
      ['logLevel', { value: 'warn', source: 'config file' }],
      ['syncDir', { value: null, source: 'default' }],
    ]);
    const configRows = report.checks.filter((check) =>
      settings.has(check.name),
    );
    expect(configRows).toHaveLength(settings.size);
    for (const row of configRows) {
      expect(row.details).toMatchObject(settings.get(row.name)!);
      expect(text.stdout).toContain(`${row.name}: ${row.message}`);
    }
    const live = doctorReportSchema.parse(
      JSON.parse(
        (await runCli(['doctor', '--live', '--json'], clientEnv)).stdout,
      ),
    );
    expect(live.checks.filter((check) => settings.has(check.name))).toEqual(
      configRows,
    );
    expect(text.stdout).not.toContain(token);
    expect(json).not.toContain(token);
    const update = {
      action: 'save_settings',
      expectedRevision: 0,
      concurrency: 3,
      allowedRoots: [],
    };
    await expect(
      runCli(['executors', JSON.stringify(update)], clientEnv),
    ).rejects.toThrow('controlled by the operator config');
    const headers = { Authorization: `Bearer ${token}` };
    const config = await createClient(url, { token }).connection.query();
    expect(config.env).toEqual({
      INTERLOCK_URL: url,
      INTERLOCK_DATA_DIR: dataDir,
    });
    for (const transport of [
      new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
        requestInit: { headers },
      }),
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'packages/mcp/src/index.ts'],
        env: { ...config.env, INTERLOCK_CONFIG: 'client-must-ignore.json' },
        stderr: 'pipe',
      }),
    ]) {
      const mcp = new Client({ name: 'data-directory-test', version: '1.0.0' });
      clients.push(mcp);
      await mcp.connect(transport);
      const { tools } = await mcp.listTools();
      expect(
        tools.find((tool) => tool.name === 'doctor')?.description,
      ).toContain('operator config path');
      expect(
        tools.find((tool) => tool.name === 'manage_executors')?.description,
      ).toContain('shared roots are read-only');
      const listed = await mcp.callTool({
        name: 'list_workflows',
        arguments: {},
      });
      expect(listed.isError).not.toBe(true);
      const diagnostic = await mcp.callTool({ name: 'doctor', arguments: {} });
      expect(diagnostic.isError).not.toBe(true);
      const mcpReport = doctorReportSchema.parse(diagnostic.structuredContent);
      expect(
        mcpReport.checks.filter((check) => settings.has(check.name)),
      ).toEqual(configRows);
      expect(JSON.stringify(diagnostic)).toContain(database);
      expect(JSON.stringify(diagnostic)).not.toContain(token);
      const refused = await mcp.callTool({
        name: 'manage_executors',
        arguments: { request: update },
      });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused)).toContain(
        'controlled by the operator config',
      );
    }
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    if (server.exitCode === null) server.kill('SIGTERM');
    await exited;
  }
}, 20000);
