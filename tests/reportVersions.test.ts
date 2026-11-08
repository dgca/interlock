import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, type NodeExecution, type Run } from '@interlock/core';

const dirs: string[] = [];
const stores: Store[] = [];
const engines: Engine[] = [];
afterEach(() => {
  engines.splice(0).forEach((engine) => engine.stop());
  stores.splice(0).forEach((store) => store.close());
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-report-versions-'));
  dirs.push(dir);
  const store = new Store(join(dir, 'test.db'));
  const engine = new Engine(store, dir);
  stores.push(store);
  engines.push(engine);
  for (const [version, stage, label] of [
    [1, 'planning', 'Human escalation'],
    [2, 'building', 'Automatic completion'],
    [3, 'shipping', 'Finished'],
  ] as const) {
    const definition = blankDefinition();
    definition.nodes = [
      {
        id: 'step',
        kind: 'exit',
        label,
        stage,
        position: { x: 0, y: 0 },
        inputSchema: {},
        outputSchema: {},
      },
    ];
    store.version({
      workflowId: 'workflow',
      version,
      definition,
      createdAt: '2026-01-01T00:00:00Z',
    });
  }
  const execution = (version?: number): NodeExecution => ({
    id: `execution-${version}`,
    nodeId: 'step',
    kind: 'exit',
    label: 'Recorded human exit',
    version,
    status: 'completed',
    input: {},
    childRunIds: [],
    nextItem: 0,
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:00:01Z',
  });
  const run: Run = {
    id: 'run',
    workflowId: 'workflow',
    workflowName: 'Workflow',
    version: 3,
    status: 'completed',
    cursor: 'step',
    input: {},
    value: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:10Z',
    executions: [execution(1)],
  };
  return { store, engine, run, execution };
}

describe('report execution version attribution', () => {
  it('uses each visit version across multiple upgrades and marks mixed node stages unknown', () => {
    const { store, engine, run, execution } = fixture();
    run.executions = [execution(1), execution(2), execution(3)];
    store.put('runs', run);
    const report = engine.report({});
    expect(
      report.stages.map((stage) => [stage.stage, stage.durationMs.median]),
    ).toEqual([
      ['planning', 1000],
      ['building', 1000],
      ['shipping', 1000],
    ]);
    expect(report.nodes[0].stage).toBeNull();
  });

  it('classifies a historical Exit even when the new version removed it', () => {
    const { store, engine, run } = fixture();
    const latest = store.getVersion('workflow', 3)!;
    latest.definition.nodes = [];
    store.version(latest);
    store.put('runs', run);
    const report = engine.report({});
    expect(report.stages[0].stage).toBe('planning');
    expect(report.terminalOutcomes.exitNodes[0].label).toBe('Human escalation');
    expect(report.terminalOutcomes.humanEscalationRate).toBe(100);
    expect(report.terminalOutcomes.unattendedCompletionRate).toBe(0);
  });

  it('does not substitute current definitions when an explicit historical version is missing', () => {
    const { store, engine, run } = fixture();
    store.remove('versions', 'workflow:1');
    store.put('workflows', {
      id: 'workflow',
      draft: store.getVersion('workflow', 3)!.definition,
    });
    store.put('runs', run);
    const report = engine.report({});
    expect(report.stages).toEqual([]);
    expect(report.nodes[0].stage).toBeNull();
    expect(report.terminalOutcomes.exitNodes[0].label).toBe(
      'Recorded human exit',
    );
    expect(report.terminalOutcomes.humanEscalationRate).toBe(100);
  });

  it('retains the run-version fallback for legacy visits without version evidence', () => {
    const { store, engine, run, execution } = fixture();
    run.executions = [execution()];
    store.put('runs', run);
    const report = engine.report({});
    expect(report.stages[0].stage).toBe('shipping');
    expect(report.terminalOutcomes.exitNodes[0].label).toBe('Finished');
  });
});
