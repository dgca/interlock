import { spawnManagedProcess } from './process.js';
import type { HarnessAdapter, HarnessRun, HarnessResult } from './contracts.js';
import { HarnessResultError, HarnessCleanupError } from './contracts.js';
import type { Json, ModelUsage } from '@interlock/core';

export function interpolateTokens(
  template: string,
  tokens: Record<string, string>,
): string {
  return template.replace(
    /\$(?:([A-Z0-9_]+)|\{([A-Z0-9_]+)\})/g,
    (_, name1, name2) => {
      const key = name1 || name2;
      return key in tokens ? tokens[key] : `$${key}`;
    },
  );
}

export function buildTokenMap(
  work: { id: string; runId: string; token?: string; input: unknown },
  cwd: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    INTERLOCK_WORK_ID: work.id,
    INTERLOCK_RUN_ID: work.runId,
    INTERLOCK_CWD: cwd,
    INTERLOCK_CLAIM_TOKEN: work.token ?? extra.claimTicket ?? '',
    INTERLOCK_CLAIM_TICKET: extra.claimTicket ?? '',
    INTERLOCK_INPUT:
      typeof work.input === 'string'
        ? work.input
        : JSON.stringify(work.input ?? null),
    INTERLOCK_SESSION_ID: extra.sessionId ?? '',
    INTERLOCK_SESSION_NAME:
      extra.sessionName ?? extra.INTERLOCK_SESSION_NAME ?? '',
    ...extra,
  };
}

export interface CustomTurnEnvelope {
  output?: Json;
  result?: Json;
  sessionId?: string;
  sessionName?: string;
  resumeCommand?: string;
  deepLink?: string;
  model?: string;
  provider?: string;
  usage?: ModelUsage[];
}

