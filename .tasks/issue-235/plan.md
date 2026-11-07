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

