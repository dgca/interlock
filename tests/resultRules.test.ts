import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blankDefinition,
  checkAgentResult,
  definitionSchema,
  validateDefinition,
  resultRulesSchema,
  ResultRejection,
  type Json,
  type ResultRule,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { batchDefinition, itemAgent } from './fixtures/batch';
import { Store } from '@interlock/storage';
import {
  exportWorkflows,
  importWorkflows,
} from '../packages/runtime/src/transfer';
const opened: Engine[] = [],
  dirs: string[] = [];
const worker = { workerId: 'test', freshContext: false, tools: [], skills: [] };
const equality: ResultRule = {
  id: 'candidate',
  kind: 'equalsInput',
  outputPath: 'candidate',
  inputPath: 'candidate',
};
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  opened.push(e);
  return e;
}
function create(e: Engine, rules: ResultRule[] = [equality]) {
  const d = blankDefinition();
  const a = d.nodes.find((n) => n.kind === 'agent')!;
  a.resultRules = rules;
  const w = e.create('Checks', '', d);
  e.publish(w.id);
  return { w, d, a };
}
function state(e: Engine) {
  return ['runs', 'work', 'events', 'usageAttempts'].map((c) =>
    e.store.list(c),
  );
}
afterEach(() => {
  for (const e of opened.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  vi.useRealTimers();
});
it.each([
  [{ candidate: null }, { candidate: null }, true],
  [{ candidate: 1 }, { candidate: '1' }, false],
  [{ candidate: [1, 2] }, { candidate: [2, 1] }, false],
  [{ candidate: { a: 1, b: 2 } }, { candidate: { b: 2, a: 1 } }, true],
  [{}, {}, false],
  [{ candidate: null }, {}, false],
  [null, null, false],
] as [Json, Json, boolean][])(
  'compares present JSON values without coercion (%j, %j)',
  (input, output, valid) => {
    expect(checkAgentResult({}, [equality], input, output).total === 0).toBe(
      valid,
    );
  },
);
it('distinguishes existence, null, array paths, root paths and bounds diagnostics', () => {
  const exists: ResultRule = {
    id: 'present',
    kind: 'exists',
    outputPath: '$.items.0',
  };
  expect(checkAgentResult({}, [exists], {}, { items: [null] }).total).toBe(0);
  expect(
    checkAgentResult({}, [exists], {}, { items: [] }).items[0],
  ).toMatchObject({ ruleId: 'present', path: '/items/0' });
  expect(
    checkAgentResult(
      {},
      [{ ...equality, inputPath: '', outputPath: '$' }],
      null,
      null,
    ).total,
  ).toBe(0);
  const rules = Array.from({ length: 32 }, (_, i) => ({
    ...equality,
    id: `r${i}`,
    outputPath: '~'.repeat(256),
  }));
  const report = checkAgentResult(
    {},
    rules,
    { candidate: 'SECRET' },
    { candidate: 'SECRET2' },
  );
  expect(report).toMatchObject({ total: 32, truncated: true });
  expect(report.items).toHaveLength(10);
  expect(report.items[0]).toMatchObject({ pathTruncated: true });
  expect(report.items[0].path.length).toBe(256);
  expect(JSON.stringify(report)).not.toContain('SECRET');
  expect(resultRulesSchema.safeParse([...rules, equality]).success).toBe(false);
  expect(
    resultRulesSchema.safeParse([{ ...equality, inputPath: '__proto__.x' }])
      .success,
  ).toBe(false);
});
it('saves incomplete rule semantics but blocks publication, and leaves complex contracts unknown', () => {
  const e = setup(),
    { w, d, a } = create(e);
  a.resultRules = [equality, equality];
  expect(definitionSchema.safeParse(d).success).toBe(true);
  e.update(w.id, { draft: d, draftRevision: w.draftRevision });
  expect(() => e.publish(w.id)).toThrow(/unique/);
  a.resultRules = [equality];
  a.inputSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
  expect(() => validateDefinition(d)).toThrow(/input contract excludes/);
  a.inputSchema = { anyOf: [{ type: 'object' }, { type: 'null' }] };
  expect(() => validateDefinition(d)).not.toThrow();
  a.outputSchema = { type: 'array', items: {}, maxItems: 1 };
  a.resultRules = [{ id: 'x', kind: 'exists', outputPath: '1' }];
  expect(() => validateDefinition(d)).toThrow(/output contract excludes/);
});
it('rejects before acceptance without mutation, exposes rules only in full work, and corrects under the same claim', () => {
  const e = setup(),
    { w } = create(e);
  const run = e.start(w.id, { candidate: 'expected' }).run;
  expect(e.workSummaries(run.id)[0]).not.toHaveProperty('resultRules');
  const claim = e.claim(e.available(run.id)[0].id, worker);
  expect(claim.resultRules).toEqual([equality]);
  const before = state(e),
    bad = { candidate: 'wrong' };
  const report = e.preflightResult(claim.id, claim.token!, bad);
  expect(report).toMatchObject({
    code: 'invalid_result',
    claimUsable: true,
    diagnostics: { items: [{ ruleId: 'candidate', inputPath: 'candidate' }] },
  });
  expect(state(e)).toEqual(before);
  expect(() => e.submit(claim.id, claim.token!, bad)).toThrow(ResultRejection);
  expect(state(e)).toEqual(before);
  expect(e.run(run.id).executions.some((x) => x.kind === 'exit')).toBe(false);
  e.submit(claim.id, claim.token!, { candidate: 'expected' });
  expect(e.run(run.id).status).toBe('completed');
  expect(() =>
    e.submit(claim.id, claim.token!, { candidate: 'expected' }),
  ).not.toThrow();
});
it('retains captured bindings and rules across restart, later publication, and failed-step retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-rules-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  const e = setup(path),
    { w, d, a } = create(e);
  a.inputBindings = { candidate: { source: 'runInput', path: 'revision' } };
  e.update(w.id, { draft: d, draftRevision: w.draftRevision });
  e.publish(w.id);
  const run = e.start(w.id, { revision: 'old' }).run,
    claim = e.claim(e.available(run.id)[0].id, worker);
  const current = e.workflow(w.id);
  const agent = current.draft.nodes.find((n) => n.kind === 'agent')!;
  agent.resultRules = [];
  e.update(w.id, {
    draft: current.draft,
    draftRevision: current.draftRevision,
  });
  e.publish(w.id);
  e.stop();
  e.store.close();
  opened.splice(opened.indexOf(e), 1);
  const restarted = setup(path);
  expect(
    restarted.preflightResult(claim.id, claim.token!, { candidate: 'new' })
      .code,
  ).toBe('invalid_result');
  restarted.reportFailure(claim.id, claim.token!, 'fail');
  const second = restarted.claim(claim.id, worker);
  restarted.reportFailure(second.id, second.token!, 'fail');
  expect(restarted.run(run.id).status).toBe('failed');
  restarted.retry(run.id);
  const retry = restarted.claim(restarted.available(run.id)[0].id, worker);
  expect(retry.resultRules).toEqual([equality]);
  expect(retry.input).toEqual({ candidate: 'old' });
  restarted.submit(retry.id, retry.token!, { candidate: 'old' });
  expect(restarted.run(run.id).status).toBe('completed');
});
it('round-trips portable rules and measures their captured and preview bytes', () => {
  const e = setup(),
    { w } = create(e),
    other = setup();
  const bundle = exportWorkflows(e.store, w.id);
  importWorkflows(other.store, bundle);
  expect(other.workflow(w.id).draft).toEqual(e.workflow(w.id).draft);
  const run = e.start(w.id, { candidate: 1 }).run,
    work = e.available(run.id)[0];
  const captured = e.assignmentSizes.read({ workId: work.id });
  expect(captured.components.resultRules.bytes).toBe(
    Buffer.byteLength(JSON.stringify([equality])),
  );
  const preview = e.assignmentSizes.read({
    workflowId: w.id,
    nodeId: work.nodeId,
    sample: { input: { candidate: 1 } },
  });
  expect(preview.components.resultRules).toEqual(
    captured.components.resultRules,
  );
});

