# Implement start admission

Read [intent](intent.md) for scope and [spec](spec.md) for decisions and acceptance criteria.

## Verified repository facts

The original base is 8cf9813526f30274f853a597ed67977d259ed5e9. RunStarts.resolve already wraps receipt lookup and creation in one Store transaction. Engine.newRun captures prompts and variables for ordinary, nested, comparison, Batch, and chain paths. Pump advances active runs transactionally and launches native jobs afterward. ExecutorManager scans asynchronously and has per-item pause rechecks. Storage uses indexed JSON documents and append-only migrations. Run projections already reserve admission_queue as a waiting kind.

## Build sequence

1. AC1, AC2, AC4, AC5, AC8. Extend shared start/options and workflow schemas, admission metadata, status and projection contracts. Extend receipt identity. Keep public Engine argument positions stable.
2. AC2 through AC5, AC10. Add a focused runtime admission module for pinned dependency resolution, capacity evaluation, stable priority order, bounded blocker summaries, and promotion. Integrate it at creation and pump boundaries. Add transactional external-task policy handling with validated replacement creation before cancellation.
3. AC3, AC7, AC10. Include queued runs in storage active paths, comparison projections, deletion protections, cancellation, continuation counts, exports and inspection. Add an append-only migration for queued-index and active-comparison trigger behavior. Preserve Batch slot sharing and existing pause gates.
4. AC6. Add optional profile concurrency and enforce live global/profile caps across direct and delegated dispatch. Count pending launch jobs and recheck eligibility after awaits. Keep profile saturation from breaking the scan for other profiles.
5. AC7, AC8. Propagate options through shared API, CLI and MCP. Update workflow edit settings, UI status/cancel handling and existing profile form if needed. Use existing components. No additional UI automation framework.
6. AC9. Update required docs plus affected README, CLI help and agent instructions. Add a pending patch changeset. Keep source request and implementation evidence in this task directory.

## Highest-risk checks owned by build

- AC3, AC4. Concurrent starts at the shared API boundary have one admitted owner under a limit and each atomic policy produces the expected creation/cancellation behavior. A valid control start proves the path is reached.
- AC4. Inject storage failure after replacement allocation and compare complete protected run/receipt/budget/work state with its prior snapshot. Invalid replacement input must leave previous active work untouched.
- AC2, AC3. Queue promotion follows priority then insertion order, skips dependency-blocked work, respects stage exclusions, and resumes identically after file-backed Store restart.
- AC5. Missing keys resolve later. Failed, cancelled and removed dependencies remain blocked with explicit identities. Captured dependency IDs never drift to a later task attempt. Chain dependencies wait for the successor.
- AC6. Fake adapters and delayed delegated launch responses demonstrate global and profile caps, cross-profile progress and a cap/pause change during an awaited operation. No stale snapshot can dispatch a now-ineligible second assignment.
- AC7, AC10. Queued parents/children cancel safely, remain protected from history/version deletion, appear in Active views and briefings, and wake continuation waits on promotion. Existing background, pause, resource and detached tests run as regression coverage.
- AC8. Transport tests inspect HTTP and stdio discovery and perform queueing starts with shared bounds/defaults. CLI help and option forwarding get direct tests.
- AC7 UI. Start two copies of a limited workflow on an isolated temporary server, see the second queued with position, open it, cancel it through existing controls, and see cancelled history. Check a narrow viewport and rendered profile limit control if changed.

## Required checks

Build owns relevant deterministic tests, the full pnpm test suite, pnpm build, and pnpm format:check. CLI changes also require pnpm test:package after build. Use temporary databases and ports throughout. Fetch and rebase latest origin/main before final review, then rerun required checks against that candidate.

Independent review owns a fresh-context diff review and selected public-boundary/race verification against the exact reviewed commit. It must assess AC1 through AC10 using the code and recorded evidence, not accept a self-review claim.

## Handoff

Commit implementation and evidence on feat/issue-235. Submit the build result only after checks are complete. Stop when Review change is available, without claiming it, pushing, opening a PR, merging, or publishing. The parent coordinates independent review and eventual preparePr delivery with the repository PR template and Closes #235.

## Build evidence and integration

The original baseline remains `8cf9813526f30274f853a597ed67977d259ed5e9`. Before final review, the branch was rebased onto main `068f6aa`, which adds #234 managed recovery. Both recovery and admission settings survived the authoring/MCP conflicts. Combined recovery, managed execution, launcher, admission, and transport checks passed after integration. The original implementation commit before rebase was `299968a8283d5e474da9bfd532ae712ae191da1b`.

Proof files remain outside the checkout in `/tmp/interlock-235-evidence/`. Initial pre-rebase logs are exploratory evidence only. `focused-rebased.log` records 107 passing combined tests. `focused-final.log` records all-policy public start races and admission checks. `rollback-final.log` records 66 passing admission, start, and background Script checks after deferring native stop requests until task-replacement commit. The final required command logs are `tests-final.log`, `build-final.log`, `package-final.log`, and `format-final.log`. They are refreshed against the submitted head and associated with its full identity in `candidate.json`.

