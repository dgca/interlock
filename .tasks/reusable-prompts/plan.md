# Reusable prompts implementation plan

Behavior and acceptance criteria are defined in [spec.md](spec.md); scope and authorization are in [intent.md](intent.md). Spec review proceeds under existing authorization and the human decision S1. The task branch is `codex/reusable-prompts`; its baseline before planning is `46f765581b7e605e56052be2f6b74b74cb968630`.

## Verified repository facts

SQLite uses generic document collections, with compatible optional fields preferred over migrations. Runtime's `newRun` creates ordinary, detached, and Batch item runs; only Batch item runs receive `batchNodeId`. Agent assignments persist the node prompt and policy. Existing claim and explicit retry paths can reuse a persisted capture without reading the library again.

The server exposes tRPC, and HTTP MCP calls the same caller directly. The stdio MCP bridge maps those procedures in `packages/mcp/src/client.ts`. UI uses React Router, a shared App context, Mantine theme, and shared dirty-navigation protection. Agent settings live in `NodeInspector`. Workflow transfer currently uses format version 1 and validates imports transactionally.

## Implementation sequence

1. Add prompt contracts and pure composition in core. Keep `promptIds` optional on Agent definitions, and add optional captures to Run and WorkRequest. Validate distinct IDs at publication while allowing incomplete drafts. Add prompt records, revision history, usage lookup, revision-protected updates, guarded deletion, capture resolution, and reference diagnostics at the existing storage/runtime seams. No database rewrite is needed. Covers AC3, AC4, AC6, AC9.
2. Capture all Agent prompt references in the current workflow graph at each non-Batch run startup. Batch item runs inherit capture. Compose assignments from that persisted capture; retain capture on retry and restart. Keep compact projections unchanged. Covers AC3, AC4, AC5, AC9.
3. Add prompt procedures to the shared server and MCP client and tool registrations. Extend definition guidance, discovery and claim instructions, validation, and transfer descriptions together. Preserve CLI JSON paths. Covers AC6, AC8, AC9.
4. Extend portable bundles with optional prompt records, preserving existing prompt-free format-1 bundles. Detect missing dependencies and divergent shared content before completing the transactional import. Reject prompt-bearing exports on older readers rather than allowing them to strip references. Use a new bundle format version for prompt-bearing exports if the current reader would otherwise drop the data. Covers AC7, AC9.
5. Add Prompts routes, library and editor, using the shared theme and navigation protection. Feed saved prompts through App context to Agent settings, with ordered selection and content inspection. Extend assignment inspection with captured prompt identities and revisions. Covers AC1, AC2, AC5, AC6.
6. Update affected user and agent documentation, CLI help where transfer behavior is described, and a pending patch changeset. Finish with the checks below and commit intended changes for the workflow's independent review. Covers AC8, AC9.

## Verification

Use temporary or in-memory databases only. Add focused behavioral coverage for prompt updates, no-op and stale revision saves, retained history, reference errors and delete guards, composition order, published definitions remaining unchanged, startup capture across later steps and Batch items, separate child and detached captures, claim reclaim, retry, loops, and reopening a stored database. Map results to AC3 through AC6 and AC9.

Extend transfer tests for dependencies and children, shared IDs, empty-library import, idempotence, conflict rollback, missing prompts, and legacy bundles. Covers AC7 and AC9. Extend existing HTTP and stdio transport tests to discover prompt tools, exercise their revision and lifecycle contract, author references, and receive the composed captured assignment. Covers AC5, AC6, AC8.

Use existing UI tests for save protection, routes, and ordered Agent settings where they give meaningful regression coverage. Confirm missing references stay visible. Covers AC1, AC2, AC6. No new automation framework is required.

Run the relevant tests, `pnpm build`, `pnpm test:package`, and `pnpm format:check`. Run the complete test suite once to check the affected shared contracts. Repeat only checks affected by subsequent corrections.

## Representative UI journey

Start a separate preview engine with a temporary database and a free port, preserving the user's running engine. Through actual browser controls:

