import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  InterlockError,
  type WorkflowDefinition,
} from '@interlock/core';
import { projectRun } from '../packages/runtime/src/runProjection';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';

const engines: Engine[] = [];
const dirs: string[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-aliases-'));
  dirs.push(dir);
  const engine = new Engine(new Store(':memory:'), dir);
  engines.push(engine);
  return { engine, dir };
}

afterEach(() => {
  for (const engine of engines) {
    try {
      engine.stop();
      engine.store.close();
    } catch {}
  }
  engines.length = 0;
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  dirs.length = 0;
});

function publish(engine: Engine, definition: WorkflowDefinition) {
  const workflow = engine.create(
    'Test Workflow',
    'Workflow for testing model aliases',
    definition,
  );
  engine.publish(workflow.id);
  return workflow.id;
}

it('manages model aliases with revision protection and prevents duplicate names', () => {
  const { engine } = setup();

  // Create alias
  const alias = engine.modelAliases.mutate({
    action: 'create',
    name: 'builder',
    description: 'Primary builder alias',
    candidates: [{ model: 'claude-3-7-sonnet', effort: 'high' }],
  }) as import('@interlock/core').SavedModelAlias;

  expect(alias.id).toBeDefined();
  expect(alias.name).toBe('builder');
  expect(alias.revision).toBe(1);
  expect(alias.candidates).toEqual([
    { model: 'claude-3-7-sonnet', effort: 'high' },
  ]);

  // Prevent duplicate name (case-insensitive)
  expect(() =>
    engine.modelAliases.mutate({
      action: 'create',
      name: 'Builder',
      candidates: [{ model: 'gpt-4o' }],
    }),
  ).toThrow(InterlockError);

  // List and inspect
  const list = engine.modelAliases.list();
  expect(list.items).toHaveLength(1);
  expect(list.items[0].name).toBe('builder');

  const inspected = engine.modelAliases.read({
    action: 'inspect',
    id: alias.id,
  }) as import('@interlock/core').SavedModelAlias;
  expect(inspected.name).toBe('builder');

  // Update alias with matching revision
  const updated = engine.modelAliases.mutate({
    action: 'update',
    id: alias.id,
    expectedRevision: 1,
    candidates: [
      { model: 'claude-3-7-sonnet', effort: 'medium' },
      { model: 'gpt-4o' },
    ],
  }) as import('@interlock/core').SavedModelAlias;

  expect(updated.revision).toBe(2);
  expect(updated.candidates).toHaveLength(2);

  // Conflicting revision fails
  expect(() =>
    engine.modelAliases.mutate({
      action: 'update',
      id: alias.id,
      expectedRevision: 1,
      description: 'stale update',
    }),
  ).toThrow(InterlockError);

  // Conflicting delete fails
  expect(() =>
    engine.modelAliases.mutate({
      action: 'delete',
      id: alias.id,
      expectedRevision: 1,
    }),
  ).toThrow(InterlockError);

  // Successful delete
  const deleted = engine.modelAliases.mutate({
    action: 'delete',
    id: alias.id,
    expectedRevision: 2,
  });
  expect(deleted).toEqual({ id: alias.id });

  expect(engine.modelAliases.get('builder')).toBeUndefined();
});

