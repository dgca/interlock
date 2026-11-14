import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  type Run,
  type SavedVariable,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import * as scripts from '../packages/runtime/src/scripts';
import { trialProcessEnvironment } from '../packages/runtime/src/localGitTrials';
import { batchDefinition, itemScript, nestedBatches } from './fixtures/batch';
import { workflowCall } from './fixtures/detached';

const requiredNames = [
  'INTERLOCK_RUN_ID',
  'INTERLOCK_ROOT_RUN_ID',
  'INTERLOCK_WORKFLOW_ID',
  'INTERLOCK_WORKFLOW_VERSION',
  'INTERLOCK_NODE_ID',
  'INTERLOCK_EXECUTION_ID',
  'INTERLOCK_ATTEMPT',
];
const names = [
  ...requiredNames,
  'INTERLOCK_BATCH_OWNER_RUN_ID',
  'INTERLOCK_BATCH_ITEM_INDEX',
  'INTERLOCK_POLL_CHECK_NUMBER',
  'INTERLOCK_URL',
  'INTERLOCK_API_TOKEN',
];
const readEnvironment = `Object.fromEntries(${JSON.stringify(names)}.map(name => [name, process.env[name]]))`;
const readJavaScript = `return { input, env: ${readEnvironment} };`;
const readBash = `input=$(cat)
printf '{"input":%s,"env":{${requiredNames.map((name) => `"${name}":"%s"`).join(',')}}}' "$input" ${requiredNames.map((name) => `"$${name}"`).join(' ')}`;

const engines: Engine[] = [];
function setup() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  return engine;
}
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
  vi.unstubAllEnvs();
});
function publish(engine: Engine, definition: WorkflowDefinition) {
  const workflow = engine.create('Script context', '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}
function script(
  command = readJavaScript,
  language: 'javascript' | 'bash' = 'javascript',
) {
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Inspect context',
    kind: 'script',
    language,
    command,
  });
  return definition;
}
async function waitForRun(
  engine: Engine,
  id: string,
  status: Run['status'] = 'completed',
) {
  return vi.waitFor(
    () => {
      const run = engine.run(id);
      expect(run.status, run.error).toBe(status);
      return run;
    },
    { timeout: 5_000 },
  );
}
function expectedIdentity(run: Run, rootId = run.id, nodeId = 'agent') {
  return {
    INTERLOCK_RUN_ID: run.id,
    INTERLOCK_ROOT_RUN_ID: rootId,
    INTERLOCK_WORKFLOW_ID: run.workflowId,
    INTERLOCK_WORKFLOW_VERSION: String(run.version),
    INTERLOCK_NODE_ID: nodeId,
    INTERLOCK_EXECUTION_ID: run.executions.find(
      (step) => step.nodeId === nodeId,
    )!.id,
    INTERLOCK_ATTEMPT: '1',
  };
}

it.each(['javascript', 'bash'] as const)(
  'gives concurrent %s scripts their own execution identity with identical inputs',
  async (language) => {
    vi.stubEnv('INTERLOCK_RUN_ID', 'inherited-run');
    vi.stubEnv('INTERLOCK_BATCH_ITEM_INDEX', 'inherited-item');
    vi.stubEnv('INTERLOCK_POLL_CHECK_NUMBER', 'inherited-check');
    vi.stubEnv('INTERLOCK_API_TOKEN', 'inherited-token');
    const engine = setup();
    // The server's address; no token because the server does not require one.
    engine.executors.mcpUrl = 'http://127.0.0.1:4999/mcp/execute';
    const workflow = publish(
      engine,
      script(language === 'bash' ? readBash : readJavaScript, language),
    );
    const first = engine.start(workflow, 'same').run;
    const second = engine.start(workflow, 'same').run;
    for (const id of [first.id, second.id]) {
      const run = await waitForRun(engine, id);
      expect(run.output).toEqual({
        input: 'same',
        env: {
          ...expectedIdentity(run),
          ...(language === 'javascript'
            ? { INTERLOCK_URL: 'http://127.0.0.1:4999' }
            : {}),
        },
      });
    }
    expect(process.env.INTERLOCK_RUN_ID).toBe('inherited-run');
  },
);

