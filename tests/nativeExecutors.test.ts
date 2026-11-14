import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { chmodSync } from 'node:fs';
import { executorProfileSchema, type WorkRequest } from '@interlock/core';
import { claudeAdapter } from '../packages/runtime/src/executors/claude';
import { codexAdapter } from '../packages/runtime/src/executors/codex';
import {
  HarnessModelError,
  HarnessResultError,
} from '../packages/runtime/src/executors/contracts';
import { codexResult } from '../packages/runtime/src/executors/codexResult';
import { assertOwnPropertyContract } from '@interlock/core';

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

it('recovers a Codex result with trailing prose without changing the contract', async () => {
  const contract = {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      path: { type: 'string', pattern: '^(?!/).+' },
    },
    required: ['ok'],
    additionalProperties: false,
    allOf: [{ properties: { ok: { const: false } } }],
  };
  const assignment = { ...work, outputSchema: contract };
  const result = await codexAdapter.run({
    command,
    cwd: process.cwd(),
    work: assignment,
    profile: executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Codex',
      model: 'schema-fallback',
    }),
    signal: new AbortController().signal,
    onSession() {},
    onProgress() {},
    request: async () => ({ allow: true }),
  });
  expect(result.output).toEqual({ ok: true });
  // Transport must not weaken runtime acceptance or require the optional path.
  expect(() =>
    assertOwnPropertyContract(contract, result.output, 'Result'),
  ).toThrow();
  expect(() =>
    assertOwnPropertyContract(contract, { ok: false }, 'Result'),
  ).not.toThrow();
  expect(assignment.outputSchema).toBe(contract);
});

it('uses native schemas for strict contracts and preserves arbitrary JSON through fallback', () => {
  const strict = {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  };
  expect(
    codexResult({ ...work, outputSchema: strict }).schema.properties.result,
  ).toBe(strict);
  const fallback = codexResult({ ...work, outputSchema: {} });
  for (const value of [null, false, 12, 'text', { extra: 1 }, [1, 2]])
    expect(fallback.decode(JSON.stringify(value))).toEqual(value);
  expect(fallback.decode('[1,2] stray prose')).toEqual([1, 2]);
  expect(fallback.decode('{"ok":true} take')).toEqual({ ok: true });
  for (const malformed of [
    '{bad',
    '{"ok":} take',
    '{"ok":true} {"ok":false}',
    '{"ok":true} true',
    '42 extra',
  ])
    expect(() => fallback.decode(malformed)).toThrow(/invalid encoded/);
  expect(() => fallback.decode({ ok: true })).toThrow(/JSON string/);
});
it.each([claudeAdapter, codexAdapter])(
  'classifies an early $id model refusal but preserves ordinary failure after task actions',
  async (adapter) => {
    for (const model of ['model-refusal', 'late-model-refusal']) {
      const result = adapter.run({
        command,
        cwd: process.cwd(),
        work,
        profile: executorProfileSchema.parse({
          id: adapter.id,
          harness: adapter.id,
          name: adapter.id,
          model,
        }),
        signal: new AbortController().signal,
        onSession() {},
        onProgress() {},
        request: async () => ({ allow: true }),
      });
      await expect(result).rejects.toBeInstanceOf(
        model === 'model-refusal' ? HarnessModelError : HarnessResultError,
      );
    }
  },
);
it.each([claudeAdapter, codexAdapter])(
  'discovers $id models without starting a task',
  async (adapter) => {
    const catalog = await adapter.models!({
      command,
      cwd: process.cwd(),
      signal: new AbortController().signal,
    });
    expect(catalog.models[0]).toMatchObject({
      id: 'fixture-model',
      name: 'Fixture Model',
      effortLevels: ['low', 'high'],
    });
    expect(catalog.models).toHaveLength(adapter.id === 'codex' ? 2 : 1);
  },
);
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

