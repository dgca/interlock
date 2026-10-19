# Compact mutation response contract

This specification implements the scope and compatibility decision in [intent](intent.md#source-and-settled-decisions). It changes no UI interaction.

## Response selection

AC1. MCP start_run and submit_result accept detail: full or summary. Omission remains full. Explicit full returns the same inspection shape as before, including run, definition, assignments, events, and descendants. Existing shared API calls, CLI commands, list_work defaults, and claim_work remain compatible.

AC2. Summary responses contain ok: true, runId, runStatus, cursor, nextWork: {items, total, truncated}, next, and nextDeadline. Submission also contains workId and workRunId. They omit workflow definitions, historical executions, prompts, input/output values, schemas, claim tokens, and context instructions. The success flag acknowledges the mutation; runStatus can still be failed if a downstream step failed.

AC3. limit defaults to 20 and accepts integers 1 through 100. It bounds nextWork.items, with exact total and truthful truncated. This is a record limit, not an arbitrary stored-text byte guarantee. A sequential 30-plus-node workflow with large prompts and repeated large outputs produces summary payloads under 4 KiB at startup and after several submissions. Both JSON text and structured content contain the selected response, without hidden full inspection.

## Continuation scope

AC4. runId identifies the continuation lifecycle. For startup this is the new run. For submission this is the work-owning run's outermost ordinary ancestor, stopping at the nearest detached boundary. workRunId always identifies the submitted assignment's immediate run. Completing a Batch item or waited child therefore exposes work unlocked in its parent or siblings.

AC5. nextWork includes available assignments in the continuation run and all descendants, including detached descendants. Each item retains the existing briefing identity, ancestry, lifecycleRunId, context mode and required tools/skills, attempts, and applicable deadline. No claimed or completed assignment appears. A terminal parent can coexist with independent detached work; runStatus describes the continuation run only. Executors inspect lifecycle identity before deciding to continue independent work.

AC6. Status, next-work totals/items, next action, next deadline, and cursor come from one post-mutation briefing snapshot. cursor is the existing opaque continuation cursor for runId and works with wait_for_run_change using that ID. It is not the graph node cursor. Empty work is valid for timer waits, claimed work, completion, cancellation, and failure. next and nextDeadline guide further inspection without exposing payloads.

## Submission and discovery

AC7. Repeating identical submission under its token retains existing idempotency, does not repeat the transition, and returns the selected response mode reflecting current state. Later progress or restart may change values and cursor. Conflicting output, invalid output, or stale claims retain existing failures. Response options are validated before mutation so invalid options cannot start a run or accept work accidentally.

AC8. HTTP and stdio advertise the same input and output contracts for start_run, submit_result, and list_work. Structured successful results are JSON objects and validate against declared output schemas for compact and legacy modes. Existing errors retain isError and text. Full-mode output schema declaration must not strip or alter legacy data.

AC9. Server instructions and affected tool descriptions teach executors to select detail: summary and fields: summary. Documentation explains the opt-in compatibility policy, scope and wait cursor, truncated work discovery, full inspection and targeted-result escape hatches, replay semantics, and limits. CLI help is checked against unchanged command behavior.

## Decisions and alternatives

D1. Keep existing defaults as accepted by the user. A default flip would require migrating existing callers and is deferred. Full-only mutation output plus a separate briefing call cannot solve context consumption.

D2. Use the owning lifecycle as automatic continuation scope and return workRunId explicitly. This matches fresh-context handoff behavior and avoids exposing only a completed child. Always selecting rootRunId would incorrectly cross detached boundaries. Adding a user-selected arbitrary continuation run is unnecessary for this increment.

D3. Reuse briefing metadata rather than a second independent work query. Record caps preserve claim requirements without a new pagination protocol. Exact byte guarantees for arbitrary labels or capability names are outside this change.

D4. Output schemas describe both supported response modes. New shared API operations may be additive so existing typed consumers retain their full-response types. Execution sequencing stays shared.

No unresolved human decisions remain. These technical choices preserve the accepted outcome and documented lifecycle rules.
