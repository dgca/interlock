# Implementation plan

Authority: [spec.md](spec.md), original baseline in [intent.md](intent.md). The reviewed UI proposal is [ui/ui-design.md](ui/ui-design.md).

1. Add core schedule schemas, portable configuration, binding validation and cron calculations using cron-parser. Expose only kind schedule. Keep operational record revisions separate from workflow drafts.
2. Add indexed storage queries for triggers and pending/bounded fire history. Runtime Schedules owns CRUD, inspection, attention, failure observation, missed-slot selection and atomic fires. Integrate the existing engine pump and RunStarts transaction. Add internal run schedule provenance and a terminal-only schedule queue gate to RunAdmission, without changing public success-dependency semantics.
3. Add shared server read/manage endpoints, bounded grouped MCP read/manage tools and CLI schedule commands. Audit affected start, pause, export/import, run attention and workflow tools. Update HTTP and stdio transport discovery tests and CLI package coverage.
4. Implement the selected workflow Schedules tab, stable selection route and attention links using Mantine, Modal and JsonEditor. Preserve entered form on rejection/conflict and separate acknowledged mutation from refresh failure. Use shared server preview and inspection truth. Include schedule attention independently in runs and Sidebar items wording.
5. Add portable schedule configuration disabled on export and import, with identity conflicts guarded and old bundle compatibility.
6. Update required documentation, CLI help and a pending patch changeset. Retain representative UI prototype evidence, decisions and exact source provenance. Exclude caches, dependencies and build output.
7. Verify deterministic validation/cron/DST, normal/gap/paused timing, interval anchor, overlap skip/queue/allow with admission boundaries, failure pause/cancel/success, missing history, retention, restart, competing stores and rollback. Use fake clocks and isolated temporary databases only. Verify actual controls at 1440/900/390 and real save/rejected save/acknowledged-save-refresh-failure paths against isolated server. Distinguish fixture preview from runtime provenance.
8. Fetch/rebase latest main, run pnpm test, pnpm build, pnpm test:package and pnpm format:check; record commands, source commit and results. Commit intended code/tests/docs/artifacts. Submit build result with exact base/head and stable acceptance evidence. Stop when fresh Review change is available. Parent owns independent UI/final code review and later PR/CI/merge. A changed candidate requires new exact-head independent review. No release/publication.

Risks: timezone/DST semantics belong to the parser and deterministic tests. Nested scheduler starts must not recurse pump or dispatch outside their atomic transaction. Queue waits for terminal predecessors even on failure, unlike public after dependencies. Disabled imports must never preserve machine-local operation history. UI must not show fixtures as runtime truth.

Step 1 covers S1/S2/S5. Steps 2 and 5 cover S3-S9. Steps 3/6 cover S1/S9/S11. Step 4 covers S8/S10. Build owns deterministic tests and required repository checks. Independent review owns exact-head diff review and targeted boundary checks. Parent UI review owns fresh rendered assessment.

Representative real-control journey S1/S2/S10: open workflow Schedules, Add schedule, enter interval/name/literal JSON and binding, create disabled, inspect acknowledgement, enable the exact schedule, reopen and save a policy, inspect history/run link, disable and delete exact trigger. Expected: published-only enable, field errors retain edits, focus returns to inspection, phone selection focuses heading, mutation success remains acknowledged after injected refresh failure. A valid save/control precedes rejected-save and refresh-failure cases. S5 rollback test injects a failed trigger write after creating the run, compares complete trigger/run/receipt/fire state, then retries successfully. S3 queue test holds an active predecessor, accepts one queued successor, suppresses a third fire, and promotes successor after predecessor failure. S4 recovery test compares same fixture under skip/run_once, preserving a single bounded recovery attempt after multiple missed slots.

## Implemented checks and handoff

Required checks pass at source commit `4349fb5ec0f0993267371ef345e9fc27cddc8576`, rebased onto main `7b29dcae81403be62833d2caa2075c625abc894d`. The original task baseline remains `dcba6b6ff490d6a8d709a39233e56fddced3d944`; review can separate upstream #237/#238 changes with the rebased main comparison. The final artifact-only commit carries this source evidence without changing product files.

