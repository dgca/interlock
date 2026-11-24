import { execFile } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { definitionSchema } from '@interlock/core';
import { resolveDataPaths } from '@interlock/core/dataPaths';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SchedulerErrors } from '../packages/runtime/src/log';
import { DesktopEngineLifecycle } from '../packages/desktop/src/lifecycle';
import { workflowSyncStatus } from '../packages/runtime/src/workflowSync';
import { developmentConnection } from '../packages/server/src/connection';
import { loadOperatorConfig } from '../packages/server/src/operatorConfig';
import { startServer } from '../packages/server/src/start';

const exec = promisify(execFile);
let root: string;
let dataDir: string;
let config: string;
let server: Awaited<ReturnType<typeof startServer>> | undefined;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-operator-')));
  dataDir = join(root, 'data');
  config = join(root, 'operator.json');
  vi.stubEnv('HOME', root);
  vi.stubEnv('INTERLOCK_DATA_DIR', dataDir);
  for (const name of [
    'INTERLOCK_CONFIG',
    'INTERLOCK_REQUIRE_TOKEN',
    'INTERLOCK_ALLOWED_ROOTS',
    'INTERLOCK_LOG_LEVEL',
    'INTERLOCK_SYNC_DIR',
    'INTERLOCK_DB',
    'INTERLOCK_SECRET_KEY_FILE',
  ])
    vi.stubEnv(name, undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  try {
    await stop();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

async function stop() {
  await server?.stop();
  server = undefined;
}

async function start(options: Partial<Parameters<typeof startServer>[0]> = {}) {
  server = await startServer({
    workdir: root,
    ui: root,
    port: 0,
    connection: developmentConnection(),
    handleSignals: false,
    ...options,
  });
  if (!server.server.listening) await once(server.server, 'listening');
  const address = server.server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test listener');
  return { ...server, url: `http://127.0.0.1:${address.port}` };
}

function setConfig(value: unknown) {
  vi.stubEnv('INTERLOCK_CONFIG', config);
  writeFileSync(config, JSON.stringify(value));
}

it('resolves options, environment, file and defaults with sources', () => {
  const get = (env: NodeJS.ProcessEnv = {}, options = {}) =>
    loadOperatorConfig(
      resolveDataPaths({ home: root, env }),
      options,
      'localhost',
      env,
    );
  expect(get()).toMatchObject({
    configFile: { found: false },
    requireToken: { value: false, source: 'default' },
    allowedRoots: { value: [], source: 'default', controlledByConfig: false },
    logLevel: { value: 'info', source: 'default' },
    syncDir: { value: null, source: 'default' },
  });
  writeFileSync(
    config,
    JSON.stringify({
      requireToken: true,
      allowedRoots: [root],
      logLevel: 'error',
      syncDir: join(root, 'sync'),
    }),
  );
  const explicit = { INTERLOCK_CONFIG: config };
  expect(get(explicit).logLevel).toEqual({
    value: 'error',
    source: 'config file',
  });
  expect(get(explicit).allowedRoots).toEqual({
    value: [root],
    source: 'config file',
    controlledByConfig: true,
  });
  const env = {
    ...explicit,
    INTERLOCK_LOG_LEVEL: 'WARN',
    INTERLOCK_SYNC_DIR: ' ',
    INTERLOCK_REQUIRE_TOKEN: 'false',
  };
  expect(get(env).logLevel).toEqual({
    value: 'warn',
    source: 'INTERLOCK_LOG_LEVEL',
  });
  expect(get(env).syncDir).toEqual({
    value: join(root, 'sync'),
    source: 'config file',
  });
  expect(get(env).requireToken).toMatchObject({
    value: false,
    source: 'INTERLOCK_REQUIRE_TOKEN',
  });
  expect(get(env, { logLevel: 'debug', requireToken: false }).logLevel).toEqual(
    { value: 'debug', source: 'flag' },
  );
  expect(get(env, { requireToken: false }).requireToken).toMatchObject({
    value: false,
    source: 'flag',
  });
  expect(
    get({
      INTERLOCK_SYNC_DIR: ' ./workflows ',
      INTERLOCK_ALLOWED_ROOTS: 'one, two:three',
    }),
  ).toMatchObject({
    allowedRoots: {
      value: ['one', 'two', 'three'],
      source: 'INTERLOCK_ALLOWED_ROOTS',
    },
    syncDir: { value: resolve('workflows'), source: 'INTERLOCK_SYNC_DIR' },
  });
});

it.each([
  ['darwin', '', 'Library/Application Support/Interlock'],
  ['linux', '', '.config/interlock'],
  ['linux', 'xdg', 'xdg/interlock'],
] as const)(
  'selects one path on %s with XDG_CONFIG_HOME=%s',
  (platform, xdg, configDir) => {
    const userDir = join(root, configDir);
    const env = {
      XDG_CONFIG_HOME: xdg ? join(root, xdg) : undefined,
      INTERLOCK_DB: join(root, 'override.db'),
      INTERLOCK_SECRET_KEY_FILE: join(root, 'private', 'key'),
    };
    const userFile = join(userDir, 'config.json');
    expect(
      resolveDataPaths({ platform, home: root, env }).configFile.path,
    ).toBe(userFile);
    mkdirSync(userDir, { recursive: true });
    mkdirSync(dataDir);
    writeFileSync(userFile, '{"logLevel":"debug"}');
    writeFileSync(join(dataDir, 'config.json'), '{"logLevel":"warn"}');
    writeFileSync(config, '{"logLevel":"error"}');
    const level = (extra: NodeJS.ProcessEnv) =>
      loadOperatorConfig(
        resolveDataPaths({ platform, home: root, env: { ...env, ...extra } }),
        {},
        'localhost',
      ).logLevel.value;
    expect(level({})).toBe('debug');
    expect(level({ INTERLOCK_DATA_DIR: dataDir })).toBe('warn');
    expect(
      level({ INTERLOCK_DATA_DIR: dataDir, INTERLOCK_CONFIG: config }),
    ).toBe('error');
  },
);

it.each([
  ['missing explicit file', undefined, /Cannot read/],
  ['non-file', 'directory', /regular file/],
  ['malformed JSON', '{', /valid JSON/],
  ['non-object', '[]', /JSON object/],
  ['unknown key', '{"host":"localhost"}', /Unknown key.*host/],
  ['prototype key', '{"__proto__":{}}', /Unknown key.*__proto__/],
  ['wrong type', '{"requireToken":"true"}', /requireToken.*boolean/],
  ['empty roots', '{"allowedRoots":[]}', /allowedRoots.*at least one path/],
  [
    'overridden log level',
    '{"logLevel":"verbose"}',
    /logLevel.*debug.*info.*warn.*error/,
  ],
  ['relative sync path', '{"syncDir":"relative"}', /syncDir.*absolute path/],
  [
    'invalid absolute path',
    '{"syncDir":"/some\\u0000where"}',
    /syncDir.*absolute path/,
  ],
  [
    'relative root path',
    '{"allowedRoots":["relative"]}',
    /allowedRoots\.0.*absolute path/,
  ],
] as const)(
  'rejects %s via the real CLI before writes',
  async (_name, content, message) => {
    if (content === 'directory') mkdirSync(config);
    else if (content !== undefined) writeFileSync(config, content);
    const result = exec(
      process.execPath,
      ['--import', 'tsx', 'packages/cli/src/bin.ts'],
      {
        env: {
          ...process.env,
          INTERLOCK_CONFIG: config,
          INTERLOCK_LOG_LEVEL: 'info',
          // Never the default port, where a real engine may be running.
          INTERLOCK_PORT: '45931',
        },
        timeout: 8000,
      },
    );
    await expect(result).rejects.toHaveProperty('code', 1);
    await expect(result).rejects.toHaveProperty(
      'stderr',
      expect.stringContaining(config),
    );
    await expect(result).rejects.toHaveProperty(
      'stderr',
      expect.stringMatching(message),
    );
    expect(existsSync(dataDir)).toBe(false);
  },
);

it('rejects a relative explicit path before opening an existing database', async () => {
  const database = join(root, 'existing.db');
  writeFileSync(database, 'fixture');
  const result = exec(
    process.execPath,
    ['--import', 'tsx', 'packages/cli/src/bin.ts', '--db', database],
    {
      env: {
        ...process.env,
        INTERLOCK_CONFIG: 'relative.json',
        INTERLOCK_PORT: '45931',
      },
      timeout: 8000,
    },
  );
  await expect(result).rejects.toHaveProperty('code', 1);
  await expect(result).rejects.toHaveProperty(
    'stderr',
    expect.stringMatching(/INTERLOCK_CONFIG.*absolute.*relative.json/),
  );
  expect(readFileSync(database, 'utf8')).toBe('fixture');
  expect(existsSync(`${database}.lock`)).toBe(false);
  expect(existsSync(dataDir)).toBe(false);
});

it('validates startup config before checkout and desktop-owned engines write state', async () => {
  setConfig({ logLevel: 'verbose' });
  const result = exec(
    process.execPath,
    ['--import', 'tsx', 'packages/server/src/index.ts'],
    { timeout: 8000 },
  );
  await expect(result).rejects.toHaveProperty('code', 1);
  await expect(result).rejects.toHaveProperty(
    'stderr',
    expect.stringContaining(config),
  );
  const desktop = new DesktopEngineLifecycle({
    workdir: root,
    ui: root,
    probeHealth: () => Promise.resolve(false),
  });
  try {
    await expect(desktop.start()).rejects.toThrow(/Config file.*logLevel/);
    expect(existsSync(dataDir)).toBe(false);
  } finally {
    await desktop.stop();
  }
});

it('keeps the operator path separate from database and log writes', async () => {
  await expect(
    start({ database: join(dataDir, 'config.json') }),
  ).rejects.toThrow('also points to engine state');
  expect(existsSync(dataDir)).toBe(false);

  config = join(dataDir, 'logs', 'interlock.log');
  mkdirSync(join(dataDir, 'logs'), { recursive: true });
  setConfig({ logLevel: 'warn' });
  await expect(start()).rejects.toThrow('also points to engine state');
  expect(readFileSync(config, 'utf8')).toBe('{"logLevel":"warn"}');
  expect(existsSync(join(dataDir, 'interlock.db'))).toBe(false);
});

it('starts with all four file settings in use', async () => {
  const allowed = join(root, 'allowed');
  const outside = join(root, 'outside');
  const sync = join(root, 'sync');
  for (const dir of [allowed, outside, sync]) mkdirSync(dir);
  setConfig({
    requireToken: true,
    allowedRoots: [allowed],
    logLevel: 'warn',
    syncDir: sync,
  });
  const attach = vi.spyOn(SchedulerErrors.prototype, 'attach');
  const { engine, url, connection } = await start();
  expect((await fetch(`${url}/api/workflows`)).status).toBe(401);
  expect(
    (
      await fetch(`${url}/api/workflows`, {
        headers: { Authorization: `Bearer ${connection.token}` },
      })
    ).status,
  ).toBe(200);

  const workflow = engine.create(
    'Config exercise',
    '',
    definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'script',
          label: 'Script',
          kind: 'script',
          language: 'javascript',
          command: 'return process.cwd();',
          cwd: { source: 'input', path: 'path' },
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'first', source: 'entry', target: 'script' },
        { id: 'last', source: 'script', target: 'exit' },
      ],
    }),
  );
  engine.publish(workflow.id);
  const good = engine.start(workflow.id, { path: allowed }).run.id;
  const bad = engine.start(workflow.id, { path: outside }).run.id;
  await vi.waitFor(() => {
    engine.pump();
    expect(engine.run(good).status).toBe('completed');
    expect(engine.run(bad).error).toContain('outside allowed roots');
    expect(existsSync(join(sync, `${workflow.id}.json`))).toBe(true);
  });
  const log = attach.mock.calls[0][0];
  log.write('info', 'ignored');
  log.write('warn', 'recorded');
  const content = readFileSync(log.file, 'utf8');
  expect(content).not.toContain('ignored');
  expect(content).toContain('recorded');
});

