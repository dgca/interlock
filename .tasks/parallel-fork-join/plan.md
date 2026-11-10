# Implement and verify Parallel groups

The [intent](intent.md) owns scope. The [approved specification](spec.md) owns observable behavior and AC1–AC16. The task branch starts at `92c789d1376e93e11c5d4e6998accd4085718dc5`. Use temporary databases and servers for all checks.

## Implementation sequence

1. Add a `parallel` definition node with ordered `branches: [{id, key}]` and concurrency. Members name their `parallelId` and `parallelBranchId`. Branch ports use `branch:<id>`, the group continues on `complete`, and returns target `join`. Separate the persisted branch ID from the editable result key. Share scope and edge helpers across publication, diagnostics, Raw, bindings, and editor connection checks. Keep existing Batch rules and support incomplete drafts. Use a structured error for invalid branch or edge locations. Make group removal and edit operations preserve or deliberately remove dependent members and edges. AC1, AC3–AC6, AC10, AC15.
2. Reuse the child-run scheduler and ordinary ancestry. Capture the group version, input, and branches on one parent execution. Dispatch branch runs from the pinned graph with invocation/branch identity and inherited captures. Count direct branch node starts against their owner's retained allowance in the same transaction as recording each execution. Keep ordinary descendants' separate step budgets. Dispatch and persist parent references atomically; collect with literal own-property keys. On failure, cancel ordinary unfinished branches, preserve successful results, and recover only through the failed group. Keep the branch version pinned and enforce existing pause, admission, resource, budget, and detached boundaries. AC2–AC9.
3. Extend the existing visual grouping and settings rather than introducing a new editor. Add branch key and concurrency fields, explicit per-branch Add step controls and start ports, and one Join return boundary. Use shared sizing, layout, selection, undo/redo, and contract components. In the inspector, select the group visit before showing branch status and navigating to its runs. Surface queued branch counts and bounded summaries through existing APIs. AC10–AC13.
4. Reject Parallel in fixture simulation's preflight. Update the existing MCP tools and CLI help where authors discover the new definition and lifecycle. Keep added discovery text short and use current bounded reads. Add a deterministic example, a patch changeset, and update the affected README, glossary, architecture, data/binding, execution, limits, and simulation docs. AC13–AC16.

## Builder checks

| Criteria | Direct check and expected result |
| --- | --- |
| AC1, AC3, AC4, AC6, AC15 | Publish a valid two-branch graph as control. Test missing starts, disconnected returns, invalid membership and ports, sibling bindings, internal cycles, duplicate keys and unsupported composition. Save incomplete drafts; publish rejects with context. Round-trip Raw, export/import and stable-ID edits. Verify null and special keys survive collection. |
| AC2, AC3, AC5, AC6 | Claim two distinct reviewer assignments before returning either; finish out of order. Check the joined object, branch-local source reads, captures, and no early continuation. Loop with new input and prove no previous result or provenance leaks. Exercise a conditional path that returns through only one of two valid edges. |
| AC7 | Exhaust shared allowance across two branches and a loop using deterministic work. Compare against a sufficient-budget control. Check blocked steps produce no operation or claim, restart retains accounting, and retry does not refund completed work. |
| AC8, AC9 | In a file-backed temporary DB, finish one branch, restart with work outstanding, then fail or cancel a sibling. Confirm queued dispatch stops, late revoked submissions reject, retry retains successful output and continues eligible branches only, and detached descendants remain independent. Compare branch/parent links after an injected dispatch write failure to detect orphan records. Exercise resource/claim uncertainty with a safe reconciliation control. |
| AC10–AC12 | Run the actual editor/inspector journey below. Use existing unit suites for canvas geometry, invalid drafts, graph navigation, and editor regressions; add focused coverage for the new failure modes. |
| AC13, AC14 | Run both transports with the same valid definition. Inspect discovery and the create/edit/validate/publish/start/work/briefing/result/retry lifecycle. Assert bounded metadata and literal output keys. Verify simulation rejection before fixture consumption with a supported-definition control. Check documented CLI examples against an isolated server. |
| AC15, AC16 | Run targeted Batch, failure routes, bindings, versions, admission, budgets, cancellation, persistence, layout, simulation, starter and transport tests. Run `pnpm build`, `pnpm format:check`, and the package smoke after build if CLI startup or packaging changes. Verify related docs and the pending patch changeset. |

### Browser journey

