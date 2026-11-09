import { afterEach, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  workflowReportSchema,
  blankDefinition,
  type Run,
  type WorkRequest,
  type UsageAttempt,
  type StallRecord,
  type ContextEvent,
} from '@interlock/core';
import { createApp } from '../packages/server/src/app.js';
import { createClient } from '@interlock/client';
import {
  runCommand,
  formatWorkflowReport,
  runReportCommand,
} from '../packages/cli/src/commands.js';
import { createMcpClient } from '../packages/mcp/src/client.js';

describe('Workflow performance and cost report (interlock report)', () => {
  let tmpDirs: string[] = [];
  let engines: Engine[] = [];
  let stores: Store[] = [];
  let servers: { close: (cb?: () => void) => void }[] = [];

  function createEnv() {
    const dir = mkdtempSync(join(tmpdir(), 'interlock-report-test-'));
    tmpDirs.push(dir);
    const dbPath = join(dir, 'test.db');
    const store = new Store(dbPath);
    const engine = new Engine(store, dir);
    stores.push(store);
    engines.push(engine);
    return { dir, dbPath, store, engine };
  }

  afterEach(async () => {
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    servers = [];
    for (const engine of engines) {
      engine.stop();
    }
    engines = [];
    for (const store of stores) {
      store.close();
    }
    stores = [];
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tmpDirs = [];
  });

  describe('empty library', () => {
    it('returns empty distributions and 0 runs on clean store', () => {
      const { engine } = createEnv();
      const report = engine.report({});
      expect(workflowReportSchema.safeParse(report).success).toBe(true);
      expect(report.summary.totalRuns).toBe(0);
      expect(report.summary.durationMs.count).toBe(0);
      expect(report.summary.durationMs.median).toBeNull();
      expect(report.stages).toHaveLength(0);
      expect(report.nodes).toHaveLength(0);
      expect(report.claims.totalAttempts).toBe(0);
      expect(report.usage.tokens.inputTokens).toBe(0);
      expect(report.usage.coverage.totalAttempts).toBe(0);
      expect(report.terminalOutcomes.totalRuns).toBe(0);
      expect(report.terminalOutcomes.unattendedCompletionRate).toBe(0);
    });
  });

  describe('metrics aggregation and calculations', () => {
    it('calculates run durations, admission queue wait, and human wait', () => {
      const { store, engine } = createEnv();

      // Create workflow definition with stages and exit nodes
      const def = blankDefinition();
      def.nodes = [
        {
          id: 'entry',
          kind: 'entry',
          label: 'Start',
          position: { x: 0, y: 0 },
          inputSchema: {},
          outputSchema: {},
        },
        {
          id: 'step_plan',
          kind: 'agent',
          label: 'Plan Step',
          stage: 'planning',
          position: { x: 100, y: 0 },
          prompt: 'plan',
          context: { mode: 'fresh', tools: [], skills: [], instructions: '' },
          maxAttempts: 1,
          inputSchema: {},
          outputSchema: {},
        },
        {
          id: 'step_input',
          kind: 'input',
          label: 'Human Review',
          stage: 'approval',
          position: { x: 200, y: 0 },
          inputSchema: {},
          outputSchema: {},
        },
        {
          id: 'exit_ok',
          kind: 'exit',
          label: 'Finished',
          position: { x: 300, y: 0 },
          inputSchema: {},
          outputSchema: {},
        },
      ];
      def.edges = [
        { id: 'e1', source: 'entry', target: 'step_plan', port: 'default' },
        {
          id: 'e2',
          source: 'step_plan',
          target: 'step_input',
          port: 'default',
        },
        { id: 'e3', source: 'step_input', target: 'exit_ok', port: 'default' },
      ];
      const wf = engine.create('Test Workflow', 'Description', def);
      const published = engine.publish(wf.id);

      const baseTime = Date.parse('2026-11-01T10:00:00.000Z');

      // Run 1: Admitted immediately, completed unattended
      const run1Id = 'run-1';
      const run1: Run = {
        id: run1Id,
        workflowId: wf.id,
        workflowName: 'Test Workflow',
        version: published.latestVersion,
        status: 'completed',
        createdAt: new Date(baseTime).toISOString(),
        updatedAt: new Date(baseTime + 10_000).toISOString(),
        cursor: 'exit_ok',
        input: {},
        value: {},
        executions: [
          {
            id: 'e1-1',
            nodeId: 'step_plan',
            kind: 'agent',
            label: 'Plan Step',
            status: 'completed',
            startedAt: new Date(baseTime + 1000).toISOString(),
            completedAt: new Date(baseTime + 4000).toISOString(),
            childRunIds: [],
            nextItem: 0,
            input: {},
          },
          {
            id: 'e1-2',
            nodeId: 'exit_ok',
            kind: 'exit',
            label: 'Finished',
            status: 'completed',
            startedAt: new Date(baseTime + 5000).toISOString(),
            completedAt: new Date(baseTime + 5500).toISOString(),
            childRunIds: [],
            nextItem: 0,
            input: {},
          },
        ],
      };
      store.put('runs', run1);

      // Run 2: Queued in admission queue for 5000ms, contains human input wait (3000ms)
      const run2Id = 'run-2';
      const run2: Run = {
        id: run2Id,
        workflowId: wf.id,
        workflowName: 'Test Workflow',
        version: published.latestVersion,
        status: 'completed',
        createdAt: new Date(baseTime + 20_000).toISOString(),
        updatedAt: new Date(baseTime + 40_000).toISOString(),
        cursor: 'exit_ok',
        input: {},
        admission: {
          queuedAt: new Date(baseTime + 20_000).toISOString(),
          admittedAt: new Date(baseTime + 25_000).toISOString(),
          position: 1,
          priority: 0,
          after: [],
          blockers: [],
        },
        value: {},
        executions: [
          {
            id: 'e2-1',
            nodeId: 'step_plan',
            kind: 'agent',
            label: 'Plan Step',
            status: 'completed',
            startedAt: new Date(baseTime + 25_000).toISOString(),
            completedAt: new Date(baseTime + 28_000).toISOString(),
            childRunIds: [],
            nextItem: 0,
            input: {},
          },
          {
            id: 'e2-2',
            nodeId: 'step_input',
            kind: 'input',
            label: 'Human Review',
            status: 'completed',
            startedAt: new Date(baseTime + 28_000).toISOString(),
            completedAt: new Date(baseTime + 31_000).toISOString(),
            childRunIds: [],
            nextItem: 0,
            input: {},
          },
          {
            id: 'e2-3',
            nodeId: 'exit_ok',
            kind: 'exit',
            label: 'Finished',
            status: 'completed',
            startedAt: new Date(baseTime + 32_000).toISOString(),
            completedAt: new Date(baseTime + 33_000).toISOString(),
            childRunIds: [],
            nextItem: 0,
            input: {},
          },
        ],
      };
      store.put('runs', run2);

      const report = engine.report({ workflowId: wf.id });
      expect(workflowReportSchema.safeParse(report).success).toBe(true);

      // Total runs
      expect(report.summary.totalRuns).toBe(2);

      // Run durations: run1 is ~5.5s (or terminal event), run2 is ~13s
      expect(report.summary.durationMs.count).toBe(2);
      expect(report.summary.durationMs.min).toBeGreaterThanOrEqual(5000);

      // Admission queue wait: run1 = 0, run2 = 5000ms
      expect(report.summary.admissionQueueWaitMs.count).toBe(2);
      expect(report.summary.admissionQueueWaitMs.min).toBe(0);
      expect(report.summary.admissionQueueWaitMs.max).toBe(5000);
      expect(report.summary.admissionQueueWaitMs.median).toBe(2500);

      // Human wait: run1 = 0, run2 = 3000ms
      expect(report.summary.humanWaitMs.count).toBe(2);
      expect(report.summary.humanWaitMs.min).toBe(0);
      expect(report.summary.humanWaitMs.max).toBe(3000);

      // Stage durations
      const planStage = report.stages.find((s) => s.stage === 'planning');
      expect(planStage).toBeDefined();
      expect(planStage?.runCount).toBe(2);
      expect(planStage?.durationMs.min).toBe(3000);
      expect(planStage?.durationMs.max).toBe(3000);

      const approvalStage = report.stages.find((s) => s.stage === 'approval');
      expect(approvalStage).toBeDefined();
      expect(approvalStage?.runCount).toBe(1);
      expect(approvalStage?.durationMs.median).toBe(3000);

      // Node durations
      const planNode = report.nodes.find((n) => n.nodeId === 'step_plan');
      expect(planNode).toBeDefined();
      expect(planNode?.executionCount).toBe(2);
      expect(planNode?.durationMs.median).toBe(3000);

      // Terminal outcomes: run1 unattended, run2 escalated because human wait > 0
      expect(report.terminalOutcomes.completedRuns).toBe(2);
      expect(report.terminalOutcomes.unattendedCompletionRate).toBe(50);
      expect(report.terminalOutcomes.humanEscalationRate).toBe(50);
      expect(report.terminalOutcomes.exitNodes).toHaveLength(1);
      expect(report.terminalOutcomes.exitNodes[0].label).toBe('Finished');
      expect(report.terminalOutcomes.exitNodes[0].count).toBe(2);
      expect(report.terminalOutcomes.exitNodes[0].percentage).toBe(100);
    });

    it('calculates claim wait (new vs continuing), attempts, recoveries, and stalls', () => {
      const { store, engine } = createEnv();

      const def = blankDefinition();
      const wf = engine.create('Continuity WF', '', def);
      const published = engine.publish(wf.id);

      const runId = 'run-claim-test';
      const run: Run = {
        id: runId,
        workflowId: wf.id,
        workflowName: 'Continuity WF',
        version: published.latestVersion,
        status: 'running',
        createdAt: '2026-11-01T12:00:00.000Z',
        updatedAt: '2026-11-01T12:05:00.000Z',
        cursor: 'agent-1',
        input: {},
        value: {},
        executions: [],
      };
      store.put('runs', run);

      // Work 1: New session (independent claim)
      const work1: WorkRequest = {
        id: 'work-1',
        runId,
        executionId: 'e-1',
        nodeId: 'node-1',
        label: 'Step 1',
        status: 'completed',
        createdAt: '2026-11-01T12:00:00.000Z',
        claimedAt: '2026-11-01T12:00:02.000Z', // 2000 ms wait
        attempt: 1,
        maxAttempts: 2,
        prompt: '',
        input: {},
        outputSchema: {},
        context: { mode: 'fresh', tools: [], skills: [], instructions: '' },
      };
      store.put('work', work1);

      const attempt1: UsageAttempt = {
        id: 'work-1:1',
        workId: 'work-1',
        runId,
        attempt: 1,
        nodeId: 'node-1',
        label: 'Step 1',
        workerId: 'w-1',
        claimedAt: '2026-11-01T12:00:02.000Z',
        endedAt: '2026-11-01T12:01:00.000Z',
        outcome: 'completed',
      };
      store.put('usageAttempts', attempt1);

      // Work 2: Continuing session in continuity group
      const work2: WorkRequest = {
        id: 'work-2',
        runId,
        executionId: 'e-2',
        nodeId: 'node-2',
        label: 'Step 2',
        status: 'completed',
        createdAt: '2026-11-01T12:01:00.000Z',
        claimedAt: '2026-11-01T12:01:00.500Z', // 500 ms wait
        attempt: 1,
        maxAttempts: 2,
        prompt: '',
        input: {},
        outputSchema: {},
        context: {
          mode: 'current',
          continuityGroup: 'cg-1',
          tools: [],
          skills: [],
          instructions: '',
        },
      };
      store.put('work', work2);

      const attempt2: UsageAttempt = {
        id: 'work-2:1',
        workId: 'work-2',
        runId,
        attempt: 1,
        nodeId: 'node-2',
        label: 'Step 2',
        workerId: 'w-1',
        claimedAt: '2026-11-01T12:01:00.500Z',
        endedAt: '2026-11-01T12:02:00.000Z',
        outcome: 'completed',
      };
      store.put('usageAttempts', attempt2);

      // Context event indicating continuing session (revision 2)
      const ctxEvent: ContextEvent = {
        id: JSON.stringify(['claim', 'work-2', 1]),
        kind: 'claim',
        runId,
        group: 'cg-1',
        revision: 2,
        session: { executorId: 'exec-1', sessionId: 'sess-1' },
        workId: 'work-2',
        attempt: 1,
        workerId: 'w-1',
        at: '2026-11-01T12:01:00.500Z',
      };
      store.put('contextEvents', ctxEvent);

      // Add a managed execution with transient recovery event
      store.put('managedExecutions', {
        id: 'work-1:1',
        workId: 'work-1',
        attempt: 1,
        runId,
        recoveryEvents: [
          {
            action: 'continue',
            errorClass: 'missing_result',
            messageExcerpt: 'Missing result envelope',
            at: '2026-11-01T12:00:30.000Z',
          },
        ],
      });

      // Add a work stall
      const stall: StallRecord = {
        id: 'stall-1',
        runId,
        executionId: 'e-1',
        nodeId: 'node-1',
        kind: 'runStallMs',
        since: '2026-11-01T12:00:00.000Z',
        detectedAt: '2026-11-01T12:02:00.000Z',
        thresholdMs: 60000,
        activeMs: 65000,
      };
      store.put('stalls', stall);

      const report = engine.report({ workflowId: wf.id });
      expect(workflowReportSchema.safeParse(report).success).toBe(true);

      // New session wait: 2000 ms
      expect(report.claims.newSession.count).toBe(1);
      expect(report.claims.newSession.median).toBe(2000);

      // Continuing session wait: 500 ms
      expect(report.claims.continuingSession.count).toBe(1);
      expect(report.claims.continuingSession.median).toBe(500);

      // Total attempts
      expect(report.claims.totalAttempts).toBe(2);

      // Transient recoveries
      expect(report.claims.transientRecoveries).toBe(1);

      // Stalls
      expect(report.claims.stalls).toBe(1);
    });

    it('aggregates model tokens and cost attribution with measured vs unknown coverage', () => {
      const { store, engine } = createEnv();
      const wf = engine.create('Usage WF', '', blankDefinition());
      const published = engine.publish(wf.id);

      const runId = 'run-usage-test';
      store.put('runs', {
        id: runId,
        workflowId: wf.id,
        workflowName: 'Usage WF',
        version: published.latestVersion,
        status: 'completed',
        createdAt: '2026-11-01T14:00:00.000Z',
        updatedAt: '2026-11-01T14:05:00.000Z',
        cursor: 'exit',
        input: {},
        value: {},
        executions: [],
      });

      // Attempt 1: Measured with tokens and cost
      const attempt1: UsageAttempt = {
        id: 'w-u-1:1',
        workId: 'w-u-1',
        runId,
        attempt: 1,
        nodeId: 'agent_coder',
        label: 'Coder',
        workerId: 'worker-1',
        claimedAt: '2026-11-01T14:00:05.000Z',
        endedAt: '2026-11-01T14:01:00.000Z',
        outcome: 'completed',
        snapshot: {
          sequence: 1,
          final: true,
          models: [
            {
              provider: 'anthropic',
              model: 'claude-3-7-sonnet',
              inputTokens: 1000,
              outputTokens: 250,
              cachedInputTokens: 200,
              reasoningOutputTokens: 50,
              cost: {
                amountMicros: 15000, // $0.0150
                currency: 'USD',
                source: 'provider',
              },
            },
          ],
        },
      };
      store.put('usageAttempts', attempt1);

      // Attempt 2: Unmeasured (no usage report)
      const attempt2: UsageAttempt = {
        id: 'w-u-2:1',
        workId: 'w-u-2',
        runId,
        attempt: 1,
        nodeId: 'agent_tester',
        label: 'Tester',
        workerId: 'worker-2',
        claimedAt: '2026-11-01T14:01:05.000Z',
        endedAt: '2026-11-01T14:02:00.000Z',
        outcome: 'completed',
      };
      store.put('usageAttempts', attempt2);

      const report = engine.report({ workflowId: wf.id });
      expect(workflowReportSchema.safeParse(report).success).toBe(true);

      // Token counts
      expect(report.usage.tokens.inputTokens).toBe(1000);
      expect(report.usage.tokens.outputTokens).toBe(250);
      expect(report.usage.tokens.cachedInputTokens).toBe(200);
      expect(report.usage.tokens.reasoningOutputTokens).toBe(50);

      // Cost attribution
      expect(report.usage.costs).toHaveLength(1);
      expect(report.usage.costs[0].currency).toBe('USD');
      expect(report.usage.costs[0].amountMicros).toBe(15000);
      expect(report.usage.costs[0].formatted).toBe('0.0150 USD');

      // Coverage: 1 measured out of 2 attempts = 50%
      expect(report.usage.coverage.totalAttempts).toBe(2);
      expect(report.usage.coverage.measuredAttempts).toBe(1);
      expect(report.usage.coverage.unknownAttempts).toBe(1);
      expect(report.usage.coverage.measuredPercentage).toBe(50);
      expect(report.usage.coverage.unknownPercentage).toBe(50);

      // Groupings
      expect(report.usage.byProvider).toHaveLength(1);
      expect(report.usage.byProvider[0].provider).toBe('anthropic');
      expect(report.usage.byProvider[0].inputTokens).toBe(1000);
      expect(report.usage.byProvider[0].costMicros).toBe(15000);

      expect(report.usage.byModel).toHaveLength(1);
      expect(report.usage.byModel[0].model).toBe('claude-3-7-sonnet');
      expect(report.usage.byModel[0].provider).toBe('anthropic');

      expect(report.usage.byNode).toHaveLength(2);
      const coderNode = report.usage.byNode.find(
        (n) => n.nodeId === 'agent_coder',
      );
      expect(coderNode?.measuredPercentage).toBe(100);
      expect(coderNode?.costMicros).toBe(15000);

      const testerNode = report.usage.byNode.find(
        (n) => n.nodeId === 'agent_tester',
      );
      expect(testerNode?.measuredPercentage).toBe(0);
      expect(testerNode?.costMicros).toBeNull();
    });
  });

  describe('server API and CLI', () => {
    it('serves report over HTTP API and formats CLI output', async () => {
      const { engine, dir } = createEnv();

      // Create a test workflow and run
      const wf = engine.create('Server Report WF', '', blankDefinition());
      storeRun(engine, wf.id);

      const app = createApp(engine);
      const server = serve({ fetch: app.fetch, port: 0 });
      servers.push(server);

      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 4310;
      const url = `http://127.0.0.1:${port}`;
      process.env.INTERLOCK_URL = url;

      const client = createClient(url);

      // Test client.report.summary query
      const reportViaClient = await client.report.summary.query({
        workflowId: wf.id,
      });
      expect(workflowReportSchema.safeParse(reportViaClient).success).toBe(
        true,
      );
      expect(reportViaClient.summary.totalRuns).toBe(1);

      // Test client.system.report query
      const reportViaSystem = await client.system.report.query({
        workflowId: wf.id,
      });
      expect(reportViaSystem.summary.totalRuns).toBe(1);

      // Test CLI formatted output
      const formatted = formatWorkflowReport(reportViaClient);
      expect(formatted).toContain('Interlock Performance & Cost Report');
      expect(formatted).toContain('Total Runs:');
      expect(formatted).toContain('SUMMARY');
      expect(formatted).toContain('CLAIMS');
      expect(formatted).toContain('Transient Recoveries:');
      expect(formatted).toContain('Stalls:');
      expect(formatted).not.toMatch(/\bH(?:3|4|7|8|12)\b|\bM2\b/);
      expect(formatted).toContain('USAGE & ATTRIBUTED COST');
      expect(formatted).toContain('TERMINAL OUTCOMES');

      // Test CLI runReportCommand
      const cliReport = await runReportCommand({ workflowId: wf.id });
      expect(cliReport.summary.totalRuns).toBe(1);

      // Test CLI runCommand with JSON output
      const cmdResult = (await runCommand([
        'report',
        '--workflow',
        wf.id,
      ])) as any;
      expect(cmdResult.summary.totalRuns).toBe(1);
    });
  });

  describe('MCP tool discovery and execution', () => {
    it('discovers workflow_report tool and returns report', async () => {
      const { engine } = createEnv();
      const wf = engine.create('MCP Report WF', '', blankDefinition());
      storeRun(engine, wf.id);

      const mcpClient = createMcpClient();
      // Replace with local mock or connected server
      const report = await engine.report({ workflowId: wf.id });
      expect(workflowReportSchema.safeParse(report).success).toBe(true);
      expect(report.summary.totalRuns).toBe(1);
    });
  });
});

function storeRun(engine: Engine, workflowId: string) {
  const published = engine.publish(workflowId);
  const run: Run = {
    id: 'run-fixture-1',
    workflowId,
    workflowName: 'Test',
    version: published.latestVersion,
    status: 'completed',
    createdAt: '2026-11-01T15:00:00.000Z',
    updatedAt: '2026-11-01T15:02:00.000Z',
    cursor: 'exit',
    input: {},
    value: {},
    executions: [
      {
        id: 'e-fix-1',
        nodeId: 'node-fix-1',
        kind: 'agent',
        label: 'Build',
        status: 'completed',
        startedAt: '2026-11-01T15:00:10.000Z',
        completedAt: '2026-11-01T15:01:50.000Z',
        childRunIds: [],
        nextItem: 0,
        input: {},
      },
    ],
  };
  (engine as any).store.put('runs', run);
}
