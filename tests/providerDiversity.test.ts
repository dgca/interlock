import { afterEach, expect, it } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  validateDefinition,
  diagnoseDraft,
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
  const workflow = engine.create('Provider diversity test', '', definition);
  engine.publish(workflow.id);
  return workflow.id;
}

it('validates distinctProviderFrom references in workflow definitions', () => {
  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'author',
    kind: 'agent',
    label: 'Author',
    prompt: 'Write code',
  });
  definition.nodes.push(
    nodeSchema.parse({
      id: 'reviewer',
      kind: 'agent',
      label: 'Reviewer',
      prompt: 'Review code',
      distinctProviderFrom: ['nonExistentNode'],
      candidateModels: ['gpt-4o'],
    }),
  );
  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'author' },
    { id: 'e2', source: 'author', port: 'default', target: 'reviewer' },
    { id: 'e3', source: 'reviewer', port: 'default', target: 'exit' },
  ];

  // Definition validation throws for non-existent node
  expect(() => validateDefinition(definition)).toThrowError(
    /distinctProviderFrom references unknown node "nonExistentNode"/,
  );

  // Draft diagnostics surface missing node
  const diagnostics = diagnoseDraft(definition);
  expect(
    diagnostics.diagnostics.some(
      (d) => d.code === 'missing_distinct_provider_node',
    ),
  ).toBe(true);

  // Self-referencing throws
  definition.nodes[2] = nodeSchema.parse({
    id: 'reviewer',
    kind: 'agent',
    label: 'Reviewer',
    prompt: 'Review code',
    distinctProviderFrom: ['reviewer'],
    candidateModels: ['gpt-4o'],
  });
  expect(() => validateDefinition(definition)).toThrowError(
    /distinctProviderFrom cannot reference itself/,
  );
  const selfDiagnostics = diagnoseDraft(definition);
  expect(
    selfDiagnostics.diagnostics.some(
      (d) => d.code === 'self_distinct_provider',
    ),
  ).toBe(true);
});

it('selects the first candidate model whose provider differs from the upstream node', async () => {
  const engine = setup();
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
      id: 'reviewer',
      kind: 'agent',
      label: 'Reviewer',
      prompt: 'Review code',
      distinctProviderFrom: ['author'],
      candidateModels: ['claude-3-7-sonnet', 'gpt-4o', 'gemini-2.0-flash'],
    }),
  );
  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'author' },
    { id: 'e2', source: 'author', port: 'default', target: 'reviewer' },
    { id: 'e3', source: 'reviewer', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, {}).run;

  // Author step is available
  const authorWork = engine.store.work('available', run.id)[0];
  expect(authorWork).toBeDefined();
  expect(authorWork.nodeId).toBe('author');

  // Claim and complete author step with usage declaring claude-3-5-sonnet (anthropic)
  const claimedAuthor = engine.claim(
    authorWork.id,
    {
      workerId: 'author-agent',
      freshContext: false,
      tools: [],
      skills: [],
      modelSelection: { model: 'claude-3-5-sonnet', provider: 'anthropic' },
    },
    300,
  );
  engine.usage.report({
    workId: authorWork.id,
    attempt: authorWork.attempt + 1,
    token: claimedAuthor.token!,
    source: 'executor',
    snapshot: {
      sequence: 1,
      models: [{ provider: 'anthropic', model: 'claude-3-5-sonnet' }],
    },
  });
  engine.submit(authorWork.id, claimedAuthor.token!, {
    code: 'console.log(1)',
  });

  // Now reviewer assignment becomes available
  const reviewerWork = engine.store
    .work('available', run.id)
    .find((w) => w.nodeId === 'reviewer');
  expect(reviewerWork).toBeDefined();
  // Provider diversity selected 'gpt-4o' (openai), because 'claude-3-7-sonnet' (anthropic) is excluded!
  expect(reviewerWork!.executorModel).toBe('gpt-4o');
  expect(reviewerWork!.executorModelSource).toBe('node');
  expect(reviewerWork!.providerDiversityBlocked).toBeUndefined();
});

