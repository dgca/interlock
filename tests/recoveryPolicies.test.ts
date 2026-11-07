import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Engine,
  type HarnessAdapter,
  type HarnessRun,
} from '@interlock/runtime';
import { Store } from '@interlock/storage';
import {
  blankDefinition,
  definitionSchema,
  elapsedExcludingPausesMs,
  type Json,
  type PauseHold,
} from '@interlock/core';
import {
  HarnessResultError,
  HarnessModelError,
  classifyHarnessError,
} from '../packages/runtime/src/executors/contracts';

const engines: Engine[] = [];
const start = (e: Engine, id: string, input: Json) => e.start(id, input).run;
const save = (e: Engine, input: any) => {
  const { revision: _revision, ...rest } = input;
  return e.executors.saveProfile(rest);
};
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
const profile = (
  e: Engine,
  harness: 'codex' | 'claude-code' | 'pi' = 'codex',
  extra = {},
) =>
  save(e, {
    id: harness,
    harness,
    name: harness,
    enabled: true,
    expectedRevision: 0,
    ...extra,
  });
function workflow(
  e: Engine,
  executor?: string,
  extra: Record<string, unknown> = {},
  workflowExtra: Record<string, unknown> = {},
) {
  const d = blankDefinition();
  d.executor = executor;
  Object.assign(d, workflowExtra);
  const node = d.nodes.find((n) => n.kind === 'agent')!;
  Object.assign(node, extra);
  const w = e.create('Recovery example', '', definitionSchema.parse(d));
  e.publish(w.id);
  return w;
}
function adapter(
  id: 'codex' | 'claude-code' | 'pi' = 'codex',
  run?: HarnessAdapter['run'],
): HarnessAdapter {
  return {
    id,
    detect: async () => ({
      command: '/fake/' + id,
      status: 'detected',
      version: 'test',
    }),
    run:
      run ??
      (async (i) => {
        i.onSession('session-' + i.work.id);
        return { output: i.work.input };
      }),
  };
}

