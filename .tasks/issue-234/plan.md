# Implementation Plan: H7 Managed Session Recovery Policies

## Reference
- **Intent**: [intent.md](./intent.md)
- **Specification**: [spec.md](./spec.md)

---

## 1. Code Areas & Boundaries

| Package | Files | Purpose |
|---|---|---|
| `packages/core` | `src/executors.ts` | Define `continueOnMissingResultSchema`, `transientRetrySchema`, `RecoveryEvent`, `errorClassSchema`, update `executorProfileSchema`, `ManagedExecution`, `ManagedWorkSummary`. |
| `packages/core` | `src/index.ts` | Add `continueOnMissingResult` and `transientRetry` to `nodeSchema` (Agent node) and `definitionSchema` (workflow definition). Re-export new schemas and types. |
| `packages/core` | `src/workflowEdits.ts` | Support `continueOnMissingResult` and `transientRetry` in workflow edit settings. |
| `packages/runtime` | `src/executors/contracts.ts` | Implement `classifyHarnessError(error: unknown)` classifying permanent vs transient vs missing result errors. |
| `packages/runtime` | `src/executors/manager.ts` | Implement recovery policy resolution, continuation loop for missing result envelopes, transient retry loop with exponential backoff and rolling window, hold escalation, recovery event recording, and pause duration exclusion. |
| `packages/server` & `packages/mcp` | `packages/mcp/src/server.ts`, etc. | Ensure inspect and execution summaries surface recovery events and updated profile schemas. |
| `docs/` | `docs/managed-executors.md`, `docs/architecture.md`, `docs/v1.md` | Document recovery policies, error classification, configuration levels, pause awareness, and inspection. |
| `.changeset/` | `*.md` | Patch changeset for `@type_of/interlock`. |

---

## 2. Implementation Steps mapped to Acceptance Criteria

### Phase 1: Core Schemas & Types (AC1, AC5)
1. In `packages/core/src/executors.ts`:
   - Define `continueOnMissingResultSchema`: `{ maxTurns: number (0..10, default 0), message?: string }`.
   - Define `transientRetrySchema`: `{ maxRetries: number (0..10, default 0), windowMs: number (1000..86400000, default 300000), initialBackoffMs: number (100..60000, default 1000) }`.
   - Define `recoveryEventSchema` & `RecoveryEvent`: `{ errorClass: 'transient' | 'permanent' | 'missing_result', messageExcerpt: string, action: 'continue' | 'retry' | 'escalate' | 'fail', at: string }`.
   - Add optional `continueOnMissingResult` and `transientRetry` to `executorProfileSchema`.
   - Add `recoveryEvents?: RecoveryEvent[]` to `ManagedExecution` and `ManagedWorkSummary`.
2. In `packages/core/src/index.ts`:
   - Add optional `continueOnMissingResult` and `transientRetry` to Agent node in `nodeSchema`.
   - Add optional `continueOnMissingResult` and `transientRetry` to `definitionSchema`.
   - Export schemas and types.
3. In `packages/core/src/workflowEdits.ts`:
   - Allow `continueOnMissingResult` and `transientRetry` in `workflowEdits` settings updates.

### Phase 2: Error Classification in Contracts (AC2)
1. In `packages/runtime/src/executors/contracts.ts`:
   - Implement `classifyHarnessError(error: unknown)`:
     - Check for `HarnessModelError` or `isModelRefusal` -> `permanent` (model refusal, handled via model hold).
     - Check for permanent markers: quota exceeded, billing error, auth/unauthorized/forbidden, invalid request (400), context length exceeded, content policy violation -> `permanent`.
     - Check for missing result: `HarnessResultError` or envelope validation error -> `missing_result`.
     - Check for transient markers: network drops (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, `socket hang up`, `network error`, `fetch failed`), timeouts, HTTP 429 rate limit, 5xx server errors (500, 502, 503, 504), server overloaded -> `transient`.
     - Default unclassified errors to `permanent` if unknown or lost.

### Phase 3: Runtime Execution Recovery in `ExecutorManager` (AC1, AC3, AC4, AC5, AC6)
1. Effective Policy Resolution:
   - Helper function `resolveRecoveryPolicies(work: WorkRequest, profile: ExecutorProfile)`:
     - Node override (from work node definition / metadata) -> Workflow default (from run definition) -> Profile config -> Defaults (`maxTurns: 0`, `maxRetries: 0`).
