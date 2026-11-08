import { afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  type WorkflowDefinition,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';

const engines: Engine[] = [];
function setup() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) {
    await engine.executors.stop();
    engine.stop();
    engine.store.close();
  }
});

function publish(engine: Engine, definition: WorkflowDefinition) {
  const workflow = engine.create('Provenance test', '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}

it('records engine-verified execution provenance and prevents agent spoofing', async () => {
  const engine = setup();
  const definition = blankDefinition();

  // Node 1: Agent node
  definition.nodes[1] = nodeSchema.parse({
    id: 'agentNode',
    kind: 'agent',
    label: 'Agent Step',
    prompt: 'Do something',
  });

  // Node 2: Script node that inspects incoming input bound from execution provenance
  definition.nodes.push(
    nodeSchema.parse({
      id: 'downstream',
      kind: 'script',
      label: 'Downstream',
      language: 'javascript',
      command: 'return input;',
      inputBindings: {
        agentProvenance: {
          source: 'execution',
          nodeId: 'agentNode',
          path: '',
        },
        agentVisitCount: {
          source: 'execution',
          nodeId: 'agentNode',
          path: 'visitCount',
        },
        spoofedField: {
          source: 'node',
          nodeId: 'agentNode',
          path: 'spoofedProp',
          default: 'missing',
        },
      },
    }),
  );

  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'agentNode' },
    { id: 'e2', source: 'agentNode', port: 'default', target: 'downstream' },
    { id: 'e3', source: 'downstream', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, { test: 1 }).run;

  const work = engine.store.work('available', run.id)[0];
  expect(work).toBeDefined();

  // Claim and attempt to submit a spoofed payload containing "provenance" and "actualModel"
  const claimed = engine.claim(
    work.id,
    { workerId: 'attacker', freshContext: false, tools: [], skills: [] },
    300,
  );
  engine.submit(work.id, claimed.token!, {
    spoofedProp: 'attackerValue',
    provenance: {
      profileId: 'fake-profile',
      actualModel: 'fake-super-model-4000',
      visitCount: 999,
    },
    actualModel: 'fake-model',
  });

  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));

  const completedRun = engine.run(run.id);
  const agentExecution = completedRun.executions.find(
    (e) => e.nodeId === 'agentNode',
  )!;
  expect(agentExecution.status).toBe('completed');
  expect(agentExecution.provenance).toBeDefined();

  // Engine verified: agentExecution.provenance cannot be spoofed by agent output
  expect(agentExecution.provenance).toEqual({
    profileId: null,
    harness: null,
    sessionId: null,
    requestedModel: null,
    actualModel: null,
    provider: null,
    effort: null,
    attempt: 1,
    visitCount: 1,
    startedAt: agentExecution.startedAt,
    endedAt: agentExecution.completedAt,
    usage: null,
  });

  // Downstream script received the engine's verified provenance, not the agent's spoofed payload
  const downstreamExecution = completedRun.executions.find(
    (e) => e.nodeId === 'downstream',
  )!;
  expect(downstreamExecution.input).toMatchObject({
    agentProvenance: {
      attempt: 1,
      visitCount: 1,
      actualModel: null,
    },
    agentVisitCount: 1,
    spoofedField: 'attackerValue',
  });
});

it('resolves execution bindings with sourceDefault and path default fallbacks', async () => {
  const engine = setup();
  const definition = blankDefinition();

  // Branch routes to script1, leaving unrunNode unexecuted
  definition.nodes[1] = nodeSchema.parse({
    id: 'branch',
    kind: 'condition',
    label: 'Branch',
    path: '',
    equals: true,
  });

  definition.nodes.push(
    nodeSchema.parse({
      id: 'script1',
      kind: 'script',
      label: 'Script 1',
      language: 'javascript',
      command: 'return input;',
      inputBindings: {
        fallbackCount: {
          source: 'execution',
          nodeId: 'unrunNode',
          path: 'visitCount',
          sourceDefault: 0,
        },
      },
    }),
    nodeSchema.parse({
      id: 'unrunNode',
      kind: 'script',
      label: 'Unrun Node',
      language: 'javascript',
      command: 'return { done: true };',
    }),
  );

  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'branch' },
    { id: 'e2', source: 'branch', port: 'true', target: 'script1' },
    { id: 'e3', source: 'branch', port: 'false', target: 'unrunNode' },
    { id: 'e4', source: 'script1', port: 'default', target: 'exit' },
    { id: 'e5', source: 'unrunNode', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, true).run;

  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));

  const script1Execution = engine
    .run(run.id)
    .executions.find((e) => e.nodeId === 'script1')!;
  expect(script1Execution.input).toEqual({ fallbackCount: 0 });
});

