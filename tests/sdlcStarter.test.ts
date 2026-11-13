import { afterEach, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { validateDefinition, type Json } from '@interlock/core';
import { importStarter } from '../packages/server/src/starters';
function addSdlc(engine: Engine) {
  importStarter(engine, { starterId: 'sdlc', requestId: 'sdlc-fixture' });
}

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
  addSdlc(engine);
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
async function draftAndReview(engine: Engine, runId: string, stage: string) {
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
  await vi.waitFor(() => expect(engine.available(runId)).toHaveLength(1));
}

it('explicitly adds a published self-contained SDLC without starting runs', () => {
  const engine = setup();
  addSdlc(engine);
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
  expect(engine.store.get('meta', 'seed')).toBeUndefined();
});

it('accepts the request-only onboarding input and rejects a missing request', () => {
  const engine = setup();
  addSdlc(engine);
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
    await draftAndReview(engine, run.id, stage);
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

it('keeps the human approval assignment available under the always policy', async () => {
  const engine = setup();
  const run = start(engine, 'always');
  await draftAndReview(engine, run.id, 'intent');
  expect(engine.available(run.id)).toMatchObject([
    { nodeId: 'intentGate', status: 'available' },
  ]);
  expect(engine.run(run.id).status).toBe('waiting');
});

it.each(['intent', 'spec', 'plan'])(
  'bounds %s revisions without losing findings or inventing approval',
  async (stage) => {
    const engine = setup();
    const run = start(engine);
    for (const prior of ['intent', 'spec', 'plan']) {
      if (prior === stage) break;
      await draftAndReview(engine, run.id, prior);
    }
    for (let round = 1; round <= 4; round++) {
      submit(engine, run.id, stage, {
        artifactPath: `.tasks/change/${stage}.md`,
        summary: 'Fixture draft',
        openQuestions: [],
      });
      submit(engine, run.id, stage + 'Review', {
        artifactPath: `.tasks/change/${stage}.md`,
        summary: 'Still missing acceptance evidence',
        route: 'revise',
        decisionSource: 'agent_review',
        reason: 'A substantive gap remains',
        authorizationBasis: [],
        decisions: [],
        feedback: 'Preserve and resolve finding F1',
      });
      await vi.waitFor(() => expect(engine.available(run.id)).toHaveLength(1));
      const work = engine.available(run.id)[0];
      expect(work.nodeId).toBe(round < 3 ? stage : stage + 'Gate');
      if (round >= 3) {
        expect(work.input).toMatchObject({
          previous: {
            route: 'needs_human',
            feedback: 'Preserve and resolve finding F1',
          },
        });
        submit(engine, run.id, stage + 'Gate', {
          artifactPath: `.tasks/change/${stage}.md`,
          summary: 'Fixture human answer',
          decision: 'revise',
          decisionSource: 'human',
          humanResponse: 'Make one more correction',
          feedback: 'Address F1',
        });
      }
    }
  },
);
