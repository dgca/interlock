# Specification: H7 Managed Session Recovery Policies

## Reference
- **Intent**: [intent.md](./intent.md)

---

## Acceptance Criteria

### AC1: Recovery Policy Schemas & Hierarchy
- Define two recovery policies in `@interlock/core`:
  1. `continueOnMissingResult`:
     ```ts
     export const continueOnMissingResultSchema = z
       .object({
         maxTurns: z.number().int().min(0).max(10).default(0),
         message: z.string().trim().min(1).max(4000).optional(),
       })
       .strict();
     export type ContinueOnMissingResult = z.infer<typeof continueOnMissingResultSchema>;
     ```
  2. `transientRetry`:
     ```ts
     export const transientRetrySchema = z
       .object({
         maxRetries: z.number().int().min(0).max(10).default(0),
         windowMs: z.number().int().min(1000).max(86_400_000).default(300_000),
         initialBackoffMs: z.number().int().min(100).max(60_000).default(1000),
       })
       .strict();
     export type TransientRetry = z.infer<typeof transientRetrySchema>;
     ```
- Configurable at three levels with strict precedence:
  1. **Agent node override** (`nodeSchema` where `kind: 'agent'`) takes highest priority.
  2. **Workflow definition default** (`definitionSchema`) applies when omitted on the node.
  3. **Executor profile configuration** (`executorProfileSchema`) applies when omitted on the workflow.
  4. When completely unset or default: `maxTurns: 0` and `maxRetries: 0` (backward compatible, recovery policies disabled).
- Updating workflow definition settings (`workflowEdits.ts`) supports `continueOnMissingResult` and `transientRetry`.

### AC2: Error Classification (`packages/runtime/src/executors/contracts.ts`)
- Harness and adapter errors are classified into three distinct categories:
  ```ts
  export type ErrorClass = 'permanent' | 'transient' | 'missing_result';
  ```
- Classification function:
  ```ts
  export function classifyHarnessError(error: unknown): {
    errorClass: ErrorClass;
    retryable: boolean;
    reason: string;
  };
  ```
- **Permanent Errors** (`retryable: false`, rejected immediately without retry):
  - Quota / Billing errors: `insufficient_quota`, `quota exceeded`, `credit balance`, `billing`, `payment required`, `account inactive`.
  - Authentication / Authorization: `unauthorized`, `forbidden`, `invalid_api_key`, `invalid api key`, `permission denied`.
  - Invalid request: `invalid_request_error`, `bad request`, HTTP 400.
  - Context length: `context_length_exceeded`, `maximum context length`, `prompt too long`, `token limit`.
  - Content policy / Safety: `content_policy_violation`, `moderation`, `safety`.
  - Model refusal: `isModelRefusal(error)` or `HarnessModelError` (triggers `needs_model` hold workflow).
- **Transient Errors** (`retryable: true`, eligible for exponential backoff):
  - Network drops / connection errors: `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, `network error`, `socket hang up`, `connection closed`, `fetch failed`.
  - Timeouts: `timeout`, `timed out`, `deadline exceeded`, HTTP 408, HTTP 504.
  - Rate limits: `rate_limit_exceeded`, `rate limit`, `too many requests`, HTTP 429.
  - Server errors: HTTP 500, 502, 503, 504, `server error`, `internal error`, `bad gateway`, `service temporarily unavailable`.
  - Server overloaded: `overloaded`, `engine is currently overloaded`.
- **Missing Result** (`errorClass: 'missing_result'`):
  - Turns that complete without a valid `{ result: ... }` JSON envelope, throwing `HarnessResultError` or failing result validation.

### AC3: Missing Result Continuation in Same Session
- When an agent turn finishes without returning a structured result envelope matching the assignment output schema:
  - If `continueOnMissingResult.maxTurns > 0` and continuation turns used for this execution < `maxTurns`:
    - Dispatch a continuation message in the same native session.
    - Message defaults to: `"Your previous turn did not return a valid result envelope matching the required output schema. Please return a JSON object with one field, 'result', matching the output schema."` or uses the configured custom `message`.
    - Record a recovery event: `{ errorClass: 'missing_result', messageExcerpt: '...', action: 'continue', at: now() }`.
    - Re-await the turn result within the same session.
  - If continuation turns reach `maxTurns`:
    - Record a recovery event: `{ errorClass: 'missing_result', messageExcerpt: '...', action: 'fail', at: now() }`.
    - Conclude the attempt as failed with a descriptive error.

### AC4: Transient Retry with Exponential Backoff and Escalation
- When an execution fails with an error classified as `transient`:
  - Check the rolling window: count previous transient retries within the rolling `windowMs` window (excluding paused run time).
  - If retries < `maxRetries`:
    - Calculate exponential backoff delay:
      `delayMs = initialBackoffMs * Math.pow(2, retryAttempt)`
    - Record recovery event: `{ errorClass: 'transient', messageExcerpt: excerpt, action: 'retry', at: now() }`.
    - Wait `delayMs` (pausing the timer if the run is paused).
    - Retry the execution attempt cleanly.
  - If retries >= `maxRetries`:
    - Transient retry budget for `windowMs` exhausted.
    - Record recovery event: `{ errorClass: 'transient', messageExcerpt: excerpt, action: 'escalate', at: now() }`.
    - Escalate to `Needs attention` hold: place work in hold category `other` with checkpoint identifying the transient failure and reason, preserving the claim or pausing execution for operator intervention.

### AC5: Recovery Event Telemetry on Attempt Record
- Define `RecoveryEvent`:
  ```ts
  export interface RecoveryEvent {
    errorClass: 'transient' | 'permanent' | 'missing_result';
    messageExcerpt: string;
    action: 'continue' | 'retry' | 'escalate' | 'fail';
    at: string;
  }
  ```
- Store `recoveryEvents: RecoveryEvent[]` on `ManagedExecution` record in `attemptsCollection`.
- Truncate `messageExcerpt` safely (e.g. at most 200 characters) to keep logs bounded.
- Expose `recoveryEvents` on:
  - `ManagedExecution`
  - `ManagedWorkSummary`
  - `manage_executors` MCP inspect action response.
  - Run Inspector / UI execution details.

### AC6: Run Pause Awareness
- In Interlock, runs can be paused (`run.status === 'paused'`).
- Time spent during run pauses is tracked or calculated via run pause history.
- The pause duration is excluded from:
  - Rolling `windowMs` time calculations (effective elapsed time between retry events).
  - Exponential backoff delay wait time (backoff pauses when run is paused and resumes when run resumes).

### AC7: Verification & Documentation
- Unit tests for `classifyHarnessError` with comprehensive permanent and transient error patterns.
- Integration tests for continuation messages on missing result envelope.
- Integration tests for transient error retry with exponential backoff.
- Integration tests for escalation to `Needs attention` hold on retry budget exhaustion.
- Integration tests for pause duration exclusion.
- Integration tests for recovery event inspection.
- Updated documentation in `docs/managed-executors.md`, `docs/architecture.md`, `docs/v1.md`.
- Patch changeset for `@type_of/interlock`.
