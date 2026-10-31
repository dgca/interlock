import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { blankDefinition } from '@interlock/core';
import { createApp } from '../packages/server/src/app';

let discovery: unknown;
it.each(['http', 'stdio'])(
  'prepares, claims, inspects and cleans trial samples over MCP %s',
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'interlock-trial-transport-')),
      repository = join(root, 'source');
    mkdirSync(repository);
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
        cwd: repository,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git('init');
    writeFileSync(join(repository, 'answer.txt'), 'original');
    git('add', '.');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'Base',
    );
    const commit = git('rev-parse', 'HEAD');
    const store = new Store(join(root, 'state.db')),
      engine = new Engine(store, repository);
    const server = serve({
      fetch: createApp(engine).fetch,
      hostname: '127.0.0.1',
      port: 0,
    });
    await new Promise<void>((r) =>
      server.listening ? r() : server.once('listening', r),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const url = `http://127.0.0.1:${address.port}`,
      client = new Client({ name: 'trial-transport', version: '1' });
    const transport =
      mode === 'http'
        ? new StreamableHTTPClientTransport(new URL(`${url}/mcp`))
        : new StdioClientTransport({
            command: process.execPath,
            args: ['--import', 'tsx', 'packages/mcp/src/index.ts'],
            cwd: process.cwd(),
            env: { ...process.env, INTERLOCK_URL: url } as Record<
              string,
              string
            >,
            stderr: 'pipe',
          });
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError).not.toBe(true);
      const value = JSON.parse((r.content as { text: string }[])[0].text);
      expect(r.structuredContent).toEqual(
        Array.isArray(value) ? { items: value } : value,
      );
      return value;
    };
    const tick = setInterval(() => engine.pump(), 20);
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(49);
      if (discovery) expect(tools).toEqual(discovery);
      else {
        discovery = tools;
        console.log(
          `MCP discovery: ${tools.length} tools, ${Buffer.byteLength(JSON.stringify(tools))} bytes`,
        );
      }
      const w = engine.create('Transport trial', '', blankDefinition());
      engine.publish(w.id);
      const suite = engine.testbench.createSuite({
        workflowId: w.id,
        content: {
          name: 'Cases',
          cases: [{ id: 'a', name: 'A', input: { task: 'original' } }],
        },
      });
      const q = {
        suiteId: suite.id,
        suiteRevision: 1,
        baselineVersion: 1,
        candidateVersion: 1,
        trialSetup: { kind: 'local_git', repository, commit },
      };
      const p = await call('preview_workflow_comparison', q);
      expect(p.canStart).toBe(true);
      expect(store.runs()).toHaveLength(0);
      const c = await call('start_workflow_comparison', {
        ...q,
        confirmation: p.confirmation,
        requestId: `trial-${mode}`,
      });
      await expect.poll(() => engine.available().length).toBe(2);
      const summaries = await call('list_work', { fields: 'summary' });
      expect(JSON.stringify(summaries)).not.toContain(root);
      expect(JSON.stringify(summaries)).not.toContain('ownerToken');
      const work = engine.available()[0];
      const briefing = await call('get_run_briefing', { id: work.runId });
      expect(JSON.stringify(briefing)).not.toContain(root);
      expect(JSON.stringify(briefing)).toContain(work.trialEnvironment!.id);
      const size = await call('inspect_assignment_size', { workId: work.id });
      expect(size.components.trialEnvironment.bytes).toBeGreaterThan(0);
      expect(JSON.stringify(size)).not.toContain(root);
      const rejected = await client.callTool({
        name: 'claim_work',
        arguments: {
          workId: work.id,
          workerId: 'unscoped',
          freshContext: false,
          tools: [],
          skills: [],
        },
      });
      expect(rejected.isError).toBe(true);
      const claim = await call('claim_work', {
        workId: work.id,
        workerId: 'scoped',
        freshContext: false,
        tools: [],
        skills: ['interlock-local-trials'],
      });
      expect(claim.trialEnvironment).toMatchObject({
        baseCommit: commit,
        policy: 'trusted_local',
      });
      expect(claim.input).toEqual({ task: 'original' });
      expect(claim.trialEnvironment.workspace).not.toBe(repository);
      writeFileSync(
        join(claim.trialEnvironment.workspace, 'answer.txt'),
        'experimental',
      );
      await call('update_workflow_comparison', {
        request: { action: 'cancel', id: c.id, cancelDetached: true },
      });
      const sample = engine.testbench
        .report({ id: c.id })
        .samples.find((s) => s.runId === claim.runId)!;
      await expect
        .poll(
          () =>
            engine.testbench.readTrial({ id: c.id, sampleId: sample.id })
              .cleanup,
        )
        .toBe('blocked');
      const receipt = await call('read_workflow_comparisons', {
        request: { action: 'trial', id: c.id, sampleId: sample.id },
      });
      expect(receipt).toMatchObject({
        requiresQuiescence: true,
        workspace: claim.trialEnvironment.workspace,
      });
      expect(receipt.ownerToken).toBeUndefined();
      const report = await call('read_workflow_comparisons', {
        request: { action: 'report', id: c.id },
      });
      expect(JSON.stringify(report)).not.toContain(root);
      expect(report.samples[0].trialRef).toBeDefined();
      const noConfirmation = await client.callTool({
        name: 'update_workflow_comparison',
        arguments: {
          request: { action: 'cleanup_trial', id: c.id, sampleId: sample.id },
        },
      });
      expect(noConfirmation.isError).toBe(true);
      await call('update_workflow_comparison', {
        request: {
          action: 'cleanup_trial',
          id: c.id,
          sampleId: sample.id,
          quiescent: true,
        },
      });
      await expect
        .poll(
          () =>
            engine.testbench.readTrial({ id: c.id, sampleId: sample.id })
              .cleanup,
        )
        .toBe('complete');
      const done = await call('read_workflow_comparisons', {
        request: { action: 'trial', id: c.id, sampleId: sample.id },
      });
      expect(readFileSync(done.artifacts.patch, 'utf8')).toContain(
        'experimental',
      );
      await call('update_workflow_comparison', {
        request: { action: 'cleanup_trial', id: c.id, sampleId: sample.id },
      });
      expect(readFileSync(join(repository, 'answer.txt'), 'utf8')).toBe(
        'original',
      );
    } finally {
      clearInterval(tick);
      await client.close();
      await new Promise<void>((r) => server.close(() => r()));
      engine.stop();
      store.close();
      await new Promise((r) => setTimeout(r, 50));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