1. Open Prompts, create two named prompts, type Markdown content, save, search, and reopen. Expect persisted text and a clean editor. Edit text and attempt navigation, then keep editing and discard. Covers AC1.
2. Open a workflow's Agent settings, select both prompts, reorder them, inspect content, and change task instructions. Expect selected prompt order and task text to match the controls. Apply, save, reopen, and inspect Raw. Covers AC2.
3. Publish and run the workflow, inspect its assignment and captured revisions, then edit a shared prompt and start another run. Expect old and new runs to show their respective content. Try deleting the referenced prompt and expect dependent-workflow feedback. Covers AC3, AC5, AC6.

Record observed results, method, and evidence references here. Broaden the journey only for a concrete failure or uncovered required interaction.

## Risks and review

Avoid accidental reference stripping by old bundle readers. Preserve empty optional fields in older definitions and exact legacy prompt text. Keep shared prompt changes separate from immutable workflow definitions. UI refreshes must not overwrite dirty text or advance its save revision. Dependent prompt deletion considers every published version, matching workflow dependency guards.

The SDLC workflow requires fresh-context implementation review. Apply the code-review skill's independent review agents at the exact committed task head. Pass the run and assignment identifiers and artifact paths without inherited implementation history. Do not claim fresh context in this conversation. Finish locally after a passing review.

## Results

Implemented prompt contracts/composition in core, revision-preserving persistence in storage, management/capture in runtime, shared server and MCP procedures, portable format-2 prompt dependencies, library and ordered Agent settings, and run inspection. No database migration or package version bump; a pending root patch changeset records the feature.

### Observable checks

| Criteria | Method and result                                                                                                                                                                                                                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1      | `tests/prompt-editor.test.ts`: dirty refresh/stale save preserve text and original save revision; discard loads latest; clean refresh and successful save stay clean. `tests/prompts.test.ts`: name/content validation, no-op edits, revision history, database reopen. Browser creation/search/edit/save/discard/navigation journey below. Passed. |
| AC2      | Picker test covers search clearing after consecutive additions, selection order, and missing references. Runtime tests: exact composition, raw and stable-ID edits preserve ordered IDs. Browser removal/reorder/apply/save/Raw/reopen below. Passed.                                                                                               |
| AC3      | Runtime tests: an immutable published workflow's new run captures an edited prompt, existing run retains its capture. Browser starts two runs of v1 with rev1 then rev2. Passed.                                                                                                                                                                    |
| AC4      | Runtime tests: later steps, Batch items dispatched later, loop back edges, lease recovery/stale tokens, explicit retry, database reopen, and ordinary/detached child startup independence. Passed.                                                                                                                                                  |
| AC5      | Runtime and transport tests: full claims and savedPrompts carry composed capture; compact run/work projections omit new bodies. Browser run inspector and actual clipboard handoff below. Passed.                                                                                                                                                   |
| AC6      | Runtime tests: all published versions and drafts guard deletion; unused deletion retains history; missing references save but block publication/startup. Picker missing reference test and browser guard below. Passed.                                                                                                                             |
| AC7      | Transfer tests: dependencies/owned children/shared IDs, empty import, idempotence, divergent ID conflict rollback even force, missing prompt rollback, invalid graph rollback, legacy format 1 and old-reader protection via format 2. Passed.                                                                                                      |
| AC8      | Existing HTTP and stdio transport tests discover prompt tools, required revision/default description metadata, create/read/list/update/stale/delete, author/publish/start/claim/submit, new-run revisions, compact briefing, and export/import. Both passed.                                                                                        |
| AC9      | Full suite: 44 files / 522 tests passed. Legacy exact task text is asserted; existing context/contracts/script-language/transfer tests passed. After browser-driven UI fixes, 33 affected UI tests (4 prompt editor/picker, 9 routes, 20 Agent settings) passed.                                                                                    |

`pnpm build`, subsequent `pnpm typecheck`, `pnpm test:package`, `pnpm format:check`, and `git diff --check` passed. The build reports existing chunk-size guidance; tests emit existing SQLite/React lifecycle diagnostics. No failed checks or required verification gaps remain.

### Browser evidence

Method: CUA browser controls against a separately started built engine on port 4311 with `/tmp/interlock-prompts-ui-20261006.db`. The user's engine and database were preserved. All content entry used typing or native clipboard paste; ordering/removal/disclosures/navigation/publication/start used their actual controls.

