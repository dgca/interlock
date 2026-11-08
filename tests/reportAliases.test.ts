import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  nodeSchema,
  workflowReportSchema,
  type Run,
  type ModelAliasSelection,
} from '@interlock/core';
import { formatWorkflowReport } from '../packages/cli/src/commands.js';

let dir: string, store: Store, engine: Engine;
afterEach(() => {
  engine?.stop();
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
const time = '2026-01-01T00:00:00Z';
const builder = {
  aliasId: 'builder-id',
  name: 'builder',
  revision: 1,
  candidateModel: 'concrete',
  candidateIndex: 0,
};
const reviewer = {
  aliasId: 'reviewer-id',
  name: 'reviewer',
  revision: 2,
  candidateModel: 'concrete',
  candidateIndex: 0,
};
const model = (tokens = 10, currency = 'USD') => ({
  provider: 'provider',
  model: 'actual',
  inputTokens: tokens,
  outputTokens: tokens,
  cost: { amountMicros: tokens, currency, source: 'reported' },
});
function setup() {
  dir = mkdtempSync(join(tmpdir(), 'interlock-report-alias-'));
  store = new Store(join(dir, 'test.db'));
  engine = new Engine(store, dir);
  const run: Run = {
    id: 'run',
    workflowId: 'workflow',
    workflowName: 'Workflow',
    version: 1,
    status: 'completed',
    cursor: 'exit',
    input: {},
    value: {},
    createdAt: time,
    updatedAt: time,
    executions: [],
    modelAliasCaptures: [
      {
        aliasId: 'builder-id',
        name: 'builder',
        revision: 1,
        candidates: [{ model: 'concrete' }],
      },
    ],
  };
  store.put('runs', run);
  return run;
}
function attempt(
  id: string,
  alias?: ModelAliasSelection,
  tokens = 10,
  currency = 'USD',
) {
  store.put('usageAttempts', {
    id,
    workId: id,
    runId: 'run',
    nodeId: 'agent',
    label: 'Agent',
    workerId: null,
    attempt: 1,
    outcome: 'completed',
    claimedAt: time,
    endedAt: time,
    modelAliasSelection: alias,
    snapshot: { models: [model(tokens, currency)], sequence: 1, final: true },
    reportedAt: time,
  });
}

describe('captured alias report attribution', () => {
  it('retains the selected alias through assignment and claim despite later live edits', () => {
    setup();
    const alias = engine.modelAliases.mutate({
      action: 'create',
      name: 'builder',
      candidates: [{ model: 'concrete' }],
    }) as import('@interlock/core').SavedModelAlias;
    const def = blankDefinition();
    def.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'agent',
      label: 'Agent',
      prompt: 'Work',
      model: 'builder',
    });
    def.edges = [
      { id: 'a', source: 'entry', target: 'agent', port: 'default' },
      { id: 'b', source: 'agent', target: 'exit', port: 'default' },
    ];
    const wf = engine.create('Aliases', '', def);
    engine.publish(wf.id);
    const run = engine.start(wf.id, {}).run;
    const work = store.work('available', run.id)[0];
    expect(work.modelAliasSelection).toEqual({ ...builder, aliasId: alias.id });
    engine.modelAliases.mutate({
      action: 'update',
      id: alias.id,
      expectedRevision: 1,
      candidates: [{ model: 'new-model' }],
    });
    engine.claim(
      work.id,
      { workerId: 'worker', freshContext: false, tools: [], skills: [] },
      300,
    );
    expect(
      store.list('usageAttempts').find((item: any) => item.workId === work.id),
    ).toMatchObject({ modelAliasSelection: { ...builder, aliasId: alias.id } });
  });
  it('retains alias attribution when a diversity block clears', () => {
    setup();
    const alias = engine.modelAliases.mutate({
      action: 'create',
      name: 'reviewer',
      candidates: [{ model: 'unmapped-review-model' }],
    }) as import('@interlock/core').SavedModelAlias;
    const def = blankDefinition();
    def.nodes[1] = nodeSchema.parse({
      id: 'author',
      kind: 'agent',
      label: 'Author',
      prompt: 'Write',
      model: 'claude-sonnet',
    });
    def.nodes.push(
      nodeSchema.parse({
        id: 'review',
        kind: 'agent',
        label: 'Review',
        prompt: 'Review',
        model: 'reviewer',
        distinctProviderFrom: ['author'],
      }),
    );
    def.edges = [
      { id: 'a', source: 'entry', target: 'author', port: 'default' },
      { id: 'b', source: 'author', target: 'review', port: 'default' },
      { id: 'c', source: 'review', target: 'exit', port: 'default' },
    ];
    const workflow = engine.create('Diversity aliases', '', def);
    engine.publish(workflow.id);
    const run = engine.start(workflow.id, {}).run;
    const author = store.work('available', run.id)[0];
    const claim = engine.claim(
      author.id,
      { workerId: 'worker', freshContext: false, tools: [], skills: [] },
      300,
    );
    engine.submit(author.id, claim.token!, {});
    const review = store
      .work('available', run.id)
      .find((work) => work.nodeId === 'review')!;
    expect(review.providerDiversityBlocked).toBeDefined();
    expect(review.modelAliasSelection).toBeUndefined();
    engine.executors.saveSettings({
      expectedRevision: 0,
      concurrency: 3,
      providerPrefixes: { 'unmapped-review': 'openai' },
    });
    engine.pump();
    expect(
      store.work('available', run.id).find((work) => work.id === review.id)
        ?.providerDiversityBlocked,
    ).toBeUndefined();
    engine.claim(
      review.id,
      { workerId: 'worker', freshContext: false, tools: [], skills: [] },
      300,
    );
    expect(store.get('usageAttempts', `${review.id}:1`)).toMatchObject({
      modelAliasSelection: {
        aliasId: alias.id,
        name: 'reviewer',
        revision: 1,
        candidateModel: 'unmapped-review-model',
      },
    });
  });

  it('separates logical roles sharing a model and preserves observer selection and run overhead', () => {
    setup();
    attempt('builder', builder);
    attempt('reviewer', reviewer);
    const receipt = store.get<any>('usageAttempts', 'builder')!;
    receipt.observerReport = {
      source: 'observer',
      reportedAt: time,
      snapshot: { models: [model(20)], sequence: 1, final: true },
    };
    store.put('usageAttempts', receipt);
    store.put('runUsage', {
      id: 'overhead',
      runId: 'run',
      source: 'observer',
      reportedAt: time,
      snapshot: { models: [model(5)], sequence: 1, final: true },
    });
    const report = engine.report({});
    workflowReportSchema.parse(report);
    expect(report.usage.tokens.inputTokens).toBe(35);
    expect(report.usage.costs[0].amountMicros).toBe(35);
    expect(report.usage.byAlias).toHaveLength(3);
    expect(report.usage.byAlias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: builder,
          scope: 'attempt',
          inputTokens: 20,
          model: 'actual',
          provider: 'provider',
        }),
        expect.objectContaining({
          alias: reviewer,
          scope: 'attempt',
          inputTokens: 10,
        }),
        expect.objectContaining({ alias: null, scope: 'run', inputTokens: 5 }),
      ]),
    );
    expect(formatWorkflowReport(report)).toContain('builder@1');
    engine.stop();
    store.close();
    store = new Store(join(dir, 'test.db'));
    engine = new Engine(store, dir);
    expect(engine.report({}).usage.byAlias).toEqual(report.usage.byAlias);
  });
  it('distinguishes selected candidates sharing a model but differing in profile and effort', () => {
    setup();
    for (const id of ['primary', 'backup'])
      engine.executors.saveProfile({
        id,
        name: id,
        harness: 'codex',
        enabled: true,
        expectedRevision: 0,
      });
    engine.modelAliases.mutate({
      action: 'create',
      name: 'role',
      candidates: [
        { model: 'gpt-4o', profileId: 'primary', effort: 'low' },
        { model: 'gpt-4o', profileId: 'backup', effort: 'high' },
      ],
    });
    const def = blankDefinition();
    def.nodes[1] = nodeSchema.parse({
      id: 'agent',
      kind: 'agent',
      label: 'Agent',
      prompt: 'Work',
      model: 'role',
    });
    const wf = engine.create('Fallback candidate identity', '', def);
    engine.publish(wf.id);
    const firstRun = engine.start(wf.id, {}).run;
    const first = store.work('available', firstRun.id)[0];
    engine.executors.saveProfile({
      id: 'primary',
      name: 'primary',
      harness: 'codex',
      enabled: false,
      expectedRevision: 1,
    });
    const secondRun = engine.start(wf.id, {}).run;
    const second = store.work('available', secondRun.id)[0];
    expect(first.modelAliasSelection).toMatchObject({
      candidateIndex: 0,
      candidateProfileId: 'primary',
      candidateEffort: 'low',
    });
    expect(second.modelAliasSelection).toMatchObject({
      candidateIndex: 1,
      candidateProfileId: 'backup',
      candidateEffort: 'high',
    });
    attempt('first-candidate', first.modelAliasSelection!);
    attempt('second-candidate', second.modelAliasSelection!);
    const groups = engine.report({}).usage.byAlias!;
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.alias?.candidateIndex)).toEqual([0, 1]);
  });

  it('keeps candidate, revision and currency groups separate without changing totals', () => {
    setup();
    attempt('one', builder);
    attempt('two', { ...builder, candidateModel: 'fallback' }, 20);
    attempt('three', { ...builder, revision: 2 }, 30);
    attempt('four', builder, 40, 'EUR');
    const report = engine.report({});
    expect(report.usage.byAlias).toHaveLength(4);
    expect(
      report.usage.byAlias!.reduce((sum, g) => sum + g.inputTokens, 0),
    ).toBe(100);
    expect(
      report.usage.costs.map((c) => [c.currency, c.amountMicros]).sort(),
    ).toEqual([
      ['EUR', 40],
      ['USD', 60],
    ]);
  });
  it('leaves legacy and native assignments unknown even when captures or live aliases match', () => {
    setup();
    attempt('legacy');
    engine.modelAliases.mutate({
      action: 'create',
      name: 'actual',
      candidates: [{ model: 'actual' }],
    });
    expect(engine.report({}).usage.byAlias).toEqual([
      expect.objectContaining({
        alias: null,
        scope: 'attempt',
        inputTokens: 10,
      }),
    ]);
  });
});