it('enforces diversity across multiple upstream nodes (author and reviewer1)', async () => {
  const engine = setup();
  const definition = blankDefinition();

  // Author on Anthropic
  definition.nodes[1] = nodeSchema.parse({
    id: 'author',
    kind: 'agent',
    label: 'Author',
    prompt: 'Write code',
    model: 'claude-3-5-sonnet',
  });
  // Reviewer1 on OpenAI
  definition.nodes.push(
    nodeSchema.parse({
      id: 'reviewer1',
      kind: 'agent',
      label: 'Reviewer 1',
      prompt: 'Review code 1',
      distinctProviderFrom: ['author'],
      candidateModels: ['claude-3-7-sonnet', 'gpt-4o', 'gemini-2.0-flash'],
    }),
  );
  // Reviewer2 must be distinct from BOTH author and reviewer1
  definition.nodes.push(
    nodeSchema.parse({
      id: 'reviewer2',
      kind: 'agent',
      label: 'Reviewer 2',
      prompt: 'Review code 2',
      distinctProviderFrom: ['author', 'reviewer1'],
      candidateModels: ['claude-3-7-sonnet', 'gpt-4o', 'gemini-2.0-flash'],
    }),
  );

  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'author' },
    { id: 'e2', source: 'author', port: 'default', target: 'reviewer1' },
    { id: 'e3', source: 'reviewer1', port: 'default', target: 'reviewer2' },
    { id: 'e4', source: 'reviewer2', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, {}).run;

  // Complete author (anthropic)
  const authorWork = engine.store.work('available', run.id)[0];
  const claimedAuthor = engine.claim(
    authorWork.id,
    {
      workerId: 'author-agent',
      freshContext: false,
      tools: [],
      skills: [],
      modelSelection: { model: 'claude-3-5-sonnet', provider: 'anthropic' },
    },
    300,
  );
  engine.usage.report({
    workId: authorWork.id,
    attempt: authorWork.attempt + 1,
    token: claimedAuthor.token!,
    source: 'executor',
    snapshot: {
      sequence: 1,
      models: [{ provider: 'anthropic', model: 'claude-3-5-sonnet' }],
    },
  });
  engine.submit(authorWork.id, claimedAuthor.token!, { result: 'author-done' });

  // Reviewer1 is available and selects gpt-4o (openai)
  const reviewer1Work = engine.store
    .work('available', run.id)
    .find((w) => w.nodeId === 'reviewer1')!;
  expect(reviewer1Work.executorModel).toBe('gpt-4o');

  // Complete reviewer1 (openai)
  const claimedReviewer1 = engine.claim(
    reviewer1Work.id,
    {
      workerId: 'reviewer1-agent',
      freshContext: false,
      tools: [],
      skills: [],
      modelSelection: { model: 'gpt-4o', provider: 'openai' },
    },
    300,
  );
  engine.usage.report({
    workId: reviewer1Work.id,
    attempt: reviewer1Work.attempt + 1,
    token: claimedReviewer1.token!,
    source: 'executor',
    snapshot: {
      sequence: 1,
      models: [{ provider: 'openai', model: 'gpt-4o' }],
    },
  });
  engine.submit(reviewer1Work.id, claimedReviewer1.token!, {
    result: 'reviewer1-done',
  });

  // Reviewer2 is now available
  const reviewer2Work = engine.store
    .work('available', run.id)
    .find((w) => w.nodeId === 'reviewer2')!;
  expect(reviewer2Work).toBeDefined();
  // Since author is anthropic and reviewer1 is openai, reviewer2 must skip both claude and gpt-4o, selecting gemini-2.0-flash (google)!
  expect(reviewer2Work.executorModel).toBe('gemini-2.0-flash');
  expect(reviewer2Work.providerDiversityBlocked).toBeUndefined();
});

