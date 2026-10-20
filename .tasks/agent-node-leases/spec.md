# Agent lease behavior

Scope and authorization: [intent](intent.md).

## Acceptance criteria

- **AC1 — Authoring.** Agent definitions accept optional integer `leaseSeconds` from 10 through 3600. Omission remains valid and does not materialize a field in saved definitions. Draft editing, publication, export/import, and MCP authoring preserve this setting. Invalid values are rejected at the contract boundary.
- **AC2 — Claim precedence and snapshots.** A claim's effective duration is its explicit override, otherwise the Agent setting from the run's published definition, otherwise 300 seconds. Assignments persist the optional configured duration as `leaseSeconds`; claims persist the effective duration as `claimLeaseSeconds`. Editing or publishing a workflow cannot change existing assignments or later assignments in that run. Restart preserves both settings. Explicit claim bounds remain 10–3600 seconds on public interfaces.
- **AC3 — Renewal.** Omitted renewal durations reuse the effective original claim duration across restarts. An explicit renewal duration affects only that renewal. Stored claims without `claimLeaseSeconds` use 300 seconds. Renewal cannot revive an expired token.
- **AC4 — Expiry and recovery.** Each processed expired claim produces exactly one `work.lease_expired` event identifying the assignment, attempt count, expiry deadline, and whether another attempt is available. The message explains renewing before expiry and inspecting/reclaiming or explicitly retrying as appropriate. Existing `work.retry`, run failure, attempt limits, unclaimed timeouts, token invalidation, cancellation, and completed-submission replay remain unchanged. Worker-reported failure does not emit a lease-expired event. No token or full task payload is added to events.
- **AC5 — Discovery and guidance.** Available-work summaries and continuation summaries expose the optional configured `leaseSeconds`; full claims expose `claimLeaseSeconds` and `leaseUntil`. MCP HTTP and stdio discover the same optional claim parameter and node setting. Instructions describe precedence, bounds, renewal, expiry, and recovery in current-state language, consistently across authoring and execution tools. Summary responses remain compact and exclude task payloads.
- **AC6 — Editor.** Agent settings expose Claim lease as an amount and unit, initially displaying the configured value or five minutes. Supported units are seconds, minutes, and hours; values represent whole seconds between 10 and 3600. Saving unrelated edits does not add the optional setting. Applying a valid duration, reopening settings, raw editing, saving, and publishing preserve it. Invalid values receive the existing form/save validation and cannot publish.
- **AC7 — Delivery.** Include a patch changeset, updated affected docs, focused automated coverage, actual browser verification of the editor journey, required build and formatting checks, and fresh independent review before PR creation. Preserve the user's workflow library and unrelated changes.

## UI proposal

Place Claim lease before Maximum attempts in Agent settings. Reuse the existing compact duration control and form validation. Explain that workers can override the duration and must renew before expiry. No new network operation, loading state, or separate save action is needed: Apply changes and the workflow's Save draft / Publish actions own persistence and feedback. Labels remain keyboard accessible, unit selection retains focus, and the compact row fits the existing narrow modal layout.

## Decisions and tradeoffs

Persist the configured setting on each assignment to make claim resolution and inspection direct, while creation uses the pinned published definition. Keep it optional to retain stored-record compatibility without migration. Distinguish the configured default (`leaseSeconds`) from the actual claim duration (`claimLeaseSeconds`). Longer leases delay recovery from abandoned work; the one-hour bound and explicit opt-in limit that tradeoff. A distinct expiry event improves diagnosis without changing failure budgets. See intent for deferred alternatives. No unresolved human decisions.