describe('Error Classification in contracts.ts', () => {
  it('classifies permanent errors correctly without retry', () => {
    // Quota and billing
    expect(
      classifyHarnessError(new Error('insufficient_quota')).errorClass,
    ).toBe('permanent');
    expect(
      classifyHarnessError(new Error('insufficient_quota')).retryable,
    ).toBe(false);
    expect(
      classifyHarnessError(new Error('You exceeded your current quota'))
        .errorClass,
    ).toBe('permanent');
    expect(
      classifyHarnessError(new Error('credit balance is too low')).errorClass,
    ).toBe('permanent');
    expect(
      classifyHarnessError(new Error('billing hard limit reached')).errorClass,
    ).toBe('permanent');
    expect(
      classifyHarnessError(new Error('account_deactivated')).errorClass,
    ).toBe('permanent');

    // Auth and permissions
    expect(classifyHarnessError(new Error('unauthorized')).errorClass).toBe(
      'permanent',
    );
    expect(classifyHarnessError(new Error('invalid_api_key')).errorClass).toBe(
      'permanent',
    );
    expect(
      classifyHarnessError(new Error('HTTP 401 Unauthorized')).errorClass,
    ).toBe('permanent');
    expect(
      classifyHarnessError(new Error('HTTP 403 Forbidden')).errorClass,
    ).toBe('permanent');
    expect(
      classifyHarnessError(new Error('permission_denied')).errorClass,
    ).toBe('permanent');

    // Invalid request
    expect(
      classifyHarnessError(
        new Error('invalid_request_error: bad model parameter'),
      ).errorClass,
    ).toBe('permanent');
    expect(
      classifyHarnessError(new Error('HTTP 400 Bad Request')).errorClass,
    ).toBe('permanent');

    // Context length
    expect(
      classifyHarnessError(new Error('context_length_exceeded')).errorClass,
    ).toBe('permanent');
    expect(
      classifyHarnessError(
        new Error('maximum context length reached for model'),
      ).errorClass,
    ).toBe('permanent');
    expect(classifyHarnessError(new Error('prompt too long')).errorClass).toBe(
      'permanent',
    );

    // Content policy
    expect(
      classifyHarnessError(new Error('content_policy_violation')).errorClass,
    ).toBe('permanent');
    expect(
      classifyHarnessError(new Error('violates our usage policy')).errorClass,
    ).toBe('permanent');

    // Model refusal
    expect(
      classifyHarnessError(new HarnessModelError('model_not_found')).errorClass,
    ).toBe('permanent');
    expect(
      classifyHarnessError(
        new Error('requested model "claude-xyz" is not supported'),
      ).errorClass,
    ).toBe('permanent');
  });

  it('classifies transient errors correctly with retryable=true', () => {
    // Rate limit (HTTP 429)
    expect(
      classifyHarnessError(new Error('rate_limit_exceeded')).errorClass,
    ).toBe('transient');
    expect(
      classifyHarnessError(new Error('rate_limit_exceeded')).retryable,
    ).toBe(true);
    expect(
      classifyHarnessError(new Error('HTTP 429 Too Many Requests')).errorClass,
    ).toBe('transient');
    expect(
      classifyHarnessError(new Error('rate limit reached, please try again'))
        .errorClass,
    ).toBe('transient');

    // Network drops and connection failures
    expect(
      classifyHarnessError(new Error('connect ECONNRESET 127.0.0.1:443'))
        .errorClass,
    ).toBe('transient');
    expect(classifyHarnessError(new Error('ETIMEDOUT')).errorClass).toBe(
      'transient',
    );
    expect(classifyHarnessError(new Error('socket hang up')).errorClass).toBe(
      'transient',
    );
    expect(classifyHarnessError(new Error('fetch failed')).errorClass).toBe(
      'transient',
    );
    expect(
      classifyHarnessError(new Error('connection closed unexpectedly'))
        .errorClass,
    ).toBe('transient');

    // Timeouts
    expect(classifyHarnessError(new Error('gateway timeout')).errorClass).toBe(
      'transient',
    );
    expect(
      classifyHarnessError(new Error('HTTP 504 Gateway Timeout')).errorClass,
    ).toBe('transient');
    expect(
      classifyHarnessError(new Error('operation timed out after 30000ms'))
        .errorClass,
    ).toBe('transient');

    // 5xx Server errors
    expect(
      classifyHarnessError(new Error('HTTP 500 Internal Server Error'))
        .errorClass,
    ).toBe('transient');
    expect(
      classifyHarnessError(new Error('HTTP 502 Bad Gateway')).errorClass,
    ).toBe('transient');
    expect(
      classifyHarnessError(new Error('HTTP 503 Service Unavailable'))
        .errorClass,
    ).toBe('transient');

    // Overloaded
    expect(
      classifyHarnessError(new Error('server is currently overloaded'))
        .errorClass,
    ).toBe('transient');
    expect(
      classifyHarnessError(new Error('engine is overloaded')).errorClass,
    ).toBe('transient');
  });

  it('classifies missing result errors into missing_result', () => {
    expect(
      classifyHarnessError(
        new HarnessResultError(
          'Claude Code completed without a structured assignment result',
        ),
      ).errorClass,
    ).toBe('missing_result');
    expect(
      classifyHarnessError(
        new HarnessResultError('Codex returned invalid result JSON'),
      ).errorClass,
    ).toBe('missing_result');
    expect(
      classifyHarnessError(
        new HarnessResultError('Pi returned an invalid result envelope'),
      ).errorClass,
    ).toBe('missing_result');
    expect(
      classifyHarnessError(
        new HarnessResultError(
          'Custom turn command completed with empty STDOUT; expected JSON envelope',
        ),
      ).errorClass,
    ).toBe('missing_result');
  });
});

