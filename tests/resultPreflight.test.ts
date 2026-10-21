import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blankDefinition,
  checkResultContract,
  ResultRejection,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
const engines: Engine[] = [],
  dirs: string[] = [];
const worker = { workerId: 'test', freshContext: false, tools: [], skills: [] };
function setup(path = ':memory:') {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
}
function snapshot(e: Engine) {
  return [
    'workflows',
    'versions',
    'runs',
    'work',
    'events',
    'usageAttempts',
  ].map((collection) => e.store.list(collection));
}
function fixture(e: Engine) {
  const d = blankDefinition();
  d.nodes[1].outputSchema = {
    type: 'object',
    required: ['answer'],
    properties: { answer: { type: 'integer' } },
  };
  const w = e.create('Preflight', '', d);
  e.publish(w.id);
  const run = e.start(w.id, {}).run;
  return e.claim(e.available(run.id)[0].id, worker, 10);
}
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.stop();
    e.store.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true });
  vi.useRealTimers();
});
it('shares correction diagnostics with submission without mutating state or leases', () => {
  const e = setup(),
    w = fixture(e);
  const before = snapshot(e);
  const invalid = e.preflightResult(w.id, w.token!, {
    answer: 'private-value',
  });
  expect(invalid).toMatchObject({
    code: 'invalid_result',
    accepted: false,
    claimUsable: true,
    nextAction: 'correct_result',
    diagnostics: { items: [{ path: '/answer', rule: 'type' }] },
  });
  expect(JSON.stringify(invalid)).not.toContain('private-value');
  expect(snapshot(e)).toEqual(before);
  try {
    e.submit(w.id, w.token!, { answer: 'private-value' });
    throw new Error('accepted');
  } catch (error) {
    expect(error).toBeInstanceOf(ResultRejection);
    expect((error as ResultRejection).resultCheck).toEqual(invalid);
  }
  expect(snapshot(e)).toEqual(before);
  expect(e.preflightResult(w.id, w.token!, { answer: 42 }).code).toBe('ready');
  e.submit(w.id, w.token!, { answer: 42 });
  expect(e.preflightResult(w.id, w.token!, { answer: 42 })).toMatchObject({
    code: 'already_accepted',
    alreadyAccepted: true,
    claimUsable: false,
  });
  expect(e.preflightResult(w.id, w.token!, { answer: 43 }).code).toBe(
    'completed_conflict',
  );
  expect(() => e.submit(w.id, w.token!, { answer: 42 })).not.toThrow();
});
it('checks overdue leases without processing them and detects a later claim', () => {
  vi.useFakeTimers();
  const e = setup(),
    w = fixture(e);
  expect(e.preflightResult(w.id, w.token!, { answer: 42 }).canSubmit).toBe(
    true,
  );
  vi.advanceTimersByTime(10001);
  const before = snapshot(e);
  expect(e.preflightResult(w.id, w.token!, { answer: 42 }).code).toBe(
    'expired',
  );
  expect(snapshot(e)).toEqual(before);
  expect(() => e.submit(w.id, w.token!, { answer: 42 })).toThrow(/expired/);
  const next = e.claim(w.id, worker);
  expect(e.preflightResult(w.id, w.token!, { answer: 42 }).code).toBe(
    'replaced',
  );
  expect(e.preflightResult(w.id, 'unknown', { answer: 42 }).code).toBe(
    'invalid_claim',
  );
  e.cancel(w.runId);
  expect(e.preflightResult(next.id, next.token!, { answer: 42 }).code).toBe(
    'cancelled',
  );
  expect(e.preflightResult('missing', 'unknown', {}).code).toBe('not_found');
});
it('bounds errors and paths without returning enum or candidate values', () => {
  const schema = {
    type: 'object',
    required: Array.from({ length: 100 }, (_, i) => 'field' + i),
    properties: { 'a/b~c': { enum: ['SECRET-SCHEMA'] } },
  };
  const result = checkResultContract(schema, { 'a/b~c': 'SECRET-CANDIDATE' });
  expect(result).toMatchObject({ total: 101, truncated: true });
  expect(result.items).toHaveLength(10);
  expect(JSON.stringify(result)).not.toMatch(/SECRET/);
  expect(
    checkResultContract({ type: 'object', required: ['a/b~c'] }, {}).items[0]
      .path,
  ).toBe('/a~1b~0c');
  const long = checkResultContract(
    { type: 'object', required: ['x'.repeat(10000)] },
    {},
  );
  expect(long.items[0].pathTruncated).toBe(true);
  expect(JSON.stringify(long).length).toBeLessThan(1000);
});
it('retains the captured contract after restart and later publication', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-preflight-'));
  dirs.push(dir);
  const path = join(dir, 'db.sqlite');
  const e = setup(path),
    w = fixture(e),
    original = e.workflow(e.run(w.runId).workflowId);
  original.draft.nodes[1].outputSchema = { type: 'string' };
  e.update(original.id, {
    draft: original.draft,
    draftRevision: original.draftRevision,
  });
  e.publish(original.id);
  e.stop();
  e.store.close();
  engines.splice(engines.indexOf(e), 1);
  const reopened = setup(path);
  expect(reopened.preflightResult(w.id, w.token!, { answer: 42 }).code).toBe(
    'ready',
  );
  reopened.submit(w.id, w.token!, { answer: 42 });
  expect(reopened.run(w.runId).status).toBe('completed');
});

it('commits expiry recovery when the lease crosses its deadline after the submission pump', () => {
  vi.useFakeTimers();
  const e = setup(),
    w = fixture(e);
  const check = e.preflightResult.bind(e);
  vi.spyOn(e, 'preflightResult').mockImplementationOnce((...args) => {
    vi.advanceTimersByTime(10001);
    return check(...args);
  });
  expect(() => e.submit(w.id, w.token!, { answer: 42 })).toThrow(
    'currently available again',
  );
  expect(e.inspect(w.runId).work[0].status).toBe('available');
  expect(
    e.store
      .events(w.runId)
      .some((event) => event.type === 'work.lease_expired'),
  ).toBe(true);
});
