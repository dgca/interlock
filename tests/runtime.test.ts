import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  validateDefinition,
  type WorkflowDefinition,
} from '@interlock/core';
const stores: Store[] = [];
const setup = (path = ':memory:') => {
  const store = new Store(path);
  stores.push(store);
  return new Engine(store, process.cwd());
};
const worker = {
  workerId: 'test-worker',
  freshContext: false,
  tools: [],
  skills: [],
};
function publish(engine: Engine, definition = blankDefinition()) {
  const w = engine.create('Test workflow', '', definition);
  engine.publish(w.id);
  return w.id;
}
function complete(engine: Engine, root: string, output: any) {
  const work = engine.available(root)[0];
  const claim = engine.claim(work.id, worker);
  return engine.submit(work.id, claim.token!, output);
}
function composed(
  child: string,
  kind: 'workflow' | 'map' = 'map',
  failurePolicy = 'all',
): WorkflowDefinition {
  return definitionSchema.parse({
    nodes: [
      { id: 'in', label: 'Input', kind: 'entry' },
      {
        id: 'child',
        label: 'Children',
        kind,
        workflowId: child,
        version: 1,
        concurrency: 2,
        failurePolicy,
      },
      { id: 'out', label: 'Output', kind: 'exit' },
    ],
    edges: [
      { id: '1', source: 'in', target: 'child' },
      { id: '2', source: 'child', target: 'out' },
    ],
  });
}
afterEach(() => {
  vi.useRealTimers();
  stores.splice(0).forEach((s) => {
    try {
      s.close();
    } catch {}
  });
});
describe('durable harness execution', () => {
  it('validates submissions and makes identical retries idempotent', () => {
    const engine = setup(),
      d = blankDefinition();
    d.nodes[1].outputSchema = {
      type: 'object',
      required: ['answer'],
      properties: { answer: { type: 'number' } },
    };
    const id = publish(engine, d),
      run = engine.start(id, { question: 'six times seven' }).run;
    const work = engine.available(run.id)[0],
      claim = engine.claim(work.id, worker);
    expect(() => engine.submit(work.id, claim.token!, {})).toThrow('answer');
    expect(engine.run(run.id).status).toBe('waiting');
    engine.submit(work.id, claim.token!, { answer: 42 });
    expect(engine.run(run.id).output).toEqual({ answer: 42 });
    expect(() =>
      engine.submit(work.id, claim.token!, { answer: 42 }),
    ).not.toThrow();
    expect(() => engine.submit(work.id, claim.token!, { answer: 43 })).toThrow(
      'different result',
    );
    expect(engine.run(run.id).executions).toHaveLength(3);
  });
  it('rejects duplicate claims and missing executor capabilities', () => {
    const engine = setup(),
      d = blankDefinition();
    if (d.nodes[1].kind === 'agent')
      d.nodes[1].context = {
        mode: 'fresh',
        instructions: '',
        tools: ['search'],
        skills: ['research'],
      };
    const run = engine.start(publish(engine, d), null).run,
      work = engine.available(run.id)[0];
    expect(() => engine.claim(work.id, worker)).toThrow('fresh context');
    expect(() =>
      engine.claim(work.id, { ...worker, freshContext: true }),
    ).toThrow('Missing capabilities');
    engine.claim(work.id, {
      ...worker,
      freshContext: true,
      tools: ['search'],
      skills: ['research'],
    });
    expect(() => engine.claim(work.id, worker)).toThrow('not available');
  });
  it('expires leases, rejects stale tokens, and exhausts bounded retries', () => {
    vi.useFakeTimers();
    const engine = setup();
    const run = engine.start(publish(engine), {}).run;
    const work = engine.available(run.id)[0],
      first = engine.claim(work.id, worker, 10);
    vi.advanceTimersByTime(11000);
    expect(engine.available(run.id)).toHaveLength(1);
    const second = engine.claim(work.id, worker, 10);
    expect(() => engine.submit(work.id, first.token!, {})).toThrow('token');
    vi.advanceTimersByTime(11000);
    engine.pump();
    expect(engine.run(run.id).status).toBe('failed');
    expect(engine.available(run.id)).toHaveLength(0);
    expect(second.attempt).toBe(2);
  });
  it('resumes claimed work after closing and reopening SQLite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'interlock-'));
    const path = join(dir, 'state.db');
    const engine = setup(path);
    const run = engine.start(publish(engine), { x: 1 }).run;
    const claim = engine.claim(engine.available(run.id)[0].id, worker);
    engine.store.close();
    stores.pop();
    const resumed = setup(path);
    resumed.submit(claim.id, claim.token!, { done: true });
    expect(resumed.run(run.id).status).toBe('completed');
    resumed.store.close();
    stores.pop();
    rmSync(dir, { recursive: true });
  });
  it('preserves pinned definitions across edits, publishing, and renaming', () => {
    const engine = setup(),
      id = publish(engine),
      run = engine.start(id, {}).run,
      w = engine.workflow(id);
    const draft = structuredClone(w.draft);
    if (draft.nodes[1].kind === 'agent')
      draft.nodes[1].prompt = 'Changed prompt';
    engine.update(id, {
      name: 'New name',
      draft,
      draftRevision: w.draftRevision,
    });
    engine.publish(id);
    expect(engine.inspect(run.id).definition.nodes[1]).toMatchObject({
      prompt: 'Process the input and return your result as JSON.',
    });
    expect(engine.run(run.id).workflowName).toBe('Test workflow');
    expect(engine.start(id, {}).run.version).toBe(2);
    expect(() =>
      engine.update(id, { draft, draftRevision: w.draftRevision }),
    ).toThrow('changed elsewhere');
  });
  it('dispatches with a concurrency bound and collects in original input order', () => {
    const engine = setup(),
      child = publish(engine),
      parent = publish(engine, composed(child));
    const run = engine.start(parent, ['a', 'b', 'c']).run;
    let work = engine.available(run.id);
    expect(work.map((w) => w.input)).toEqual(['a', 'b']);
    const b = engine.claim(work[1].id, worker);
    engine.submit(b.id, b.token!, 'B');
    work = engine.available(run.id);
    expect(work.map((w) => w.input)).toEqual(['a', 'c']);
    complete(engine, run.id, 'A');
    complete(engine, run.id, 'C');
    expect(engine.run(run.id).output).toEqual(['A', 'B', 'C']);
  });
  it('collects explicit failures without substituting successful data', () => {
    const engine = setup(),
      d = blankDefinition();
    if (d.nodes[1].kind === 'agent') d.nodes[1].maxAttempts = 1;
    const child = publish(engine, d),
      parent = publish(engine, composed(child, 'map', 'collect'));
    const run = engine.start(parent, ['a', 'b']).run;
    const a = engine.claim(engine.available(run.id)[0].id, worker);
    engine.reportFailure(a.id, a.token!, 'Source unavailable');
    complete(engine, run.id, 'B');
    expect(engine.run(run.id).output).toMatchObject([
      { status: 'failed', output: null, error: 'Source unavailable' },
      { status: 'completed', output: 'B' },
    ]);
  });
  it('fails strict maps and cancels sibling work', () => {
    const engine = setup(),
      d = blankDefinition();
    if (d.nodes[1].kind === 'agent') d.nodes[1].maxAttempts = 1;
    const child = publish(engine, d),
      run = engine.start(publish(engine, composed(child)), ['a', 'b']).run;
    const a = engine.claim(engine.available(run.id)[0].id, worker);
    engine.reportFailure(a.id, a.token!, 'No source');
    expect(engine.run(run.id).status).toBe('failed');
    expect(engine.available(run.id)).toHaveLength(0);
  });
  it('cancels nested work and refuses late results', () => {
    const engine = setup(),
      child = publish(engine),
      run = engine.start(publish(engine, composed(child, 'workflow')), {}).run;
    const claim = engine.claim(engine.available(run.id)[0].id, worker);
    engine.cancel(run.id);
    expect(
      engine.inspect(run.id).children.every((r) => r.status === 'cancelled'),
    ).toBe(true);
    expect(() => engine.submit(claim.id, claim.token!, {})).toThrow();
  });
  it('routes conditions and stops loops at the step budget', () => {
    const engine = setup();
    const d = definitionSchema.parse({
      maxSteps: 5,
      nodes: [
        { id: 'in', kind: 'entry', label: 'Input' },
        {
          id: 'check',
          kind: 'condition',
          label: 'Check',
          path: 'ok',
          equals: true,
        },
        { id: 'out', kind: 'exit', label: 'Output' },
      ],
      edges: [
        { id: '1', source: 'in', target: 'check' },
        { id: '2', source: 'check', target: 'out', port: 'true' },
        { id: '3', source: 'check', target: 'check', port: 'false' },
      ],
    });
    const id = publish(engine, d);
    expect(engine.start(id, { ok: true }).run.status).toBe('completed');
    expect(engine.start(id, { ok: false }).run.error).toContain('step limit');
  });
  it.each([undefined, 'bash', 'javascript'] as const)(
    'executes %s scripts and validates output',
    async (language) => {
      const engine = setup(),
        d = blankDefinition();
      d.nodes[1] = {
        id: 'agent',
        label: 'Double',
        kind: 'script',
        language,
        inputSchema: {},
        outputSchema: { type: 'number' },
        position: { x: 0, y: 0 },
        command:
          language === 'javascript'
            ? 'console.log("doubling"); return await Promise.resolve(input * 2);'
            : 'node -e \'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s)*2))\'',
        timeoutMs: 5000,
      };
      const run = engine.start(publish(engine, d), 21).run;
      await vi.waitFor(() =>
        expect(engine.run(run.id).status).toBe('completed'),
      );
      expect(engine.run(run.id).output).toBe(42);
    },
  );
  it.each([
    ['throw new Error("broken");', {}, 'broken'],
    ['return;', {}, 'must return a JSON value'],
    ['return "wrong";', { type: 'number' }, ''],
    ['while (true) {}', {}, 'exceeded'],
  ] as const)(
    'fails JavaScript script %s',
    async (command, outputSchema, error) => {
      const engine = setup(),
        d = blankDefinition();
      d.nodes[1] = {
        id: 'agent',
        label: 'Script',
        kind: 'script',
        language: 'javascript',
        inputSchema: {},
        outputSchema,
        position: { x: 0, y: 0 },
        command,
        timeoutMs: 100,
      };
      const run = engine.start(publish(engine, d), null).run;
      await vi.waitFor(() => expect(engine.run(run.id).status).toBe('failed'));
      expect(engine.run(run.id).error).toContain(error);
    },
  );
  it('retries failed map children while preserving successful research', () => {
    const engine = setup(),
      d = blankDefinition();
    if (d.nodes[1].kind === 'agent') d.nodes[1].maxAttempts = 1;
    const child = publish(engine, d),
      run = engine.start(publish(engine, composed(child)), ['a', 'b']).run;
    complete(engine, run.id, 'A');
    const work = engine.claim(engine.available(run.id)[0].id, worker);
    engine.reportFailure(work.id, work.token!, 'Temporary failure');
    engine.retry(run.id);
    expect(engine.available(run.id).map((w) => w.input)).toEqual(['b']);
    complete(engine, run.id, 'B');
    expect(engine.run(run.id).output).toEqual(['A', 'B']);
  });
  it('marks interrupted scripts failed without replaying them', () => {
    const engine = setup(),
      d = blankDefinition();
    const id = publish(engine, d);
    const run = engine.start(id, {}).run;
    run.status = 'running';
    run.executions.at(-1)!.kind = 'script';
    run.executions.at(-1)!.status = 'running';
    engine.store.put('runs', run);
    const restarted = new Engine(engine.store, process.cwd());
    expect(restarted.run(run.id).error).toContain('interrupted');
  });
  it.each(['bash', 'javascript'] as const)(
    'kills a running %s script when its run is cancelled',
    async (language) => {
      const engine = setup(),
        dir = mkdtempSync(join(tmpdir(), 'interlock-cancel-'));
      const ready = join(dir, 'ready'),
        late = join(dir, 'late');
      const code = `const fs=require("node:fs");fs.writeFileSync(${JSON.stringify(ready)},"ready");setTimeout(()=>{fs.writeFileSync(${JSON.stringify(late)},"late");console.log("null")},400);`;
      const d = blankDefinition();
      d.nodes[1] = {
        id: 'agent',
        label: 'Delayed script',
        kind: 'script',
        language,
        inputSchema: {},
        outputSchema: {},
        position: { x: 0, y: 0 },
        command:
          language === 'javascript'
            ? `${code}\nawait new Promise(resolve => setTimeout(resolve, 1000)); return null;`
            : `node -e '${code}'`,
        timeoutMs: 5000,
      };
      const run = engine.start(publish(engine, d), null).run;
      await vi.waitFor(() => expect(existsSync(ready)).toBe(true));
      engine.cancel(run.id);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(existsSync(late)).toBe(false);
      expect(engine.run(run.id).status).toBe('cancelled');
      rmSync(dir, { recursive: true });
    },
  );
  it('rejects malformed graph routes before publishing', () => {
    const d = blankDefinition();
    d.edges.push({
      id: 'duplicate',
      source: 'entry',
      target: 'exit',
      port: 'default',
    });
    expect(() => validateDefinition(d)).toThrow('outgoing routes');
  });
});