describe('Missing Result Continuation (continueOnMissingResult)', () => {
  it('sends continuation prompts in the same session before failing', async () => {
    const e = create();
    profile(e, 'codex', {
      continueOnMissingResult: {
        maxTurns: 2,
        message: 'Please provide result',
      },
    });
    const turns: { prompt: string; sessionId?: string }[] = [];
    e.executors.start([
      adapter('codex', async (input) => {
        turns.push({ prompt: input.work.prompt, sessionId: input.sessionId });
        input.onSession('codex-session-1');
        if (turns.length === 1) {
          throw new HarnessResultError(
            'Codex completed without a structured assignment result',
          );
        }
        return { output: { answer: 42 } };
      }),
    ]);

    const w = workflow(e, 'codex');
    const r = start(e, w.id, {});
    await vi.waitFor(() => expect(e.run(r.id).status).toBe('completed'));

    expect(turns).toHaveLength(2);
    expect(turns[0].sessionId).toBeUndefined();
    expect(turns[1].sessionId).toBe('codex-session-1');
    expect(turns[1].prompt).toBe('Please provide result');

    const work = e.store.work()[0];
    const inspection = e.executors.inspect(work.id);
    const events = inspection.items[0].recoveryEvents ?? [];
    expect(events).toEqual([
      expect.objectContaining({
        errorClass: 'missing_result',
        action: 'continue',
      }),
    ]);
  });

  it('fails the attempt after exhausting maxTurns', async () => {
    const e = create();
    profile(e, 'codex', {
      continueOnMissingResult: { maxTurns: 1 },
    });
    let callCount = 0;
    e.executors.start([
      adapter('codex', async (input) => {
        callCount++;
        input.onSession('codex-session-2');
        throw new HarnessResultError(
          'Codex completed without a structured assignment result',
        );
      }),
    ]);

    const w = workflow(e, 'codex', { maxAttempts: 1 });
    const r = start(e, w.id, {});
    await vi.waitFor(() => expect(e.run(r.id).status).toBe('failed'));

    // First attempt + 1 continuation turn = 2 calls
    expect(callCount).toBe(2);

    const work = e.store.work()[0];
    const inspection = e.executors.inspect(work.id);
    const events = inspection.items[0].recoveryEvents ?? [];
    expect(events).toEqual([
      expect.objectContaining({
        errorClass: 'missing_result',
        action: 'continue',
      }),
      expect.objectContaining({
        errorClass: 'missing_result',
        action: 'fail',
      }),
    ]);
  });

  it('honors node-level override over workflow and profile defaults', async () => {
    const e = create();
    profile(e, 'codex', {
      continueOnMissingResult: { maxTurns: 0 },
    });
    const turns: string[] = [];
    e.executors.start([
      adapter('codex', async (input) => {
        turns.push(input.work.prompt);
        input.onSession('codex-session-3');
        if (turns.length === 1) {
          throw new HarnessResultError(
            'Codex completed without a structured assignment result',
          );
        }
        return { output: 'done' };
      }),
    ]);

    // Node override allows 1 continuation with custom message
    const w = workflow(e, 'codex', {
      continueOnMissingResult: { maxTurns: 1, message: 'Node override prompt' },
    });
    const r = start(e, w.id, {});
    await vi.waitFor(() => expect(e.run(r.id).status).toBe('completed'));

    expect(turns).toHaveLength(2);
    expect(turns[1]).toBe('Node override prompt');
  });
});