it('forces authentication off loopback and reports the reason', async () => {
  setConfig({ requireToken: false });
  const { engine, url, connection } = await start({ hostname: '0.0.0.0' });
  for (const path of [
    '/api/workflows',
    '/trpc/connection',
    '/mcp',
    '/events',
  ]) {
    expect((await fetch(`${url}${path}`)).status).toBe(401);
    const allowed = await fetch(`${url}${path}`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    });
    expect(allowed.status).toBe(path === '/mcp' ? 405 : 200);
    await allowed.body?.cancel();
  }
  const report = await engine.doctor();
  const auth = report.checks.find((row) => row.name === 'requireToken');
  expect(auth?.details).toEqual({
    value: true,
    source: 'non-loopback listener',
    forced: true,
  });
  expect(auth?.message).toContain('Required on non-loopback');
  expect(JSON.stringify(report)).not.toContain(connection.token);
  await stop();
  rmSync(join(dataDir, 'keys', 'api-token'));
  mkdirSync(join(dataDir, 'keys', 'api-token'));
  await expect(start({ hostname: '0.0.0.0' })).rejects.toThrow(
    'Cannot use the API token file',
  );
});

it('keeps the startup snapshot and restores saved shared roots after restart without the key', async () => {
  const savedRoots = [join(root, 'saved')];
  const fileRoots = [join(root, 'file')];
  const first = await start();
  expect(first.engine.startupSettings?.configFile).toEqual({
    path: join(dataDir, 'config.json'),
    found: false,
  });
  first.engine.executors.saveSettings({
    expectedRevision: 0,
    concurrency: 3,
    allowedRoots: savedRoots,
  });
  writeFileSync(
    join(dataDir, 'config.json'),
    JSON.stringify({ allowedRoots: fileRoots, logLevel: 'debug' }),
  );
  expect(first.engine.getAllowedRoots()).toEqual(savedRoots);
  expect(
    (await first.engine.doctor()).checks.find(
      (row) => row.name === 'Config file',
    )?.details,
  ).toMatchObject({ found: false });
  await stop();

  const second = await start();
  expect(second.engine.getAllowedRoots()).toEqual(fileRoots);
  const save = (request: object) =>
    second.engine.executors.saveSettings({
      expectedRevision: 1,
      concurrency: 4,
      ...request,
    });
  expect(() => save({ allowedRoots: savedRoots })).toThrow(
    'controlled by the operator config',
  );
  // Sending back the list that was read is not a change.
  expect(save({ allowedRoots: fileRoots })).toMatchObject({
    revision: 2,
    allowedRoots: fileRoots,
  });
  expect(
    second.engine.executors.saveSettings({
      expectedRevision: 2,
      concurrency: 4,
    }),
  ).toMatchObject({
    revision: 3,
    concurrency: 4,
    allowedRoots: fileRoots,
  });
  rmSync(join(dataDir, 'config.json'));
  expect(second.engine.getAllowedRoots()).toEqual(fileRoots);
  expect(
    (await second.engine.doctor()).checks.find((row) => row.name === 'logLevel')
      ?.details,
  ).toEqual({ value: 'debug', source: 'config file' });
  await stop();

  const third = await start();
  expect(third.engine.executors.settings()).toMatchObject({
    revision: 3,
    concurrency: 4,
    allowedRoots: savedRoots,
  });
  expect(third.engine.getAllowedRoots()).toEqual(savedRoots);
});

