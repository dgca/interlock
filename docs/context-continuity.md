# Keep Agent context across phases

Set `context.continuityGroup` on Agent nodes that should use the same executor session, such as specification, planning, and implementation. Use `context.mode: "current"` (the default). A fresh-context node cannot belong to a group: the editor can save that draft, but publication rejects it. Leave fresh reviewers outside the author group.

A group belongs to one exact run ID. Its binding survives phases, loop visits, claim failures, lease expiry, explicit failed-step retry, and server restart. Separate root runs, invoked workflows, detached runs, and each Batch item have independent groups, even when their group names match. No child inherits a parent's session. A harness can explicitly declare the same identity elsewhere, but Interlock never chooses or copies it across runs.

Group names are trimmed, case-sensitive strings of 1–128 characters. Executor and session IDs are trimmed, case-sensitive opaque strings of 1–200 characters. Use stable harness identities, not claim tokens or secrets. The worker ID identifies the claimant; changing it does not replace the session.

## Claim grouped work

Discovery (`list_work`, `get_run_briefing`, and compact start/submit responses) includes `context.continuityGroup` and a `continuity` descriptor: `runId`, `group`, `revision`, `session`, and an optional `checkpointRef`. An unbound group has revision `0` and session `null`.

1. If unbound, choose or create the appropriate harness session.
2. If bound, resume the exact `continuity.session` identity. If it is unavailable, record a handoff before claiming.
3. Include `session: {executorId, sessionId}` in `claim_work` along with the usual worker identity and actual capabilities.

For example:

```sh
interlock claim WORK_ID coordinator '{"session":{"executorId":"my-harness","sessionId":"author-session"}}'
```

The first successful claim binds the group at revision `1`. Failed admission checks do not bind it. Later claims must match both IDs. A conflicting declaration rejects without consuming an attempt. Claiming work, its binding, and its claim-history record commit together. Renewal and submission still use the claim token; neither changes the binding.

Ungrouped work keeps its existing behavior and requires no session declaration. Session declarations on ungrouped claims do not create continuity records. The manual UI cannot claim grouped work because it cannot attest an external executor session.

## Replace an unavailable session

Read the current binding and history on demand:

```sh
interlock context-group RUN_ID author
interlock context-group RUN_ID author '{"offset":20,"limit":20}'
```

MCP uses `get_context_group`. History contains claim attempts and handoffs, in insertion order. Reads default to 20 records, accept limits from 1 through 100 and offsets from 0 through 1,000,000, and return `total` and `nextOffset` (`null` on the last page). Reading an unbound name on an existing run returns revision `0` and empty history.

A handoff must include the current revision, replacement identity, declared actor, reason, and checkpoint reference:

```sh
interlock handoff-context '{"runId":"RUN_ID","group":"author","expectedRevision":1,"session":{"executorId":"my-harness","sessionId":"replacement-session"},"actor":"coordinator","reason":"Original session is unavailable","checkpointRef":".tasks/example/checkpoint.md"}'
```

MCP uses `handoff_context_group`. The actor, reason, and checkpoint reference must be nonblank, with maximum lengths of 200, 1,000, and 2,048 characters respectively. The replacement identity must differ from the current identity. The checkpoint reference is opaque: Interlock never reads or executes it. The harness must use the referenced checkpoint to restore context in the replacement session.

Handoff rejects while the group has any active claim. Complete or report failure on that claim, or let its lease expire. Handoff processes overdue leases through normal recovery before checking. Inspect external side effects before retrying work. Failed runs can receive a handoff before explicit retry; completed and cancelled runs cannot.

An accepted handoff increments the binding revision and records both identities, actor, reason, reference, and timestamp. A retry identical to the latest accepted handoff returns `applied: false`; stale or conflicting revisions reject. It does not claim work, reset attempt counters or usage budgets, or extend a lease. Available assignment metadata and continuation cursors update to expose the new binding. Completed attempt history retains its original session.

Bindings and history persist in the local database and are removed with run history when the workflow is deleted. Workflow export/import includes group declarations, but never run session identities or handoff history. Existing databases require no record conversion.

## Enforcement boundary

Optional [model tiers](model-tiers.md) apply to both current and fresh context. A tier never replaces a bound session or triggers a handoff. If a session cannot change models, preserve its continuity and report the selection you can provide. Claims accept a different declared tier or no model declaration.

Interlock checks declarations and records handoffs. It does not create sessions, authenticate the declared actor or executor, inspect conversation history, or prove continuity or fresh-review isolation. The external harness owns those responsibilities. A group name alone does not cause an executor to resume a session.
