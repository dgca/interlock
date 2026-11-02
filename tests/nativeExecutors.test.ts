import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { chmodSync } from 'node:fs';
import { executorProfileSchema, type WorkRequest } from '@interlock/core';
import { claudeAdapter } from '../packages/runtime/src/executors/claude';
import { codexAdapter } from '../packages/runtime/src/executors/codex';

const command = fileURLToPath(
  new URL('./fixtures/managed-harness.mjs', import.meta.url),
);
chmodSync(command, 0o755);
const work: WorkRequest = {
  executionId: 'execution',
  label: 'Test',
  status: 'claimed',
  attempt: 1,
  maxAttempts: 1,
  createdAt: new Date().toISOString(),
  id: 'work',
  runId: 'run',
  nodeId: 'agent',
  prompt: 'Return whether the test action was allowed',
  input: { test: true },
  context: { mode: 'fresh', instructions: '', tools: [], skills: [] },
  outputSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  },
};
it.each([claudeAdapter, codexAdapter])(
  'bridges $id native protocol, explicit permissions and structured results without a provider',
  async (adapter) => {
    const sessions: string[] = [],
      requests: string[] = [];
    const detection = await adapter.detect(command);
    expect(detection.status).toBe('detected');
    const result = await adapter.run({
      command,
      cwd: process.cwd(),
      work,
      profile: executorProfileSchema.parse({
        id: adapter.id,
        harness: adapter.id,
        name: adapter.id,
      }),
      signal: new AbortController().signal,
      onSession: (id) => sessions.push(id),
      onProgress: () => {},
      request: async (q) => {
        requests.push(q.detail);
        return { allow: true };
      },
    });
    expect(sessions).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('test command');
    expect(result.output).toEqual({ ok: true });
    expect(result.usage?.[0]).toMatchObject({
      inputTokens: 13,
      outputTokens: 4,
      cachedInputTokens: 2,
      reasoningOutputTokens: 1,
    });
  },
  15000,
);
it.each([claudeAdapter, codexAdapter])(
  'preserves explicit denial through $id',
  async (adapter) => {
    const result = await adapter.run({
      command,
      cwd: process.cwd(),
      work,
      profile: executorProfileSchema.parse({
        id: adapter.id,
        harness: adapter.id,
        name: adapter.id,
      }),
      signal: new AbortController().signal,
      onSession: () => {},
      onProgress: () => {},
      request: async () => ({ allow: false }),
    });
    expect(result.output).toEqual({ ok: false });
  },
  15000,
);
it.each([claudeAdapter, codexAdapter])(
  'cancels $id while waiting for the model',
  async (adapter) => {
    const abort = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const result = adapter.run({
      command,
      cwd: process.cwd(),
      work,
      profile: executorProfileSchema.parse({
        id: adapter.id,
        harness: adapter.id,
        name: adapter.id,
        model: 'wait',
      }),
      signal: abort.signal,
      onSession: () => {},
      onProgress: () => {},
      request: async () => {
        entered();
        return { allow: true };
      },
    });
    const rejected = expect(result).rejects.toThrow();
    await ready;
    abort.abort();
    await rejected;
  },
  15000,
);