it.each(['wait', 'detached'] as const)(
  'identifies the published %s child and its original root',
  async (mode) => {
    const engine = setup();
    const childWorkflow = publish(engine, script());
    engine.publish(childWorkflow);
    const definition = workflowCall(childWorkflow, mode);
    const node = definition.nodes[1];
    if (node.kind !== 'workflow') throw new Error('Expected workflow call');
    node.version = 2;
    const root = engine.start(publish(engine, definition), null).run;
    const [child] = engine.inspect(root.id).children;
    const run = await waitForRun(engine, child.id);
    expect(run.version).toBe(2);
    expect(run.output).toEqual({
      input: null,
      env: expectedIdentity(run, root.id),
    });
  },
);

it('identifies the owning Batch run and position of each nested item', async () => {
  const engine = setup();
  const workflow = publish(
    engine,
    nestedBatches(2, itemScript(readJavaScript)),
  );
  const root = engine.start(workflow, [['same', 'same'], ['same']]).run;
  const run = await waitForRun(engine, root.id);
  const owners = run.executions.find(
    (step) => step.kind === 'batch',
  )!.childRunIds;
  const groups = owners.map((ownerId) => {
    const owner = engine.run(ownerId);
    return owner.executions[0].childRunIds.map((id, index) => ({
      input: 'same',
      env: {
        ...expectedIdentity(engine.run(id), root.id, 'work'),
        INTERLOCK_BATCH_OWNER_RUN_ID: ownerId,
        INTERLOCK_BATCH_ITEM_INDEX: String(index),
      },
    }));
  });
  expect(groups.map((group) => group.length)).toEqual([2, 1]);
  expect(run.output).toEqual(groups);
});

it('restores the position of a legacy Batch item when explicitly retried', async () => {
  const engine = setup();
  const workflow = publish(
    engine,
    batchDefinition(
      itemScript(`
    if (process.env.INTERLOCK_ATTEMPT === '1') throw new Error('retry item');
    ${readJavaScript}
  `),
    ),
  );
  const root = engine.start(workflow, ['same']).run;
  const failed = await waitForRun(engine, root.id, 'failed');
  const [itemId] = failed.executions.at(-1)!.childRunIds;
  const item = engine.run(itemId);
  const failedExecutionId = item.executions[0].id;
  delete item.batchItemIndex;
  engine.store.put('runs', item);

  engine.retry(root.id);
  await waitForRun(engine, root.id);
  const retried = engine.run(item.id);
  expect(retried.executions[1].id).not.toBe(failedExecutionId);
  expect(retried.output).toEqual({
    input: 'same',
    env: {
      ...expectedIdentity(retried, root.id, 'work'),
      INTERLOCK_EXECUTION_ID: retried.executions[1].id,
      INTERLOCK_ATTEMPT: '2',
      INTERLOCK_BATCH_OWNER_RUN_ID: root.id,
      INTERLOCK_BATCH_ITEM_INDEX: '0',
    },
  });
});

it('counts explicit retries separately from later visits to the same Script node', async () => {
  const engine = setup();
  const definition = script(`
    const env = ${readEnvironment};
    if (input === 0 && env.INTERLOCK_ATTEMPT !== '3') throw new Error('retry me');
    return input === 0 ? { loop: true, first: env } : { loop: false, first: input.first, last: env };
  `);
  const node = definition.nodes[1];
  if (node.kind !== 'script') throw new Error('Expected Script');
  node.routing = {
    path: 'loop',
    cases: [{ equals: true, port: 'again' }],
    default: 'done',
  };
  definition.edges[1].port = 'done';
  definition.edges.push({
    id: 'again',
    source: node.id,
    target: node.id,
    port: 'again',
  });
  const root = engine.start(publish(engine, definition), 0).run;
  await waitForRun(engine, root.id, 'failed');
  engine.retry(root.id);
  await waitForRun(engine, root.id, 'failed');
  engine.retry(root.id);
  const run = await waitForRun(engine, root.id);
  const [first, second, third, loop] = run.executions.filter(
    (step) => step.nodeId === node.id,
  );
  expect(new Set([first.id, second.id, third.id, loop.id]).size).toBe(4);
  expect(second.attempt).toBe(2);
  const expected = expectedIdentity(run);
  expect(run.output).toEqual({
    loop: false,
    first: {
      ...expected,
      INTERLOCK_EXECUTION_ID: third.id,
      INTERLOCK_ATTEMPT: '3',
    },
    last: { ...expected, INTERLOCK_EXECUTION_ID: loop.id },
  });
});