it('fails execution binding when sourceDefault is omitted and node has not run', () => {
  const engine = setup();
  const definition = blankDefinition();

  definition.nodes[1] = nodeSchema.parse({
    id: 'branch',
    kind: 'condition',
    label: 'Branch',
    path: '',
    equals: true,
  });

  definition.nodes.push(
    nodeSchema.parse({
      id: 'script1',
      kind: 'script',
      label: 'Script 1',
      language: 'javascript',
      command: 'return input;',
      inputBindings: {
        strictCount: {
          source: 'execution',
          nodeId: 'unrunNode',
          path: 'visitCount',
        },
      },
    }),
    nodeSchema.parse({
      id: 'unrunNode',
      kind: 'script',
      label: 'Unrun Node',
      language: 'javascript',
      command: 'return { done: true };',
    }),
  );

  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'branch' },
    { id: 'e2', source: 'branch', port: 'true', target: 'script1' },
    { id: 'e3', source: 'branch', port: 'false', target: 'unrunNode' },
    { id: 'e4', source: 'script1', port: 'default', target: 'exit' },
    { id: 'e5', source: 'unrunNode', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, true).run;

  expect(run.status).toBe('failed');
  expect(run.error).toContain(
    'Node "unrunNode" has no completed execution in this run',
  );
});

it('increments visitCount accurately across loop visits and terminates via Branch condition', async () => {
  const engine = setup();
  const definition = blankDefinition();

  // Workflow loop:
  // entry -> loopStep -> branch
  // branch: if execution.loopStep.visitCount === 3 -> exit
  // else default -> loopStep
  definition.nodes[1] = nodeSchema.parse({
    id: 'loopStep',
    kind: 'script',
    label: 'Loop Step',
    language: 'javascript',
    command: 'return { step: "loop" };',
  });

  definition.nodes.push(
    nodeSchema.parse({
      id: 'branch',
      kind: 'switch',
      label: 'Branch Step',
      path: 'execution.loopStep.visitCount',
      cases: [{ port: 'done', equals: 3 }],
      default: 'loop',
    }),
  );

  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'loopStep' },
    { id: 'e2', source: 'loopStep', port: 'default', target: 'branch' },
    { id: 'e3', source: 'branch', port: 'loop', target: 'loopStep' },
    { id: 'e4', source: 'branch', port: 'done', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, {}).run;

  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));

  const finalRun = engine.run(run.id);
  const loopExecutions = finalRun.executions.filter(
    (e) => e.nodeId === 'loopStep',
  );

  expect(loopExecutions).toHaveLength(3);
  expect(loopExecutions[0].provenance?.visitCount).toBe(1);
  expect(loopExecutions[1].provenance?.visitCount).toBe(2);
  expect(loopExecutions[2].provenance?.visitCount).toBe(3);

  const branchExecutions = finalRun.executions.filter(
    (e) => e.nodeId === 'branch',
  );
  expect(branchExecutions).toHaveLength(3);
  expect(branchExecutions[0].port).toBe('loop');
  expect(branchExecutions[1].port).toBe('loop');
  expect(branchExecutions[2].port).toBe('done');
});

