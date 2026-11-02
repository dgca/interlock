# Additional review of PR #197

Reviewed the draft at `6a0ac9fb028ce015b402c26399ff4d3c2bb74b45` against base `3afdcba98cb143680dd1b466b1c2e7aa036d3510`, issue #71 and the accepted scope in this session. Independent standards and specification reviewers used read-only local probes. The parent reviewed integration behavior, fixed findings and added regression coverage. No real provider accounts or user databases were used.

## Standards

Two documented-standard findings, both resolved:

1. **P1, process cleanup.** `JsonLinesProcess.close()` cancelled SIGKILL escalation as soon as the leader exited. A child ignoring SIGTERM survived while the adapter could return success and release resources. Cleanup now owns the process group independently of leader lifetime, escalates termination and checks remaining members. Claude SDK custom spawning and Codex share it. Tests cover both an exited leader and one killed during cleanup.
2. **P2, restart usage attribution.** Startup recovery did not invalidate the cumulative baseline of an interrupted continuity session. A retry could be charged for the unknown interrupted turn. Recovery now invalidates matching session baselines, preserving unknown usage rather than attributing it to another attempt. A persisted-state regression verifies that no snapshot is assigned to the retry.

The standards reviewer rechecked both fixes. That recheck caught a new unread-stderr pipe in Claude custom spawning. It is fixed and verified with a native fixture that writes about 4.8 MiB of diagnostics before initialization. The reviewer confirmed resolution.

## Spec

Three specification findings, all resolved:

1. **P1, automatic replay after transport loss.** Every adapter exception previously consumed the ordinary retry budget and could repeat uncertain external effects. Unexpected errors now interrupt and hold the assignment for reconciliation. Explicit completed native failures and invalid results retain bounded failure handling.
2. **P1, subprocess lifetime.** The process cleanup finding also violated the required cancellation and ownership guarantees. The shared cleanup fix above addresses this independent specification finding.
3. **P2, captured configuration.** Admission checked the editable profile before resolving a pinned session or retry profile. Removing a capability from the current profile could block an existing captured session. Resolution now precedes capability checks. Resolved executable paths and default working directories also survive restart and retry.

The specification reviewer rechecked these fixes and reran focused regressions. All three findings were resolved, with no serious new issue found in those fixes.

## Additional integration checks

- Active managed records block external reclaim after lease expiry, including the interval before the observer notices. Permission responses also recheck claim validity before granting an action.
- Tests cover pending-question lease renewal, timeout, profile disablement, global concurrency, exact native session resumption and stale permission identities.
- Codex file approvals require captured paths and patches. Missing details, session-wide write grants and secret-input requests decline. Foreign thread/turn messages cannot supply the assignment's result.
- Native question choices are validated. Custom answers remain available when the harness supports them, including through the UI, with tests for exact request identity.
- Shutdown has a finite exit bound after uncertainty is persisted. Native diagnostics drain without being retained as arbitrary log content.
- Configuration controls avoid discarding open profile edits through an immediate enable toggle.

## Validation and limits

The full suite passed **100 files / 1,158 tests** after the review changes. A final native turn-identity guard received another focused adapter run. Build, installed-package smoke, formatting and diff checks are rerun before pushing. The package smoke exercises both native stand-ins through the installed bundle, plus CLI, HTTP/stdio MCP, scripts, restart and persistence.

Checked affected guidance in README, architecture, harness connection, current scope, model tiers, managed execution, context continuity, workflow execution, evaluation and testbench docs. MCP discovery and profile/dispatch/continuation/response flows are covered over HTTP and stdio; this is not a whole-tool-set audit.

This review does not establish real-account authentication, enterprise policy or subscription compatibility. Rendered desktop/mobile UI review and the Impeccable finish review remain pending. Keep the PR in draft until those release checks are addressed. Process-group cleanup is not an operating-system sandbox and cannot contain deliberately detached or privileged external processes.

## Subsequent scope decision

The user removed managed Agent runtime limits after this review. The draft runtime cutoff and settings control are gone; proposed workflow overrides were discarded before publication. Regression coverage now advances a pending assignment past the former 30-minute cutoff, verifies ongoing claim renewal, and verifies that retired timeoutMs fields in earlier draft configurations and continuity snapshots do not impose a limit. The original timeout-review observation above is historical.

## Model selection extension review

Native model discovery and workflow model overrides received separate correctness and standards reviews against commit 98447a6. Neither reviewer found an actionable regression. Tests cover cached and refreshed catalogs on disabled configurations without claims, unsaved paths, bounded results, timeout/shutdown cleanup, native discovery with no user prompt/turn, captured workflow overrides, retry pinning and resolved-model continuity. The full suite passed 101 files / 1,184 tests, followed by the focused picker tests after final label/focus refinements. HTTP and stdio each expose 51 tools / 293,810 bytes of definitions; catalogs remain on demand inside the existing grouped tool.

The installed local Codex catalog loaded in the rendered UI without starting a task. Claude is not installed on this machine, so its catalog checks used the native stand-in. Native approval/task runs against real provider accounts remain pending. The scoped Impeccable model-picker review returned ship with no material findings; node inspector and execution provenance received source review only. The documentation comparison is in model-selection-ui-review.md.

## Shared concurrency follow-up

The user consolidated concurrency into one revision-checked local setting, default 3 and range 1–8, above Harnesses configurations. Tests verify cross-harness sharing, capacity above the retired hidden four-job cap, graceful lowering, raising queued work, persistence, stale writes and changes during executable detection. Earlier draft profile limits are ignored. A UI regression verifies that conflict recovery disables editing during reload. The full suite passed 101 files / 1,188 tests; the four focused UI tests also passed after the final loading-label refinement. HTTP and stdio expose 51 tools / 294,384 bytes of definitions. The scoped Impeccable finish review returned ship with no material findings; see shared-concurrency-ui-review.md for visual coverage. Wider real-account task and run approval/recovery UI checks remain pending.
