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

## Harness settings polish

The user requested a design review and fixes for the whole local Harnesses settings screen. The refinement preserves the Mantine theme and every configuration field. It groups the shared limit controls, adds saved default summaries and execution-default hierarchy, clarifies working-directory and advanced capability labels, moves native version information beside executable configuration, and makes cancelling, saving and error recovery explicit. Open edits survive installation refresh; pending saves lock controls; cancelling returns keyboard focus to Configure. Tests verify all model/path/tool/skill/permission fields survive submission and cover stale reload, pending-save locking and lookup recovery. The full suite passed 101 files / 1,191 tests. Backend and MCP contracts are unchanged.

The independent Impeccable polish finish review returned ship with no material findings across the supplied desktop, tablet, mobile, add, saving and error captures. The comparison and scope limits are recorded in harness-settings-polish-ui-review.md. Existing mobile navigation remains outside this local refinement.

## Unlimited concurrency follow-up

The user approved explicit Limited/Unlimited choices and removal of the eight-assignment ceiling. Limited defaults to 3; positive numeric limits use JSON-safe whole numbers, and concurrency:null persists Unlimited. Tests exercise numeric 10 and Unlimited with 12 live stand-ins, returning to Limited without interruption, retained exclusive resources and capabilities, null across restart, UI selection and larger limits, and both MCP transports. The full suite passed 101 files / 1,194 tests. HTTP and stdio discovery remain 51 tools / 294,616 bytes, 232 bytes above the prior settings contract. No new tools or normal response catalogs were added.

The browser saved Unlimited, displayed the workflow summary, saved and reloaded 25, then restored Limited to 3 in the temporary preview. Six settled desktop/mobile captures received an independent Impeccable ship verdict with no required changes. See unlimited-concurrency-ui-review.md for scope and unobserved states. Native account/task validation for the wider draft remains pending.

## Assignment-mode dropdown refinement

After reviewing the radio controls, the user approved a compact native dropdown with Limit to and Unlimited options. The numeric field remains visible only for Limit to; narrow layouts put the dropdown above the number and Save action. Runtime, JSON/MCP contracts, default 3 and Unlimited null semantics are unchanged. All nine focused settings tests passed against the new select, including canonical null and larger numeric submissions, and the build passed. Four settled desktop/mobile captures cover both modes.

## Node models and thinking effort

The user approved concrete node model overrides and native thinking-effort choices with node → workflow → harness → native inheritance. Optional Agent model/effort and workflow agentEffort are portable; omission inherits and null effort selects native defaults. Existing advisory tiers are preserved and shown for connected Agents. Harness tools/skills controls are removed, while API declarations, requirement checks and stored values remain compatible.

Native discovery retains bounded model-specific effort levels and Codex's suggested default as metadata. Dispatch checks explicit effort before taking a new claim; unavailable support or incompatible choices remain blocked with a reason. No tier mapping, fallback model or thinking-token budget is introduced. Retry snapshots retain model/effort. Conflicting explicit overrides cannot silently change a pinned continuity group, including a workflow default inherited after an earlier node override. Previously captured sessions do not require a new catalog merely to continue.

The full suite passed 101 files / 1,214 tests. Regression coverage includes inheritance and source fields, native null resets, connected-agent opt-out, unsupported and unknown-model effort before claim, captured effort after failed attempts/profile edits, continuity conflicts, edit/unset contracts, native SDK/turn effort arguments, and HTTP/stdio authoring/inspection/briefing projections. After trimming repeated schema descriptions, HTTP and stdio each expose 51 tools / 299,077 bytes of discovery, 4,461 bytes above the preceding draft. Catalog effort metadata remains on demand and no tool is added. The final schema-description refinement passed both transport checks. Build, installed package smoke and formatting checks run before pushing. Tests use temporary stores and native stand-ins; real provider tasks remain untested.

Rendered browser checks cover desktop/mobile harness defaults, workflow defaults, node inheritance/overrides, unknown-model effort errors and native reset, plus connected Model tier and switching back without value loss. The installed Codex returned effort choices through model discovery without a task/turn. The local shared limit and harness defaults were preserved; only an unpublished scratch workflow was updated for review. The one scoped detector pass returned no findings. A fresh Impeccable finish reviewer returned ship with no required fixes for these settings; this does not certify the wider run approval/recovery UI or native-account execution. The documenter comparison is in model-effort-ui-review.md.

## Real Codex execution check

On 2026-11-02, at the user's request, the local branch server ran a published four-node workflow through the installed Codex CLI 0.166.0-alpha.5.1 with the existing account sign-in. This used the temporary test database, Read only workflow permissions, independent fresh sessions, no tools and one allowed attempt per Agent. Existing harness/global defaults were preserved.

