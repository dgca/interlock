import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  executorProfileSchema,
  type TranscriptEvent,
  type WorkRequest,
} from '@interlock/core';
import { codexAdapter } from '../packages/runtime/src/executors/codex';
import { claudeAdapter } from '../packages/runtime/src/executors/claude';
import { piAdapter } from '../packages/runtime/src/executors/pi';

it('captures native Codex tool messages and steers the exact active turn without starting another', async () => {
  const command = fileURLToPath(
    new URL('./fixtures/managed-harness.mjs', import.meta.url),
  );
  chmodSync(command, 0o755);
  const events: TranscriptEvent[] = [];
  let send!: (text: string) => Promise<void>, ready!: () => void;
  const available = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const work: WorkRequest = {
    id: 'work',
    runId: 'run',
    executionId: 'execution',
    nodeId: 'agent',
    label: 'Fixture',
    status: 'claimed',
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date().toISOString(),
    input: {},
    prompt: 'Inspect the project',
    context: { mode: 'current', tools: [], skills: [], instructions: '' },
    outputSchema: { type: 'object' },
  };
  const result = codexAdapter.run({
    command,
    cwd: process.cwd(),
    work,
    signal: new AbortController().signal,
    profile: executorProfileSchema.parse({
      id: 'codex',
      harness: 'codex',
      name: 'Fixture',
      model: 'transcript-steer',
    }),
    onSession() {},
    onProgress() {},
    request: async () => ({ allow: true }),
    onTranscript: (event) => events.push(event),
    onMessageChannel: (channel) => {
      if (channel) {
        send = channel;
        ready();
      }
    },
  });
  await available;
  await send('Use the vendored dependency');
  expect((await result).output).toEqual({ ok: true });
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: 'tool_call',
      callId: 'checks',
      text: 'pnpm test',
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: 'tool_result',
      callId: 'checks',
      text: 'Checks passed',
    }),
  );
  expect(events.some((event) => event.kind === 'assistant')).toBe(true);
});

it.each(['claude-code', 'pi'] as const)(
  'captures visible %s tool results and delivers input inside the existing run',
  async (harness) => {
    const command = fileURLToPath(
      new URL(
        harness === 'pi'
          ? './fixtures/pi-harness.mjs'
          : './fixtures/managed-harness.mjs',
        import.meta.url,
      ),
    );
    chmodSync(command, 0o755);
    const events: TranscriptEvent[] = [];
    let send!: (text: string) => Promise<void>, ready!: () => void;
    const available = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const work: WorkRequest = {
      id: 'work',
      runId: 'run',
      executionId: 'execution',
      nodeId: 'agent',
      label: 'Fixture',
      status: 'claimed',
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date().toISOString(),
      input: {},
      prompt: harness === 'pi' ? 'TRANSCRIPT_STEER' : 'Inspect dependencies',
      context: { mode: 'current', tools: [], skills: [], instructions: '' },
      outputSchema: { type: 'object' },
    };
    const adapter = harness === 'pi' ? piAdapter : claudeAdapter;
    const result = adapter.run({
      command,
      cwd: process.cwd(),
      work,
      signal: new AbortController().signal,
      profile: executorProfileSchema.parse({
        id: harness,
        harness,
        name: 'Fixture',
        model: harness === 'pi' ? 'fixture/model' : 'transcript-message',
      }),
      onSession() {},
      onProgress() {},
      request: async () => ({ allow: true }),
      onTranscript: (event) => events.push(event),
      onMessageChannel: (channel) => {
        if (channel) {
          send = channel;
          ready();
        }
      },
    });
    await available;
    await send('Use the vendored dependency');
    expect((await result).output).toEqual({ ok: true });
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'tool_call', callId: 'checks' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'tool_result',
        callId: 'checks',
        text: 'Checks passed',
      }),
    );
  },
);