Open an isolated server in the browser. In a draft, add Parallel, name two branches, and check keyboard navigation through branch rows. Enter a duplicate key and confirm the field reports it; correct it. Add and connect one reviewer per branch using graph controls, save, reopen, and tidy. Publish, start with controlled test input, and observe both available branches. Complete one, inspect the other, then finish and verify the joined output. At a narrow width, inspect the settings and run detail for reachable actions and legible status. Capture actual controls and outcomes, plus criterion IDs AC10–AC12, in this plan. Use deterministic executor submissions only for run setup/results; do not substitute direct state injection for the editing journey.

## Independent review

Use a fresh session or subagent without inherited implementation history. Compare the complete candidate diff against the original base, the accepted artifacts, and repository standards. Inspect evidence for each criterion at the exact candidate commit. Independently probe one boundary such as retry after a retained-success restart with a tight remaining step budget, or a cross-branch connection that can be saved incomplete but cannot publish. Check affected HTTP and stdio guidance against the actual tool registrations. Use the workflow review contract and route any findings back to implementation.

Delivery checks that the reviewed candidate is still HEAD and the accepted artifacts are committed. Finish locally.

## Evidence

Implementation commit `02a370c9753d3724ce5aad99936b32e669904801`. The evidence commit adds this section only. Logs and browser artifacts are outside the worktree at `/tmp/interlock-parallel-fork-join-proof/`. Checks used temporary databases and deterministic assignments.

| Criteria | Observed result |
| --- | --- |
| AC1–AC6 | `tests/parallel.test.ts` published and ran two separately configured reviewers. Both assignments were available before either returned. Out-of-order results, null, and literal special keys joined correctly. The selected conditional edge returned once. A second visit received fresh input, identities, and provenance. Invalid scope, keys, cycles and missing starts rejected publication while drafts saved. |
| AC7–AC9 | The same suite exhausted the shared limit without additional work. It retained successful branches and accounting after file-backed restart, cancelled unfinished siblings, rejected stale results, blocked retry until revoked work was confirmed stopped, preserved detached descendants, and honored lifecycle budgets and admission. The injected parent-link write failure left no orphan run. The joined contract rejected invalid output without replaying successful branches on retry. |
| AC10–AC12 | `final-authoring.log` records the actual editor journey at the implementation commit. It checked Tab focus, add/remove focus, duplicate keys, a long key at 430px, both Join connections, cross-branch rejection, collapse/expand, tidy, save/reload, named publication preview, and run start. `final-undo.log` verifies group and member deletion with Undo/Redo. `elk-layout.log` verifies alternate layout preserves the publishable graph. |
| AC10–AC12 | `final-both-branches.yml`, `final-run-inspection.log`, and `final-joined-run.yml` show two available reviewers, a waiting parent after one result, the correct branch link and return to its parent visit, and both named outputs after completion. `final-narrow-settings.png` and `final-narrow-branches.png` show the affected narrow controls and status rows. `final-joined-output.json` records the expected JSON. |
| AC13 | `tests/parallelTransport.test.ts` exercised create, revision-protected edit, validate, publish, start, briefing, claim/submit, fail/retry and result on HTTP and stdio. Both discovered 66 tools and 298,195 B of definitions in the main transport test, below the existing 300,000 B cap. Kept validation's permissive candidate input so malformed drafts still receive diagnostics. Reviewed the affected authoring, execution, inspection, retry, version and simulation guidance. |
| AC14–AC16 | The Parallel simulation fixture rejected before creating live work, and supported simulations retained their existing coverage. `cli-example.log` shows the documented import, publish, start and run example returned `{"count":2,"hasTests":true}`. Export preserved branch IDs and keys, dry-run import accepted it, and the all-nodes demo imported and published without executing. Checked the README, related execution/binding/limit docs, CLI help, and pending patch changeset. |

- `pnpm test --maxWorkers=4`: 186 files and 2,176 tests passed. See `full-tests.log`.
- `pnpm build`, `pnpm format:check`, and `pnpm test:package`: passed. See `build.log`, `format.log`, and `package.log`.
- `pnpm site:build`: passed. See `site.log`, including 585 checked local references.
- The browser scenario uses deterministic test results and demonstrates eligibility and joining. It does not measure model latency or provider capacity.

## Review revision

Revision commit `ff42deedc0cf278234f67304f45fac5382aa9f54`. The previous review covered `fc39f58ca322a5e80404f142fde44a904d18edb1`.