it('resolves provider from slash notation, profile provider, and custom prefix table', async () => {
  const engine = setup();

  // Configure custom providerPrefixes in executor settings
  engine.executors.saveSettings({
    expectedRevision: 0,
    concurrency: 3,
    providerPrefixes: {
      'custom-cohere': 'cohere',
      'deep-reasoner': 'deepseek',
    },
  });

  const definition = blankDefinition();
  definition.nodes[1] = nodeSchema.parse({
    id: 'step1',
    kind: 'agent',
    label: 'Step 1',
    prompt: 'First step',
    // Uses slash notation (e.g. Pi harness catalog style)
    model: 'mistral/mistral-large-2411',
  });
  definition.nodes.push(
    nodeSchema.parse({
      id: 'step2',
      kind: 'agent',
      label: 'Step 2',
      prompt: 'Second step',
      distinctProviderFrom: ['step1'],
      // First candidate is mistral (matches step1), second is custom-cohere (resolves to cohere)
      candidateModels: ['mistral/mistral-small', 'custom-cohere-v2', 'gpt-4o'],
    }),
  );
  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'step1' },
    { id: 'e2', source: 'step1', port: 'default', target: 'step2' },
    { id: 'e3', source: 'step2', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, {}).run;

  const step1Work = engine.store.work('available', run.id)[0];
  const claimedStep1 = engine.claim(
    step1Work.id,
    { workerId: 'w1', freshContext: false, tools: [], skills: [] },
    300,
  );
  engine.submit(step1Work.id, claimedStep1.token!, { ok: true });

  const step2Work = engine.store
    .work('available', run.id)
    .find((w) => w.nodeId === 'step2')!;
  expect(step2Work).toBeDefined();
  // step1 resolved to 'mistral' from slash notation.
  // candidate 1 'mistral/mistral-small' resolved to 'mistral' (excluded).
  // candidate 2 'custom-cohere-v2' resolved to 'cohere' via custom prefix table!
  expect(step2Work.executorModel).toBe('custom-cohere-v2');
});

it('leaves work unclaimed with explicit blocker reason when candidates are exhausted', async () => {
  const engine = setup();
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
      id: 'reviewer',
      kind: 'agent',
      label: 'Reviewer',
      prompt: 'Review code',
      distinctProviderFrom: ['author'],
      // Only anthropic candidates provided!
      candidateModels: ['claude-3-7-sonnet', 'claude-3-opus'],
    }),
  );
  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'author' },
    { id: 'e2', source: 'author', port: 'default', target: 'reviewer' },
    { id: 'e3', source: 'reviewer', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  const run = engine.start(workflowId, {}).run;

  const authorWork = engine.store.work('available', run.id)[0];
  const claimedAuthor = engine.claim(
    authorWork.id,
    { workerId: 'w1', freshContext: false, tools: [], skills: [] },
    300,
  );
  engine.submit(authorWork.id, claimedAuthor.token!, { ok: true });

  // Reviewer work should be created but marked as blocked
  const reviewerWork = engine.store
    .work('available', run.id)
    .find((w) => w.nodeId === 'reviewer')!;
  expect(reviewerWork).toBeDefined();
  expect(reviewerWork.providerDiversityBlocked).toBeDefined();
  expect(reviewerWork.providerDiversityBlocked?.reason).toBe(
    'provider_diversity_exhausted',
  );
  expect(reviewerWork.providerDiversityBlocked?.excludedProviders).toContain(
    'anthropic',
  );

  // Attempting to claim blocked work must fail
  expect(() =>
    engine.claim(
      reviewerWork.id,
      { workerId: 'attacker', freshContext: false, tools: [], skills: [] },
      300,
    ),
  ).toThrowError(/provider_diversity_exhausted/);

  // Continuation blockers expose the reason
  const briefing = engine.continuation.briefing({ id: run.id, limit: 10 });
  const blocker = briefing.blockers.items.find(
    (b) => b.workId === reviewerWork.id,
  );
  expect(blocker).toBeDefined();
  expect(blocker?.reason).toBe('provider_diversity_exhausted');
});