it.each([
  'file-approval',
  'file-missing',
  'file-grant',
  'secret-question',
  'foreign-event',
])(
  'handles Codex %s with complete, scoped approval details',
  async (model) => {
    const requests: any[] = [];
    const result = await codexAdapter.run({
      command,
      cwd: process.cwd(),
      work,
      profile: executorProfileSchema.parse({
        id: 'codex',
        harness: 'codex',
        name: 'Codex',
        model,
      }),
      signal: new AbortController().signal,
      onSession: () => {},
      onProgress: () => {},
      request: async (request) => {
        requests.push(request);
        return { allow: true };
      },
    });
    if (model === 'file-approval') {
      expect(requests).toHaveLength(1);
      expect(requests[0].detail).toContain('example.txt');
      expect(requests[0].detail).toContain('old');
      expect(result.output).toEqual({ ok: true });
    } else if (model === 'foreign-event') {
      expect(result.output).toEqual({ ok: true });
    } else {
      expect(requests).toHaveLength(0);
      expect(result.output).toEqual({ ok: false });
    }
  },
  15000,
);

it.each([claudeAdapter, codexAdapter])(
  'drains diagnostic floods from $id without stalling',
  async (adapter) => {
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 4000);
    try {
      const result = await adapter.run({
        command,
        cwd: process.cwd(),
        work,
        profile: executorProfileSchema.parse({
          id: adapter.id,
          harness: adapter.id,
          name: adapter.id,
          model: 'diagnostic-flood',
        }),
        signal: abort.signal,
        onSession: () => {},
        onProgress: () => {},
        request: async () => ({ allow: false }),
      });
      expect(result.output).toEqual({ ok: false });
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  },
  15000,
);
it.each([claudeAdapter, codexAdapter])(
  'resumes the exact owned native session through $id',
  async (adapter) => {
    const ids: string[] = [];
    const result = await adapter.run({
      command,
      cwd: process.cwd(),
      work: {
        ...work,
        context: {
          ...work.context,
          mode: 'current',
          continuityGroup: 'author',
        },
      },
      sessionId: 'existing-native-session',
      profile: executorProfileSchema.parse({
        id: adapter.id,
        harness: adapter.id,
        name: adapter.id,
      }),
      signal: new AbortController().signal,
      onSession: (id) => ids.push(id),
      onProgress: () => {},
      request: async () => ({ allow: false }),
    });
    expect(ids).toEqual(['existing-native-session']);
    expect(result.output).toEqual({ ok: false });
  },
  15000,
);

it.each(
  [claudeAdapter, codexAdapter].flatMap((adapter) =>
    (['read-only', 'standard', 'full-access'] as const).map((permissions) => ({
      adapter,
      permissions,
    })),
  ),
)(
  'maps $adapter.id $permissions into native controls',
  async ({ adapter, permissions }) => {
    const requests: any[] = [];
    const result = await adapter.run({
      command,
      cwd: process.cwd(),
      work,
      profile: executorProfileSchema.parse({
        id: adapter.id,
        harness: adapter.id,
        name: adapter.id,
        permissions,
        model: 'permissions-' + permissions,
      }),
      signal: new AbortController().signal,
      onSession: () => {},
      onProgress: () => {},
      request: async (request) => {
        requests.push(request);
        return { allow: false };
      },
    });
    expect(result.output).toEqual({ ok: permissions === 'full-access' });
    expect(requests).toHaveLength(permissions === 'standard' ? 1 : 0);
    // The policy judges the same action each harness asks about.
    if (permissions === 'standard')
      expect(requests[0]).toHaveProperty('action', {
        kind: 'command',
        command: 'test command',
        cwd: process.cwd(),
      });
  },
  15000,
);

it.each([claudeAdapter, codexAdapter])(
  'passes explicit effort through $id native protocol',
  async (adapter) => {
    const result = await adapter.run({
      command,
      cwd: process.cwd(),
      work,
      profile: executorProfileSchema.parse({
        id: adapter.id,
        harness: adapter.id,
        name: adapter.id,
        model: 'effort-check',
        effort: 'high',
      }),
      signal: new AbortController().signal,
      onSession: () => {},
      onProgress: () => {},
      request: async () => ({ allow: true }),
    });
    expect(result.output).toEqual({ ok: true });
  },
);