2. Missing Result Continuation Loop:
   - In `ExecutorManager.runDirect` / execution loop:
   - If adapter finishes without `{ result: ... }` envelope or returns empty/invalid result:
     - Check `continueOnMissingResult.maxTurns`.
     - If continuation count < `maxTurns`:
       - Record recovery event: `errorClass: 'missing_result'`, `action: 'continue'`, `messageExcerpt: ...`, `at: now()`.
       - Send continuation prompt using adapter `request` or subsequent turn prompt in same session:
         `message` or `"Your previous turn did not return a valid result envelope matching the required output schema. Please return a JSON object with one field, 'result', matching the output schema."`.
       - Re-await adapter response.
     - Else:
       - Record recovery event: `errorClass: 'missing_result'`, `action: 'fail'`, `at: now()`.
       - Fail the attempt.
3. Transient Retries & Backoff:
   - When turn/adapter throws or fails:
     - Classify error using `classifyHarnessError`.
     - If `permanent`:
       - Record recovery event: `errorClass: 'permanent'`, `action: 'fail'`.
       - Fail attempt or handle model refusal as existing.
     - If `transient`:
       - Calculate prior transient retries within rolling `windowMs`, subtracting run pause intervals.
       - If retries < `transientRetry.maxRetries`:
         - Record recovery event: `errorClass: 'transient'`, `action: 'retry'`.
         - Delay with exponential backoff: `delay = initialBackoffMs * 2^(retryCount)`.
         - If run is paused during backoff, suspend delay until resumed.
         - Cleanly retry the execution.
       - If retries >= `transientRetry.maxRetries`:
         - Record recovery event: `errorClass: 'transient'`, `action: 'escalate'`.
         - Escalate to `Needs attention` hold via `engine.manageWorkHold({ category: 'other', reason: ... })`.
4. Surface Recovery Events:
   - Include `recoveryEvents` in `ManagedExecution`, update `manage` inspect response, and ensure UI and MCP callers see recovery events.

---

## 3. High-Risk Failure Cases & Negative Controls

1. **Permanent Error Misclassification**:
   - *Risk*: A quota or billing error or auth failure might be retried repeatedly, exhausting budgets or hammering dead endpoints.
   - *Check*: Inject `401 Unauthorized` and `insufficient_quota` errors; verify `classifyHarnessError` returns `errorClass: 'permanent'` and `ExecutorManager` rejects without retry.
2. **Infinite Continuation Loop**:
   - *Risk*: Agent continuously outputs plain text without a result envelope; continuation loop could run forever.
   - *Check*: Configure `continueOnMissingResult: { maxTurns: 2 }`; inject turns that never return a result envelope; verify exactly 2 continuation prompts are sent, and the attempt fails after the 2nd continuation with `action: 'fail'`.
3. **Transient Retry Budget Exhaustion Escalation**:
   - *Risk*: When transient errors persist past `maxRetries`, the job might crash or fail silently instead of placing work on hold.
   - *Check*: Configure `transientRetry: { maxRetries: 2, windowMs: 60000, initialBackoffMs: 10 }`; inject continuous 503 errors; verify 2 retries occur with exponential backoff, followed by escalation to hold with category `'other'` and an event with `action: 'escalate'`.
4. **Pause Exclusion Integrity**:
   - *Risk*: A paused run could age out the rolling window or trigger backoff during a pause.
   - *Check*: Verify that paused durations are deducted from window calculations, and backoff waits do not fire while the run is in a paused state.

---

## 4. Verification Sequence & Ownership

- **Build Stage**:
  - Implement Core schemas and types.
  - Implement runtime error classification and `ExecutorManager` recovery policies.
  - Add comprehensive unit and integration tests in `packages/runtime/test/recoveryPolicies.test.ts`.
  - Update docs: `docs/managed-executors.md`, `docs/architecture.md`, `docs/v1.md`.
  - Add changeset in `.changeset/`.
  - Run `pnpm test`, `pnpm build`, `pnpm format:check`.
  - Commit implementation.
- **Review Stage**:
  - Independent review will verify git diff, boundary contracts, and negative controls.