it('captures model aliases at run start and pins revisions against mid-run mutations', () => {
  const { engine } = setup();

  // Create alias
  const alias = engine.modelAliases.mutate({
    action: 'create',
    name: 'builder',
    candidates: [{ model: 'claude-3-7-sonnet', effort: 'high' }],
  }) as import('@interlock/core').SavedModelAlias;

  const definition = blankDefinition();
  definition.executor = 'codex';
  definition.nodes[1] = nodeSchema.parse({
    id: 'step1',
    kind: 'agent',
    label: 'Step 1',
    prompt: 'Do work',
    model: 'builder',
  });
  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'step1' },
    { id: 'e2', source: 'step1', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, {}).run;

  // Run captured model alias revision 1
  expect(run.modelAliasCaptures).toBeDefined();
  expect(run.modelAliasCaptures).toHaveLength(1);
  expect(run.modelAliasCaptures![0].name).toBe('builder');
  expect(run.modelAliasCaptures![0].revision).toBe(1);
  expect(run.modelAliasCaptures![0].candidates[0].model).toBe(
    'claude-3-7-sonnet',
  );

  // Check work dispatched with captured model
  const work1 = engine.store.work('available', run.id)[0];
  expect(work1.executorModel).toBe('claude-3-7-sonnet');
  expect(work1.executorEffort).toBe('high');

  // Now mutate the alias in the store to something completely different
  engine.modelAliases.mutate({
    action: 'update',
    id: alias.id,
    expectedRevision: 1,
    candidates: [{ model: 'mutated-model-should-not-affect-run' }],
  });

  // Verify that an active run reading its captures still uses the pinned alias definition
  const resolved = engine.modelAliases.resolveCandidates(
    run.modelAliasCaptures,
    'builder',
  );
  expect(resolved).toEqual([{ model: 'claude-3-7-sonnet', effort: 'high' }]);
});

it('resolves alias candidate fallback honoring profile availability', () => {
  const { engine } = setup();

  // Configure executor profiles: one disabled, one enabled
  engine.executors.saveProfile({
    id: 'codex-disabled',
    name: 'Disabled Profile',
    harness: 'codex',
    enabled: false,
    model: 'claude-3-7-sonnet',
    expectedRevision: 0,
  });

  engine.executors.saveProfile({
    id: 'pi-enabled',
    name: 'Enabled Profile',
    harness: 'pi',
    enabled: true,
    model: 'gpt-4o',
    expectedRevision: 0,
  });

  // Alias with first candidate pointing to disabled profile, second to enabled profile
  engine.modelAliases.mutate({
    action: 'create',
    name: 'builder',
    candidates: [
      {
        model: 'claude-3-7-sonnet',
        profileId: 'codex-disabled',
        effort: 'high',
      },
      { model: 'gpt-4o', profileId: 'pi-enabled', effort: 'medium' },
    ],
  });

  const definition = blankDefinition();
  definition.executor = 'codex';
  definition.nodes[1] = nodeSchema.parse({
    id: 'step1',
    kind: 'agent',
    label: 'Step 1',
    prompt: 'Do work',
    model: 'builder',
  });
  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'step1' },
    { id: 'e2', source: 'step1', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, {}).run;

  const work = engine.store.work('available', run.id)[0];
  // Fell back to pi-enabled profile with gpt-4o
  expect(work.executor).toBe('pi-enabled');
  expect(work.executorModel).toBe('gpt-4o');
  expect(work.executorEffort).toBe('medium');
});