it('reports the shared roots in effect, including saved ones', async () => {
  const startupRoot = join(root, 'startup');
  const savedRoot = join(root, 'saved');
  vi.stubEnv('INTERLOCK_ALLOWED_ROOTS', startupRoot);
  const { engine } = await start();
  const row = async () =>
    (await engine.doctor()).checks.find(
      (check) => check.name === 'allowedRoots',
    );
  expect((await row())?.message).toBe(
    `${JSON.stringify([startupRoot])} (INTERLOCK_ALLOWED_ROOTS)`,
  );
  engine.executors.saveSettings({
    expectedRevision: 0,
    concurrency: 3,
    allowedRoots: [savedRoot],
  });
  expect(await row()).toMatchObject({
    message: `${JSON.stringify([startupRoot, savedRoot])} (INTERLOCK_ALLOWED_ROOTS and saved shared roots)`,
    details: {
      value: [startupRoot],
      effective: [startupRoot, savedRoot],
      controlledByConfig: false,
    },
  });
});

it('refuses to start when the config file sits in the workflow sync folder', async () => {
  mkdirSync(dataDir);
  const path = join(dataDir, 'config.json');
  const content = JSON.stringify({ syncDir: dataDir });
  writeFileSync(path, content);
  await expect(start()).rejects.toThrow(
    /config\.json.*is in the workflow sync folder \(config file\)/,
  );
  expect(readdirSync(dataDir)).toEqual(['config.json']);

  // The environment variable selects the folder the same way.
  writeFileSync(path, '{}');
  vi.stubEnv('INTERLOCK_SYNC_DIR', dataDir);
  await expect(start()).rejects.toThrow(/\(INTERLOCK_SYNC_DIR\)/);

  // With no config file, the same folder syncs as before.
  rmSync(path);
  const { engine } = await start();
  expect(workflowSyncStatus(engine)?.items).toEqual([]);
});
