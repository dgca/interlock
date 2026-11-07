import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Engine,
  type HarnessAdapter,
  type HarnessRun,
} from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  executorProfileSchema,
  type Json,
  type Run,
  type WorkflowDefinition,
} from '@interlock/core';

const engines: Engine[] = [];
const tempDirs: string[] = [];

function createTempDir(name = 'test'): string {
  const dir = mkdtempSync(join(tmpdir(), `interlock-${name}-`));
  tempDirs.push(dir);
  return realpathSync(dir);
}

function createEngine(
  options: { allowedRoots?: string[]; workdir?: string } = {},
): Engine {
  const store = new Store(':memory:');
  const workdir = options.workdir ?? createTempDir('workdir');
  const engine = new Engine(store, workdir, {
    allowedRoots: options.allowedRoots,
  });
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
  for (const d of tempDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const worker = {
  workerId: 'test-worker',
  freshContext: false,
  tools: [],
  skills: [],
};

describe('Dynamic CWD binding for Scripts', () => {
  it('executes script in static cwd when provided on node', async () => {
    const customDir = createTempDir('custom');
    const engine = createEngine({ allowedRoots: [customDir] });
    const def = definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'script',
          label: 'Script',
          kind: 'script',
          language: 'javascript',
          cwd: customDir,
          command: 'return { cwd: process.cwd() };',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'script' },
        { id: 'e2', source: 'script', target: 'exit' },
      ],
    });
    const wf = engine.create('Test CWD', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    let run: Run = start.run;

    for (let i = 0; i < 10; i++) {
      engine.pump();
      await new Promise((r) => setTimeout(r, 50));
      run = engine.run(run.id);
      if (run.status === 'completed') break;
    }

    expect(run.status).toBe('completed');
    expect(run.output).toEqual({ cwd: customDir });
    const scriptExec = run.executions.find((e) => e.nodeId === 'script');
    expect(scriptExec?.resolvedCwd).toBe(customDir);
  });

  it('binds cwd dynamically from run input', async () => {
    const rootDir = createTempDir('root');
    const worktreeDir = join(rootDir, 'worktree-123');
    mkdirSync(worktreeDir);
    const engine = createEngine({ allowedRoots: [rootDir] });

    const def = definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'script',
          label: 'Script',
          kind: 'script',
          language: 'javascript',
          cwd: { source: 'input', path: 'targetDir' },
          command: 'return { cwd: process.cwd() };',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'script' },
        { id: 'e2', source: 'script', target: 'exit' },
      ],
    });
    const wf = engine.create('Dynamic Input CWD', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, { targetDir: worktreeDir });
    let run: Run = start.run;

    for (let i = 0; i < 10; i++) {
      engine.pump();
      await new Promise((r) => setTimeout(r, 50));
      run = engine.run(run.id);
      if (run.status === 'completed') break;
    }

    expect(run.status).toBe('completed');
    expect(run.output).toEqual({ cwd: worktreeDir });
  });

  it('binds cwd dynamically from previous node output', async () => {
    const rootDir = createTempDir('root');
    const provisionedDir = join(rootDir, 'provisioned-wt');
    mkdirSync(provisionedDir);
    const engine = createEngine({ allowedRoots: [rootDir] });

    const def = definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'provision',
          label: 'Provision Worktree',
          kind: 'script',
          language: 'javascript',
          command: `return { path: ${JSON.stringify(provisionedDir)} };`,
        },
        {
          id: 'build',
          label: 'Build in Worktree',
          kind: 'script',
          language: 'javascript',
          cwd: { source: 'node', nodeId: 'provision', path: 'path' },
          command: 'return { cwd: process.cwd() };',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'provision' },
        { id: 'e2', source: 'provision', target: 'build' },
        { id: 'e3', source: 'build', target: 'exit' },
      ],
    });
    const wf = engine.create('Node Output CWD', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    let run: Run = start.run;

    for (let i = 0; i < 15; i++) {
      engine.pump();
      await new Promise((r) => setTimeout(r, 50));
      run = engine.run(run.id);
      if (run.status === 'completed') break;
    }

    expect(run.status).toBe('completed');
    expect(run.output).toEqual({ cwd: provisionedDir });
  });

  it('inherits workflow-level cwd when omitted on node', async () => {
    const customDir = createTempDir('wf-cwd');
    const engine = createEngine({ allowedRoots: [customDir] });

    const def = definitionSchema.parse({
      cwd: customDir,
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'script',
          label: 'Script',
          kind: 'script',
          language: 'javascript',
          command: 'return { cwd: process.cwd() };',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'script' },
        { id: 'e2', source: 'script', target: 'exit' },
      ],
    });
    const wf = engine.create('Workflow CWD', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    let run: Run = start.run;

    for (let i = 0; i < 10; i++) {
      engine.pump();
      await new Promise((r) => setTimeout(r, 50));
      run = engine.run(run.id);
      if (run.status === 'completed') break;
    }

    expect(run.status).toBe('completed');
    expect(run.output).toEqual({ cwd: customDir });
  });

  it('node cwd overrides workflow cwd', async () => {
    const wfDir = createTempDir('wf-dir');
    const nodeDir = createTempDir('node-dir');
    const engine = createEngine({ allowedRoots: [wfDir, nodeDir] });

    const def = definitionSchema.parse({
      cwd: wfDir,
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'script',
          label: 'Script',
          kind: 'script',
          language: 'javascript',
          cwd: nodeDir,
          command: 'return { cwd: process.cwd() };',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'script' },
        { id: 'e2', source: 'script', target: 'exit' },
      ],
    });
    const wf = engine.create('Override CWD', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    let run: Run = start.run;

    for (let i = 0; i < 10; i++) {
      engine.pump();
      await new Promise((r) => setTimeout(r, 50));
      run = engine.run(run.id);
      if (run.status === 'completed') break;
    }

    expect(run.status).toBe('completed');
    expect(run.output).toEqual({ cwd: nodeDir });
  });

  it('fails script step when directory escapes allowedRoots', async () => {
    const allowedDir = createTempDir('allowed');
    const forbiddenDir = createTempDir('forbidden');
    const engine = createEngine({ allowedRoots: [allowedDir] });

    const def = definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'script',
          label: 'Script',
          kind: 'script',
          language: 'javascript',
          cwd: forbiddenDir,
          command: 'return { ok: true };',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'script' },
        { id: 'e2', source: 'script', target: 'exit' },
      ],
    });
    const wf = engine.create('Escaping CWD', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    let run: Run = start.run;

    for (let i = 0; i < 10; i++) {
      engine.pump();
      await new Promise((r) => setTimeout(r, 50));
      run = engine.run(run.id);
      if (run.status === 'failed') break;
    }

    expect(run.status).toBe('failed');
    expect(run.error).toContain('outside allowed roots');
  });

  it('fails script step when symlink resolves outside allowedRoots', async () => {
    const allowedDir = createTempDir('allowed');
    const forbiddenDir = createTempDir('forbidden');
    const symlinkPath = join(allowedDir, 'leak-link');
    symlinkSync(forbiddenDir, symlinkPath);

    const engine = createEngine({ allowedRoots: [allowedDir] });

    const def = definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'script',
          label: 'Script',
          kind: 'script',
          language: 'javascript',
          cwd: symlinkPath,
          command: 'return { ok: true };',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'script' },
        { id: 'e2', source: 'script', target: 'exit' },
      ],
    });
    const wf = engine.create('Symlink Escape', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    let run: Run = start.run;

    for (let i = 0; i < 10; i++) {
      engine.pump();
      await new Promise((r) => setTimeout(r, 50));
      run = engine.run(run.id);
      if (run.status === 'failed') break;
    }

    expect(run.status).toBe('failed');
    expect(run.error).toContain('outside allowed roots');
  });

  it('fails script step when bound directory does not exist', async () => {
    const allowedDir = createTempDir('allowed');
    const nonExistent = join(allowedDir, 'does-not-exist');
    const engine = createEngine({ allowedRoots: [allowedDir] });

    const def = definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'script',
          label: 'Script',
          kind: 'script',
          language: 'javascript',
          cwd: nonExistent,
          command: 'return { ok: true };',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'script' },
        { id: 'e2', source: 'script', target: 'exit' },
      ],
    });
    const wf = engine.create('Missing Dir', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    let run: Run = start.run;

    for (let i = 0; i < 10; i++) {
      engine.pump();
      await new Promise((r) => setTimeout(r, 50));
      run = engine.run(run.id);
      if (run.status === 'failed') break;
    }

    expect(run.status).toBe('failed');
    expect(run.error).toContain('does not exist');
  });
});