- **Uppercase message** inherited workflow model gpt-6-luna and low effort. It completed on attempt one in about 2.9 seconds, returning the uppercase input.
- **Count words** overrode the model with gpt-6.1-sol and medium effort at the node. It completed on attempt one in about 6.8 seconds.
- The final accepted output was `{"message":"INTERLOCK WORKS","wordCount":2}`. Both managed records completed, reported the expected native model and setting sources, and recorded no tool activity or human requests. Codex usage reports independently identified both requested models. Configured effort was accepted by the real native protocol; the harness does not provide an independent measurement of an effective effort level.
- Usage reports contain 34,579 input tokens and 136 output tokens, including 89 reasoning output tokens. Billing cost remains unknown. These are native reported totals, including native context, not an estimate based on the short task prompt.

The retained test workflow is e90d9e10-761c-4f12-b4df-45d7b2a4bb68, version 1; completed run 46868be4-4772-46fa-86fc-d6f4e7d05a11, on the local port-4321 instance. The workflow and history remain available for the user to inspect. This is evidence for real text-only automatic dispatch, model/effort inheritance and overrides, result acceptance, and usage capture with this Codex installation. It does not validate Claude Code or real permission requests, cancellation/recovery, or session continuity.

## Native approval check follow-up

A real Codex approval test with fresh context exposed a prompt error: managed assignments received the connected-worker handoff instructions even though the host already created an independent session. The native Agent delegated again and the child returned a denial without attempting the command or opening a permission request. Changing only context.mode to current reached a genuine pending native command approval, isolating the cause. This initial fresh run is not counted as an approval pass.

A failing regression at assignmentPrompt now catches the connected-worker delegation text reaching managed work. Common resource/trial guidance is composed in agentInstructions for both paths; connected fresh claims keep their existing handoff text, while managed fresh prompts explicitly say the required isolated session already exists. Resource cleanup instructions remain present. The regression and full suite pass 102 files / 1,215 tests; build and installed-package smoke pass. Real fresh-context re-verification and stop/recovery checks resume after the user answers the pending native permission.

The user then clicked Allow once in the real run inspector for run e3d39fae-9e51-4978-be05-b405a742fdac. The exact native request was persisted as answered with allow:true, the approved marker appeared, and the run completed with {"approvedWrite":true,"marker":"INTERLOCK_APPROVAL_OK"}. The request survived roughly fourteen minutes of human wait with renewed claims. After loading the prompt fix, a fresh stop/recovery assignment reached its native command approval directly, with no delegation activity. That run is d009dd2a-5c17-4a8a-a7a8-c765422f2b46; actual stop and recovery are still pending the next human action.

## Completed native stop and recovery check

The user approved the fresh assignment's native command in the run inspector. The command wrote its process identity to a temporary marker and waited, making it possible to observe the native Codex process and its separate command process group before stopping them. Clicking Stop execution in the actual inspector terminated both processes and left no members of the test command's process group. The assignment stayed held on attempt one, its resource reservation remained uncertain, and no automatic retry occurred. The recovery checkbox was unchecked and Confirm stopped and retry was disabled until confirmation.

After verifying process termination, the test setup created a checkpoint marker so a retry could finish immediately. The user explicitly confirmed that the session and subprocesses had stopped and requested the retry. Attempt two started a new native session. Its approval remained pending when inspected, so the user's explicit approval was applied through the shared API only after checking that the request details exactly matched the previously approved command. This verifies the human decision and response path; the retry approval was not independently observed as a browser click.

Run d009dd2a-5c17-4a8a-a7a8-c765422f2b46 completed on attempt two with `{"recovered":true}`. The persisted hold ended with reason resumed, the resource reservation was released, and no pending requests or native Codex children remained. The original test process was still absent. This also reverified real fresh-context execution after the prompt fix: the native command ran directly without unnecessary delegation.

The requested real Codex checks now cover text-only execution, model/effort inheritance and overrides, Allow once approval, prolonged human waits, stopping a running command, retained uncertainty/resource ownership, explicit human recovery, a fresh retry session and successful completion. Real native continuity and Claude Code execution remain untested; continuity has automated coverage, and the user explicitly deferred Claude validation to Lucy after the next release. This check does not extend the earlier UI reviews to a comprehensive accessibility or responsive audit of run inspection.

Code validation at e96ab709f1803d4720aa5276640e4489f9885b65 passed 102 files / 1,215 tests, build, installed-package smoke, formatting and diff checks. GitHub CI also passed on that commit. All real checks used the temporary database and test directory; existing harness defaults and the user's shared assignment limit were preserved.