it('expands model aliases in distinctProviderFrom and blocks with runProjection when exhausted', () => {
  const { engine } = setup();

  // Reviewer alias with candidates: first is anthropic, second is openai
  engine.modelAliases.mutate({
    action: 'create',
    name: 'reviewer',
    candidates: [{ model: 'claude-3-5-sonnet' }, { model: 'gpt-4o' }],
  });

  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'author',
    kind: 'agent',
    label: 'Author',
    prompt: 'Write code',
    model: 'claude-3-5-sonnet',
  });
  definition.nodes.push(
    nodeSchema.parse({
      id: 'review',
      kind: 'agent',
      label: 'Review',
      prompt: 'Review code',
      model: 'reviewer',
      distinctProviderFrom: ['author'],
    }),
  );
  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'author' },
    { id: 'e2', source: 'author', port: 'default', target: 'review' },
    { id: 'e3', source: 'review', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, {}).run;

  // Complete author on anthropic
  const authorWork = engine.store.work('available', run.id)[0];
  const claimedAuthor = engine.claim(
    authorWork.id,
    { workerId: 'w1', freshContext: false, tools: [], skills: [] },
    300,
  );
  engine.submit(authorWork.id, claimedAuthor.token!, { ok: true });

  // review step becomes available and selects gpt-4o (second candidate in alias) because author used anthropic
  const reviewWork = engine.store
    .work('available', run.id)
    .find((w) => w.nodeId === 'review')!;
  expect(reviewWork.executorModel).toBe('gpt-4o');
  expect(reviewWork.providerDiversityBlocked).toBeUndefined();

  // Now test exhaustion: an alias where all candidates are anthropic
  engine.modelAliases.mutate({
    action: 'create',
    name: 'strict-reviewer',
    candidates: [
      { model: 'claude-3-5-sonnet' },
      { model: 'claude-3-7-sonnet' },
    ],
  });

  const definition2 = blankDefinition();
  definition2.nodes[1] = nodeSchema.parse({
    id: 'author2',
    kind: 'agent',
    label: 'Author',
    prompt: 'Write code',
    model: 'claude-3-5-sonnet',
  });
  definition2.nodes.push(
    nodeSchema.parse({
      id: 'review2',
      kind: 'agent',
      label: 'Review',
      prompt: 'Review code',
      model: 'strict-reviewer',
      distinctProviderFrom: ['author2'],
    }),
  );
  definition2.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'author2' },
    { id: 'e2', source: 'author2', port: 'default', target: 'review2' },
    { id: 'e3', source: 'review2', port: 'default', target: 'exit' },
  ];

  const workflowId2 = publish(engine, definition2);
  const run2 = engine.start(workflowId2, {}).run;

  const authorWork2 = engine.store.work('available', run2.id)[0];
  const claimedAuthor2 = engine.claim(
    authorWork2.id,
    { workerId: 'w1', freshContext: false, tools: [], skills: [] },
    300,
  );
  engine.submit(authorWork2.id, claimedAuthor2.token!, { ok: true });

  // review2 is blocked because all candidates belong to excluded provider anthropic
  const reviewWork2 = engine.store
    .work(undefined, run2.id)
    .find((w) => w.nodeId === 'review2')!;
  expect(reviewWork2.providerDiversityBlocked).toBeDefined();
  expect(reviewWork2.providerDiversityBlocked?.reason).toBe(
    'provider_diversity_exhausted',
  );

  // Verify runProjection projects human_request / person with provider_diversity_exhausted reason
  const projection = engine.projectRun(run2.id);
  expect(projection.waiting?.kind).toBe('human_request');
  expect(projection.actor).toBe('person');
  expect(projection.waiting?.detail.message).toBe(
    'provider_diversity_exhausted',
  );
});

it('exports workflow bundles with alias requirements without local overrides', () => {
  const { engine } = setup();

  // Create alias
  engine.modelAliases.mutate({
    action: 'create',
    name: 'builder',
    description: 'Build agent alias',
    candidates: [{ model: 'claude-3-7-sonnet', profileId: 'local-private-p' }],
  });

  const definition = blankDefinition();
  definition.executor = 'codex';
  definition.nodes[1] = nodeSchema.parse({
    id: 'step1',
    kind: 'agent',
    label: 'Step 1',
    prompt: 'Do work',
    model: 'builder',
  });
  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'step1' },
    { id: 'e2', source: 'step1', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);

  // Export bundle
  const bundle = exportWorkflows(engine.store, workflowId);
  expect(bundle.formatVersion).toBe(6);
  expect(bundle.modelAliases).toEqual([
    { name: 'builder', description: 'Build agent alias' },
  ]);
  // Verify bundle does NOT contain candidates or profileId
  expect((bundle.modelAliases![0] as any).candidates).toBeUndefined();

  // Import into a new store
  const { engine: newEngine } = setup();
  importWorkflows(newEngine.store, bundle);

  // Imported workflow exists
  const imported = newEngine.workflow(workflowId);
  expect(imported.name).toBe('Test Workflow');
});
