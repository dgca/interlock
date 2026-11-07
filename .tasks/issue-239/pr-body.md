## TL;DR

Unattended workflows can now surface stalled work in Needs attention, and Agent attempts can opt into an active execution limit independent of renewable leases. Custom launchers can opt into capped idle nudges and confirmed-stop recovery.

Closes #239.

## Details

Adds inherited library/workflow/applicable-node stall thresholds, interval-union pause/hold exclusions, durable stalled attention/events and Agent `maxExecutionMs`. Declared `needs_human` holds freeze clocks; human-wait monitoring covers unheld input nodes without changing actor. M2 trigger registration remains future work.

Managed recovery preserves attempts, claim budgets, tickets, session identity and uncertain resource ownership. Native/direct adapters retain observational attention. Existing Mantine settings and Run Inspector expose the controls and limits.

Artifacts: [intent](.tasks/issue-239/intent.md), [spec](.tasks/issue-239/spec.md), [plan](.tasks/issue-239/plan.md), [verification](.tasks/issue-239/verification.md).

## MCP impact

Adds one grouped `manage_stalls` operation and typed authoring/claim/inspection fields. Actual HTTP and stdio full discovery envelopes match, growing from 267,709 to 280,092 UTF-8 bytes. `manage_stalls` costs 2,907 bytes; portable definition schemas account for 7,763 additional bytes across import/create/update, with the remainder in execution-limit responses and affected guidance. Review fixes add 304 bytes for deadline reconciliation and resumed availability rules. Initialization instructions shrink from 9,979 to 9,973 bytes. The envelope ceiling is 283,000 bytes.

Stall inspection returns only current records, defaults to 20 and caps at 100, with exact totals and pagination, without payloads or tokens. Full run inspection includes the same bounded page. Affected authoring, work lifecycle, holds, external input and managed recovery flows were checked; HTTP and stdio discovery and execution tests pass. See the exact [measurement data](.tasks/issue-239/mcp-discovery.json).

## Backwards compatible?

Yes. New policies are opt-in, omitted fields preserve existing behavior, and library defaults are local. Threshold null disables inheritance. Wait deadlines and claim leases retain their existing semantics. A pending patch changeset is included; there is no version bump or release.

## Validation

`pnpm test` passes 133 files and 1,581 tests. `pnpm build`, `pnpm format:check`, package smoke and `git diff --check` are recorded in verification.md. Clock/recovery tests use deterministic clocks, temporary Stores and fake adapters. Review fixes cover failed-nudge process survival, local-trial quiescence, launcher deadline reconciliation, resumed availability clocks and indexed unresolved history. Actual controls were saved/reopened, and a stalled run was opened from Needs attention, including a narrow-screen deadline check. No real model/account or user data was used.