1. AC1: Created Style guide and Review guide with Markdown, searched Style, reopened, typed an unsaved edit, attempted sidebar navigation, kept editing, discarded, and reopened. Expected text preservation/navigation guard and clean saved text; observed each. Edited Style and saved revision 2. Evidence: [editor](evidence/interlock-prompts-editor.jpg), plus stale/poll/save component regression tests.
2. AC2: Added Style then Review through search; moved Review up, removed Style, added it again, typed task instructions, opened content and combined preview, applied and saved, inspected Raw IDs `[9677b3ae-042e-4ef6-8ad7-6af3ffb140ab, 7a59ad24-ae8e-4a95-be4a-03706013d54a]`, and reopened visual settings. Expected order/content/task persistence; observed it. Evidence: [reopened Agent preview](evidence/interlock-prompts-agent-preview.jpg). Initial check found retained picker search; controlled search clears after selection, then this journey and regression test passed.
3. AC3/AC5: Published workflow `0044fa5b-070d-4b82-bbb6-a3f1c51a4bef` once as v1. Run `32b47278-5f0d-4b1f-8e57-98002142193a` displayed original Style rev1 and composed instructions. Edited Style, started run `a26c486d-3385-449b-bdcb-0cd1aec4ea8c` from the same v1, observed changed text and rev2, then reopened the first run and observed old text/rev1. Evidence: [original run after edit](evidence/interlock-prompts-original-run.jpg). Clicked Copy instructions for agent and read the actual clipboard: it routes discovery to the existing run and tells the executor to follow claimed prompt/input/context and isolated-session guidance.
4. AC6: Used-by listed Draft and v1. Delete confirmation and server rejection named Untitled workflow; content and references remained. Evidence: [delete guard](evidence/interlock-prompts-delete-guard.jpg). Initial toast was obscured by the modal; error now renders inside it, and repeated browser check plus component regression passed.

### Documentation and affected MCP audit

Checked README navigation, CONTEXT terminology, architecture/persistence/execution/projections, current limits, new Prompts guide, agent workflow transfer guidance, harness execution guidance, and CLI import help against implementation. The new guide's Agent JSON fields match nodeSchema. No separate prompt CLI group is introduced.

Checked MCP server instructions and shared definition guidance; all five prompt tool descriptions/schemas/defaults/results/errors; create/update/edit workflow schemas and reference guidance; validate/publish startup guards; export/import version and conflict semantics; start/retry capture rules; list_work summary/full and claim work context handoff; get_run full capture; continuation briefing projections. HTTP and stdio discovery/lifecycle tests and package smoke verify the affected flows. This is an affected-flow review, not a comprehensive audit of every unrelated MCP tool.

The repository has no `docs/agents/issue-tracker.md`; the authorized SDLC task's local spec is the originating review source, so no issue tracker setup is needed for this task.

### Implementation review revision

Independent full review of `4b433945b39155f6f9a77aa14a57ee50c4dbbda7` returned revise. It independently passed the full suite (44 files / 524 tests), build, package smoke, format and affected runtime/MCP/transfer checks. The two independent review axes found these actionable issues:

| Stable finding              | Resolution and verification                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4b433945-discard-baseline` | PromptEditor Discard chooses the newer saved baseline or refreshed prop, preventing stale props after successful save/failed refresh from restoring older text. Regression test saves revision 3 while props remain revision 2, edits again, and discards to revision 3. Existing newer-prop discard case still passes. AC1. |
| `4b433945-beforeunload`     | Extracted the existing browser unload warning into `useBeforeUnloadWarning` shared by PromptEditor and WorkflowEditor. Regression tests verify dirty prompt and raw workflow edits prevent unload; clean/discarded/unmounted editors release it. AC1/AC9.                                                                    |
| `4b433945-prompt-routes`    | Added `/prompts` and `/prompts/:promptId` to architecture's UI route inventory. Checked against actual router and path builders. AC8.                                                                                                                                                                                        |

An advisory projection-duplication heuristic was evaluated and left unchanged: the small field projections serve storage immutability, transfer conflict checks, edit comparison, and runtime no-op checks at separate module boundaries. No concrete behavior inconsistency or required standard violation was found.

Revision checks: `pnpm test tests/prompt-editor.test.ts tests/workflowEditor.test.ts tests/routes.test.ts` passed 52 tests (5 prompt, 38 workflow, 9 route). `pnpm build`, `pnpm test:package`, `pnpm format:check`, and `git diff --check` passed. Runtime and affected MCP code did not change, so the prior full suite/transport/package evidence remains applicable.

Repeated affected real browser interaction on the built temporary engine: typed unsaved prompt instructions using native input, attempted reload and observed the same dirty text/page retained; Discard restored saved revision 2, and a subsequent reload succeeded with a clean editor. The in-app browser did not expose native confirmation text through its dialog API; the event-handler tests verify that the standard beforeunload warning is requested. No visual warning-text claim is made. Prior creation/selection/publication/capture screenshots remain valid. This revision preserves accepted product decisions and the fixed baseline.

### Import lifecycle review revision

Focused review of `3355e2e684114921bf8ffaf0dd09b70c5a9d1a31` independently resolved all three prior findings. A further boundary check returned finding `3355e2e-import-revision-history`: export revision 1, edit to revision 2, delete the workflow and unused prompt, then import the old bundle. Import restored current revision 1, so the next edit collided with immutable historical revision 2.

Resolution: storage exposes a scalar `latestPromptRevision(id)` query over retained history; absent-current imports allocate `max(bundle revision, retained maximum + 1)`. Existing current content still conflicts or reuses its current revision as before. A truly new ID preserves the bundle revision. Old history is never replaced. This stays within edit/save, deletion, and portable current-content semantics; no restoration UI or product decision is added.

Regression coverage performs that lifecycle through Engine APIs and confirms imported revision 3, subsequent edit revision 4, unchanged historical revisions 1/2, repeated-import idempotence, initial import revision preservation, and rollback of the current/history restoration if later published-graph validation fails. The first new test incorrectly expected workflow deletion to retain its runs; the existing deletion contract removes them, so that unrelated assumption was removed. Capture immutability remains covered by the established capture tests.

`pnpm test tests/prompts.test.ts tests/transfer.test.ts tests/transport.test.ts tests/workflowDeletion.test.ts` passed 21 tests across four files. HTTP and stdio transport tests were repeated after updating the import tool description and passed. `pnpm build`, `pnpm test:package`, `pnpm format:check`, and `git diff --check` passed. New Prompts guide and architecture describe deleted-ID allocation; affected MCP import description agrees with shared API behavior. Prior UI checks and screenshots remain applicable because no UI changed. AC1, AC6, AC7, AC8 are verified by the new lifecycle test and retained checks.

### UI polish follow-up

The user requested a local UI pass after the completed SDLC feature run. Prompt library and usage navigation now reuse workflow card styles, including full-card links and focus treatment. The editor reuses the workflow toolbar with Back, save state, Discard, Save, and an actions menu. Instructions occupy the main column; name, description, and workflow usage occupy the side column. Guidance uses field descriptions, and creation/deletion use the shared modal. Selected prompts in Agent settings have bordered groups and guidance about ordering before task instructions. The sidebar remains Workflows, Runs, Prompts.

At narrower widths the form stacks name/description, instructions, then usage. A 600px browser check found shared toolbar CSS overriding its wrapped height; a more specific local selector fixes the spacing. No backend, capture, persistence, transfer, or MCP contract changed. The Prompts guide now identifies the Prompt actions menu for deletion; the remaining guide instructions, README navigation, architecture route list, and MCP management flow remain consistent.

Verification: 14 prompt-editor and route tests passed, including toolbar submission, stale-edit protection, unload warnings, deletion feedback, and picker ordering. `pnpm build`, `pnpm format:check`, and `git diff --check` passed. Browser checks on a separate temporary database covered creation, search/no-match recovery, full-card opening, toolbar save, dirty navigation protection, deletion dialog/cancel, usage cards, selected-prompt grouping, and 768px/600px layouts. The user's database was untouched. Screenshots: [editor](evidence/prompts-polished-editor.jpg) and [library](evidence/prompts-polished-library.jpg). This localized pass did not restart the completed SDLC run.

### Remove combined preview

After opening PR #89, the user removed the combined-instructions preview from the accepted scope. Agent settings retain ordered selection, individual content inspection, and missing-reference feedback. Runtime composition and captured assignment inspection remain unchanged. Updated intent D6, spec AC2, the Prompts guide, architecture, and the picker test to match. Earlier browser evidence records the original implementation before this scope change.
