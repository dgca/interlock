import { assignmentInstructions } from '../agentInstructions.js';
import type {
  ExecutorAnswer,
  ExecutorProfile,
  ExecutorQuestion,
  Json,
  ModelUsage,
  HarnessModel,
  WorkRequest,
  ErrorClass,
} from '@interlock/core';

export interface HarnessRequest {
  kind: 'permission' | 'question';
  title: string;
  detail: string;
  questions?: ExecutorQuestion[];
}
export interface HarnessRun {
  profile: ExecutorProfile;
  command: string;
  cwd: string;
  sessionId?: string;
  sessionName?: string;
  work: WorkRequest;
  signal: AbortSignal;
  onSession: (id: string, model?: string) => void;
  onProgress: (message: string) => void;
  request: (request: HarnessRequest) => Promise<ExecutorAnswer>;
}
export interface HarnessResult {
  output: Json;
  usage?: ModelUsage[];
  /** Omission means native session cumulative counters. */
  usageScope?: 'attempt';
  resumeCommand?: string;
  deepLink?: string;
}
/** Native transports remain inside adapters; neither owns Interlock claims. */
export interface HarnessAdapter {
  id: ExecutorProfile['harness'];
  models?: (input: {
    command: string;
    cwd: string;
    signal: AbortSignal;
  }) => Promise<{ models: HarnessModel[]; truncated?: boolean }>;
  detect: (override?: string) => Promise<{
    command?: string;
    version?: string;
    status: 'detected' | 'missing' | 'unavailable';
    message?: string;
  }>;
  run: (input: HarnessRun) => Promise<HarnessResult>;
}
export function assignmentPrompt(work: WorkRequest) {
  return [
    work.prompt,
    work.context.instructions,
    assignmentInstructions(work, { managedSession: true }),
    'Complete this one Interlock assignment. Return a JSON object with one field, result, whose value matches the supplied result schema. The host unwraps result and owns claim, renewal and submission; do not claim or submit this assignment yourself.',
    'Before returning, stop background commands and subprocesses you started. Do not detach daemons or leave work running after this assignment.',
    `Assignment input:\n${JSON.stringify(work.input)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
export function resultEnvelope(work: WorkRequest) {
  return {
    type: 'object',
    properties: { result: work.outputSchema },
    required: ['result'],
    additionalProperties: false,
  };
}

/** A completed native attempt returned an explicit failure or invalid result. */
export class HarnessResultError extends Error {}

/** Definite model refusal before task actions; thrown only after native cleanup. */
export class HarnessModelError extends Error {}

/** A native protocol command was explicitly rejected, rather than lost. */
export class HarnessRequestError extends Error {}

/** Match native errors, never assistant answer text or generic HTTP failures. */
export function isModelRefusal(error: unknown): boolean {
  const message = extractErrorText(error);
  return (
    typeof message === 'string' &&
    (/\bmodel_(?:not_found|not_available|not_supported|access_denied)\b/i.test(
      message,
    ) ||
      /\b(?:requested )?model\s+["'][^"'\n]{1,200}["']\s+(?:does not exist|is (?:not supported|unavailable))/i.test(
        message,
      ) ||
      /["'][^"'\n]{1,200}["'] model is not supported when using Codex with a ChatGPT account/i.test(
        message,
      ))
  );
}

export function extractErrorText(error: unknown): string {
  if (error instanceof Error) {
    let text = error.message;
    if ('cause' in error && error.cause) {
      text += ' ' + extractErrorText(error.cause);
    }
    return text;
  }
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error ?? '');
}

export interface ClassifiedHarnessError {
  errorClass: ErrorClass;
  retryable: boolean;
  reason: string;
}

export function isMissingResultError(error: unknown): boolean {
  if (error instanceof HarnessResultError) {
    const message = extractErrorText(error);
    return (
      /without a(?:n)? (?:structured )?assignment result/i.test(message) ||
      /completed without a structured (?:assignment )?result/i.test(message) ||
      /invalid result (?:JSON|envelope)/i.test(message) ||
      /expected JSON envelope/i.test(message) ||
      /failed to return a(?:n)? (?:structured )?result/i.test(message) ||
      /missing result envelope/i.test(message) ||
      /empty STDOUT; expected JSON envelope/i.test(message) ||
      /no result envelope/i.test(message)
    );
  }
  return false;
}

/**
 * Classify harness/adapter errors into permanent, transient, or missing_result.
 *
 * Permanent errors (quota, billing, auth, invalid request, context length,
 * content policy, model refusal) reject immediately without retry.
 *
 * Transient errors (network drops, timeouts, HTTP 429 rate limit, 5xx server
 * error, server overloaded) are retried with exponential backoff up to maxRetries.
 */
export function classifyHarnessError(error: unknown): ClassifiedHarnessError {
  const message = extractErrorText(error);

  if (error instanceof HarnessModelError || isModelRefusal(error)) {
    return {
      errorClass: 'permanent',
      retryable: false,
      reason: message || 'Model refused or not supported',
    };
  }

  if (isMissingResultError(error)) {
    return {
      errorClass: 'missing_result',
      retryable: false,
      reason: message || 'Missing structured result envelope',
    };
  }

  // Permanent error checks
  const isPermanent =
    // Quota / billing
    /\b(?:insufficient_quota|quota_exceeded|exceeded_quota|credit_balance|billing_hard_limit|payment_required|account_deactivated|account_suspended)\b/i.test(
      message,
    ) ||
    /insufficient\s+quota|quota\s+exceeded|credit\s+balance|payment\s+required|billing\s+limit|billing\s+issue|account\s+suspended/i.test(
      message,
    ) ||
    // Authentication / authorization
    /\b(?:unauthorized|invalid_api_key|api_key_invalid|authentication_failed|forbidden|permission_denied)\b/i.test(
      message,
    ) ||
    /invalid\s+api\s*key|api\s*key\s+not\s+found|authentication\s+failed|permission\s+denied|unauthorized\b|HTTP\s+40[13]\b|status(?:\s*code)?\s*[:=]?\s*40[13]\b/i.test(
      message,
    ) ||
    // Invalid request
    /\b(?:invalid_request_error|bad_request|invalid_parameter)\b/i.test(
      message,
    ) ||
    /bad\s+request|invalid\s+request|HTTP\s+400\b|status(?:\s*code)?\s*[:=]?\s*400\b/i.test(
      message,
    ) ||
    // Context length exceeded
    /\b(?:context_length_exceeded|max_tokens_exceeded|maximum_context_length)\b/i.test(
      message,
    ) ||
    /context\s+length\s+exceeded|maximum\s+context\s+length|prompt\s+too\s+long|token\s+limit\s+exceeded|context\s+window\s+is\s+full/i.test(
      message,
    ) ||
    // Content policy / safety
    /\b(?:content_policy_violation|safety_policy|moderation_block)\b/i.test(
      message,
    ) ||
    /content\s+filter|safety\s+policy|content\s+policy|violat(?:es?|ing)\s+our\s+usage\s+policy/i.test(
      message,
    );

  if (isPermanent) {
    return {
      errorClass: 'permanent',
      retryable: false,
      reason: message,
    };
  }

  // Transient error checks
  const isTransient =
    // HTTP 429 rate limit
    /\b(?:rate_limit_exceeded|rate_limit|too_many_requests)\b/i.test(message) ||
    /rate\s*limit|too\s+many\s+requests|HTTP\s+429\b|status(?:\s*code)?\s*[:=]?\s*429\b/i.test(
      message,
    ) ||
    // Network drops / connection errors
    /\b(?:ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|EPIPE|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)\b/i.test(
      message,
    ) ||
    /socket\s+hang\s+up|network\s+(?:error|timeout|drop)|connection\s+(?:reset|refused|closed|dropped)|fetch\s+failed/i.test(
      message,
    ) ||
    // Timeouts
    /\b(?:timeout|timed_out|deadline_exceeded)\b/i.test(message) ||
    /timed?\s*out|deadline\s+exceeded|HTTP\s+(?:408|504)\b|status(?:\s*code)?\s*[:=]?\s*(?:408|504)\b/i.test(
      message,
    ) ||
    // Server errors (5xx)
    /\b(?:server_error|internal_server_error|bad_gateway|service_unavailable|gateway_timeout)\b/i.test(
      message,
    ) ||
    /HTTP\s+50[0234]\b|status(?:\s*code)?\s*[:=]?\s*50[0234]\b|internal\s+server\s+error|bad\s+gateway|service\s+unavailable|gateway\s+timeout/i.test(
      message,
    ) ||
    // Server overloaded
    /\b(?:overloaded|service_overloaded|engine_overloaded)\b/i.test(message) ||
    /server\s+(?:is\s+)?overloaded|temporarily\s+unavailable|system\s+(?:is\s+)?overloaded|capacity\s+exceeded/i.test(
      message,
    );

  if (isTransient) {
    return {
      errorClass: 'transient',
      retryable: true,
      reason: message,
    };
  }

  // Unclassified default: permanent failure
  return {
    errorClass: 'permanent',
    retryable: false,
    reason: message,
  };
}
