# Start admission specification

The [intent](intent.md) owns the outcome and constraints. Requirements below derive from live issue #235 and H8 of #223.

## Decisions

- D1. Admission applies to ordinary runs, invoked workflow runs, comparison roots, and continue-as-new successors. Batch item runs share their parent admission and never consume extra workflow slots.
- D2. Each queued run uses its captured published workflow's maxActiveRuns and excludeStages. Capacity counts admitted, nonterminal, non-Batch-item runs of the same workflow ID across versions. A currently excluded projected stage does not count. Existing admitted runs continue when they leave an excluded stage, so a stage transition can temporarily exceed the limit. Admission is a start gate, not preemption.
- D3. Higher integer priority runs first, then durable insertion order. Default priority is zero. Dependencies and pauses can make a run ineligible; an eligible later run can pass it. Queue position is one-based within its workflow's waiting queue in this order, including blocked entries.
- D4. after contains at most 32 references, each with exactly one requestId or externalTask identity. A request key binds its original run. A task reference binds the newest retained non-Batch run matching that identity when first resolved. Missing references remain explicit blockers and can resolve later. Resolution pins the run ID and follows its continue-as-new chain to the current successor. Every dependency must complete successfully. Failed, cancelled, deleted, unresolved, or queued dependencies keep the start queued with an inspectable reason. A start cannot depend on its own requestId. Cycles never execute and remain blocked.
- D5. Active-task policy is library-wide for exact normalized system/id identity and includes queued, running, and waiting runs. allow is the default. reuse returns the oldest active matching run without creating or pumping it. reject creates nothing. cancel_previous cancels all active matching lifecycles through the existing cancellation path before admitting the replacement, retaining uncertain resource/executor ownership. Continue-as-new correlation participates. Policies require externalTask. The receipt fingerprints priority, dependencies, and policy. A reuse request key records a receipt pointing to the existing run and must remain replayable.
- D6. Profile concurrency is optional positive integer or null. Omission and null impose no profile cap. The current local profile limit controls new managed dispatch, including launches pending a ticket claim. Reducing a cap does not interrupt active attempts. Both global and profile caps must permit a dispatch. Profile saturation skips that profile so other profiles can use global capacity. Historical configuration snapshots retain their original values.

## Acceptance criteria

- AC1. Workflow definitions and editing contracts accept optional maxActiveRuns, a positive integer, and bounded excludeStages. Definitions without controls preserve current starts.
- AC2. An admitted start commits captures, metadata, budget, and request receipt atomically. A queued start executes no node and exposes queued status, priority, one-based position, queued timestamp, and waiting.kind admission_queue with bounded blocker detail and engine actor.
- AC3. Pumping promotes eligible queued runs by D2 and D3 as slots open, including completion, failure, cancellation, stage transitions, and restart. Paused workflows remain queued without effects. Concurrent ordinary requests cannot over-admit or bypass active-task policy.
- AC4. All four policies obey D5, including concurrent requests, uncertain cancellation ownership, and exact requestId replay. Invalid starts leave neither receipts nor cancellation effects.
- AC5. Dependencies obey D4 across restart and uncertain redelivery. A dependency completion wakes admission. A failed or cancelled dependency reports its status and run identity without starting the dependent.
- AC6. Profile concurrency obeys D6 for direct and delegated launcher paths, with eligibility rechecked after asynchronous work. Global capacity still limits all profiles together.
- AC7. Queued runs remain active for cancellation, history/version/workflow deletion protections, exports, summaries, descendants, continuation counts, and UI Active views. Briefings explain admission blockers and finite change waits wake when queue state changes. There is no claimable assignment until promotion.
- AC8. Shared API, CLI, and MCP start inputs use the same bounds/defaults and preserve old positional Engine callers. Lookup accepts queued status. HTTP and stdio discovery expose the updated contract. Existing authoring settings and executor save operations support the new fields without a new tool.
- AC9. Required architecture, managed execution, idempotent starts, and scope docs describe the final behavior. Affected README, agent operations, CLI help, and MCP descriptions and schemas agree. A pending patch changeset describes user-visible behavior.
- AC10. Existing pause unions, background Script recovery, external input, detached boundaries, chain identity, uncertain resources, prompt and variable capture, dynamic cwd, and launcher ticket rules retain their current protections.

## UI proposal

Existing Active runs and Run Inspector display queued status and admission waiting details through the shared projection. A queued row can be opened and cancelled using existing controls. Queue position and reason appear with the existing waiting message. Workflow admission is configured through the existing raw definition/settings API for this increment. Profile concurrency is supported by the existing profile form if practical without duplicating global settings. Existing focus, loading, error, and narrow-screen patterns apply. No new navigation or independent admission editor is introduced.

## Risks and limits

Priority has no aging policy. A stream of higher priority starts can delay lower priority runs. Dependency references are local-library identities, not external board state. Admission does not fence external processes or wait for uncertain previous effects to stop. Existing resource reconciliation remains authoritative.

## Open questions

No material requirement remains unresolved. The design choices above are ordinary implementation decisions under the coordinator's explicit delegation.

