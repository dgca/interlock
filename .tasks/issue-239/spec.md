# Stall policy and attempt deadlines

[Intent](intent.md) owns scope, authorization and task identity.

## Decisions

All behavior is opt-in. Flat threshold fields exist on library stall settings, workflow definitions and every node. Each field inherits independently node > workflow > library; null disables an inherited threshold, omission inherits. Thresholds and maxExecutionMs accept whole milliseconds from 1 to 2,592,000,000. Agent maxExecutionMs is optional, with no inherited default.

The issue explicitly excludes declared workHolds and needs_human from stall clocks. Current runtime distinguishes those from unheld external input-node waits. humanWaitStallMs therefore measures unheld input-node wait duration. It does not alert merely because a managed permission/question remains in needs_human. Input acceptance holds freeze it too. This interpretation was confirmed by coordinator on 2026-11-07; input actor classification remains unchanged because delivery can be automated.

runStallMs measures lack of workflow transition/progress, excluding intentional Wait timers, queued admission, waited active children and declared holds. Agent-specific clocks measure available time and time since latest claim progress or renewal respectively. All clocks union overlapping library/workflow pauses and declared hold intervals before subtracting. Holds and needs_human exclude their complete persisted intervals. Attention reports a stall without changing queued, waiting or held status.

Managed idle recovery is independently opt-in with a bounded maxRecoveries and nudge message. It first sends the message where supported, then, after another idle interval, stops and relaunches only after confirmed quiescence through existing claim/resource rules. Actual progress or renewal cancels a pending escalation. Recovery cap persists and does not reset failure, lease, deadline, resource, provider or continuity protections. Unsupported messaging or uncertain stop escalates for inspection. Active attempt deadlines do not reset when the same attempt continues or retries a native turn.

## Acceptance criteria

- AC1: Library settings and workflow/node authoring accept the four thresholds with the stated inheritance, null disabling, bounds, and defaults. Agent maxExecutionMs is available through shared authoring paths.
- AC2: Server pump detects eligible unclaimed, claimed-idle, unheld input and transition stalls at the threshold, creates durable deduplicated stalled attention and a stalled lifecycle event with bounded projection metadata. Progress resolves current attention; a subsequent stall produces a new event. Restart preserves evidence. Future event-trigger registration is not implemented.
- AC3: Pauses and declared holds freeze all relevant active clocks with interval unions, including historical overlaps and needs_human resume. Queued and intentional Wait states keep their existing semantics.
- AC4: maxExecutionMs expires each claimed Agent attempt based on total active duration independently of lease renewals and native recovery, using ordinary failure/ownership rules. A new claim attempt has a fresh deadline. Late result/renewal cannot race past expiry.
- AC5: Managed idle recovery executes an actual nudge then bounded safe stop/relaunch. Progress/renewal/completion/hold/pause/restart races cannot restart stale work, bypass tickets, resume uncertain sessions or reset budgets.
- AC6: Existing Mantine settings and node dialogs provide the new controls; workflow settings expose overrides, Run Inspector shows current stall/deadline details and Needs attention links to stalled execution. Save/reopen, invalid inputs, loading/errors, keyboard focus and narrow layouts follow current dialogs.
- AC7: Document timers, managed execution, architecture and limits, review affected README/CONTEXT/CLI/MCP flows, test transport discovery, and add a patch changeset. Required tests/build/format pass on the final exact candidate.

## UI proposal

Reuse existing settings dialogs with numeric millisecond controls grouped under Stall detection and explicit inheritance/disabled choices. Workflow/node settings use the same field component. Agent settings add Maximum active execution. Existing footer Apply/Cancel and validation behavior remain. Add a stalled reason and concrete threshold/current duration in attention/inspection, without making input waits require a person. On small screens fields stack; labels and existing focus traps remain. Empty thresholds mean disabled at library scope, inherited elsewhere. Failed saves retain edits and visible error. No separate UI redesign.
