import { assignmentInstructions } from '../agentInstructions.js';
import type {
  ExecutorAnswer,
  ExecutorProfile,
  ExecutorQuestion,
  Json,
  ModelUsage,
  HarnessModel,
  WorkRequest,
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
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
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
