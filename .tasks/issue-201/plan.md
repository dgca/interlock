# Implementation and verification

## Approach

Implement a runtime RunVersions module with core request contracts and additive persisted run fields. Keep its compatibility preview and mutation path shared by policy advancement and operator apply. Call it only before execution creation, so existing execution completion uses the original definition. Record execution versions at creation. Keep bounded version history separate from full graph responses.

## Build sequence

1. AC1–AC5: Add contracts, compatibility checking, confirmation fingerprints, transactional apply and start receipt policy identity. Validate input bindings against the proposed definition without executing operations. Preserve all existing captured dependency revisions.
2. AC6–AC8: Integrate creation, Batch inheritance, chain inheritance and active-binding cleanup/history impact. Preserve budgets and continuity records without rewriting them.
3. AC9–AC10: Add shared API, grouped MCP read/policy/preview/apply, CLI and inspector dialog. Reuse existing UI and transport tests. Keep MCP payloads bounded.
4. Update affected execution, continuation, prompt, cleanup and agent docs and pending patch changeset. Check README, CLI help and the complete affected MCP path against final implementation.

## Checks and ownership

Build owns focused temporary-database runtime tests for AC1–AC8, API/MCP transport tests for AC9, and existing UI interaction tests for AC10. Highest risks are stale preview application, partial writes, accidentally replacing captured work, changed prompt pins and altered child/chain scope. Pair each negative test with a valid compatible move and compare protected state after rejection or injected failure.

Build runs `pnpm test`, `pnpm build`, `pnpm format:check` and `pnpm test:package`. Test logs must retain exit status and inspectable results. Fetch and rebase current main before final handoff, repeating affected checks if the candidate changes.

Representative UI journey for AC10: open run version controls, change policy, preview a target with a blocker, then preview a compatible target and apply with a reason. Expect correct blockers, disabled apply while blocked and refreshed version/history after success. Reuse existing test infrastructure or inspect controls manually. Record an explicit gap if unavailable. Human UI review remains deferred per intent authorization.

Independent review owns the complete task diff and targeted checks against stable AC identifiers. Stop with the fresh review assignment available, return exact HEAD/base, run and work IDs, checks and remaining gaps to coordinator. Delivery remains in preparePr after independent review.

## Build results

AC1 through AC8 are covered by 25 temporary-database tests in `tests/runVersions.test.ts`. These exercise pinned defaults and automatic moves, available and claimed assignment preservation, contract and binding blockers, stale previews and revisions, complete rollback after an injected write failure, publish-pinned prompt recapture, preserved variable and alias revisions, continuity and budgets, children and Batch inheritance, nested Batch ancestry, chain caps, legacy execution stamping, restart, bounded history, comparisons and actual-binding cleanup. Incompatible target step limits also retain the old binding. The runtime uses additive optional fields; no migration or user database operation was required.

AC9 is covered by `tests/runVersionTransport.test.ts` over HTTP and stdio, shared API and CLI, plus existing transport regressions. The final full `pnpm test` passed 146 files and 1,728 tests. The log is `/tmp/interlock-201-tests-final.log`. `pnpm build`, `pnpm format:check` and `pnpm test:package` passed; their logs are `/tmp/interlock-201-build-final.log`, `/tmp/interlock-201-format-final.log` and `/tmp/interlock-201-package-final.log`.

AC10 has four DOM interaction tests in `tests/runVersionDialog.test.ts` and an actual browser journey through save policy, target preview, reason entry, apply and visible version history. Escape restored trigger focus and Enter reopened the dialog. A 390 by 844 viewport had no horizontal overflow after shortening the policy option. The console had no warnings or errors. Screenshots are `/tmp/interlock-201-ui.8Yz2Vs/desktop-preview.png` and `/tmp/interlock-201-ui.8Yz2Vs/mobile-history-final.png`. Human visual review remains deferred as authorized; the coordinator supplies independent final review.

Checked README, CONTEXT, workflow execution, architecture, continuation, prompts, version cleanup, current limits, agent usage and idempotent start guidance against the implementation and CLI help. The pending patch changeset describes the shipped behavior.

## MCP impact and review scope

One grouped `manage_run_version` tool exposes read, policy, preview and apply. Its 2,395-byte discovery entry earns its cost by keeping these related operations together; history defaults to 20 and caps at 100, without definitions or prompt/input bodies. HTTP and stdio expose identical contracts. Full discovery is 299,534 bytes, tool definitions are 299,524 bytes, and instructions are 9,697 bytes, within unchanged transport limits.

Reviewed the affected start, publication, capture, run inspection, briefing/change-wait, claims, result, retry, history and version-cleanup flow, including parameter defaults, revision/confirmation checks, retained state, returned fields and errors. Existing descriptions compacted to preserve the discovery bound include `manage_run_history`, `start_run`, `publish_workflow`, `list_work`, `retry_run`, `get_workflow`, `preview_version_deletion`, `delete_workflow_versions`, `get_run_result`, `get_run_briefing`, `report_usage`, `get_run_usage`, `claim_work`, `external_input` and `manage_work_hold`. Shared instructions and `get_run` guidance were aligned. Compaction retains capture and lifecycle rules, resource reconciliation, usage accounting and response bounds. This is a review of the affected flow and changed guidance, not an audit of every MCP tool.

No implementation gaps remain. The optional workflow-level policy default and child latest-dispatch alternative remain outside the selected design. Explicit moves require an execution boundary; policy updates can be made during work. Final independent review and the authorized combined UI review remain pending.