describe('Transient Retries and Escalation (transientRetry)', () => {
  it('retries transient errors with exponential backoff', async () => {
    const e = create();
    profile(e, 'codex', {
      transientRetry: { maxRetries: 2, windowMs: 30000, initialBackoffMs: 20 },
    });
    let attempts = 0;
    e.executors.start([
      adapter('codex', async (input) => {
        attempts++;
        if (attempts === 1) {
          throw new Error('HTTP 429 Too Many Requests');
        }
        return { output: 'success' };
      }),
    ]);

    const w = workflow(e, 'codex');
    const r = start(e, w.id, {});
    await vi.waitFor(() => expect(e.run(r.id).status).toBe('completed'));

    expect(attempts).toBe(2);
    const work = e.store.work()[0];
    const inspection = e.executors.inspect(work.id);
    const events = inspection.items[0].recoveryEvents ?? [];
    expect(events).toEqual([
      expect.objectContaining({
        errorClass: 'transient',
        action: 'retry',
      }),
    ]);
  });

  it('escalates to Needs attention hold when transient retries exceed maxRetries', async () => {
    const e = create();
    profile(e, 'codex', {
      transientRetry: { maxRetries: 2, windowMs: 30000, initialBackoffMs: 10 },
    });
    let attempts = 0;
    e.executors.start([
      adapter('codex', async () => {
        attempts++;
        throw new Error('HTTP 503 Service Unavailable');
      }),
    ]);

    const w = workflow(e, 'codex');
    const r = start(e, w.id, {});

    // Wait for the work to enter held state
    await vi.waitFor(() => {
      const work = e.store.work()[0];
      expect(work?.status).toBe('held');
    });

    // 1 initial try + 2 retries = 3 attempts total before escalation
    expect(attempts).toBe(3);

    const work = e.store.work()[0];
    expect(work.hold?.category).toBe('other');
    expect(work.hold?.reason).toContain('Transient failure limit reached');

    const inspection = e.executors.inspect(work.id);
    expect(inspection.items[0].state).toBe('needs_human');
    const events = inspection.items[0].recoveryEvents ?? [];
    expect(events).toEqual([
      expect.objectContaining({ errorClass: 'transient', action: 'retry' }),
      expect.objectContaining({ errorClass: 'transient', action: 'retry' }),
      expect.objectContaining({ errorClass: 'transient', action: 'escalate' }),
    ]);

    // Surfaces in describe
    const desc = e.executors.describe(work as any);
    expect(desc?.state).toBe('needs_human');
    expect(desc?.recoveryEvents).toHaveLength(3);
  });

  it('rejects permanent errors immediately without retry', async () => {
    const e = create();
    profile(e, 'codex', {
      transientRetry: { maxRetries: 3, windowMs: 30000, initialBackoffMs: 10 },
    });
    let attempts = 0;
    e.executors.start([
      adapter('codex', async () => {
        attempts++;
        throw new HarnessResultError('invalid_api_key: check credentials');
      }),
    ]);

    const w = workflow(e, 'codex', { maxAttempts: 1 });
    const r = start(e, w.id, {});
    await vi.waitFor(() => expect(e.run(r.id).status).toBe('failed'));

    // Failed immediately on attempt 1 without retry
    expect(attempts).toBe(1);
    const work = e.store.work()[0];
    const inspection = e.executors.inspect(work.id);
    const events = inspection.items[0].recoveryEvents ?? [];
    expect(events).toEqual([
      expect.objectContaining({
        errorClass: 'permanent',
        action: 'fail',
      }),
    ]);
  });
});

describe('Pause Duration Exclusion', () => {
  it('excludes paused intervals from elapsed active time calculations', () => {
    const startMs = 1000;
    const endMs = 10000;
    const holds: PauseHold[] = [
      {
        id: 'p1',
        scope: 'library',
        actor: 'admin',
        reason: 'maintenance',
        createdAt: new Date(2000).toISOString(),
        releasedAt: new Date(5000).toISOString(),
      },
      {
        id: 'p2',
        scope: 'library',
        actor: 'operator',
        reason: 'deployment',
        createdAt: new Date(4000).toISOString(),
        releasedAt: new Date(6000).toISOString(),
      },
    ];

    // Union of [2000, 5000] and [4000, 6000] is [2000, 6000] (4000ms paused)
    const result = elapsedExcludingPausesMs(startMs, endMs, holds);
    expect(result.wallMs).toBe(9000);
    expect(result.pausedMs).toBe(4000);
    expect(result.activeMs).toBe(5000);
  });

  it('keeps retry in rolling window when pause time is excluded', async () => {
    const e = create();
    profile(e, 'codex', {
      transientRetry: { maxRetries: 1, windowMs: 5000, initialBackoffMs: 10 },
    });

    let calls = 0;
    e.executors.start([
      adapter('codex', async () => {
        calls++;
        if (calls === 1) {
          throw new Error('HTTP 429 Too Many Requests');
        }
        throw new Error('HTTP 503 Service Unavailable');
      }),
    ]);

    const w = workflow(e, 'codex');
    const r = start(e, w.id, {});

    // First attempt fails, retries, second attempt also fails and exhausts maxRetries (1)
    await vi.waitFor(() => {
      const work = e.store.work()[0];
      expect(work?.status).toBe('held');
    });

    const work = e.store.work()[0];
    const inspection = e.executors.inspect(work.id);
    const events = inspection.items[0].recoveryEvents ?? [];
    expect(events.some((ev) => ev.action === 'escalate')).toBe(true);
  });
});
