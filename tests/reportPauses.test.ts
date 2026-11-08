import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  workflowReportSchema,
  type Run,
} from '@interlock/core';
import { formatWorkflowReport } from '../packages/cli/src/commands.js';

let dir: string, store: Store, engine: Engine;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  engine?.stop();
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
const at = (second: number) =>
  new Date(Date.parse('2026-01-01T00:00:00Z') + second * 1000).toISOString();
function setup() {
  dir = mkdtempSync(join(tmpdir(), 'interlock-report-pauses-'));
  store = new Store(join(dir, 'test.db'));
  engine = new Engine(store, dir);
  const definition = blankDefinition();
  definition.nodes = [
    {
      id: 'input',
      kind: 'input',
      label: 'Review',
      stage: 'review',
      position: { x: 0, y: 0 },
      inputSchema: {},
      outputSchema: {},
    },
  ];
  store.version({
    workflowId: 'workflow',
    version: 1,
    definition,
    createdAt: at(0),
  });
  const run: Run = {
    id: 'run',
    workflowId: 'workflow',
    workflowName: 'Workflow',
    version: 1,
    status: 'completed',
    createdAt: at(0),
    updatedAt: at(10),
    cursor: 'input',
    input: {},
    value: {},
    admission: {
      queuedAt: at(0),
      admittedAt: at(10),
      position: 1,
      priority: 0,
      after: [],
      blockers: [],
    },
    executions: [
      {
        id: 'visit',
        nodeId: 'input',
        kind: 'input',
        label: 'Review',
        version: 1,
        status: 'completed',
        input: {},
        childRunIds: [],
        nextItem: 0,
        startedAt: at(0),
        completedAt: at(10),
      },
    ],
  };
  store.put('runs', run);
  store.put('work', {
    id: 'work',
    runId: 'run',
    nodeId: 'agent',
    createdAt: at(0),
    status: 'completed',
    context: { continuityGroup: 'group' },
  });
  store.put('usageAttempts', {
    id: 'attempt',
    workId: 'work',
    runId: 'run',
    nodeId: 'agent',
    label: 'Agent',
    attempt: 1,
    claimedAt: at(10),
    endedAt: at(10),
    outcome: 'completed',
  });
  return run;
}
function hold(id: string, start: number, end?: number, workflowId?: string) {
  store.put('pauseHolds', {
    id,
    scope: workflowId ? 'workflow' : 'library',
    workflowId,
    actor: 'test',
    reason: 'Maintenance',
    createdAt: at(start),
    ...(end === undefined ? {} : { releasedAt: at(end) }),
  });
}
const expected = {
  median: 10000,
  pausedMs: { median: 6000 },
  activeMs: { median: 4000 },
};

describe('pause-adjusted report durations', () => {
  it('preserves wall time and subtracts six seconds across all elapsed metrics', () => {
    setup();
    hold('pause', 2, 8);
    const report = engine.report({});
    workflowReportSchema.parse(report);
    for (const metric of [
      report.summary.durationMs,
      report.summary.admissionQueueWaitMs,
      report.summary.humanWaitMs,
      report.nodes[0].durationMs,
      report.stages[0].durationMs,
      report.claims.newSession,
    ])
      expect(metric).toMatchObject(expected);
    expect(formatWorkflowReport(report)).toContain(
      'active: count=1 min=4000 median=4000',
    );
    expect(formatWorkflowReport(report)).toContain(
      'paused: count=1 min=6000 median=6000',
    );
  });
  it('unions overlapping holds, clips partial and current intervals, and isolates workflows', () => {
    setup();
    hold('library', -2, 4);
    hold('workflow', 2, 6, 'workflow');
    hold('current', 8);
    hold('other', 0, 10, 'other');
    store.put('runs', {
      ...store.get<Run>('runs', 'run')!,
      id: 'other-run',
      workflowId: 'unpaused',
    });
    const report = engine.report({});
    expect(report.summary.durationMs).toMatchObject({
      median: 10000,
      pausedMs: { min: 6000, max: 8000 },
      activeMs: { min: 2000, max: 4000 },
    });
    expect(report.stages[0].durationMs).toMatchObject({
      pausedMs: { median: 8000 },
      activeMs: { median: 2000 },
    });
  });
  it('adjusts retry claim wait, continuing sessions and declared human holds', () => {
    const run = setup();
    hold('pause', 2, 8);
    run.executions = [];
    store.put('runs', run);
    store.put('usageAttempts', {
      id: 'attempt',
      workId: 'work',
      runId: 'run',
      nodeId: 'agent',
      label: 'Agent',
      attempt: 1,
      claimedAt: at(0),
      endedAt: at(0),
      outcome: 'failed',
    });
    store.put('usageAttempts', {
      id: 'retry',
      workId: 'work',
      runId: 'run',
      nodeId: 'agent',
      label: 'Agent',
      attempt: 2,
      claimedAt: at(10),
      endedAt: at(10),
      outcome: 'completed',
    });
    store.put('contextEvents', {
      id: 'context',
      runId: 'run',
      workId: 'work',
      attempt: 2,
      kind: 'claim',
      revision: 2,
    });
    store.put('workHolds', {
      id: 'human',
      runId: 'run',
      workId: 'work',
      heldAt: at(0),
      endedAt: at(10),
    });
    const report = engine.report({});
    expect(report.claims.continuingSession).toMatchObject(expected);
    expect(report.summary.humanWaitMs).toMatchObject(expected);
  });
  it('uses one report instant for active runs and queued waits', () => {
    const run = setup();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at(10)));
    run.status = 'queued';
    run.admission!.admittedAt = undefined;
    store.put('runs', run);
    hold('current', 2);
    expect(engine.report({}).summary).toMatchObject({
      durationMs: {
        median: 10000,
        pausedMs: { median: 8000 },
        activeMs: { median: 2000 },
      },
      admissionQueueWaitMs: { median: 10000, activeMs: { median: 2000 } },
    });
    vi.restoreAllMocks();
  });
});