function pollingScript(command: string) {
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    label: 'Check twice',
    kind: 'wait',
    timing: {
      kind: 'poll',
      everyMs: 1_000,
      path: 'ready',
      equals: true,
      check: {
        kind: 'script',
        language: 'javascript',
        command,
      },
    },
  });
  return definition;
}

it('gives polling Script checks the Wait execution and a separate check number', async () => {
  const engine = setup();
  const definition = pollingScript(
    `return { ready: process.env.INTERLOCK_POLL_CHECK_NUMBER === '2', env: ${readEnvironment} };`,
  );
  const root = engine.start(publish(engine, definition), {
    passedThrough: true,
  }).run;
  const first = await vi.waitFor(
    () => {
      const run = engine.run(root.id);
      const check = run.executions.at(-1)?.check;
      expect(check?.count).toBe(1);
      return run;
    },
    { timeout: 3_000 },
  );
  expect(first.executions.at(-1)?.check?.output).toEqual({
    ready: false,
    env: { ...expectedIdentity(first), INTERLOCK_POLL_CHECK_NUMBER: '1' },
  });
  const done = await vi.waitFor(
    () => {
      engine.pump();
      const run = engine.run(root.id);
      expect(run.status, run.error).toBe('completed');
      return run;
    },
    { timeout: 5_000 },
  );
  expect(done.output).toEqual({
    ready: true,
    passedThrough: true,
    env: { ...expectedIdentity(first), INTERLOCK_POLL_CHECK_NUMBER: '2' },
  });
});

it('restarts check numbering in a new polling Wait attempt', async () => {
  const engine = setup();
  const definition = pollingScript(`
    if (process.env.INTERLOCK_ATTEMPT === '1') return {};
    return { ready: true, env: ${readEnvironment} };
  `);
  const { id } = engine.start(publish(engine, definition), null).run;
  const failed = await waitForRun(engine, id, 'failed');
  const failedExecution = failed.executions.at(-1)!;
  expect(failedExecution.check?.count).toBe(1);

  engine.retry(id);
  const retried = await waitForRun(engine, id);
  const retry = retried.executions.filter((step) => step.kind === 'wait')[1];
  expect(retry.id).not.toBe(failedExecution.id);
  expect(retry.check?.count).toBe(1);
  expect(retried.output).toEqual({
    ready: true,
    env: {
      ...expectedIdentity(retried),
      INTERLOCK_EXECUTION_ID: retry.id,
      INTERLOCK_ATTEMPT: '2',
      INTERLOCK_POLL_CHECK_NUMBER: '1',
    },
  });
});

it('preserves an existing workflow variable binding that uses a context name', async () => {
  const engine = setup();
  const variable = engine.variables.mutate({
    action: 'create',
    name: 'existing_run_id',
    kind: 'config',
    value: 'existing-value',
  }) as SavedVariable;
  const definition = script();
  const node = definition.nodes[1];
  if (node.kind !== 'script') throw new Error('Expected Script');
  node.environment = [{ name: 'INTERLOCK_RUN_ID', variableId: variable.id }];
  const started = engine.start(publish(engine, definition), null).run;
  const run = await waitForRun(engine, started.id);
  expect(run.output).toEqual({
    input: null,
    env: { ...expectedIdentity(run), INTERLOCK_RUN_ID: 'existing-value' },
  });
});

it('uses the original environment when spawn rejects the added context', async () => {
  vi.stubEnv('INTERLOCK_RUN_ID', 'inherited-run');
  vi.stubEnv('INTERLOCK_EXECUTION_ID', undefined);
  const launch = vi
    .spyOn(scripts, 'executeScript')
    .mockRejectedValueOnce(
      Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' }),
    );
  try {
    const engine = setup();
    const definition = script('return process.env.INTERLOCK_RUN_ID;');
    const { id } = engine.start(publish(engine, definition), null).run;
    expect((await waitForRun(engine, id)).output).toBe('inherited-run');
    expect(launch).toHaveBeenCalledTimes(2);
    expect(launch.mock.calls[0][6]?.INTERLOCK_RUN_ID).toBe(id);
    expect(launch.mock.calls[1][6]?.INTERLOCK_RUN_ID).toBe('inherited-run');
    expect(launch.mock.calls[1][6]?.INTERLOCK_EXECUTION_ID).toBeUndefined();
  } finally {
    launch.mockRestore();
  }
});