it('injects INTERLOCK_EXECUTION_PROVENANCE_FILE for scripts to read prior node provenance', async () => {
  const engine = setup();
  const definition = blankDefinition();

  // Node 1: script node that completes first
  definition.nodes[1] = nodeSchema.parse({
    id: 'firstNode',
    kind: 'script',
    label: 'First Node',
    language: 'javascript',
    command: 'return { first: "success" };',
  });

  // Node 2: script that reads INTERLOCK_EXECUTION_PROVENANCE_FILE
  definition.nodes.push(
    nodeSchema.parse({
      id: 'readerScript',
      kind: 'script',
      label: 'Reader Script',
      language: 'javascript',
      command: `
        const fs = require('node:fs');
        const provenanceFile = process.env.INTERLOCK_EXECUTION_PROVENANCE_FILE;
        if (!provenanceFile) throw new Error('Missing provenance file env');
        const content = JSON.parse(fs.readFileSync(provenanceFile, 'utf8'));
        return {
          hasProvenanceFile: true,
          firstNodeVisitCount: content.firstNode?.visitCount,
          firstNodeLatest: content.firstNode?.latest,
          historyLength: content.firstNode?.history?.length,
        };
      `,
    }),
  );

  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'firstNode' },
    { id: 'e2', source: 'firstNode', port: 'default', target: 'readerScript' },
    { id: 'e3', source: 'readerScript', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, {}).run;

  await vi.waitFor(() => expect(engine.run(run.id).status).toBe('completed'));

  const finalRun = engine.run(run.id);
  expect(finalRun.output).toMatchObject({
    hasProvenanceFile: true,
    firstNodeVisitCount: 1,
    historyLength: 1,
    firstNodeLatest: {
      attempt: 1,
      visitCount: 1,
    },
  });
});

it('rejects publishing workflows with invalid execution binding targets', () => {
  const engine = setup();
  const definition = blankDefinition();

  definition.nodes[1] = nodeSchema.parse({
    id: 'step1',
    kind: 'script',
    label: 'Step 1',
    language: 'javascript',
    command: 'return input;',
    inputBindings: {
      invalidTarget: {
        source: 'execution',
        nodeId: 'nonExistentNode',
        path: 'visitCount',
      },
    },
  });

  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'step1' },
    { id: 'e2', source: 'step1', port: 'default', target: 'exit' },
  ];

  const workflow = engine.create('Invalid binding', '', definition);
  expect(() => engine.publish(workflow.id)).toThrowError(
    /execution binding must reference an existing non-Entry\/Exit node/,
  );
});

it('records verified provenance for managed agent executions including model, effort, and usage', async () => {
  const engine = setup();
  engine.executors.saveProfile({
    id: 'codex',
    harness: 'codex',
    name: 'Codex Profile',
    enabled: true,
    model: 'gpt-4o',
    effort: 'medium',
    expectedRevision: 0,
  });

  engine.executors.start([
    {
      id: 'codex',
      detect: async () => ({
        command: '/bin/fake',
        status: 'detected',
        version: '1',
      }),
      models: async () => ({
        models: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            effortLevels: ['low', 'medium', 'high'],
          },
        ],
      }),
      run: async (i) => {
        i.onSession('native-session-123');
        return {
          output: { answer: 'verified' },
          usage: [
            {
              provider: 'openai',
              model: 'gpt-4o-2024-08-06',
              inputTokens: 100,
              outputTokens: 50,
            },
          ],
        };
      },
    },
  ]);

  const definition = blankDefinition();
  definition.executor = 'codex';
  definition.nodes[1] = nodeSchema.parse({
    id: 'agent',
    kind: 'agent',
    label: 'Managed Agent',
    prompt: 'Execute task',
  });

  const workflowId = publish(engine, definition);
  const start = engine.start(workflowId, {});
  let run = engine.run(start.run.id);

  for (let i = 0; i < 30; i++) {
    engine.pump();
    await new Promise((r) => setTimeout(r, 50));
    run = engine.run(run.id);
    if (run.status === 'completed') break;
  }

  expect(run.status).toBe('completed');

  const agentExecution = run.executions.find((e) => e.nodeId === 'agent')!;
  expect(agentExecution.status).toBe('completed');
  expect(agentExecution.provenance).toMatchObject({
    profileId: 'codex',
    harness: 'codex',
    requestedModel: 'gpt-4o',
    actualModel: 'gpt-4o-2024-08-06',
    provider: 'openai',
    effort: 'medium',
    attempt: 1,
    visitCount: 1,
    usage: [
      {
        provider: 'openai',
        model: 'gpt-4o-2024-08-06',
        inputTokens: 100,
        outputTokens: 50,
      },
    ],
  });
});