it('checks each repeated visit against its own assignment input', () => {
  const e = setup(),
    { w, d, a } = create(e);
  d.nodes.push({
    id: 'loop',
    kind: 'condition',
    label: 'Loop',
    path: 'again',
    equals: true,
    inputSchema: {},
    outputSchema: {},
    position: { x: 0, y: 0 },
  });
  d.edges.find((edge) => edge.source === a.id)!.target = 'loop';
  d.edges.push(
    { id: 'repeat', source: 'loop', target: a.id, port: 'true' },
    { id: 'done', source: 'loop', target: 'exit', port: 'false' },
  );
  e.update(w.id, { draft: d, draftRevision: w.draftRevision });
  e.publish(w.id);
  const run = e.start(w.id, { candidate: 1 }).run;
  const first = e.claim(e.available(run.id)[0].id, worker);
  e.submit(first.id, first.token!, { candidate: 1, again: true });
  const second = e.claim(e.available(run.id)[0].id, worker);
  expect(second.id).not.toBe(first.id);
  expect(second.input).toEqual({ candidate: 1, again: true });
  expect(
    e.preflightResult(second.id, second.token!, { candidate: 2, again: false })
      .code,
  ).toBe('invalid_result');
  e.submit(second.id, second.token!, { candidate: 1, again: false });
  expect(e.run(run.id).status).toBe('completed');
});

it('keeps Batch item input comparisons isolated', () => {
  const e = setup(),
    agent = itemAgent();
  if (agent.kind !== 'agent') throw new Error('Expected Agent');
  agent.resultRules = [equality];
  const workflow = e.create('Item checks', '', batchDefinition(agent));
  e.publish(workflow.id);
  const run = e.start(workflow.id, [{ candidate: 1 }, { candidate: 2 }]).run;
  const claims = e.available(run.id).map((w) => e.claim(w.id, worker));
  expect(claims).toHaveLength(2);
  expect(
    e.preflightResult(claims[0].id, claims[0].token!, claims[1].input).code,
  ).toBe('invalid_result');
  for (const claim of claims) e.submit(claim.id, claim.token!, claim.input);
  expect(e.run(run.id).output).toEqual([{ candidate: 1 }, { candidate: 2 }]);
});