| Criteria | Observable build check |
| --- | --- |
| AC1, AC8 | workflowEdits tests set, clear, and reject invalid admission settings. Publication diff includes both new settings. |
| AC2, AC3 | runAdmission tests check no queued executions, priority/FIFO, stage exclusions, scoped wakeups, independent pause release, file-backed restart, Batch slot sharing, and queued invoked children. |
| AC4 | HTTP transport races cover allow/reuse/reject/cancel_previous. Injected receipt failure compares complete protected state. A native controller remains active on rollback and aborts after a successful replacement. Claimed resources remain uncertain after replacement. |
| AC5 | Request and task dependencies resolve, pin identities, skip blocked higher priority work, report failed/cancelled blockers, follow chain successors, and admit only after final success. |
| AC6 | Managed executor tests prove profile caps, cross-profile progress, live cap changes, captured history, and shared capacity. Custom launcher tests change limits and cancel captured work while an earlier response is pending. |
| AC7 | Queued-only workflow deletion rejects, cancellation permits cleanup, Active counts include queued runs, and parent waiting projects queued child admission. UI controls below cover inspection/cancellation. |
| AC8 | Both HTTP and stdio discover and execute admission inputs. CLI forwards negative priority, dependencies, task identity and policy. Discovery remains 57 tools and 259,694 bytes under the unchanged 260,000-byte limit after the #234 integration. |
| AC9, AC10 | Full tests include retained migration fixtures, JavaScript/legacy Bash pins, protected variable captures, pauses, resources, background recovery, detached workflows, chains and managed recovery. Package smoke covers installed startup, HTTP/stdio, restart and durable Scripts. |

The migration test upgrades schema 8 to 9 without rewriting run documents, backfills queued comparison roots, and reads the new queue index. Existing prior-release migration fixtures remain intact.

## UI controls and proof provenance

The UI ran on an isolated database at `/tmp/interlock-235-evidence/ui.db`, port 49035. The server and browser were stopped after verification. No shared server or user data changed.

On the initial build, actual controls opened a queued Active row, showed position 1 and capacity 1/1, cancelled it, and showed the cancelled row in History at 390 pixels. The exported queued run retained its admission metadata. Proof is `cancelled-history-mobile.png`, the downloaded run JSON, and timestamped Playwright snapshots. That first rendered header exposed a pending badge; it was corrected before the implementation commit.

Fresh rendered verification at source `dd03bc93be4af48135ae5a59280d10b7601dba97` confirmed the corrected queued badge/title at desktop and 390 pixels. Proof is `queued-run-final-desktop.png` and `queued-run-final-mobile.png`. On that same source, actual profile controls changed concurrency from 1 to 2, saved, reopened with 2, and retained keyboard focus/Tab behavior. Proof is `profile-cap-final-desktop.png`, `profile-cap-final-mobile.png`, and the 09:54Z Playwright snapshots. The custom-profile modal also accepted a cap at 390 pixels and was cancelled without saving; proof is `custom-profile-cap-mobile.png`. Later changes affect rollback, CLI help, formatting, and this evidence only, so these UI proofs still apply. The Impeccable detector returned an empty finding list in `impeccable.json`.

## Documentation and MCP impact

Checked and updated README, architecture, managed-executors, idempotent-run-starts, v1, agent-workflows, connect-harness, and CLI help against the final behavior. The start examples and CLI options are exercised through transport tests and `cli-help.json`.

Reviewed affected MCP authoring, start, lookup, inspection, continuation, claim/submission, cancellation/retry, executor, export/import, and cleanup flows. Shared schemas carry new workflow settings, profile concurrency, start options, queued status, and bounded waiting detail. No tools were added. Added discovery fields are required to configure and inspect admission; overlapping execution descriptions were shortened to retain the existing size ceiling. The pending patch changeset covers user-visible behavior only. This is an affected-flow review, not an audit of every unrelated MCP tool.

No build-owned requirement remains intentionally unverified. Native provider calls are excluded from routine checks, as required by repository guidance. Fresh independent review and PR delivery remain unclaimed work for the parent coordinator.


## Review revision 466a12c-F1

The independent full review at `466a12ceb4a41f78a2bebc1ec96fa7ac46b83464` verified the functional criteria and required checks, and found one P3 AC9 contradiction in managed-executors.md. The guide now states that stored profile `concurrency` values remain effective after upgrade and that clearing the field removes the cap. This matches parseProfileSnapshot, profileAtCapacity, and the existing stored-profile regression test. A focused search found no directly related duplicate claim. No runtime, schema, test, UI, CLI, or MCP behavior changed.

The original author manifest, full-review verdict and all earlier proof retain their original source identities. This docs-only revision reuses the 1,502-test/build/package evidence from reviewed commit `466a12ceb4a41f78a2bebc1ec96fa7ac46b83464`, with applicability established by the revision diff. Validation is a documentation/implementation comparison, targeted regression test, formatting, and diff checks. Revision-specific proof is stored separately at `/tmp/interlock-235-evidence/revision-466a12c-F1.json` and `revision-466a12c-F1-{test,format}.log`. The same SDLC run is resumed; fresh review remains unclaimed after the build result.