describe('Dynamic CWD binding for Polling Script Checks', () => {
  it('executes polling script check in bound cwd', async () => {
    const customDir = createTempDir('poll-cwd');
    writeFileSync(join(customDir, 'ready.txt'), 'ready');
    const engine = createEngine({ allowedRoots: [customDir] });

    const def = definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'wait',
          label: 'Poll Check',
          kind: 'wait',
          timing: {
            kind: 'poll',
            everyMs: 1000,
            check: {
              kind: 'script',
              language: 'javascript',
              cwd: customDir,
              command:
                'const { existsSync } = require("node:fs"); return { ready: existsSync("ready.txt") };',
            },
            path: 'ready',
            equals: true,
          },
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'wait' },
        { id: 'e2', source: 'wait', target: 'exit' },
      ],
    });
    const wf = engine.create('Poll CWD', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    let run: Run = start.run;

    for (let i = 0; i < 15; i++) {
      engine.pump();
      await new Promise((r) => setTimeout(r, 50));
      run = engine.run(run.id);
      if (run.status === 'completed') break;
    }

    expect(run.status).toBe('completed');
    const waitExec = run.executions.find((e) => e.nodeId === 'wait');
    expect(waitExec?.resolvedCwd).toBe(customDir);
  });
});

describe('Dynamic CWD binding for Agent Nodes', () => {
  it('resolves cwd for Agent node and surfaces resolvedCwd on claim and execution', () => {
    const allowedDir = createTempDir('agent-allowed');
    const engine = createEngine({ allowedRoots: [allowedDir] });

    const def = definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'agent',
          label: 'Agent Task',
          kind: 'agent',
          cwd: allowedDir,
          prompt: 'Do task',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'agent' },
        { id: 'e2', source: 'agent', target: 'exit' },
      ],
    });
    const wf = engine.create('Agent CWD', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    const run = start.run;
    engine.pump();

    const available = engine.available(run.id);
    expect(available).toHaveLength(1);
    expect(available[0].resolvedCwd).toBe(allowedDir);

    const claim = engine.claim(available[0].id, worker);
    expect(claim.resolvedCwd).toBe(allowedDir);

    const updatedRun = engine.run(run.id);
    const agentExec = updatedRun.executions.find((e) => e.nodeId === 'agent');
    expect(agentExec?.resolvedCwd).toBe(allowedDir);
  });

  it('leaves work unclaimed and sets cwdBlocked when cwd is outside allowedRoots', () => {
    const allowedDir = createTempDir('allowed');
    const forbiddenDir = createTempDir('forbidden');
    const engine = createEngine({ allowedRoots: [allowedDir] });

    const def = definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'agent',
          label: 'Agent Task',
          kind: 'agent',
          cwd: forbiddenDir,
          prompt: 'Do task',
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'agent' },
        { id: 'e2', source: 'agent', target: 'exit' },
      ],
    });
    const wf = engine.create('Blocked Agent', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    const run = start.run;
    engine.pump();

    // Not available in available() list
    expect(engine.available(run.id)).toHaveLength(0);

    // Visible in briefing blockers
    const briefing = engine.continuation.briefing({ id: run.id, limit: 10 });
    const blocker = briefing.blockers.items.find(
      (b) => b.reason === 'cwd_blocked',
    );
    expect(blocker).toBeDefined();
    expect(blocker?.cwdBlocked?.reason).toContain('outside allowed roots');
    expect(briefing.run).toMatchObject({
      actor: 'person',
      waiting: {
        kind: 'human_request',
        detail: { message: expect.stringContaining('outside allowed roots') },
      },
    });
    expect(engine.inspect(run.id).run).toMatchObject({
      actor: 'person',
      waiting: { kind: 'human_request' },
    });

    // Claim attempt is rejected with blocker reason
    const allWork = engine.store.work();
    const workItem = allWork.find((w) => w.runId === run.id);
    expect(workItem?.cwdBlocked).toBeDefined();
    expect(() => engine.claim(workItem!.id, worker)).toThrow(
      'outside allowed roots',
    );
  });

  it('managed executor runs in resolvedCwd and pins cwd across continuity group sessions', async () => {
    const dirA = createTempDir('session-dir-a');
    const dirB = createTempDir('session-dir-b');
    const engine = createEngine({ allowedRoots: [dirA, dirB] });

    let runCommands: Array<{ cwd: string; command: string }> = [];
    const testAdapter: HarnessAdapter = {
      id: 'codex',
      detect: async () => ({ status: 'detected', command: '/bin/codex' }),
      run: async (input: HarnessRun) => {
        runCommands.push({ cwd: input.cwd, command: input.command });
        input.onSession('session-native-123', 'gpt-5');
        return { output: { result: 'done' } };
      },
    };

    engine.executors.start([testAdapter]);
    engine.executors.saveProfile({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      enabled: true,
      allowedRoots: [dirA, dirB],
      expectedRevision: 0,
    });

    const def = definitionSchema.parse({
      nodes: [
        { id: 'entry', label: 'Entry', kind: 'entry' },
        {
          id: 'step1',
          label: 'Step 1',
          kind: 'agent',
          executor: 'codex',
          cwd: dirA,
          prompt: 'Step 1 prompt',
          context: {
            mode: 'current',
            continuityGroup: 'group-one',
            tools: [],
            skills: [],
          },
        },
        {
          id: 'step2',
          label: 'Step 2',
          kind: 'agent',
          executor: 'codex',
          cwd: dirB, // Attempts to bind dirB, but group already pinned dirA!
          prompt: 'Step 2 prompt',
          context: {
            mode: 'current',
            continuityGroup: 'group-one',
            tools: [],
            skills: [],
          },
        },
        { id: 'exit', label: 'Exit', kind: 'exit' },
      ],
      edges: [
        { id: 'e1', source: 'entry', target: 'step1' },
        { id: 'e2', source: 'step1', target: 'step2' },
        { id: 'e3', source: 'step2', target: 'exit' },
      ],
    });

    const wf = engine.create('Continuity CWD', '', def);
    engine.publish(wf.id);
    const start = engine.start(wf.id, {});
    let run: Run = start.run;

    for (let i = 0; i < 30; i++) {
      engine.pump();
      await new Promise((r) => setTimeout(r, 100));
      run = engine.run(run.id);
      if (run.status === 'completed') break;
    }

    expect(run.status).toBe('completed');
    expect(runCommands).toHaveLength(2);
    // Both executions ran in dirA because continuity group pinned dirA!
    expect(runCommands[0].cwd).toBe(dirA);
    expect(runCommands[1].cwd).toBe(dirA);

    const exec1 = run.executions.find((e) => e.nodeId === 'step1');
    const exec2 = run.executions.find((e) => e.nodeId === 'step2');
    expect(exec1?.resolvedCwd).toBe(dirA);
    expect(exec2?.resolvedCwd).toBe(dirA);
  });
});