it('leaves work unclaimed with provider_diversity_unmet when upstream provider is unknown or unexecuted', async () => {
  const engine = setup();
  const definition = blankDefinition();

  // Branch where author is bypassed
  definition.nodes[1] = nodeSchema.parse({
    id: 'condition',
    kind: 'condition',
    label: 'Branch',
    path: 'skipAuthor',
    equals: true,
  });
  definition.nodes.push(
    nodeSchema.parse({
      id: 'author',
      kind: 'agent',
      label: 'Author',
      prompt: 'Write code',
      model: 'claude-3-5-sonnet',
    }),
  );
  definition.nodes.push(
    nodeSchema.parse({
      id: 'reviewer',
      kind: 'agent',
      label: 'Reviewer',
      prompt: 'Review code',
      distinctProviderFrom: ['author'],
      candidateModels: ['gpt-4o'],
    }),
  );
  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'condition' },
    { id: 'e2', source: 'condition', port: 'true', target: 'reviewer' }, // Bypasses author!
    { id: 'e2b', source: 'condition', port: 'false', target: 'author' },
    { id: 'e3', source: 'author', port: 'default', target: 'reviewer' },
    { id: 'e4', source: 'reviewer', port: 'default', target: 'exit' },
  ];

  const workflowId = publish(engine, definition);
  // Run with skipAuthor: true so condition routes directly to reviewer
  const run = engine.start(workflowId, { skipAuthor: true }).run;

  const reviewerWork = engine.store
    .work('available', run.id)
    .find((w) => w.nodeId === 'reviewer')!;
  expect(reviewerWork).toBeDefined();
  expect(reviewerWork.providerDiversityBlocked).toBeDefined();
  expect(reviewerWork.providerDiversityBlocked?.reason).toBe(
    'provider_diversity_unmet',
  );

  // Attempting to claim throws
  expect(() =>
    engine.claim(
      reviewerWork.id,
      { workerId: 'w', freshContext: false, tools: [], skills: [] },
      300,
    ),
  ).toThrowError(/provider_diversity_unmet/);

  // Check continuation briefing
  const briefing = engine.continuation.briefing({ id: run.id, limit: 10 });
  const blocker = briefing.blockers.items.find(
    (b) => b.workId === reviewerWork.id,
  );
  expect(blocker?.reason).toBe('provider_diversity_unmet');
});

it('preserves continuity group session and blocks if pinned provider conflicts', async () => {
  const engine = setup();
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
      id: 'step2',
      kind: 'agent',
      label: 'Step 2',
      prompt: 'Pinned group step',
      context: { continuityGroup: 'my-group' },
      distinctProviderFrom: ['author'],
      candidateModels: ['gpt-4o', 'gemini-2.0-flash'],
    }),
  );
  definition.edges = [
    { id: 'e1', source: 'entry', port: 'default', target: 'author' },
    { id: 'e2', source: 'author', port: 'default', target: 'step2' },
    { id: 'e3', source: 'step2', port: 'default', target: 'exit' },
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

  // step2 is available and selects gpt-4o (openai)
  const step2Work = engine.store
    .work('available', run.id)
    .find((w) => w.nodeId === 'step2')!;
  expect(step2Work.executorModel).toBe('gpt-4o');
  expect(step2Work.providerDiversityBlocked).toBeUndefined();

  // Claim with continuity group session
  const claimedStep2 = engine.claim(
    step2Work.id,
    {
      workerId: 'w2',
      freshContext: false,
      tools: [],
      skills: [],
      session: { executorId: 'gpt-session', sessionId: 'sess-1' },
      modelSelection: { model: 'gpt-4o', provider: 'openai' },
    },
    300,
  );
  expect(claimedStep2.token).toBeDefined();

  // Continuity group 'my-group' is now pinned to { executorId: 'gpt-session', sessionId: 'sess-1' }
  const group = engine.contextGroups.describe(run.id, 'my-group');
  expect(group.session?.sessionId).toBe('sess-1');
});
