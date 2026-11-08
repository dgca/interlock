import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition, definitionSchema } from '@interlock/core';
import { nativeAdapters } from '../packages/runtime/src/executors/native.js';
import {
  evaluateSessionNameTemplate,
  evaluateCommandOrUrlTemplate,
  sanitizeDeepLink,
  sanitizeMessage,
} from '../packages/runtime/src/executors/templates.js';

const engines: Engine[] = [];

const create = (path = ':memory:') => {
  const e = new Engine(new Store(path), process.cwd());
  engines.push(e);
  return e;
};

afterEach(async () => {
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function workflowWithAgent(
  e: Engine,
  executor?: string,
  extra: Record<string, unknown> = {},
) {
  const d = blankDefinition();
  d.executor = executor;
  const node = d.nodes.find((n) => n.kind === 'agent')!;
  Object.assign(node, extra);
  const w = e.create(
    'Session Visibility Workflow',
    '',
    definitionSchema.parse(d),
  );
  e.publish(w.id);
  return w;
}

describe('Session visibility & templates (Issue #243)', () => {
  describe('evaluateSessionNameTemplate (AC1)', () => {
    it('evaluates template from full run context with externalTask and node data', () => {
      const template =
        '{{externalTask.id}} {{node.label}}: {{externalTask.title}}';
      const result = evaluateSessionNameTemplate(template, {
        externalTask: {
          id: 'dgca/interlock#243',
          system: 'github',
          title: 'M4: Session visibility',
          url: 'https://github.com/dgca/interlock/issues/243',
        },
        node: {
          id: 'agent-build',
          label: 'Implement changes',
          kind: 'agent',
        },
        run: {
          id: 'run-12345',
          status: 'running',
        },
      });

      expect(result).toBe(
        'dgca/interlock#243 Implement changes: M4: Session visibility',
      );
    });

    it('handles missing or undefined template properties cleanly without errors', () => {
      const template =
        '{{externalTask.id}} {{node.label}}: {{externalTask.title}}';
      const result = evaluateSessionNameTemplate(template, {
        externalTask: {
          id: 'GH-243',
          system: 'github',
        },
        node: {
          id: 'step1',
          label: 'Run task',
        },
      });

      expect(result).toBe('GH-243 Run task:');
    });

    it('evaluates direct runId, workId, and nodeId shortcuts', () => {
      const template = '{{runId}} / {{nodeId}} / {{workId}}';
      const result = evaluateSessionNameTemplate(template, {
        runId: 'run-99',
        nodeId: 'node-42',
        workId: 'work-77',
      });

      expect(result).toBe('run-99 / node-42 / work-77');
    });

    it('sanitizes control characters, collapses whitespace, and truncates to 200 chars', () => {
      const template = 'Task\n\t{{externalTask.id}}\r\n   --   {{node.label}}';
      const longTitle = 'A'.repeat(300);
      const result = evaluateSessionNameTemplate(template, {
        externalTask: { id: 'ID-1' },
        node: { label: longTitle },
      });

      expect(result.includes('\n')).toBe(false);
      expect(result.includes('\r')).toBe(false);
      expect(result.includes('\t')).toBe(false);
      expect(result.length).toBeLessThanOrEqual(200);
      expect(result.startsWith('Task ID-1 -- AAAA')).toBe(true);
    });
  });

  describe('evaluateCommandOrUrlTemplate and sanitizeDeepLink (AC2 & AC5)', () => {
    it('interpolates resume command templates with session tokens', () => {
      const template = 'custom-cli resume {{sessionId}} --dir {{cwd}}';
      const vars = {
        sessionId: 'sess-abc-123',
        cwd: '/worktrees/test',
        workId: 'w-1',
      };
      const result = evaluateCommandOrUrlTemplate(template, vars);
      expect(result).toBe(
        'custom-cli resume sess-abc-123 --dir /worktrees/test',
      );
    });

    it('interpolates deep link URL templates', () => {
      const template =
        'https://agent.example.com/sessions/{{sessionId}}?run={{runId}}';
      const vars = {
        sessionId: 'sess-xyz',
        runId: 'run-555',
      };
      const result = evaluateCommandOrUrlTemplate(template, vars);
      expect(result).toBe(
        'https://agent.example.com/sessions/sess-xyz?run=run-555',
      );
    });

    it('sanitizes deep links: accepts valid http/https and rejects malicious schemes', () => {
      expect(sanitizeDeepLink('https://agent.example.com/sessions/123')).toBe(
        'https://agent.example.com/sessions/123',
      );
      expect(sanitizeDeepLink('http://localhost:3000/view')).toBe(
        'http://localhost:3000/view',
      );
      expect(sanitizeDeepLink('javascript:alert(1)')).toBeUndefined();
      expect(sanitizeDeepLink('file:///etc/passwd')).toBeUndefined();
      expect(sanitizeDeepLink('https://user:pass@example.com')).toBeUndefined();
    });
  });

  describe('sanitizeMessage & live tail ring buffer (AC3 & AC5)', () => {
    it('redacts tokens, claim tickets, and sensitive headers from progress messages', () => {
      const raw1 =
        'Agent authenticated with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret';
      const raw2 =
        'Connecting using claim_ticket="550e8400-e29b-41d4-a716-446655440000" and token=abc12345678';
      const raw3 =
        'Running with INTERLOCK_CLAIM_TOKEN=secret-token-value-123 in env';

      expect(sanitizeMessage(raw1)).toBe(
        'Agent authenticated with Bearer [REDACTED]',
      );
      expect(sanitizeMessage(raw2)).toBe(
        'Connecting using claim_ticket="[REDACTED]" and token=[REDACTED]',
      );
      expect(sanitizeMessage(raw3)).toBe(
        'Running with INTERLOCK_TOKEN=[REDACTED] in env',
      );
    });

    it('maintains a bounded live tail buffer of at most 20 messages in execution records', async () => {
      const e = create();
      let capturedPayload: any = null;

      const server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          capturedPayload = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              output: { result: 'ok' },
              sessionId: 'sess-live-test',
              resumeCommand: 'agent resume sess-live-test',
              deepLink: 'https://agent.corp.internal/sess-live-test',
            }),
          );
        });
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        e.executors.saveProfile({
          id: 'custom-http-live',
          harness: 'custom',
          name: 'Custom HTTP Live',
          enabled: true,
          expectedRevision: 0,
          mode: 'direct',
          transport: 'http',
          turnUrl: `http://127.0.0.1:${port}/turn`,
          sessionNameTemplate: '{{externalTask.id}} {{node.label}}',
        });

        e.executors.start(nativeAdapters);

        const w = workflowWithAgent(e, 'custom-http-live');
        const run = e.start(w.id, { input: 1 }, undefined, undefined, {
          externalTask: {
            system: 'github',
            id: 'GH-243',
            title: 'Live tail test',
          },
        }).run;

        await vi.waitFor(
          () => {
            const currentRun = e.run(run.id);
            expect(currentRun.status).toBe('completed');
          },
          { timeout: 8000 },
        );

        expect(capturedPayload).toBeDefined();
        expect(capturedPayload.sessionName).toBe('GH-243 Agent assignment');

        const agentWork = (e.store as any)
          .work()
          .find((x: any) => x.runId === run.id && x.nodeId === 'agent');
        expect(agentWork).toBeDefined();

        const inspection = e.executors.inspect(agentWork.id);
        expect(inspection.items.length).toBe(1);
        const item = inspection.items[0];
        expect(item.sessionId).toBe('sess-live-test');
        expect(item.sessionName).toBe('GH-243 Agent assignment');
        expect(item.resumeCommand).toBe('agent resume sess-live-test');
        expect(item.deepLink).toBe(
          'https://agent.corp.internal/sess-live-test',
        );

        // Verify live tail bounds by adding > 25 logs
        const record = (e.executors as any).latest(agentWork.id);
        for (let i = 1; i <= 30; i++) {
          (e.executors as any).log(record, `Progress message ${i}`);
        }

        const updatedInspection = e.executors.inspect(agentWork.id);
        expect(updatedInspection.items[0].logs.length).toBe(20);
        expect(updatedInspection.items[0].logs[19].message).toBe(
          'Progress message 30',
        );
        expect(updatedInspection.items[0].logs[0].message).toBe(
          'Progress message 11',
        );
      } finally {
        server.close();
      }
    });

    it('evaluates profile resumeCommandTemplate and deepLinkTemplate when harness does not supply them directly', async () => {
      const e = create();

      const server = createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            output: { done: true },
            sessionId: 'native-sess-888',
          }),
        );
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        e.executors.saveProfile({
          id: 'custom-template-profile',
          harness: 'custom',
          name: 'Custom Template Harness',
          enabled: true,
          expectedRevision: 0,
          mode: 'direct',
          transport: 'http',
          turnUrl: `http://127.0.0.1:${port}/turn`,
          sessionNameTemplate: '{{node.label}} [{{runId}}]',
          resumeCommandTemplate: 'runner resume {{sessionId}}',
          deepLinkTemplate: 'https://harness.io/session/{{sessionId}}',
        });

        e.executors.start(nativeAdapters);

        const w = workflowWithAgent(e, 'custom-template-profile');
        const run = e.start(w.id, { test: true }).run;

        await vi.waitFor(
          () => {
            const currentRun = e.run(run.id);
            expect(currentRun.status).toBe('completed');
          },
          { timeout: 8000 },
        );

        const agentWork = (e.store as any)
          .work()
          .find((x: any) => x.runId === run.id && x.nodeId === 'agent')!;
        const inspection = e.executors.inspect(agentWork.id);
        const item = inspection.items[0];

        expect(item.sessionId).toBe('native-sess-888');
        expect(item.sessionName).toBe(`Agent assignment [${run.id}]`);
        expect(item.resumeCommand).toBe('runner resume native-sess-888');
        expect(item.deepLink).toBe(
          'https://harness.io/session/native-sess-888',
        );
      } finally {
        server.close();
      }
    });

    it('honors node sessionNameTemplate override over profile default', async () => {
      const e = create();
      let capturedPayload: any = null;

      const server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          capturedPayload = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ output: { ok: true } }));
        });
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        e.executors.saveProfile({
          id: 'custom-override-profile',
          harness: 'custom',
          name: 'Custom Override',
          enabled: true,
          expectedRevision: 0,
          mode: 'direct',
          transport: 'http',
          turnUrl: `http://127.0.0.1:${port}/turn`,
          sessionNameTemplate: 'profile-default-{{workId}}',
        });

        e.executors.start(nativeAdapters);

        const w = workflowWithAgent(e, 'custom-override-profile', {
          sessionNameTemplate: 'node-override-{{nodeId}}',
        });
        const run = e.start(w.id, {}).run;

        await vi.waitFor(
          () => {
            const currentRun = e.run(run.id);
            expect(currentRun.status).toBe('completed');
          },
          { timeout: 8000 },
        );

        expect(capturedPayload).toBeDefined();
        expect(capturedPayload.sessionName).toBe('node-override-agent');
      } finally {
        server.close();
      }
    });

    it('updates resumeCommand and deepLink from launcher status poll hook', async () => {
      const e = create();
      let launchPayload: any = null;

      const server = createServer((req, res) => {
        if (req.url === '/launch') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            launchPayload = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                sessionId: 'launcher-sess-100',
              }),
            );
          });
        } else if (req.url === '/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'working',
              progress: 'Agent compiling dependencies',
              resumeCommand: 'launcher resume launcher-sess-100',
              deepLink: 'https://launcher.corp/sessions/launcher-sess-100',
            }),
          );
        }
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        e.executors.saveProfile({
          id: 'custom-launcher-visibility',
          harness: 'custom',
          name: 'Custom Launcher Visibility',
          enabled: true,
          expectedRevision: 0,
          mode: 'launcher',
          transport: 'http',
          launchUrl: `http://127.0.0.1:${port}/launch`,
          statusUrl: `http://127.0.0.1:${port}/status`,
          sessionNameTemplate: 'launcher-{{externalTask.id}}',
        });

        e.executors.start(nativeAdapters);

        const w = workflowWithAgent(e, 'custom-launcher-visibility');
        const run = e.start(w.id, { task: 1 }, undefined, undefined, {
          externalTask: { system: 'github', id: 'TICKET-99' },
        }).run;

        // Wait for launch
        await vi.waitFor(
          () => {
            expect(launchPayload).toBeDefined();
            expect(launchPayload.sessionName).toBe('launcher-TICKET-99');
          },
          { timeout: 5000 },
        );

        const agentWork = (e.store as any)
          .work()
          .find((x: any) => x.runId === run.id && x.nodeId === 'agent')!;

        // Wait for status poll to update status and live tail
        await vi.waitFor(
          () => {
            const insp = e.executors.inspect(agentWork.id);
            expect(insp.items.length).toBeGreaterThan(0);
            const item = insp.items[0];
            expect(item.resumeCommand).toBe(
              'launcher resume launcher-sess-100',
            );
            expect(item.deepLink).toBe(
              'https://launcher.corp/sessions/launcher-sess-100',
            );
            expect(
              item.logs.some(
                (l) => l.message === 'Agent compiling dependencies',
              ),
            ).toBe(true);
          },
          { timeout: 6000 },
        );
      } finally {
        server.close();
      }
    });
  });
});
