import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  type SavedVariable,
  type WorkflowDefinition,
} from '@interlock/core';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
import { secretRedaction } from '../packages/runtime/src/secretRedaction';
import { inspectImportDocument } from '../packages/runtime/src/importSelection';
import { batchDefinition } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';

const engines: Engine[] = [];
const dirs: string[] = [];
const servers: Server[] = [];
const token = 'fake-credential-M7pQ2_sentinel';
function setup(file = false, key?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-variables-'));
  dirs.push(dir);
  const database = file ? join(dir, 'library.db') : ':memory:';
  const keyFile = key ?? join(dir, 'private', 'key');
  const engine = new Engine(
    new Store(database, file ? { secretKeyFile: keyFile } : {}),
    dir,
  );
  engines.push(engine);
  return { engine, dir, database, keyFile };
}
function create(
  engine: Engine,
  kind: 'secret' | 'config' = 'secret',
  value = token,
  name = 'service_token',
) {
  return engine.variables.mutate({
    action: 'create',
    name,
    kind,
    value,
  }) as SavedVariable;
}
function update(
  engine: Engine,
  variable: SavedVariable,
  patch: { value?: string; enabled?: boolean; name?: string },
) {
  return engine.variables.mutate({
    action: 'update',
    id: variable.id,
    expectedRevision: variable.revision,
    ...patch,
  }) as SavedVariable;
}
function script(
  variableId: string,
  command = 'return { echo: process.env.TEST_TOKEN };',
) {
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Use variable',
    language: 'javascript',
    command,
    environment: [{ name: 'TEST_TOKEN', variableId }],
  });
  return d;
}
function publish(engine: Engine, d: WorkflowDefinition) {
  const w = engine.create('Variables test', '', d);
  engine.publish(w.id);
  return w.id;
}
async function done(engine: Engine, id: string) {
  await vi.waitFor(() =>
    expect(['completed', 'failed', 'cancelled']).toContain(
      engine.run(id).status,
    ),
  );
  return engine.run(id);
}
async function service() {
  const headers: string[] = [];
  const reply = { status: 200 };
  const server = createServer((req, res) => {
    const value = req.headers.authorization ?? '';
    headers.push(value);
    res.statusCode = reply.status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-echo', value);
    res.end(JSON.stringify({ echo: value }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  return { url: `http://127.0.0.1:${address.port}`, headers, reply };
}
function fetchDefinition(variableId: string, url: string, pause = false) {
  const d = blankDefinition();
  const fetch = nodeSchema.parse({
    id: pause ? 'fetch' : 'agent',
    kind: 'fetch',
    label: 'Authenticated fetch',
    url,
    headers: [
      {
        name: 'Authorization',
        value: { kind: 'variable', variableId, prefix: 'Bearer ' },
      },
    ],
  });
  if (pause) {
    d.nodes.splice(2, 0, fetch);
    d.edges[1].target = 'fetch';
    d.edges.push({
      id: 'after-fetch',
      source: 'fetch',
      target: 'exit',
      port: 'default',
    });
  } else d.nodes[1] = fetch;
  return d;
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const engine of engines.splice(0)) {
    engine.stop();
    try {
      engine.store.close();
    } catch {}
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

it('encrypts both kinds, bounds metadata, enforces names and revisions, and never reads secrets back', () => {
  const { engine } = setup();
  const v = create(engine);
  const config = create(engine, 'config', 'ordinary', 'base_url');
  expect(JSON.stringify(engine.store.list('variableValues'))).not.toContain(
    token,
  );
  expect(engine.variables.read({ action: 'list', limit: 1 })).toMatchObject({
    total: 2,
    truncated: true,
  });
  expect(
    JSON.stringify(engine.variables.read({ action: 'inspect', id: v.id })),
  ).not.toContain(token);
  expect(() =>
    engine.variables.read({ action: 'config_value', id: v.id }),
  ).toThrow(/cannot be read back/);
  expect(
    engine.variables.read({ action: 'config_value', id: config.id }),
  ).toEqual({ id: config.id, value: 'ordinary' });
  expect(() => create(engine, 'secret', 'other', 'SERVICE_TOKEN')).toThrow(
    /already exists/,
  );
  const renamed = update(engine, v, { name: 'rotated_token' });
  expect(renamed.valueRevision).toBe(1);
  expect(() => update(engine, v, { value: 'stale' })).toThrow(
    /changed elsewhere/,
  );
  expect(engine.variables.get(v.id).name).toBe('rotated_token');
  expect(() => create(engine, 'secret', '')).toThrow(/empty/);
  expect(() =>
    create(engine, 'secret', token.repeat(2000), 'oversized'),
  ).toThrow(/Invalid variable change/);
});

it('keeps database ciphertext restartable only with its original safe key, without regenerating missing keys', () => {
  const { engine, database, keyFile, dir } = setup(true);
  expect(existsSync(keyFile)).toBe(false);
  const v = create(engine);
  expect(readFileSync(keyFile).length).toBe(32);
  engine.stop();
  engine.store.close();
  const reopen = () => {
    const e = new Engine(new Store(database, { secretKeyFile: keyFile }), dir);
    engines.push(e);
    return e;
  };
  const valid = reopen();
  expect(valid.variables.captureIds([v.id])[0].valueRevision).toBe(1);
  expect(readFileSync(database).includes(Buffer.from(token))).toBe(false);
  const original = readFileSync(keyFile);
  rmSync(keyFile);
  expect(() => valid.variables.captureIds([v.id])).toThrow(
    /Protected variable store unavailable/,
  );
  expect(existsSync(keyFile)).toBe(false);
  expect(valid.variables.read({ action: 'inspect', id: v.id })).toMatchObject({
    availability: 'locked',
  });
  writeFileSync(keyFile, Buffer.alloc(32, 7), { mode: 0o600 });
  const protectedCollections = [
    'variables',
    'variableValues',
    'variableValueCounters',
    'variableVault',
    'variableBindings',
  ];
  const snapshot = () =>
    protectedCollections.map((collection) => valid.store.list(collection));
  const beforeWrongKey = snapshot();
  expect(() => update(valid, v, { value: 'wrong-key-replacement' })).toThrow(
    /Protected variable store unavailable/,
  );
  expect(() =>
    create(valid, 'secret', 'wrong-key-new-value', 'wrong_key_create'),
  ).toThrow(/Protected variable store unavailable/);
  expect(snapshot()).toEqual(beforeWrongKey);
  expect(() => valid.variables.captureIds([v.id])).toThrow(
    /Protected variable store unavailable/,
  );
  writeFileSync(keyFile, original);
  chmodSync(keyFile, 0o644);
  expect(() => valid.variables.captureIds([v.id])).toThrow(
    /Protected variable store unavailable/,
  );
  chmodSync(keyFile, 0o600);
  expect(valid.variables.captureIds([v.id])).toHaveLength(1);
  const target = join(dir, 'other-key');
  writeFileSync(target, original, { mode: 0o600 });
  rmSync(keyFile);
  symlinkSync(target, keyFile);
  expect(() => valid.variables.captureIds([v.id])).toThrow(
    /Protected variable store unavailable/,
  );
  rmSync(keyFile);
  writeFileSync(keyFile, original, { mode: 0o600 });
  const envelope = valid.store.get<any>('variableValues', `${v.id}:1`);
  valid.store.put('variableValues', {
    ...envelope,
    tag: Buffer.alloc(16).toString('base64'),
  });
  expect(() => valid.variables.captureIds([v.id])).toThrow(
    /Protected variable store unavailable/,
  );
});

it('rolls back complete protected database state if a metadata write fails', () => {
  const { engine } = setup();
  const v = create(engine);
  const collections = [
    'variables',
    'variableValues',
    'variableValueCounters',
    'variableVault',
    'variableBindings',
  ];
  const snapshot = () => collections.map((c) => engine.store.list(c));
  const before = snapshot();
  const original = engine.store.put.bind(engine.store);
  const spy = vi
    .spyOn(engine.store, 'put')
    .mockImplementation((collection, value) => {
      if (collection === 'variables')
        throw new Error('injected metadata failure');
      return original(collection, value);
    });
  expect(() => update(engine, v, { value: 'replacement' })).toThrow(/injected/);
  expect(snapshot()).toEqual(before);
  spy.mockRestore();
  expect(update(engine, v, { value: 'replacement' }).valueRevision).toBe(2);
});

it('delivers Fetch credentials in memory, pins existing runs and picks up rotation across published workflows', async () => {
  const { engine } = setup();
  const endpoint = await service();
  const v = create(engine);
  const a = publish(engine, fetchDefinition(v.id, endpoint.url, true));
  const b = publish(engine, fetchDefinition(v.id, endpoint.url));
  const run = engine.start(a, {}).run;
  const next = update(engine, v, { value: 'replacement-fake-M8_token' });
  const work = engine.available(run.id)[0];
  const claim = engine.claim(work.id, {
    workerId: 'variables-test',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.submit(work.id, claim.token!, {});
  await done(engine, run.id);
  const later = engine.start(b, {}).run;
  await done(engine, later.id);
  expect(endpoint.headers).toEqual([
    `Bearer ${token}`,
    'Bearer replacement-fake-M8_token',
  ]);
  expect(engine.run(run.id).variableCaptures?.[0].valueRevision).toBe(1);
  expect(engine.run(later.id).variableCaptures?.[0].valueRevision).toBe(
    next.valueRevision,
  );
  const persisted = JSON.stringify([
    engine.store.list('runs'),
    engine.store.list('events'),
    engine.store.list('work'),
  ]);
  expect(persisted).not.toContain(token);
  expect(persisted).not.toContain('replacement-fake-M8_token');
  expect(persisted).toContain('[REDACTED]');
  expect(engine.workflow(a).latestVersion).toBe(1);
});

it('delivers only declared Script environment entries and scrubs stdout, JSON keys, encoded values, and stderr before truncation', async () => {
  const { engine } = setup();
  const endpoint = await service();
  const v = create(engine);
  create(engine, 'secret', 'unselected-value', 'other');
  const d = script(
    v.id,
    `await fetch(input.url, {headers:{Authorization:process.env.TEST_TOKEN}}); return {[process.env.TEST_TOKEN]: process.env.TEST_TOKEN, encoded: Buffer.from(process.env.TEST_TOKEN).toString('base64'), other: process.env.other ?? null};`,
  );
  const id = publish(engine, d);
  const run = engine.start(id, { url: endpoint.url }).run;
  const result = await done(engine, run.id);
  expect(endpoint.headers).toEqual([token]);
  expect(result.output).toEqual({
    '[REDACTED]': '[REDACTED]',
    encoded: '[REDACTED]',
    other: null,
  });
  const failed = publish(
    engine,
    script(
      v.id,
      `process.stderr.write('x'.repeat(8200)); process.stderr.write(process.env.TEST_TOKEN.slice(0,10)); await new Promise(r=>setTimeout(r,5)); process.stderr.write(process.env.TEST_TOKEN.slice(10)); throw new Error('failure');`,
    ),
  );
  const error = await done(engine, engine.start(failed, {}).run.id);
  expect(error.status).toBe('failed');
  expect(error.error).toContain('[REDACTED]');
  expect(error.error).not.toContain(token);
});

it('blocks missing, disabled, stale and retained references without fallback and preserves legacy scripts', async () => {
  const { engine } = setup();
  const v = create(engine);
  const id = publish(engine, script(v.id));
  const disabled = update(engine, v, { enabled: false });
  expect(() => engine.start(id, {})).toThrow(/disabled/);
  expect(() =>
    engine.variables.mutate({
      action: 'delete',
      id: v.id,
      expectedRevision: disabled.revision,
    }),
  ).toThrow(/dependent workflows/);
  expect(() => publish(engine, script('missing-id'))).toThrow(/missing/);
  const invalid = script(v.id);
  if (invalid.nodes[1].kind === 'script')
    invalid.nodes[1].environment![0].name = 'BAD-NAME';
  expect(() => publish(engine, invalid)).toThrow(/environment variable name/);
  const unsupported = blankDefinition();
  expect(() =>
    engine.create('Unsupported Agent delivery', '', {
      ...unsupported,
      nodes: unsupported.nodes.map((n) =>
        n.kind === 'agent'
          ? { ...n, environment: [{ name: 'TOKEN', variableId: v.id }] }
          : n,
      ),
    }),
  ).toThrow(/supported only on Script/);
  const fetch = fetchDefinition(v.id, 'https://example.com').nodes[1];
  expect(
    nodeSchema.safeParse({
      ...fetch,
      query: [
        { name: 'credential', value: { kind: 'variable', variableId: v.id } },
      ],
    }).success,
  ).toBe(false);
  const legacy = blankDefinition();
  legacy.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'script',
    label: 'Legacy',
    command: 'cat',
  });
  const old = await done(
    engine,
    engine.start(publish(engine, legacy), { legacy: true }).run.id,
  );
  expect(old.output).toEqual({ legacy: true });
  expect(old.variableCaptures).toBeUndefined();
});

it('exports safe requirements and imports only deliberate same-kind direct bindings with atomic conflicts', async () => {
  const { engine } = setup();
  const v = create(engine);
  const id = publish(engine, script(v.id));
  const bundle = exportWorkflows(engine.store, id);
  expect(bundle.formatVersion).toBe(4);
  expect(bundle.variables).toEqual([
    { id: v.id, name: v.name, kind: 'secret' },
  ]);
  expect(JSON.stringify(bundle)).not.toContain(token);
  expect(inspectImportDocument(bundle).variables).toEqual(bundle.variables);
  const local = setup().engine;
  const other = create(local, 'secret', 'local-secret', 'local_token');
  expect(() => importWorkflows(local.store, bundle)).toThrow(
    /Choose a local binding/,
  );
  expect(local.store.workflows()).toHaveLength(0);
  importWorkflows(local.store, bundle, {
    variableBindings: { [v.id]: { action: 'bind', variableId: other.id } },
  });
  expect(local.workflow(id).draft).toEqual(engine.workflow(id).draft);
  expect(local.variables.captureIds([v.id])[0].variableId).toBe(other.id);
  expect(() =>
    local.variables.mutate({
      action: 'bind',
      id: other.id,
      variableId: v.id,
      kind: 'secret',
      expectedRevision: 0,
    }),
  ).toThrow(/directly/);
  const cfg = create(local, 'config', 'ordinary', 'config');
  expect(() =>
    local.variables.mutate({
      action: 'bind',
      id: v.id,
      variableId: cfg.id,
      kind: 'config',
      expectedRevision: 1,
    }),
  ).toThrow(/kind is immutable/);
  expect(() =>
    local.variables.mutate({
      action: 'bind',
      id: 'foreign',
      variableId: cfg.id,
      kind: 'secret',
      expectedRevision: 0,
    }),
  ).toThrow(/required kind/);
  const replacement = create(local, 'secret', 'another', 'replacement');
  expect(() =>
    importWorkflows(local.store, bundle, {
      variableBindings: {
        [v.id]: { action: 'bind', variableId: replacement.id },
      },
    }),
  ).toThrow(/existing variable binding/);
  const before = local.store.list('variableBindings');
  const conflict = structuredClone(bundle);
  conflict.workflows[0].versions[0].definition.nodes[1].label = 'conflict';
  expect(() =>
    importWorkflows(local.store, conflict, {
      variableBindings: { [v.id]: { action: 'bind', variableId: other.id } },
    }),
  ).toThrow();
  expect(local.store.list('variableBindings')).toEqual(before);
  const unset = setup().engine;
  importWorkflows(unset.store, bundle, {
    variableBindings: { [v.id]: { action: 'provision' } },
  });
  expect(() => unset.start(id, {})).toThrow(/has no value/);
});

it('never reuses a deleted value revision when the same portable identity is provisioned again', () => {
  const { engine } = setup();
  const v = create(engine);
  const capture = engine.variables.captureIds([v.id]);
  engine.variables.mutate({ action: 'delete', id: v.id, expectedRevision: 1 });
  engine.variables.importRequirements(
    [{ id: v.id, name: v.name, kind: v.kind }],
    { [v.id]: { action: 'provision' } },
  );
  const reprovisioned = engine.variables.get(v.id);
  const next = update(engine, reprovisioned, { value: 'new-value' });
  expect(next.valueRevision).toBe(2);
  expect(() =>
    engine.variables.resolve({ variableCaptures: capture }, [v.id]),
  ).toThrow(/revision is missing/);
});

it('masks literal matches once, including numeric values and short overlapping secrets', () => {
  const redact = secretRedaction(['12345', 'ED']);
  expect(redact.json({ value: 12345, text: '12345 ED' })).toEqual({
    value: '[REDACTED]',
    text: '[REDACTED] [REDACTED]',
  });
});

function completeAgent(engine: Engine, id?: string) {
  const work = engine.available(id)[0];
  if (!work) throw new Error('Expected an Agent assignment');
  const claim = engine.claim(work.id, {
    workerId: 'variable-lifecycle',
    freshContext: false,
    tools: [],
    skills: [],
  });
  engine.submit(work.id, claim.token!, {});
}

it('authenticates vault keys even after all values are deleted and retains recovery with the original key', () => {
  const { engine, keyFile } = setup(true);
  const v = create(engine);
  const key = readFileSync(keyFile);
  engine.variables.mutate({
    action: 'delete',
    id: v.id,
    expectedRevision: v.revision,
  });
  const before = [
    'variables',
    'variableValues',
    'variableValueCounters',
    'variableVault',
  ].map((c) => engine.store.list(c));
  writeFileSync(keyFile, Buffer.alloc(32, 19));
  expect(() =>
    create(engine, 'secret', 'never-written', 'new_after_delete'),
  ).toThrow(/Protected variable store unavailable/);
  expect(
    [
      'variables',
      'variableValues',
      'variableValueCounters',
      'variableVault',
    ].map((c) => engine.store.list(c)),
  ).toEqual(before);
  writeFileSync(keyFile, key);
  const next = create(
    engine,
    'secret',
    'valid-after-recovery',
    'new_after_delete',
  );
  expect(engine.variables.captureIds([next.id])).toHaveLength(1);
});

it('bootstraps a missing pre-release key verifier only after authenticating a retained value', () => {
  const { engine, keyFile } = setup(true);
  const v = create(engine);
  const key = readFileSync(keyFile);
  const vault = engine.store.get<any>('variableVault', 'default');
  delete vault.check;
  engine.store.put('variableVault', vault);
  writeFileSync(keyFile, Buffer.alloc(32, 29));
  expect(() => update(engine, v, { value: 'not-written' })).toThrow(
    /Protected variable store unavailable/,
  );
  writeFileSync(keyFile, key);
  const next = update(engine, v, { value: 'valid-replacement' });
  expect(engine.store.get<any>('variableVault', 'default').check).toBeTruthy();
  expect(engine.variables.captureIds([next.id])[0].valueRevision).toBe(2);
});

it.each(['script', 'poll'] as const)(
  'rejects NUL environment values before native %s diagnostics can disclose them',
  async (mode) => {
    const { engine } = setup();
    const v = create(engine, 'secret', 'nul-sentinel\0credential-tail');
    const d = mode === 'script' ? script(v.id) : blankDefinition();
    if (mode === 'poll')
      d.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'wait',
        label: 'Poll credential',
        timing: {
          kind: 'poll',
          everyMs: 1000,
          path: 'ok',
          equals: true,
          check: {
            kind: 'script',
            language: 'javascript',
            command: 'return {ok:true};',
            environment: [{ name: 'TEST_TOKEN', variableId: v.id }],
          },
        },
      });
    const run = engine.start(publish(engine, d), {}).run;
    if (mode === 'script') await done(engine, run.id);
    else
      await vi.waitFor(() =>
        expect(
          engine.run(run.id).executions.find((e) => e.kind === 'wait')?.check
            ?.error,
        ).toContain('NUL'),
      );
    const inspection = engine.inspect(run.id);
    const serialized = JSON.stringify(inspection);
    expect(serialized).not.toContain('nul-sentinel');
    expect(serialized).not.toContain('credential-tail');
    expect(serialized).toContain('TEST_TOKEN');
    expect(serialized).toContain('service_token');
    expect(serialized).not.toContain('options.env');
  },
);

it.each(['nul\0sentinel', 'newline\nsentinel', 'unicode-雪-sentinel'])(
  'rejects invalid referenced Fetch header values without native value diagnostics',
  async (value) => {
    const { engine } = setup();
    const endpoint = await service();
    const v = create(engine, 'secret', value);
    const run = await done(
      engine,
      engine.start(publish(engine, fetchDefinition(v.id, endpoint.url)), {}).run
        .id,
    );
    expect(run.status).toBe('failed');
    expect(run.error).toContain('valid header text');
    expect(JSON.stringify(engine.inspect(run.id))).not.toContain('sentinel');
    expect(endpoint.headers).toEqual([]);
  },
);

it.each([
  `diagnostic-sentinel-"'\u0060\\tail`,
  'diagnostic-sentinel-' + 'x'.repeat(12000),
  'diagnostic-sentinel-' + 'a'.repeat(70) + '\n' + 'b'.repeat(70),
  'diagnostic-sentinel-' + 'a'.repeat(48) + '\n' + 'tail!',
  `diagnostic-sentinel-"'\u0060\\` +
    'a'.repeat(70) +
    '\r\n' +
    `"'\u0060\\` +
    'b'.repeat(70),
  'diagnostic-sentinel-' + ('a'.repeat(100) + '\n').repeat(120),
])(
  'scrubs standard Node-inspected diagnostic representations without retaining partial values',
  async (value) => {
    const { engine } = setup();
    const v = create(engine, 'secret', value);
    const run = await done(
      engine,
      engine.start(
        publish(
          engine,
          script(
            v.id,
            'console.error({token:process.env.TEST_TOKEN}); console.error({a:{b:{token:process.env.TEST_TOKEN}}}); throw new Error("control failure");',
          ),
        ),
        {},
      ).run.id,
    );
    const serialized = JSON.stringify(engine.inspect(run.id));
    expect(run.status).toBe('failed');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('diagnostic-sentinel');
    expect(serialized).not.toContain('a'.repeat(40));
    expect(serialized).not.toContain('b'.repeat(40));
  },
);

it('keeps a captured value across server restart and explicit retry after rotation', async () => {
  const { engine, database, keyFile, dir } = setup(true);
  const endpoint = await service();
  const v = create(engine);
  const id = publish(engine, fetchDefinition(v.id, endpoint.url, true));
  const run = engine.start(id, {}).run;
  update(engine, v, { value: 'new-after-restart' });
  engine.stop();
  engine.store.close();
  const resumed = new Engine(
    new Store(database, { secretKeyFile: keyFile }),
    dir,
  );
  engines.push(resumed);
  endpoint.reply.status = 500;
  completeAgent(resumed, run.id);
  expect((await done(resumed, run.id)).status).toBe('failed');
  endpoint.reply.status = 200;
  resumed.retry(run.id);
  expect((await done(resumed, run.id)).status).toBe('completed');
  const next = resumed.start(id, {}).run;
  completeAgent(resumed, next.id);
  await done(resumed, next.id);
  expect(endpoint.headers).toEqual([
    `Bearer ${token}`,
    `Bearer ${token}`,
    'Bearer new-after-restart',
  ]);
});

it('disables later consumption by an already captured run and re-enables its original revision', async () => {
  const { engine } = setup();
  const endpoint = await service();
  const v = create(engine);
  const id = publish(engine, fetchDefinition(v.id, endpoint.url, true));
  const run = engine.start(id, {}).run;
  const disabled = update(engine, v, { enabled: false });
  completeAgent(engine, run.id);
  expect((await done(engine, run.id)).error).toContain('disabled');
  expect(endpoint.headers).toEqual([]);
  update(engine, disabled, { enabled: true });
  engine.retry(run.id);
  await done(engine, run.id);
  expect(endpoint.headers).toEqual([`Bearer ${token}`]);
});

it.each(['wait', 'detached'] as const)(
  'captures invoked %s workflows independently after rotation',
  async (mode) => {
    const { engine } = setup();
    const endpoint = await service();
    const v = create(engine);
    const child = publish(engine, fetchDefinition(v.id, endpoint.url));
    const d = fetchDefinition(v.id, endpoint.url, true);
    const call = { ...workflowCall(child, mode).nodes[1], id: 'child' };
    d.nodes.splice(d.nodes.length - 1, 0, call);
    d.edges.find((e) => e.source === 'fetch')!.target = 'child';
    d.edges.push({
      id: 'child-exit',
      source: 'child',
      target: 'exit',
      port: 'default',
    });
    const run = engine.start(publish(engine, d), {}).run;
    update(engine, v, { value: 'child-current-value' });
    completeAgent(engine, run.id);
    await done(engine, run.id);
    await vi.waitFor(() => expect(endpoint.headers).toHaveLength(2));
    const childRun = engine.store
      .list<any>('runs')
      .find((r) => r.parentRunId === run.id);
    await done(engine, childRun.id);
    expect(engine.run(run.id).variableCaptures?.[0].valueRevision).toBe(1);
    expect(childRun.variableCaptures[0].valueRevision).toBe(2);
    expect(endpoint.headers).toEqual([
      `Bearer ${token}`,
      'Bearer child-current-value',
    ]);
  },
);

it('inherits captures for Batch items queued after a rotation', async () => {
  const { engine } = setup();
  const endpoint = await service();
  const v = create(engine);
  const item = { ...fetchDefinition(v.id, endpoint.url).nodes[1], id: 'work' };
  const id = publish(engine, batchDefinition(item, { concurrency: 1 }));
  const run = engine.start(id, [{}, {}, {}]).run;
  update(engine, v, { value: 'later-current' });
  await done(engine, run.id);
  expect(endpoint.headers).toEqual(Array(3).fill(`Bearer ${token}`));
  const items = engine.store
    .list<any>('runs')
    .filter((r) => r.parentRunId === run.id);
  expect(items).toHaveLength(3);
  expect(items.every((r) => r.variableCaptures[0].valueRevision === 1)).toBe(
    true,
  );
});

it('shares the initial capture with continue-as-new successors', async () => {
  const { engine } = setup();
  const endpoint = await service();
  const v = create(engine);
  const d = fetchDefinition(v.id, endpoint.url, true);
  d.nodes[d.nodes.length - 1] = nodeSchema.parse({
    ...d.nodes.at(-1),
    continueAsNew: { maxRuns: 2 },
  });
  const id = publish(engine, d);
  const run = engine.start(id, {}).run;
  update(engine, v, { value: 'new-chain-value' });
  completeAgent(engine, run.id);
  await vi.waitFor(() =>
    expect(engine.run(run.id).chain?.nextRunId).toBeTruthy(),
  );
  const next = engine.run(run.id).chain!.nextRunId!;
  expect(engine.run(next).variableCaptures).toEqual(
    engine.run(run.id).variableCaptures,
  );
  completeAgent(engine, next);
  await done(engine, next);
  expect(endpoint.headers).toEqual([`Bearer ${token}`, `Bearer ${token}`]);
});

it('pins comparison values before queueing both sides and reports safe identities', async () => {
  const { engine } = setup();
  const endpoint = await service();
  const v = create(engine);
  const id = publish(engine, fetchDefinition(v.id, endpoint.url, true));
  engine.publish(id);
  const suite = engine.testbench.createSuite({
    workflowId: id,
    content: {
      name: 'Variable cases',
      cases: [
        { id: 'a', name: 'A', input: {} },
        { id: 'b', name: 'B', input: {} },
      ],
    },
  });
  const selection = {
    suiteId: suite.id,
    suiteRevision: 1,
    baselineVersion: 1,
    candidateVersion: 2,
    concurrency: 1,
  };
  const preview = engine.testbench.preview(selection);
  expect(preview.canStart).toBe(true);
  const comparison = engine.testbench.start({
    ...selection,
    confirmation: preview.confirmation,
    requestId: 'variables-comparison',
  });
  engine.pump();
  update(engine, v, { value: 'new-comparison-value' });
  await vi.waitFor(
    () => {
      engine.pump();
      if (engine.available().length) completeAgent(engine);
      expect(engine.testbench.progress(comparison.id).status).toBe('completed');
    },
    { timeout: 10000 },
  );
  expect(endpoint.headers).toEqual(Array(4).fill(`Bearer ${token}`));
  const report = engine.testbench.report({ id: comparison.id });
  expect(report.variables?.[0].valueRevision).toBe(1);
  expect(report.configurations?.baseline.variables?.[0].valueRevision).toBe(1);
  expect(JSON.stringify(report)).not.toContain(token);
});

it('protects polling outputs and validates redacted results before routing failure data', async () => {
  const { engine } = setup();
  const v = create(engine);
  const d = blankDefinition();
  d.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'wait',
    label: 'Check credential',
    timing: {
      kind: 'poll',
      everyMs: 1000,
      path: 'ok',
      equals: true,
      check: {
        kind: 'script',
        language: 'javascript',
        command: 'return {ok:true,echo:process.env.TEST_TOKEN};',
        environment: [{ name: 'TEST_TOKEN', variableId: v.id }],
      },
    },
  });
  const run = await done(engine, engine.start(publish(engine, d), {}).run.id);
  expect(run.output).toEqual({ ok: true, echo: '[REDACTED]' });
  expect(JSON.stringify(run)).not.toContain(token);
  const numeric = create(engine, 'secret', '12345', 'numeric');
  const routed = script(numeric.id, 'return Number(process.env.TEST_TOKEN);');
  routed.nodes[1] = nodeSchema.parse({
    ...routed.nodes[1],
    outputSchema: { type: 'number' },
    onFailure: 'route',
  });
  routed.edges.push({
    id: 'failure',
    source: 'agent',
    target: 'exit',
    port: 'failed',
  });
  const failure = await done(
    engine,
    engine.start(publish(engine, routed), {}).run.id,
  );
  expect(failure.status).toBe('completed');
  expect(failure.executions.find((e) => e.nodeId === 'agent')?.port).toBe(
    'failed',
  );
  expect(JSON.stringify(failure.output)).not.toContain('12345');
  expect(JSON.stringify(failure.output)).toContain('[REDACTED]');
});
