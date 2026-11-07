import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  doctorReportSchema,
  blankDefinition,
  nodeSchema,
  type WorkflowDefinition,
  type PauseHold,
  type ManagedExecution,
} from '@interlock/core';
import { createApp } from '../packages/server/src/app.js';
import { createClient } from '@interlock/client';
import {
  runCommand,
  formatDoctorReport,
  runDoctorCommand,
} from '../packages/cli/src/commands.js';
import { createMcpServer } from '../packages/mcp/src/server.js';
import { createMcpClient } from '../packages/mcp/src/client.js';
import {
  uncertainClaimCollection,
  uncertainOperationCollection,
} from '../packages/runtime/src/quiescence.js';

describe('doctor health and readiness check', () => {
  let tmpDirs: string[] = [];
  let engines: Engine[] = [];
  let stores: Store[] = [];
  let servers: { close: (cb?: () => void) => void }[] = [];

  function createEnv(file = false) {
    const dir = mkdtempSync(join(tmpdir(), 'interlock-doctor-test-'));
    tmpDirs.push(dir);
    const dbPath = file ? join(dir, 'test.db') : ':memory:';
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

  describe('system checks', () => {
    it('reports passing status on a clean database', async () => {
      const { engine } = createEnv();
      const report = await engine.doctor();
      expect(doctorReportSchema.safeParse(report).success).toBe(true);
      expect(report.status).toBe('ok');
      expect(report.summary.fail).toBe(0);

      const sysChecks = report.checks.filter((c) => c.category === 'system');
      expect(
        sysChecks.some((c) => c.name === 'Engine version' && c.status === 'ok'),
      ).toBe(true);
      expect(
        sysChecks.some(
          (c) => c.name === 'Database schema version' && c.status === 'ok',
        ),
      ).toBe(true);
      expect(
        sysChecks.some(
          (c) => c.name === 'SQLite integrity' && c.status === 'ok',
        ),
      ).toBe(true);
      expect(
        sysChecks.some((c) => c.name === 'Storage space' && c.status === 'ok'),
      ).toBe(true);
      expect(
        sysChecks.some(
          (c) => c.name === 'Free disk space' && c.status === 'ok',
        ),
      ).toBe(true);
    });

    it('detects SQLite integrity failures', async () => {
      const { engine, store } = createEnv();
      vi.spyOn(store, 'quickCheck').mockReturnValueOnce([
        'corrupted index detected',
      ]);

      const report = await engine.doctor();
      expect(report.status).toBe('fail');
      const integrityCheck = report.checks.find(
        (c) => c.name === 'SQLite integrity',
      );
      expect(integrityCheck).toBeDefined();
      expect(integrityCheck!.status).toBe('fail');
      expect(integrityCheck!.message).toContain('corrupted index');
      expect(integrityCheck!.remediation).toBeDefined();
    });
  });

  describe('harness profile checks', () => {
    it('flags enabled profiles with missing binaries', async () => {
      const { engine } = createEnv();
      await engine.executors.saveProfile({
        id: 'claude-code',
        harness: 'claude-code',
        name: 'Claude Code',
        enabled: true,
        expectedRevision: 0,
        command: '/nonexistent/bin/claude',
      });

      const report = await engine.doctor();
      expect(report.status).toBe('fail');
      const binCheck = report.checks.find((c) =>
        c.name.includes('Harness binary'),
      );
      expect(binCheck).toBeDefined();
      expect(binCheck!.status).toBe('fail');
      expect(binCheck!.remediation).toContain(
        'Install the "claude-code" binary',
      );
    });

    it('verifies cwd and allowedRoots existence', async () => {
      const { engine, dir } = createEnv();
      const nonExistentCwd = join(dir, 'missing-dir');
      const nonExistentRoot = join(dir, 'missing-root');

      // Profile with missing cwd and allowedRoots
      await engine.executors.saveProfile({
        id: 'codex',
        harness: 'codex',
        name: 'Codex',
        enabled: true,
        expectedRevision: 0,
        cwd: nonExistentCwd,
        allowedRoots: [nonExistentRoot],
      });

      const report = await engine.doctor();
      expect(report.status).toBe('fail');
      expect(
        report.checks.some(
          (c) => c.name.includes('Working directory') && c.status === 'fail',
        ),
      ).toBe(true);
      expect(
        report.checks.some(
          (c) => c.name.includes('Allowed root') && c.status === 'fail',
        ),
      ).toBe(true);
    });

    it('supports live probe model check', async () => {
      const { engine } = createEnv();
      await engine.executors.saveProfile({
        id: 'custom',
        harness: 'custom',
        name: 'Custom',
        enabled: true,
        expectedRevision: 0,
        command: '/bin/echo',
      });

      vi.spyOn(engine.executors, 'listProfiles').mockResolvedValueOnce([
        {
          id: 'custom',
          harness: 'custom',
          name: 'Custom',
          enabled: true,
          revision: 1,
          mode: 'direct',
          detection: { status: 'detected', command: '/bin/echo' },
        } as any,
      ]);

      vi.spyOn(engine.executors, 'models').mockResolvedValueOnce({
        models: [{ id: 'test-model', name: 'Test Model' }],
      } as any);

      const report = await engine.doctor({ live: true });
      const liveCheck = report.checks.find((c) =>
        c.name.includes('Live probe'),
      );
      expect(liveCheck).toBeDefined();
      expect(liveCheck!.status).toBe('ok');
      expect(liveCheck!.message).toContain('1 model(s) available');
    });
  });

  describe('trigger checks', () => {
    it('detects auto-paused schedules and consecutive failures', async () => {
      const { engine, store } = createEnv();
      const wf = engine.create('Target Workflow');
      engine.publish(wf.id);

      store.put('workflowTriggers', {
        id: 'sched-1',
        workflowId: wf.id,
        kind: 'schedule',
        name: 'Auto-paused Nightly',
        enabled: true,
        autoPaused: true,
        consecutiveFailures: 5,
        timing: { kind: 'interval', seconds: 3600 },
        nextFireAt: new Date(Date.now() - 100000).toISOString(),
      });

      const report = await engine.doctor();
      expect(report.status).toBe('fail');
      const autoPausedCheck = report.checks.find((c) =>
        c.name.includes('Auto-paused schedule'),
      );
      expect(autoPausedCheck).toBeDefined();
      expect(autoPausedCheck!.status).toBe('fail');
      expect(autoPausedCheck!.message).toContain('5 failures');
    });

    it('detects excessive schedule lag', async () => {
      const { engine, store } = createEnv();
      const wf = engine.create('Target Workflow');
      engine.publish(wf.id);

      store.put('workflowTriggers', {
        id: 'sched-2',
        workflowId: wf.id,
        kind: 'schedule',
        name: 'Lagging Schedule',
        enabled: true,
        autoPaused: false,
        consecutiveFailures: 0,
        timing: { kind: 'interval', seconds: 3600 },
        nextFireAt: new Date(Date.now() - 120000).toISOString(), // 2 minutes overdue
      });

      const report = await engine.doctor();
      expect(report.status).toBe('warn');
      const lagCheck = report.checks.find((c) =>
        c.name.includes('Schedule lag'),
      );
      expect(lagCheck).toBeDefined();
      expect(lagCheck!.status).toBe('warn');
      expect(lagCheck!.message).toContain('delayed by');
    });

    it('surfaces recent webhook rejections', async () => {
      const { engine, store } = createEnv();
      vi.spyOn(store, 'recentWebhookRejections').mockReturnValueOnce(3);

      const report = await engine.doctor();
      expect(report.status).toBe('warn');
      const webhookCheck = report.checks.find(
        (c) => c.name === 'Webhook rejections',
      );
      expect(webhookCheck).toBeDefined();
      expect(webhookCheck!.status).toBe('warn');
      expect(webhookCheck!.message).toContain(
        '3 rejected webhook delivery attempt(s)',
      );
    });
  });

  describe('blocker checks', () => {
    it('detects active H3 pause holds', async () => {
      const { engine, store } = createEnv();
      store.put('pauseHolds', {
        id: 'hold-1',
        scope: 'workspace',
        reason: 'Maintenance pause',
        actor: 'operator',
        createdAt: new Date().toISOString(),
      });

      const report = await engine.doctor();
      expect(report.status).toBe('warn');
      const pauseCheck = report.checks.find((c) =>
        c.name.includes('pause hold'),
      );
      expect(pauseCheck).toBeDefined();
      expect(pauseCheck!.status).toBe('warn');
    });

    it('detects uncertain resource reservations', async () => {
      const { engine, store } = createEnv();
      store.put(uncertainClaimCollection, {
        id: 'claim-1',
        workId: 'w-1',
        runId: 'r-1',
        state: 'uncertain',
      });

      const report = await engine.doctor();
      expect(report.status).toBe('warn');
      const resCheck = report.checks.find((c) =>
        c.name.includes('Uncertain resource'),
      );
      expect(resCheck).toBeDefined();
      expect(resCheck!.status).toBe('warn');
    });

    it('detects unresolved work stalls (H12)', async () => {
      const { engine, store } = createEnv();
      vi.spyOn(store, 'currentStalls').mockReturnValueOnce([
        {
          id: 'stall-1',
          runId: 'r-1',
          executionId: 'e-1',
          nodeId: 'step-1',
          kind: 'runStallMs',
          since: new Date().toISOString(),
          detectedAt: new Date().toISOString(),
          thresholdMs: 30000,
          activeMs: 40000,
        },
      ]);

      const report = await engine.doctor();
      expect(report.status).toBe('fail');
      const stallCheck = report.checks.find((c) =>
        c.name.includes('Unresolved stalled work'),
      );
      expect(stallCheck).toBeDefined();
      expect(stallCheck!.status).toBe('fail');
    });

    it('detects needs_model executions', async () => {
      const { engine, store } = createEnv();
      store.put('managedExecutions', {
        id: 'me-1',
        workId: 'w-1',
        attempt: 1,
        state: 'needs_model',
      });

      const report = await engine.doctor();
      expect(report.status).toBe('warn');
      const nmCheck = report.checks.find((c) => c.name.includes('needs_model'));
      expect(nmCheck).toBeDefined();
      expect(nmCheck!.status).toBe('warn');
    });
  });

  describe('workflow & dependency integrity checks', () => {
    it('detects missing variables referenced by published workflows', async () => {
      const { engine, store } = createEnv();
      const savedVar = engine.variables.mutate({
        action: 'create',
        name: 'TEMPORARY_KEY',
        value: 'initial_val',
        kind: 'config',
      }) as { id: string; revision: number };
      const def: WorkflowDefinition = blankDefinition();
      def.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'script',
        label: 'Script',
        command: 'return input;',
        environment: [{ name: 'TEMPORARY_KEY', variableId: savedVar.id }],
      });
      const wf = engine.create('Production Pipeline', '', def);
      engine.publish(wf.id);

      // Delete the variable after publishing to simulate a broken dependency
      store.remove('variables', savedVar.id);

      const report = await engine.doctor();
      expect(report.status).toBe('fail');
      const varCheck = report.checks.find((c) =>
        c.name.includes('Missing variable'),
      );
      expect(varCheck).toBeDefined();
      expect(varCheck!.status).toBe('fail');
      expect(varCheck!.message).toContain(
        `references missing variable "${savedVar.id}"`,
      );
    });

    it('detects disabled variables referenced by published workflows', async () => {
      const { engine } = createEnv();
      const savedVar = engine.variables.mutate({
        action: 'create',
        name: 'API_KEY',
        value: 'initial_value',
        kind: 'config',
      }) as { id: string; revision: number };
      engine.variables.mutate({
        action: 'update',
        id: savedVar.id,
        expectedRevision: savedVar.revision,
        enabled: false,
      });

      const def: WorkflowDefinition = blankDefinition();
      def.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'script',
        label: 'Script',
        command: 'return input;',
        environment: [{ name: 'API_KEY', variableId: savedVar.id }],
      });
      const wf = engine.create('Production Pipeline', '', def);
      engine.publish(wf.id);

      const report = await engine.doctor();
      expect(report.status).toBe('fail');
      const varCheck = report.checks.find((c) =>
        c.name.includes('Disabled variable'),
      );
      expect(varCheck).toBeDefined();
      expect(varCheck!.status).toBe('fail');
      expect(varCheck!.message).toContain(
        'references disabled variable "API_KEY"',
      );
    });

    it('surfaces workflows with unpublished draft edits', async () => {
      const { engine } = createEnv();
      const wf = engine.create('Draft Edited Workflow');
      engine.publish(wf.id);

      const updatedDraft = structuredClone(wf.draft);
      updatedDraft.nodes[1].label = 'Locally changed label';
      engine.update(wf.id, {
        draft: updatedDraft,
        draftRevision: wf.draftRevision,
      });

      const report = await engine.doctor();
      expect(report.status).toBe('warn');
      const draftCheck = report.checks.find((c) =>
        c.name.includes('Unpublished draft'),
      );
      expect(draftCheck).toBeDefined();
      expect(draftCheck!.status).toBe('warn');
      expect(draftCheck!.message).toContain(
        'has unpublished draft modifications',
      );
    });
  });

  describe('server API, CLI, and MCP integration', () => {
    it('queries system.doctor over tRPC server API', async () => {
      const { engine } = createEnv();
      const server = serve({
        fetch: createApp(engine).fetch,
        hostname: '127.0.0.1',
        port: 0,
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listening ? resolve() : server.once('listening', resolve),
      );
      const addr = server.address();
      const url = `http://127.0.0.1:${(addr as any).port}`;

      const client = createClient(url);
      const report = await client.system.doctor.query();
      expect(report.status).toBe('ok');
      expect(report.checks.length).toBeGreaterThan(0);
    });

    it('formats CLI output and outputs JSON with runCommand', async () => {
      const { engine } = createEnv();
      const server = serve({
        fetch: createApp(engine).fetch,
        hostname: '127.0.0.1',
        port: 0,
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listening ? resolve() : server.once('listening', resolve),
      );
      const addr = server.address();
      const url = `http://127.0.0.1:${(addr as any).port}`;
      process.env.INTERLOCK_URL = url;

      try {
        const report = (await runCommand(['doctor'])) as any;
        expect(report.status).toBe('ok');

        const formatted = formatDoctorReport(report);
        expect(formatted).toContain('Interlock Doctor');
        expect(formatted).toContain('[system]');
        expect(formatted).toContain('Summary:');
        expect(formatted).toContain('Overall status: OK');
      } finally {
        delete process.env.INTERLOCK_URL;
      }
    });

    it('exposes doctor tool in MCP server', async () => {
      const { engine } = createEnv();
      const server = serve({
        fetch: createApp(engine).fetch,
        hostname: '127.0.0.1',
        port: 0,
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listening ? resolve() : server.once('listening', resolve),
      );
      const addr = server.address();
      const url = `http://127.0.0.1:${(addr as any).port}`;

      const mcpClient = createMcpClient(url);
      const report = await mcpClient.system.doctor();
      expect(report.status).toBe('ok');
      expect(report.summary.total).toBeGreaterThan(0);
    });

    it('returns failing DoctorReport with runCommand when a check fails', async () => {
      const { engine } = createEnv();
      await engine.executors.saveProfile({
        id: 'claude-code',
        harness: 'claude-code',
        name: 'Claude Code',
        enabled: true,
        expectedRevision: 0,
        command: '/nonexistent/bin/claude',
      });

      const server = serve({
        fetch: createApp(engine).fetch,
        hostname: '127.0.0.1',
        port: 0,
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listening ? resolve() : server.once('listening', resolve),
      );
      const addr = server.address();
      const url = `http://127.0.0.1:${(addr as any).port}`;
      process.env.INTERLOCK_URL = url;

      try {
        const report = (await runCommand(['doctor'])) as any;
        expect(report.status).toBe('fail');
        expect(report.summary.fail).toBeGreaterThan(0);
        const formatted = formatDoctorReport(report);
        expect(formatted).toContain('Overall status: FAIL');
        expect(formatted).toContain('Remediation:');
      } finally {
        delete process.env.INTERLOCK_URL;
      }
    });

    function invokeCli(args: string[], url: string) {
      return new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', 'packages/cli/src/bin.ts', 'doctor', ...args],
          {
            cwd: process.cwd(),
            env: { ...process.env, INTERLOCK_URL: url },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      });
    }

    it('exits with code 1 when CLI binary encounters failure status', async () => {
      const { engine } = createEnv();
      await engine.executors.saveProfile({
        id: 'claude-code',
        harness: 'claude-code',
        name: 'Claude Code',
        enabled: true,
        expectedRevision: 0,
        command: '/nonexistent/bin/claude',
      });

      const server = serve({
        fetch: createApp(engine).fetch,
        hostname: '127.0.0.1',
        port: 0,
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listening ? resolve() : server.once('listening', resolve),
      );
      const addr = server.address();
      const url = `http://127.0.0.1:${(addr as any).port}`;

      const cliResult = await invokeCli([], url);
      expect(cliResult.code).toBe(1);
      expect(cliResult.stdout).toContain('Overall status: FAIL');

      const jsonResult = await invokeCli(['--json'], url);
      expect(jsonResult.code).toBe(1);
      const report = JSON.parse(jsonResult.stdout);
      expect(report.status).toBe('fail');
    });

    it('exits with code 0 when CLI binary encounters passing status', async () => {
      const { engine } = createEnv();
      const server = serve({
        fetch: createApp(engine).fetch,
        hostname: '127.0.0.1',
        port: 0,
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listening ? resolve() : server.once('listening', resolve),
      );
      const addr = server.address();
      const url = `http://127.0.0.1:${(addr as any).port}`;

      const cliResult = await invokeCli([], url);
      expect(cliResult.code).toBe(0);
      expect(cliResult.stdout).toContain('Overall status: OK');
    });
  });
});
