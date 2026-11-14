/**
 * Measures how step latency, inspector load, report dashboard load and startup
 * scale with retained run history.
 * Not part of `pnpm test`. Uses temporary stores only:
 *
 *   pnpm exec tsx scripts/benchmark-run-storage.ts [retained counts, default 100 10000]
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { blankDefinition, type Run, type RunEvent } from '@interlock/core';
import { appRouter } from '../packages/server/src/router';

const counts = process.argv.slice(2).map(Number);
const samples = 40;
const worker = {
  workerId: 'benchmark',
  freshContext: false,
  tools: [],
  skills: [],
};

function definition(steps: number) {
  const blank = blankDefinition();
  const [entry, agent, exit] = blank.nodes;
  const nodes = [entry];
  const edges = [];
  let previous = entry.id;
  for (let index = 0; index < steps; index++) {
    const id = `step-${index}`;
    nodes.push({ ...agent, id, label: `Step ${index}` });
    edges.push({ id: `e${index}`, source: previous, target: id });
    previous = id;
  }
  nodes.push(exit);
  edges.push({ id: 'last', source: previous, target: exit.id });
  return { ...blank, nodes, edges };
}

function complete(engine: Engine, runId: string, output: unknown) {
  const work = engine.claim(engine.available(runId)[0].id, worker);
  engine.submit(work.id, work.token!, output as never);
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2) };
}

function time(fn: () => unknown) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

async function timeAsync(fn: () => Promise<unknown>) {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

/** Copies completed and failed template trees under fresh ids, including work and events. */
function seed(store: Store, templates: Run[][], retained: number) {
  const work = new Map(
    templates.flat().map((run) => [run.id, store.work(undefined, run.id)]),
  );
  const events = new Map(
    templates.flat().map((run) => [run.id, store.events(run.id)]),
  );
  let created = 0;
  store.transaction(() => {
    for (let index = 0; created < retained; index++) {
      const tree = templates[index % templates.length];
      const ids = new Map(tree.map((run) => [run.id, randomUUID()]));
      const rewrite = <T>(value: T): T => {
        let text = JSON.stringify(value);
        for (const [from, to] of ids) text = text.replaceAll(from, to);
        return JSON.parse(text) as T;
      };
      for (const run of tree) {
        const at = new Date(
          Date.UTC(2026, 0, 1) + created * 60_000,
        ).toISOString();
        store.put('runs', { ...rewrite(run), createdAt: at, updatedAt: at });
        for (const item of work.get(run.id)!)
          store.put('work', {
            ...rewrite(item),
            id: randomUUID(),
            token: undefined,
          });
        for (const event of events.get(run.id)!)
          store.put('events', {
            ...rewrite(event as RunEvent),
            id: randomUUID(),
          });
        created++;
      }
    }
  });
}

async function measure(retained: number) {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-benchmark-'));
  const file = join(dir, 'interlock.db');
  try {
    let engine = new Engine(new Store(file), dir);
    const workflow = engine.create('Benchmark', '', definition(3));
    engine.publish(workflow.id);
    const payload = { summary: 'result '.repeat(200) };
    const templates: Run[][] = [];
    for (const outcome of [
      'completed',
      'completed',
      'cancelled',
      'failed',
    ] as const) {
      const { run } = engine.start(workflow.id, { task: 'template' });
      complete(engine, run.id, payload);
      if (outcome === 'cancelled') engine.cancel(run.id);
      else complete(engine, run.id, payload);
      if (outcome === 'completed') complete(engine, run.id, payload);
      const copy = engine.run(run.id);
      if (outcome === 'failed') {
        // A failed terminal copy; its open assignment is not retained.
        copy.status = 'failed';
        copy.error = 'benchmark failure';
        copy.executions.at(-1)!.status = 'failed';
        engine.store.remove(
          'work',
          engine.store.work('available', run.id)[0].id,
        );
      }
      templates.push([copy]);
    }
    seed(engine.store, templates, retained - templates.length);
    const middle = engine.store
      .findRuns({ limit: Math.ceil(retained / 2), rootOnly: false })
      .at(-1)!.id;
    engine.stop();
    engine.store.close();

    const startup: number[] = [];
    for (let index = 0; index < 5; index++) {
      const store = new Store(file);
      startup.push(
        time(() => {
          engine = new Engine(store, dir);
          engine.pump();
        }),
      );
      if (index < 4) {
        engine.stop();
        store.close();
      }
    }
    const caller = appRouter.createCaller({ engine });
    const steps: number[] = [];
    const starts: number[] = [];
    const cancels: number[] = [];
    const usage: number[] = [];
    for (let index = 0; index < samples; index++) {
      let runId = '';
      starts.push(
        time(() => (runId = engine.start(workflow.id, { index }).run.id)),
      );
      const work = engine.claim(engine.available(runId)[0].id, worker);
      steps.push(time(() => engine.submit(work.id, work.token!, payload)));
      usage.push(
        await timeAsync(() =>
          caller.runs.usage({ runId, includeDescendants: true }),
        ),
      );
      cancels.push(time(() => engine.cancel(runId)));
    }
    const inspector: number[] = [];
    const runsPage: number[] = [];
    const runList: number[] = [];
    for (let index = 0; index < samples; index++) {
      inspector.push(await timeAsync(() => caller.runs.get({ id: middle })));
      runsPage.push(await timeAsync(() => caller.runs.summaries({})));
    }
    for (let index = 0; index < 5; index++)
      runList.push(await timeAsync(() => caller.runs.list()));
    // Seeded runs are one minute apart. A three-day window ending at the last
    // seeded run fills both the current and previous dashboard windows at 10,000.
    const until = Date.UTC(2026, 0, 1) + retained * 60_000;
    const window = {
      since: new Date(until - 3 * 86_400_000).toISOString(),
      until: new Date(until).toISOString(),
      limit: 1000,
    };
    const report: number[] = [];
    const dashboard: number[] = [];
    const dashboardPage: number[] = [];
    for (let index = 0; index < 10; index++) {
      report.push(await timeAsync(() => caller.report.summary(window)));
      dashboard.push(await timeAsync(() => caller.report.dashboard(window)));
      // Everything the Report page requests: dashboard, attention and recent runs.
      dashboardPage.push(
        await timeAsync(() =>
          Promise.all([
            caller.report.dashboard(window),
            caller.runs.summaries({ tab: 'active', limit: 100 }),
            caller.runs.summaries({ tab: 'history', limit: 12 }),
          ]),
        ),
      );
    }
    engine.stop();
    engine.store.close();
    return {
      retained,
      startupMs: stats(startup),
      startMs: stats(starts),
      stepMs: stats(steps),
      cancelMs: stats(cancels),
      usageMs: stats(usage),
      inspectorMs: stats(inspector),
      runsPageMs: stats(runsPage),
      runsListMs: stats(runList),
      reportMs: stats(report),
      dashboardMs: stats(dashboard),
      dashboardPageMs: stats(dashboardPage),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const results = [];
for (const retained of counts.length ? counts : [100, 10_000])
  results.push(await measure(retained));
console.table(
  results.map(({ retained, ...metrics }) => ({
    retained,
    ...Object.fromEntries(
      Object.entries(metrics).map(([name, value]) => [
        name,
        `${value.median} (p95 ${value.p95})`,
      ]),
    ),
  })),
);