/** Run trusted shell source with assignment values kept in the environment. */
export async function executeCustomCommand(input: {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  payload?: unknown;
  tokens: Record<string, string>;
  signal?: AbortSignal;
  timeoutSeconds?: number;
  retainChildrenOnSuccess?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<string> {
  if (input.signal?.aborted) throw new Error('Custom command aborted');
  const payload =
    input.payload === undefined ? undefined : JSON.stringify(input.payload);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(input.env ?? {}))
    env[key] = interpolateTokens(value, input.tokens);
  // Identity metadata is also available to scripts reading their environment.
  // Input is delivered through stdin and may exceed OS environment limits, so
  // export it only when the command explicitly references that token.
  for (const [key, value] of Object.entries(input.tokens))
    if (key.startsWith('INTERLOCK_') && key !== 'INTERLOCK_INPUT')
      env[key] = value;
  if (/\$(?:INTERLOCK_INPUT\b|\{INTERLOCK_INPUT\b)/.test(input.command))
    env.INTERLOCK_INPUT = input.tokens.INTERLOCK_INPUT;
  const managed = spawnManagedProcess('/bin/sh', ['-c', input.command], {
    cwd: input.cwd,
    env,
  });
  const child = managed.child;
  let timer: NodeJS.Timeout | undefined;
  let aborted: (() => void) | undefined;
  let succeeded = false;
  try {
    const output = await new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        input.onProgress?.(text);
      });
      child.on('error', reject);
      // EPIPE is emitted by stdin, not by the ChildProcess, when the command exits early.
      child.stdin.on('error', reject);
      child.on('close', (code) => {
        code === 0
          ? resolve(stdout.trim())
          : reject(
              new Error(
                `Custom command failed with exit code ${code}${stderr ? ': ' + stderr.trim() : ''}`,
              ),
            );
      });
      aborted = () => reject(new Error('Custom command aborted'));
      input.signal?.addEventListener('abort', aborted, { once: true });
      if (input.signal?.aborted) {
        aborted();
        return;
      }
      if (input.timeoutSeconds && input.timeoutSeconds > 0)
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Custom command timed out after ${input.timeoutSeconds} seconds`,
              ),
            ),
          input.timeoutSeconds * 1000,
        );
      child.stdin.end(payload);
    });
    succeeded = true;
    return output;
  } finally {
    clearTimeout(timer);
    if (aborted) input.signal?.removeEventListener('abort', aborted);
    if (!succeeded || !input.retainChildrenOnSuccess) {
      try {
        // Cleanup includes descendants that remain after their shell exits.
        await managed.close();
      } catch (error) {
        throw new HarnessCleanupError(
          'Custom harness subprocess termination could not be confirmed',
          { cause: error },
        );
      }
    }
  }
}

export async function executeSubprocessTurn(input: {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  payload: unknown;
  tokens: Record<string, string>;
  signal: AbortSignal;
  timeoutSeconds?: number;
  onProgress?: (msg: string) => void;
}): Promise<CustomTurnEnvelope> {
  const stdout = await executeCustomCommand(input);
  if (!stdout)
    throw new HarnessResultError(
      'Custom turn command completed with empty STDOUT; expected JSON envelope',
    );
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new HarnessResultError(
      `Failed to parse custom turn STDOUT JSON: ${error instanceof Error ? error.message : String(error)}\nOutput was: ${stdout.slice(0, 500)}`,
    );
  }
}

export async function executeHttpTurn(input: {
  url: string;
  headers?: Record<string, string>;
  payload: unknown;
  tokens: Record<string, string>;
  signal: AbortSignal;
  timeoutSeconds?: number;
}): Promise<CustomTurnEnvelope> {
  const resolvedUrl = interpolateTokens(input.url, input.tokens);
  const resolvedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (input.headers) {
    for (const [k, v] of Object.entries(input.headers)) {
      resolvedHeaders[k] = interpolateTokens(v, input.tokens);
    }
  }

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  if (input.timeoutSeconds && input.timeoutSeconds > 0) {
    timer = setTimeout(() => controller.abort(), input.timeoutSeconds * 1000);
  }

  const abortListener = () => controller.abort();
  input.signal.addEventListener('abort', abortListener, { once: true });

  try {
    const res = await fetch(resolvedUrl, {
      method: 'POST',
      headers: resolvedHeaders,
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(
        `Custom turn HTTP request failed (${res.status} ${res.statusText}): ${errorText.slice(
          0,
          500,
        )}`,
      );
    }
    const data = await res.json();
    return data as CustomTurnEnvelope;
  } finally {
    if (timer) clearTimeout(timer);
    input.signal.removeEventListener('abort', abortListener);
  }
}

export const customAdapter: HarnessAdapter = {
  id: 'custom',
  detect: async (override?: string) => ({
    status: 'detected',
    command: override ?? 'custom',
    version: '1.0.0',
  }),
  models: async () => ({ models: [], truncated: false }),
  run: async (input: HarnessRun): Promise<HarnessResult> => {
    const { profile, work, cwd, signal, onSession, onProgress } = input;
    const sessionName =
      input.sessionName || `interlock-${work.runId}-${work.id}`;
    const tokens = buildTokenMap(work, cwd, {
      sessionId: input.sessionId ?? '',
      sessionName,
      INTERLOCK_SESSION_NAME: sessionName,
    });

    const contextPayload = {
      idempotencyKey: `${work.id}:${work.attempt}`,
      workId: work.id,
      runId: work.runId,
      attempt: work.attempt,
      prompt: work.prompt,
      input: work.input,
      outputSchema: work.outputSchema,
      cwd,
      model: profile.model,
      effort: profile.effort,
      permissions: profile.permissions,
      sessionName,
      sessionId: input.sessionId,
    };

    let envelope: CustomTurnEnvelope;
    if (profile.transport === 'http') {
      if (!profile.turnUrl) {
        throw new Error(
          `Custom profile "${profile.id}" in HTTP direct turn mode requires turnUrl`,
        );
      }
      envelope = await executeHttpTurn({
        url: profile.turnUrl,
        headers: profile.headers,
        payload: contextPayload,
        tokens,
        signal,
        timeoutSeconds: profile.timeoutSeconds,
      });
    } else {
      const command = profile.turnCommand || profile.command;
      if (!command) {
        throw new Error(
          `Custom profile "${profile.id}" in subprocess direct turn mode requires turnCommand`,
        );
      }
      envelope = await executeSubprocessTurn({
        command,
        cwd,
        env: profile.env,
        payload: contextPayload,
        tokens,
        signal,
        timeoutSeconds: profile.timeoutSeconds,
        onProgress,
      });
    }

    if (envelope.sessionId || envelope.model) {
      onSession(envelope.sessionId ?? input.sessionId ?? '', envelope.model);
    }

    const output =
      envelope.output !== undefined
        ? envelope.output
        : envelope.result !== undefined
          ? envelope.result
          : (envelope as Json);

    return {
      output,
      usage: envelope.usage,
      usageScope: 'attempt',
      resumeCommand: envelope.resumeCommand,
      deepLink: envelope.deepLink,
    };
  },
};