it.each([
  ['contains a NUL byte', 'script\0node'],
  ['contains an unpaired surrogate', 'script\uD800node'],
  ['exceeds the portable context size limit', 'x'.repeat(140 * 1024)],
])('keeps a Script runnable if its existing node ID %s', async (_label, id) => {
  const engine = setup();
  const definition = script();
  definition.nodes[1].id = id;
  definition.edges[0].target = id;
  definition.edges[1].source = id;
  const { id: runId } = engine.start(publish(engine, definition), null).run;
  const run = await waitForRun(engine, runId);
  expect(
    Object.hasOwn((run.output as { env: object }).env, 'INTERLOCK_NODE_ID'),
  ).toBe(false);
  const { INTERLOCK_NODE_ID: _omitted, ...env } = expectedIdentity(
    run,
    runId,
    id,
  );
  expect(run.output).toEqual({ input: null, env });
});

const readServerKeys = {
  javascript:
    "const e = process.env; return [e.SERVER_ONLY_API_KEY ?? '', e.DECLARED_KEY ?? '', e.BOUND_KEY ?? '', !!e.PATH, e.INTERLOCK_RUN_ID === undefined ? '' : 'run'].join(':');",
  bash: 'printf \'"%s:%s:%s:%s:%s"\' "${SERVER_ONLY_API_KEY-}" "${DECLARED_KEY-}" "${BOUND_KEY-}" "$([ -n "$PATH" ] && echo true || echo false)" "${INTERLOCK_RUN_ID:+run}"',
};
it.each([
  ['javascript', undefined, 'server-key:declared:bound:true:run'],
  ['javascript', 'minimal', ':declared:bound:true:run'],
  ['bash', 'minimal', ':declared:bound:true:run'],
] as const)(
  'gives a %s Script in %s mode the expected server environment',
  async (language, environmentMode, expected) => {
    vi.stubEnv('SERVER_ONLY_API_KEY', 'server-key');
    vi.stubEnv('DECLARED_KEY', 'declared');
    const engine = setup();
    const variable = engine.variables.mutate({
      action: 'create',
      name: 'bound',
      kind: 'config',
      value: 'bound',
    }) as SavedVariable;
    const definition = script(readServerKeys[language], language);
    Object.assign(definition.nodes[1], {
      environmentMode,
      environmentPassthrough: ['DECLARED_KEY'],
      environment: [{ name: 'BOUND_KEY', variableId: variable.id }],
    });
    const { id } = engine.start(publish(engine, definition), null).run;
    expect((await waitForRun(engine, id)).output).toBe(expected);
  },
);

it('names a server variable withheld from a failed minimal Script and its fix', async () => {
  vi.stubEnv('SERVER_ONLY_API_KEY', 'server-secret-value');
  const engine = setup();
  const definition = script(
    'test -n "$SERVER_ONLY_API_KEY" || { echo "token missing" >&2; exit 1; }',
    'bash',
  );
  Object.assign(definition.nodes[1], { environmentMode: 'minimal' });
  const { id } = engine.start(publish(engine, definition), null).run;
  const run = await waitForRun(engine, id, 'failed');
  expect(run.error).toMatch(
    /did not pass SERVER_ONLY_API_KEY .*environmentPassthrough.*inherit/,
  );
  expect(run.error).not.toContain('server-secret-value');
});

it('keeps a local Git trial hardened environment intact in minimal mode', () => {
  vi.stubEnv('SERVER_ONLY_API_KEY', 'server-key');
  const env = scripts.baseEnvironment(
    { environmentMode: 'minimal' },
    trialProcessEnvironment(),
  );
  expect(env).toMatchObject({
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1',
  });
  expect(env.SERVER_ONLY_API_KEY).toBeUndefined();
});
