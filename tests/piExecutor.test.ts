import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { executorProfileSchema, type WorkRequest } from '@interlock/core';
import { piAdapter, piPermissions } from '../packages/runtime/src/executors/pi';
import type { HarnessRun } from '../packages/runtime/src/executors/contracts';
import {
  HarnessModelError,
  HarnessResultError,
} from '../packages/runtime/src/executors/contracts';

const command = fileURLToPath(
  new URL('./fixtures/pi-harness.mjs', import.meta.url),
);
chmodSync(command, 0o755);
const work: WorkRequest = {
  id: 'work',
  executionId: 'execution',
  runId: 'run',
  nodeId: 'agent',
  label: 'Pi fixture',
  status: 'claimed',
  attempt: 1,
  maxAttempts: 1,
  createdAt: new Date().toISOString(),
  input: {},
  prompt: 'Complete the assignment',
  context: { mode: 'fresh', instructions: '', tools: [], skills: [] },
  outputSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  },
};
function input(extra: Partial<HarnessRun> = {}): HarnessRun {
  return {
    command,
    cwd: process.cwd(),
    work,
    profile: executorProfileSchema.parse({
      id: 'pi',
      harness: 'pi',
      name: 'Pi',
      model: 'fixture/model',
      effort: 'high',
    }),
    signal: new AbortController().signal,
    onSession: vi.fn(),
    onProgress: vi.fn(),
    request: vi.fn(async () => ({ allow: true })),
    ...extra,
  };
}

it('does not classify a malformed transport event as a model refusal', async () => {
  await expect(
    piAdapter.run(
      input({ work: { ...work, prompt: 'MALFORMED_MODEL_EVENT' } }),
    ),
  ).rejects.not.toBeInstanceOf(HarnessModelError);
});
it.each(['MODEL_REFUSAL', 'LATE_MODEL_REFUSAL'])(
  'classifies Pi %s according to whether task actions began',
  async (prompt) => {
    await expect(
      piAdapter.run(input({ work: { ...work, prompt } })),
    ).rejects.toBeInstanceOf(
      prompt === 'MODEL_REFUSAL' ? HarnessModelError : HarnessResultError,
    );
  },
);
it('detects Pi and discovers exact model IDs and native efforts without a task', async () => {
  expect(await piAdapter.detect(command)).toMatchObject({ status: 'detected' });
  expect(await piAdapter.models!(input())).toEqual({
    models: [
      {
        id: 'fixture/model',
        name: 'Fixture Model (fixture)',
        effortLevels: ['off', 'low', 'high'],
      },
    ],
    truncated: false,
  });
});
it.each(['standard', 'read-only', 'full-access'] as const)(
  'enforces Pi %s permissions and waits through retries until settled',
  async (permissions) => {
    const args = input();
    args.profile.permissions = permissions;
    const result = await piAdapter.run(args);
    expect(result.output).toEqual({ ok: permissions !== 'read-only' });
    expect(args.request).toHaveBeenCalledTimes(
      permissions === 'standard' ? 1 : 0,
    );
    expect(result.usageScope).toBe('attempt');
    expect(result.usage).toEqual([
      {
        provider: 'fixture',
        model: 'model',
        inputTokens: 26,
        outputTokens: 8,
        cachedInputTokens: 4,
        reasoningOutputTokens: 2,
        cost: {
          amountMicros: 80,
          currency: 'USD',
          source: 'Pi estimated usage',
        },
      },
    ]);
    expect(args.onSession).toHaveBeenCalledWith(
      expect.any(String),
      'fixture/model',
    );
  },
);
it('preserves a denial and bridges native questions', async () => {
  const args = input({
    work: { ...work, prompt: 'QUESTION' },
    request: vi.fn(async (q) =>
      q.kind === 'permission'
        ? { allow: false }
        : { answers: { question: ['Two'] } },
    ),
  });
  expect((await piAdapter.run(args)).output).toEqual({ ok: false });
  expect(args.request).toHaveBeenCalledTimes(2);
});
it('resumes the exact manager-owned Pi session', async () => {
  const args = input({ sessionId: 'existing-session' });
  await piAdapter.run(args);
  expect(args.onSession).toHaveBeenCalledWith(
    'existing-session',
    'fixture/model',
  );
});
it.each(['BAD_JSON', 'PROVIDER_ERROR'])(
  'rejects Pi %s as an explicit failed result',
  async (prompt) => {
    await expect(
      piAdapter.run(input({ work: { ...work, prompt } })),
    ).rejects.toThrow(/Pi (returned invalid|ended without)/);
  },
);
it('rejects unavailable explicit models instead of substituting the CLI default', async () => {
  const args = input();
  args.profile.model = 'missing/model';
  await expect(piAdapter.run(args)).rejects.toThrow('unavailable or ambiguous');
  expect(args.onSession).not.toHaveBeenCalled();
});
it('cancels a Pi subprocess awaiting model completion', async () => {
  const controller = new AbortController();
  let ready!: () => void;
  const entered = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const result = piAdapter.run(
    input({
      signal: controller.signal,
      work: { ...work, prompt: 'WAIT_FOREVER' },
      request: async () => {
        ready();
        return { allow: true };
      },
    }),
  );
  const rejected = expect(result).rejects.toThrow();
  await entered;
  controller.abort();
  await rejected;
}, 10000);
it('blocks unknown tools in read-only mode and fails closed without approval UI', async () => {
  for (const mode of ['read-only', 'standard'] as const) {
    let handler: any;
    const extension = await import(
      `data:text/javascript,${encodeURIComponent(piPermissions(mode, 'verify'))}`
    );
    extension.default({
      registerCommand() {},
      on: (_: string, fn: any) => {
        handler = fn;
      },
    });
    expect(
      await handler({ toolName: 'custom_write', input: {} }, { hasUI: false }),
    ).toMatchObject({ block: true });
    expect(
      await handler({ toolName: 'read', input: {} }, { hasUI: false }),
    ).toBeUndefined();
  }
});
