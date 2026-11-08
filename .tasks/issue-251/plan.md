# Implementation and verification

See [spec](spec.md) for AC1–AC8 and [intent](intent.md) for scope and authorization.

1. Add core operational policy/settings/status contracts. Store revisioned settings per scope and one scheduler receipt separately from workflow definitions. Expose read/configure/status through server and existing grouped CLI/MCP history operations. Covers AC1, AC5.
2. Extend RunHistory with scheduled policy selection and complete-tree pooling. Reuse existing guarded preview/delete, preserve whole-tree grouping, and run after lifecycle observation. Persist deadline/result in the same outer transaction as deletion. Covers AC2–AC4, AC7.
3. Add Mantine settings controls for library and workflow scopes, with explicit enable/save, labeled bounds and reusable storage evidence. Covers AC6. UI work may be delegated with sole ownership of UI files. Representative journey: load disabled library settings, enable count threshold, save, reload, set workflow disabled override and return to inherited mode. Expect the displayed effective policy and status to match API results. Parent explicitly deferred human UI journey to the combined final pass.
4. Add meaningful temporary-store tests for default no-op, age/count pools and overrides, schedule/restart, protected detached/chain/uncertain/comparison/pending-event trees, rollback on injected write failure with complete protected state comparison, and reusable pages in a file-backed database. Extend existing HTTP and stdio history transport tests for discoverable settings/configure/status with valid and stale writes. Covers AC1–AC8.
5. Update history cleanup, v1, architecture and affected README/help/MCP guidance; add a patch changeset. Check existing affected flows for consistent limits and safe retained receipts. Run targeted tests, pnpm test, pnpm build, pnpm test:package and pnpm format:check. Covers AC8.
6. Fetch/rebase latest main, repeat affected verification if candidate changes, commit all intended work and report exact HEAD/base/evidence. Stop before claiming fresh final review. Independent parent reviewer owns final diff and targeted boundary review; delivery remains parent-controlled.

Highest risks: accidental deletion from an inherited default, count displacement by protected trees, loss of event or start receipts, stale policy saves, and partial cleanup after a storage exception. Direct tests must reach each boundary with a valid control and assert unchanged protected state on rejection. Physical file shrink is not a success criterion; free SQLite pages prove reclaim for reuse.


## Build evidence

AC6: The UI author exercised real controls against an explicitly temporary SQLite store and isolated backend/UI ports. Library count10 saved and survived reload. Workflow History opened Retention settings, saved Disabled then Inherit, and Escape restored trigger focus. Desktop and 390×844 layouts had no modal overflow, fields stacked and footer remained usable; browser console had zero errors. Screenshots: `/tmp/issue251-retention-workflow.png`, `/tmp/issue251-retention-mobile-inputs.png`. Preview servers and source files were removed. This is agent interaction evidence; the separately deferred combined human UI review is still pending.

Build found a safety gap in existing manual cleanup metadata guards: missing forward chain links and recorded child references needed explicit protection. The shared path now guards both; a direct valid-control test verifies retention preserves incomplete trees while removing an unrelated eligible tree. Pending schedule/webhook/lifecycle-handler outcome references and queued admission prerequisites are also checked by the shared deletion guard.


Initial implementation verification at `2c61ce779ff5b00cf012b2bca5123c9f69353bc3`: `pnpm test` passed 1842 tests in 160 files. Targeted retention tests cover report counts before/after deletion in addition to retained receipt, archive and quiescence boundaries. `pnpm build`, `pnpm test:package`, `pnpm format:check` and `git diff --check` passed. Logs are outside the candidate at `/tmp/issue-251-final-tests.log`, `/tmp/issue-251-final-retention.log`, `/tmp/issue-251-final-build.log`, `/tmp/issue-251-final-package.log`, `/tmp/issue-251-final-format.log`.

AC7 observed storage: allocated 2203648 bytes stayed constant; reusable pages grew from 0 to 2015232 bytes after deletion, then fell to 1003520 bytes after a 1 MB replacement payload without database growth. This proves reuse, not physical file shrinkage.

AC5/AC8 affected MCP review covered `manage_run_history` selection, parameter contracts/defaults/bounds, returned fields, authorization and lifecycle guidance, plus existing manual preview/delete and workflow deletion interactions. HTTP and stdio discovery each report 66 tools and a 4301-byte history definition, with no new tool. Settings/configure/status responses are bounded and contain no history payloads; on-demand preview remains the path to individual blockers. README, history-cleanup, v1, architecture, agent-workflows and CLI help were checked against implementation. This is an affected-flow audit, not an audit of all MCP tools. Inherited report/tag/default/hook follow-up documentation stays under parent ownership.


## Review revisions

- `2c61ce7-doc-scope`: Removed the stale automatic-retention exclusion from `docs/v1.md:28`; comparison-evidence cascading and automatic compaction remain excluded. The implemented-retention entry and cleanup guide retain the supported behavior.
- `2c61ce7-deadline`: Workflow deletion now removes its operational policy through `HistoryRetention`, clearing the persisted deadline only when no enabled library or workflow policy remains. File-backed regression tests cover immediate status, pump, restart and overdue ticks after deleting the last policy. Valid controls keep an enabled library policy or a different workflow override scheduled and demonstrate that its history is still cleaned.

Prior independent review at `2c61ce779ff5b00cf012b2bca5123c9f69353bc3` passed 1842 tests, build/package/format and the file-restart/resource/dependency-release probe at `/tmp/issue-251-review-boundary.ts` and `.log`. Those original evidence commits remain unchanged; the revision adds direct checks for the two findings.


Revision verification: targeted retention/history/HTTP+stdio tests passed 28 tests across 3 files, including all 18 retention tests. Full `pnpm test` passed 1845 tests across 160 files. `pnpm build`, `pnpm test:package`, `pnpm format:check` and `git diff --check` passed. Evidence: `/tmp/issue-251-r1-targeted.log`, `/tmp/issue-251-r1-tests.log`, `/tmp/issue-251-r1-build.log`, `/tmp/issue-251-r1-package.log`, `/tmp/issue-251-r1-format.log`. The runtime delta is limited to policy removal and deadline synchronization. Existing UI interaction evidence and affected MCP contract review remain applicable without changing their original evidence commit. Both stable finding IDs above are addressed for independent verification.
