import { afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  validateDefinition,
  type Json,
} from '@interlock/core';
import { seed } from '../packages/server/src/seed';

const engines: Engine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.stop();
    engine.store.close();
  }
});
function setup() {
  const engine = new Engine(new Store(':memory:'), process.cwd());
  engines.push(engine);
  return engine;
}
const worker = {
  workerId: 'seed-test',
  freshContext: false,
  tools: [],
  skills: [],
};
function submit(engine: Engine, runId: string, nodeId: string, output: Json) {
  const available = engine.available(runId);
  expect(available).toHaveLength(1);
  expect(available[0].nodeId).toBe(nodeId);
  const claim = engine.claim(available[0].id, worker);
  engine.submit(claim.id, claim.token!, output);
}
function start(engine: Engine, reviewPolicy = 'auto') {
  seed(engine);
  const workflow = engine.store.workflows()[0];
  const run = engine.start(workflow.id, {
    request: 'Synthetic routing fixture',
  }).run;
  submit(engine, run.id, 'configure', {
    request: 'Synthetic routing fixture',
    repoPath: '/fixture/project',
    taskDir: '.tasks/change',
    reviewPolicy,
    createPr: false,
  });
  return run;
}
function draftAndReview(engine: Engine, runId: string, stage: string) {
  submit(engine, runId, stage, {
    artifactPath: `.tasks/change/${stage}.md`,
    summary: 'Synthetic accepted artifact',
    openQuestions: [],
  });
  submit(engine, runId, `${stage}Review`, {
    artifactPath: `.tasks/change/${stage}.md`,
    summary: 'Synthetic review under existing authorization',
    route: 'proceed',
    decisionSource: 'agent_review',
    reason: 'Fixture request settles scope',
    authorizationBasis: [{ source: 'request', evidence: 'Synthetic fixture' }],
    decisions: [],
    feedback: '',
  });
}

it('publishes a self-contained SDLC v1 in a fresh store without old versions or runs', () => {
  const engine = setup();
  seed(engine);
  const workflows = engine.store.workflows();
  expect(workflows).toHaveLength(1);
  const workflow = workflows[0];
  expect(workflow.name).toBe('SDLC workflow');
  expect(workflow.latestVersion).toBe(1);
  expect(workflow.ownerWorkflowId).toBeNull();
  const version = engine.store.getVersion(workflow.id, 1)!;
  expect(() => validateDefinition(version.definition)).not.toThrow();
  expect(engine.store.getVersion(workflow.id, 2)).toBeUndefined();
  expect(engine.store.runs()).toEqual([]);
  expect(engine.store.work()).toEqual([]);
  expect(engine.store.get('meta', 'seed')).toBeDefined();
});

it('accepts the request-only onboarding input and rejects a missing request', () => {
  const engine = setup();
  seed(engine);
  const workflow = engine.store.workflows()[0];
  expect(() => engine.start(workflow.id, {})).toThrow(/request/);
  const request =
    "Improve this project's setup instructions and verify the documented commands.";
  const run = engine.start(workflow.id, { request }).run;
  expect(run.version).toBe(1);
  expect(engine.available(run.id)).toMatchObject([
    { nodeId: 'configure', input: { request }, context: { mode: 'current' } },
  ]);
});

it('routes automatic planning to construction and requires a fresh final reviewer', async () => {
  const engine = setup();
  const run = start(engine);
  for (const stage of ['intent', 'spec', 'plan'])
    draftAndReview(engine, run.id, stage);
  await vi.waitFor(() =>
    expect(engine.available(run.id)[0]?.nodeId).toBe('build'),
  );
  const baseCommit = 'a'.repeat(40),
    headCommit = 'b'.repeat(40);
  submit(engine, run.id, 'build', {
    summary: 'Synthetic candidate, no source execution',
    branch: 'fixture/change',
    baseCommit,
    headCommit,
    checks: [{ name: 'Fixture check', result: 'passed' }],
  });
  const review = engine.available(run.id)[0];
  expect(review.nodeId).toBe('review');
  expect(review.context.mode).toBe('fresh');
  expect(() => engine.claim(review.id, worker)).toThrow(/fresh context/);
  const claim = engine.claim(review.id, {
    ...worker,
    workerId: 'fresh-reviewer',
    freshContext: true,
  });
  engine.submit(claim.id, claim.token!, {
    verdict: 'pass',
    summary: 'Synthetic passing review',
    baseCommit,
    reviewedCommit: headCommit,
    priorReviewedCommit: null,
    reviewScope: 'full',
    scopeReason: 'First review',
    specEvidence: [
      {
        criterion: 'AC1',
        status: 'verified',
        evidence: 'Fixture check',
        evidenceCommit: headCommit,
        source: 'checked',
      },
    ],
    standardsEvidence: [
      {
        check: 'Fixture standards',
        evidence: 'Fixture check',
        evidenceCommit: headCommit,
        source: 'checked',
      },
    ],
    findingResolutions: [],
    findings: [],
  });
  submit(engine, run.id, 'preparePr', {
    taskDir: '.tasks/change',
    branch: 'fixture/change',
    prUrl: null,
    summary: 'Synthetic local completion',
  });
  expect(engine.run(run.id).status).toBe('completed');
  expect(engine.run(run.id).output).toMatchObject({ prUrl: null });
});

it('keeps the human approval assignment available under the always policy', () => {
  const engine = setup();
  const run = start(engine, 'always');
  draftAndReview(engine, run.id, 'intent');
  expect(engine.available(run.id)).toMatchObject([
    { nodeId: 'intentGate', status: 'available' },
  ]);
  expect(engine.run(run.id).status).toBe('waiting');
});

it('seeds once and never revives a deleted starter', () => {
  const engine = setup();
  seed(engine);
  const first = engine.store.workflows();
  seed(engine);
  expect(engine.store.workflows()).toEqual(first);
  engine.deleteWorkflow(first[0].id);
  seed(engine);
  expect(engine.store.workflows()).toEqual([]);
});

it('preserves a pre-marker library and its published versions', () => {
  const engine = setup();
  const own = engine.create('Existing workflow', '', blankDefinition());
  engine.publish(own.id);
  const before = engine.store.workflows(),
    version = engine.store.getVersion(own.id, 1);
  seed(engine);
  expect(engine.store.workflows()).toEqual(before);
  expect(engine.store.getVersion(own.id, 1)).toEqual(version);
  engine.deleteWorkflow(own.id);
  seed(engine);
  expect(engine.store.workflows()).toEqual([]);
});

it('preserves a marked empty library', () => {
  const engine = setup();
  const marker = { id: 'seed', seededAt: '2025-01-01T00:00:00Z' };
  engine.store.put('meta', marker);
  seed(engine);
  expect(engine.store.workflows()).toEqual([]);
  expect(engine.store.get('meta', 'seed')).toEqual(marker);
});

it('rolls back a failed starter publication and permits a clean retry', () => {
  const engine = setup();
  vi.spyOn(engine, 'publish').mockImplementationOnce(() => {
    throw new Error('Controlled publication failure');
  });
  expect(() => seed(engine)).toThrow('Controlled publication failure');
  expect(engine.store.workflows()).toEqual([]);
  expect(engine.store.list('versions')).toEqual([]);
  expect(engine.store.get('meta', 'seed')).toBeUndefined();
  seed(engine);
  expect(engine.store.workflows()).toHaveLength(1);
  expect(engine.store.workflows()[0].latestVersion).toBe(1);
});