| Finding | Correction and proof |
| --- | --- |
| `fc39f58-admission` (AC8) | Treat Parallel branches like Batch items in run admission and dependency lookup. The original `stage-capacity-before.log` shows the excluded Review stage still yielded `Workflow capacity 2/1`. The regression admits a second root with both first-run branches active. The ordinary capacity and lifecycle budget control still passes. |
| `fc39f58-literal-contract` (AC3, AC9) | Use the existing own-property validator for Parallel group contracts. Publication rejects the unsafe `properties.__proto__` declaration with `patternProperties` guidance. The regression publishes the supported pattern, rejects a numeric branch result without forwarding it, and completes with a string under the literal key. External input validation and version preview tests passed. |
| `fc39f58-docs` (AC16) | The guide uses **Add node**, matching the saved editor evidence, and documents the literal key pattern. The README says Join returns results after every branch succeeds. The documentation build checked 585 local links and assets. |

`revision-tests.log` records 76 passing tests in eight files: Parallel, both Parallel transports, admission, external input, versioning and its transports, run start transports, and general transport discovery. The general transport tests retained 66 tools and 298,195 B of definitions on HTTP and stdio. `revision-build.log`, `revision-format.log`, and `revision-site.log` passed. Proof files are in the directory above.

The browser journey, CLI example, package smoke, and full suite evidence remain at `02a370c9753d3724ce5aad99936b32e669904801`. The revision did not change the UI, CLI, package layout, or MCP definitions. The new runtime behavior is exercised by the revision tests; the retained checks establish the original authoring journey, packaging, and broader compatibility at their recorded commit.

## Authoring transport revision

Revision commit `37a398c74611e0f4021fb89260cc21c7740bced6` follows the focused review of `c4b21d5c73b22580c8b4789a4023b4532fadc446`.

| Finding | Correction and proof |
| --- | --- |
| `fc39f58-literal-contract` (AC3, AC4, AC13) | Validate authoring JSON without substituting the parsed copy, which omitted nested literal keys. MCP, shared validation, atomic edits, and import preview preserve the supplied JSON for downstream checks. The independent `review-atomic-contract-probe.log` shows the former behavior on HTTP and stdio. The transport regression now preserves the invalid draft for editing, reports actionable diagnostics for candidate and stored draft, and blocks publication on both transports. Replacing the declaration with `patternProperties` allows publication and retains the literal key in the actual joined output. |
| `c4b21d5-admission-docs` (AC8, AC16) | The start-admission reference and architecture explain that Parallel branches share their parent's admission. Checked against the excluded-stage test and the earlier review's separate dependency probe. Related usage docs describe branch ancestry, input, captures, holds and shared steps. |
| `c4b21d5-spec-control-label` (AC10, AC16) | The approved UI proposal now names **Add node** for the existing toolbar action, matching the editor and the browser evidence. The behavior and approval stay the same. |

`revision2-targeted.log` records 71 passing tests across Parallel transports, shared validation transport, atomic editing, and general discovery. Both transports retained 66 tools and advertised 297,761 B of definitions. Editing and preflight still accept candidate JSON for diagnostics; no new MCP tools or response fields were added. `revision2-build.log`, `revision2-format-final.log`, `revision2-package.log`, and `revision2-site-final.log` passed, including 585 checked local references and bundled HTTP and stdio smoke coverage. The real browser and CLI example evidence remains at `02a370c9753d3724ce5aad99936b32e669904801`; the revision does not change the editor controls, inspector or CLI commands.

`pnpm test --maxWorkers=4` passed all 186 files and 2,178 tests. See `revision2-full-tests.log`. This repeated the broader checks because the fix touches the shared authoring path.

## Retry between steps

Revision commit `2333412ae7ae598858531c095bdbed482878746e` addresses `fd4820e-retry-after-completed-workflow` (AC7–AC9). The previous full review covered `fd4820eecab6b87b8bf123a0c79e095156280a0e` and verified the earlier authoring and admission findings were resolved.

A transient sibling assignment write failure cancels an unfinished branch in the same pass, after that branch has dispatched detached work and before its follow-up Agent starts. The regression first failed because retry produced no follow-up assignment (`revision3-regression-before.log`). With the fix it starts the next Agent with the exact forwarded run reference, retains the completed execution unchanged and the original detached run still waiting, and joins after the follow-up and sibling finish. The group charges four actual branch step starts. See `revision3-regression-after.log` and `revision3-repro-after.log` for the regression and the review probe.

Build, formatting and packaged CLI/UI/HTTP/stdio smoke passed (`revision3-build.log`, `revision3-format.log`, and `revision3-package.log`). Browser controls, CLI commands, MCP definitions, and docs did not change in this revision; their evidence retains the original commits recorded above.

The full suite passed all 186 files and 2,179 tests (`revision3-full-tests.log`), including ordinary Workflow, Batch, failure routes, cancellation, background Script retry, versioning, and Parallel on HTTP and stdio. Both transports still advertised 66 tools and 297,761 B of definitions.