| Criteria | Build evidence and observed result |
| --- | --- |
| S1 | Shared API and MCP create/update/enable/disable/delete, packaged CLI create/inspect/cron preview/delete, real UI create disabled, enable exact ID, edit/reopen, disable/delete. All pass. |
| S2 | 25 schedule tests cover interval minimum, five-field grammar, invalid zone, metadata paths, literal templates and DST. Real controls rejected invalid JSON, cron and zone, then saved corrected values. Mantine clamps an interval below 30 seconds on blur; API tests establish rejection at the shared boundary. |
| S3 | Skip/queue/allow tests include queued capacity, one pending successor, failure-terminal promotion and continue-as-new chain overlap. All pass. |
| S4/S6 | Deterministic clocks cover multi-slot gaps, both missed policies, re-enable/timing reset, independent library/workflow holds, a hold covering a slot between ticks and a hold ending before the slot. All pass. Final correction uses persisted hold intervals, not whether a tick saw the hold active. |
| S5 | Full protected-state rollback after injected trigger write failure, file-backed reopen, competing Store connections and genuinely concurrent independent scheduler processes all retain one slot fire/run/RunStarts receipt. All pass. |
| S7 | Failed admission without any run row, terminal failures observed once, default no pause, success reset, neutral cancellation and automatic pause/re-enable all pass. Actual runtime fixtures show failure pause and pending admission lag independently of run rows. |
| S8 | Paging/200-settled retention, missing run history and independent attention counts pass. Actual UI shows two schedule alerts with zero run alerts, accessible “2 items need attention,” exact schedule links, a real run link and missing schedule list recovery. |
| S9 | Format-5 disabled exports/imports, forced disabled import, identity conflict and old bundle import all pass. Imported configuration has no fire history. |
| S10 | Actual controls at 1440/900/390 cover save/reopen, rejection retaining text, acknowledged save plus failed refresh, read-only retry, real second-page revision conflict and explicit reload, Back/Keep editing retention and narrow inspection focus. Fifteen runtime PNGs were opened and inspected; the original ten design fixture PNGs remain separately preserved. Impeccable detector returned no findings. |
| S11 | Full suite 128 files/1541 tests, pnpm build, installed package smoke and pnpm format:check all pass. HTTP and stdio transport discovery/operations pass. Checked README, CONTEXT, architecture, v1, agent workflows, schedules, variables, prompts, work holds, idempotent starts and history cleanup, CLI command/help and the affected MCP workflow. |

Evidence is in [checks/provenance.json](checks/provenance.json), the saved check logs, and [actual browser results](ui/runtime-evidence/browser-checks.json). Original check commits are retained. Carried UI evidence is explicit: later source changes affect the missing-schedule read, the schedule-only empty panel and persisted pause-slot classification, each separately checked. Fresh independent UI review is still required. No rendered human approval or physical screen-reader session is claimed.

The affected MCP audit covers read/manage triggers, start/admission, applicable pause inspection, workflow export/import and deletion, run inspection/history/attention and their shared schemas/defaults/errors. This is not an audit of every MCP tool. Two grouped tools keep configuration/history on demand. List responses omit input templates and bindings; inspect is explicit. Discovery is 59 tools, approximately 267.6 kB; server instructions are 9979 bytes. The tool-definition guard is 270 kB, raised from 260 kB to cover schedule contracts and portable bundle schema. Main's compact import/delete descriptions were retained during rebase, and redundant cross-tool guidance was removed to keep the existing 10 kB instruction bound.

The installed CLI dispatcher originally omitted the newly added schedule command. The package smoke test exposed that boundary; the dispatcher/help now accept schedules and the existing pause/resume/pause-holds commands, and package smoke exercises schedule CLI plus the bundled cron parser. A real create exposed an unsaved-navigation guard racing the acknowledged save; the success path now clears it synchronously before selecting the saved schedule. Failed writes retain their guard and edits.

## Fresh UI review recipe

Wait for the independent review's build to complete before capturing UI assets. From this checkout:

```sh
pnpm exec tsx .tasks/issue-236/ui/runtime-server.ts
```

The fixture starts production `packages/ui/dist` on loopback port 5197, creates its own temporary SQLite database and prints a selected schedule URL. `/tmp/issue236-ui-context.json` records the generated workflow, draft workflow and trigger IDs. It seeds one due slot, then executes the actual runtime. In another process:

```sh
pnpm exec tsx .tasks/issue-236/ui/runtime-states.ts
```

This adds real admission-failure/automatic-pause and capacity-queue/lag fixtures in that same isolated database, and writes their generated IDs to `/tmp/issue236-ui-states.json`. Inspect the printed normal schedule URL, the draft workflow's Schedules tab and `/runs?tab=attention`. Use the generated IDs for direct schedule links. Browser scripts under `ui/runtime-evidence` retain the exact original fixture URLs as evidence, not universal replay IDs. Do not point either fixture script at a user database. Stop only this fixture process and remove its printed temporary directory after review.

Author cleanup stopped browser `issue236-runtime` and its isolated server, then removed only its own temporary database directories. The handoff, original design prototype, representative images and proof remain committed for final human review. No shared engine configuration, schedules, pauses or user `.interlock` data changed.

Artifact staging check: `git check-ignore` found the selected task images were not ignored. Normal explicit staging is sufficient. No node_modules, dist, database, browser cache or generated vendor files are included.

## Revision after independent review 45758202

All seven stable findings have focused regressions and fixes in commit `f0090455a71df6bb7e23e3e3418bb28baeb77944`. The complete prior review, individual resolutions, red→green logs, current check provenance and actual-control evidence are in [revision-45758202](revision-45758202/resolution.md). Runtime chain lag, selected-set schedule merging, existing documentation contracts and all four UI recovery/refresh findings are covered. Five new 900×1000 PNGs were opened and inspected; successful actual controls use production build plus isolated runtime/API. This focused revision does not replace the earlier full review or claim human approval.

Current source includes `c6ae26b` for regression-test formatting only. Fresh required checks are recorded at that exact source commit; the final proof commit changes task artifacts only. Fetched/rebased main remains `7b29dcae81403be62833d2caa2075c625abc894d`. Author stopped the isolated server/browser and removed only its own generated database. Independent reviewer directory `ui-review-26628afe` remains untouched. Parent owns fresh exact-head code/UI review and subsequent PR, CI and merge.

## Revision after review 29474b8: UI236-R5

The latest isolated review resolves all seven preceding findings and identifies one new low-severity correction-copy defect. Its exact result is retained in `revision-29474b8/prior-review.json`. Source `b3067ea81b3ced6dc13f7e5721ed358505810874` changes shared validation messages only: interval bounds now state “Use an interval of at least 30 seconds.” and “Use an interval of at most 365 days.” The numeric acceptance limits, path association, UI layout, scheduler policies and MCP schemas are unchanged. Existing schedule docs correctly describe the same duration bounds; no contradictory command or guidance required an update. This does not add a changeset or version for an intermediate pre-shipping correction.

S2/S10: new meaningful shared-schema and form regressions first failed against the prior source, then passed (33 focused tests). The form test selects minutes, rejects Every=0.1 with the duration message associated with Every and zero writes, then saves Every=0.5 as 30000 ms. The schema test also covers the explicit 365-day maximum. Current Zod 3.25.76 primary docs, retrieved through Context7, confirm custom messages on number bounds: <https://github.com/colinhacks/zod/blob/v3.25.76/packages/docs/content/packages/v3.mdx>.

Actual controls at 390×844 against the completed production build and isolated fixture confirm the same message, field association, zero invalid mutation POSTs and exactly one acknowledged corrected save, read back as 30000 ms. The screenshot `revision-29474b8/interval-minimum-390.png` was opened and inspected. Script/log/provenance are retained there; this brief affected journey does not claim a new full UI assessment or human approval. Existing broader proofs remain attributed to their original reviewed commits because this revision changes only interval-bound copy.

S11: final pnpm build, pnpm test (129 files / 1550 tests), pnpm test:package and pnpm format:check pass at source b3067ea. Logs are in `revision-29474b8/checks/`. Main was fetched and rebased before these checks, remaining 7b29dcae. The following handoff commit contains task artifacts only. Browser revision236-r5 and its isolated server were stopped, and only their generated temporary database was removed. Prior reviewer directories remain untouched. Parent owns the next fresh independent exact-head review. No push, PR, merge or release was performed.
