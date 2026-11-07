# Start admission controls

## Problem and outcome

High-volume pipelines can launch duplicate task attempts, exceed workflow capacity, or let one managed executor profile consume every shared slot. Operators currently need external locking and scheduling.

Interlock will accept and retain starts that must wait, explain why they are queued, and admit them when their dependencies and capacity permit. Callers can atomically choose how to handle an already active external task. Managed executor profiles can reserve independent capacity beneath the existing global cap.

## Scope

Issue [#235](https://github.com/dgca/interlock/issues/235), H8 of [#223](https://github.com/dgca/interlock/issues/223), defines this change. It completes the remaining concurrency criteria in [#71](https://github.com/dgca/interlock/issues/71). The users are workflow authors, connected agents, CLI callers, and operators of managed pipelines.

The change covers workflow admission settings, durable queued runs, priority and dependency admission, external-task policies, per-profile managed concurrency, inspection, and affected shared API, CLI, MCP, and UI contracts. It does not add schedules, webhook ingress, release publication, or distributed scheduling.

## Constraints and authorization

Task branch: `feat/issue-235`. Original baseCommit: `8cf9813526f30274f853a597ed67977d259ed5e9`.

The live issues and coordinator request are captured in [request.md](request.md). Repository instructions remain authoritative for package boundaries and validation. Existing request receipts, prompt and variable capture, immutable versions, pause hold unions, stage projections, managed launch tickets, background Scripts, JavaScript, and legacy Bash behavior must remain valid.

The coordinator authorized ordinary design decisions and deferred design review to the end. This run uses reviewPolicy auto and createPr true. The author stops before claiming the fresh final Review change assignment. A separate reviewer and delivery continuation handle review and eventual PR work. No merge or publication is authorized for this author.

All validation uses temporary databases and isolated servers. The user's running server configuration and .interlock data are outside the change.

## Outcome-level success

A caller can submit a pipeline start once and inspect its durable admission state without maintaining an external queue. Duplicate task starts follow an explicit atomic policy. Workflow and executor capacity remain bounded while unrelated profiles can make progress.

## Open questions

No unresolved intent decision. Dependency identity, stage-exclusion behavior, queue fairness, and restart details will be defined in spec.md after checking the current runtime.

