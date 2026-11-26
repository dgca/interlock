import type {
  ScriptRetryReceipt,
  ScriptRetryState,
  TransientRetry,
} from '@interlock/core';
import { classifyFailureText } from './executors/contracts.js';

/** What a foreground Script launch actually produced, kept for retry judgment. */
export type ScriptExitOutcome =
  | {
      kind: 'exit';
      exitCode: number;
      stdout: string;
      stderr: string;
      /** An explicit retry request written by the Script itself. */
      retryRequest?: ScriptRetryRequest;
    }
  | {
      kind: 'signal';
      exitCode: number | null;
      signal: string | null;
      stdout: string;
      stderr: string;
    }
  | { kind: 'aborted' }
  | { kind: 'timeout' }
  | { kind: 'spawn'; code?: string }
  | { kind: 'output-limit' }
  | { kind: 'invalid-json' };

/** A Script's explicit request, using exit 75 or a JSON marker. */
export interface ScriptRetryRequest {
  reason?: string;
  source: 'stdout' | 'stderr';
}

const outcomeKey = Symbol.for('interlock.scriptOutcome');

/** Carries a typed process outcome on the unchanged public error. */
export function withScriptOutcome<T extends object>(
  error: T,
  outcome: ScriptExitOutcome,
): T {
  Object.defineProperty(error, outcomeKey, {
    value: outcome,
    enumerable: false,
    configurable: true,
  });
  return error;
}

export function scriptOutcomeOf(error: unknown): ScriptExitOutcome | undefined {
  if (!error || typeof error !== 'object') return;
  return (error as Record<symbol, ScriptExitOutcome | undefined>)[outcomeKey];
}

/** Applies the same Secret redaction the error message receives. */
export function redactScriptOutcome(
  outcome: ScriptExitOutcome,
  redact: (text: string) => string,
): ScriptExitOutcome {
  if (outcome.kind !== 'exit' && outcome.kind !== 'signal') return outcome;
  return {
    ...outcome,
    stdout: redact(outcome.stdout),
    stderr: redact(outcome.stderr),
    ...(outcome.kind === 'exit' && outcome.retryRequest?.reason
      ? {
          retryRequest: {
            ...outcome.retryRequest,
            reason: redact(outcome.retryRequest.reason),
          },
        }
      : {}),
  };
}

function retryMarker(value: unknown): { reason?: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (record.retryable !== true && record.transient !== true) return;
  return typeof record.reason === 'string' ? { reason: record.reason } : {};
}

/**
 * Reads an explicit retry request from the complete stdout JSON value or the
 * final non-empty stderr line. Only an observed non-zero exit asks.
 */
export function parseScriptRetryRequest(
  stdout: string,
  stderr: string,
): ScriptRetryRequest | undefined {
  try {
    const marker = retryMarker(JSON.parse(stdout));
    if (marker) return { ...marker, source: 'stdout' };
  } catch {
    // Not one JSON result. Ordinary logs do not ask for a retry.
  }
  const finalLine = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!finalLine) return;
  try {
    const marker = retryMarker(JSON.parse(finalLine));
    if (marker) return { ...marker, source: 'stderr' };
  } catch {
    // The final line is ordinary error text.
  }
}

/** Narrow lock contention that a Script can reasonably repeat. */
const scriptLockBusy =
  /\b(?:SQLITE_BUSY|SQLITE_LOCKED)\b|database (?:table )?is locked|database is busy|lock wait timeout/i;

/**
 * Judges Script failure text. Recognized permanent text stays permanent, even
 * if lock wording also appears. Only an otherwise unknown failure may match a
 * narrow lock-busy pattern, and Agent classification keeps its own defaults.
 */
function classifyScriptFailure(
  text: string,
): 'transient' | 'permanent' | 'unknown' {
  const shared = classifyFailureText(text);
  if (shared !== 'unknown') return shared;
  return scriptLockBusy.test(text) ? 'transient' : 'unknown';
}

/** Line endings and collapsed whitespace, for conservative duplicate checks. */
export function normalizeScriptFailure(stderr: string) {
  return stderr.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim();
}

export interface ScriptRetryDecision {
  retry: boolean;
  layer: ScriptRetryReceipt['layer'];
  reason: string;
  delayMs: number;
}

/**
 * Applies the three judgment layers and the retry budget. `recentRetries`
 * counts retries whose pause-excluded age is inside the rolling window.
 */
export function decideScriptRetry(input: {
  policy: TransientRetry;
  outcome: ScriptExitOutcome;
  errorText: string;
  state?: ScriptRetryState;
  recentRetries: number;
}): ScriptRetryDecision {
  const { policy, outcome, state, recentRetries } = input;
  if (outcome.kind !== 'exit' || outcome.exitCode === 0)
    return {
      retry: false,
      layer: 'ineligible',
      reason:
        outcome.kind === 'exit'
          ? 'Exit 0 is a result, not a retry request'
          : `Engine-side ${outcome.kind} outcome is never retried`,
      delayMs: 0,
    };

  let layer: ScriptRetryReceipt['layer'];
  let reason: string;
  if (outcome.exitCode === 75) {
    layer = 'signal';
    reason = 'Exit 75 requests a retry';
  } else if (outcome.retryRequest) {
    layer = 'signal';
    reason =
      outcome.retryRequest.reason ??
      `${outcome.retryRequest.source} JSON marker requests a retry`;
  } else {
    const text = outcome.stderr || outcome.stdout || input.errorText;
    const judgment = classifyScriptFailure(text);
    if (judgment === 'permanent')
      return {
        retry: false,
        layer: 'permanent',
        reason: text.slice(0, 200),
        delayMs: 0,
      };
    if (judgment === 'transient') {
      layer = 'classifier';
      reason = text.slice(0, 200);
    } else {
      const previous = state?.previous;
      if (
        previous &&
        previous.exitCode === outcome.exitCode &&
        previous.stderr === normalizeScriptFailure(outcome.stderr)
      )
        return {
          retry: false,
          layer: 'duplicate',
          reason:
            'A repeated unclassified failure with the same exit and error',
          delayMs: 0,
        };
      layer = 'classifier';
      reason = `Unclassified exit ${outcome.exitCode}; one probe retry`;
    }
  }

  const retries = state?.retries ?? 0;
  if (retries >= policy.maxRetries)
    return {
      retry: false,
      layer: 'exhausted',
      reason: `Retry limit ${policy.maxRetries} reached`,
      delayMs: 0,
    };
  if (recentRetries >= policy.maxRetries)
    return {
      retry: false,
      layer: 'window',
      reason: `Retry limit ${policy.maxRetries} reached within ${policy.windowMs}ms`,
      delayMs: 0,
    };
  return {
    retry: true,
    layer,
    reason,
    delayMs: policy.initialBackoffMs * Math.pow(2, recentRetries),
  };
}
