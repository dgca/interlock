# Intent: H7: Managed session recovery policies

## Baseline Information
- **Task Branch**: `feat/issue-234`
- **Base Commit**: `c9e2a0a833712a233412dd21432d2abc23cb4672`
- **Issue**: dgca/interlock#234

## Problem Statement
Managed agent executions frequently encounter recoverable disruptions:
1. **Missing Result Envelopes**: Agent turns complete or halt after tool work or conversational reasoning without emitting the structured JSON `{ result: ... }` envelope required by Interlock's output contract.
2. **Transient Provider & Infrastructure Failures**: External LLM providers and networks frequently experience transient HTTP 429 rate limits, 5xx server errors, gateway timeouts, connection drops, or temporary capacity overload.

Currently, Interlock either immediately marks the attempt as failed or interrupts the job with a lost harness execution, requiring external coordinators or human operators to inspect logs, manually issue "continue" nudges, or trigger manual retries.

## Desired Outcome
Interlock natively manages automated recovery for managed agent executions according to configurable policies:
1. **Missing Result Continuation (`continueOnMissingResult`)**:
   - Configurable per executor profile, workflow definition default, and Agent node override.
   - Default is 0 (disabled) for backward compatibility.
   - Allows up to `maxTurns` consecutive continuation prompts within the same managed session, sending a continuation message (with default or customized prompt) to coax the agent into completing the structured result before declaring the attempt failed.
2. **Transient Error Retries with Exponential Backoff (`transientRetry`)**:
   - Configurable per executor profile (`maxRetries`, `windowMs`, `initialBackoffMs`), defaulting to 0.
   - Classifies errors into permanent vs. transient:
     - **Permanent errors**: quota exhaustion, billing errors, authentication failures, invalid requests, context length exceeded, content policy violations, and model refusals (`HarnessModelError`) reject immediately without retry.
     - **Transient errors**: network connection resets/drops, socket timeouts, HTTP 429 rate limits, HTTP 5xx server errors, and provider overload errors.
     - Transient errors trigger automatic retries with exponential backoff up to `maxRetries` within the rolling `windowMs` window.
     - If the transient retry budget is exhausted within the window, the execution escalates to a `Needs attention` hold instead of silent fatal failure.
3. **Recovery Event Telemetry**:
   - Record discrete recovery events (`errorClass: "transient" | "permanent" | "missing_result"`, `messageExcerpt`, `action: "continue" | "retry" | "escalate" | "fail"`, `at: string`) on the managed execution attempt record (`ManagedExecution.recoveryEvents`).
   - Surface these events in inspection APIs (`manage_executors` inspect, run inspection, Run Inspector UI).
4. **Pause Awareness**:
   - If a workflow run is paused (H3 pause state), paused time is excluded from `windowMs` calculations and retry backoff delays.
5. **Robust Documentation & Changeset**:
   - Update `docs/managed-executors.md`, `docs/architecture.md`, and `docs/v1.md`.
   - Add a patch changeset for `@type_of/interlock`.

## Affected Users and Systems
- **Workflow Authors & Operators**: Can configure resilience policies at the profile, workflow, or node level, avoiding babysitting transient failures.
- **`packages/core`**: Recovery policy schemas, node and workflow schemas, managed execution event types.
- **`packages/runtime`**: `ExecutorManager` retry loop, continuation message dispatch, error classification in `contracts.ts`, pause calculation, and hold escalation.
- **`packages/server` & `packages/mcp`**: Expose recovery settings and execution events in executor inspection.
- **`packages/ui`**: Display recovery events in execution logs/details if applicable.

## Settled Decisions
- **Defaults**: 0 for `continueOnMissingResult.maxTurns` and 0 for `transientRetry.maxRetries` (opt-in / fully backward-compatible).
- **Hierarchical Overrides**: Agent node settings override workflow definition settings, which override profile settings.
- **Error Classification**: Standardized pattern-matching and error type checks in `packages/runtime/src/executors/contracts.ts`.
- **Hold Escalation**: When retries are exhausted, work enters hold with category `other` and checkpoint for operator attention.
- **Pause Handling**: Time spent in run pauses is tracked or subtracted from rolling window checks and backoff deadlines.

## Open Questions
- None. Requirements and acceptance criteria are fully specified.
