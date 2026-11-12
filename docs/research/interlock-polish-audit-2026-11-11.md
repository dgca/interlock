# Interlock cleanup and UI audit

November 11, 2026 · Audit of `main` at `3e0964ac050c684dd4784beaac4d7dfef31ef37c`

Interlock needs a consolidation pass. The existing package split, Mantine theme, shared controls, and contract editors are worth keeping. The largest problems are inconsistent editor behavior, expensive reads that grow with unrelated history, and feature-specific implementations that bypass patterns already present elsewhere.

I would fix lost edits and run inspection first. Then standardize the lifecycle of forms and collection navigation. Refactor the runtime in small sections while pruning completed task artifacts and superseded documentation. A framework replacement or broad rewrite would add risk without addressing the observed problems.

This report distinguishes reproduced defects, source-confirmed gaps, and design proposals. High priority means address in the first cleanup batch; medium means a planned follow-up with a clear acceptance test; low means opportunistic cleanup. Priority is not a claim that every item blocks release. Effort is relative: small is a focused change, medium crosses several modules, and large needs multiple independently reviewable changes.

## Prioritized backlog

| ID  | Priority | Recommendation                                                                 | Evidence                                              | Effort              |
| --- | -------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------- |
| H1  | High     | Preserve drafts and guard every way of leaving an editor                       | Lost Board and new-prompt edits reproduced            | Medium              |
| H2  | High     | Scope run inspection to the selected run and its relevant tree                 | Source trace and isolated benchmark                   | Medium              |
| M1  | Medium   | Separate page readiness from sidebar counters                                  | Confirmed dependency in App                           | Small–medium        |
| M2  | Medium   | Finish the query-cache migration and stop refreshing full libraries everywhere | Confirmed overlapping refresh paths                   | Medium              |
| M3  | Medium   | Page board candidates before projecting all their state                        | Confirmed query shape; scale impact needs measurement | Medium              |
| M4  | Medium   | Standardize creation, save, discard, and conflict recovery                     | Browser comparison and source review                  | Medium              |
| M5  | Medium   | Make run navigation and attention actions predictable                          | Browser reproduction and source review                | Medium              |
| M6  | Medium   | Restore semantic relationships in shared lists                                 | Confirmed markup gap                                  | Medium              |
| M7  | Medium   | Complete shared collection states and operator-focused layouts                 | Rendered review; design proposal                      | Medium              |
| M8  | Medium   | Extract workflow authoring and inspection from Engine                          | Responsibility analysis                               | Large, staged       |
| M9  | Medium   | Separate executor configuration from supervision                               | Dependency analysis                                   | Large, staged       |
| M10 | Medium   | Enforce package directions and simplify core imports                           | Confirmed private imports and cycles                  | Medium              |
| M11 | Medium   | Reconcile obsolete docs and remove completed tracked task artifacts            | Source contradictions and tracked-file inventory      | Small–medium        |
| L1  | Low      | Prune stale global CSS and normalize readable text roles                       | Source candidates and detector advisories             | Small               |
| L2  | Low      | Consolidate the large-query transport allowlist                                | Identical policy maintained twice                     | Small               |
| L3  | Low      | Measure bundle loading before replacing dependencies                           | Build output; no dependency proven unused             | Small investigation |

## High priority findings

### H1 Preserve drafts and guard every way of leaving an editor

Board settings keep the name, columns, and workflow selection in local state without registering dirty or pending state with the app. They also omit the browser-unload warning. I entered a board name, followed the Prompts sidebar link, and returned with browser Back. The field was empty and no warning appeared. The existing Cancel link also remains enabled during save; the eventual save completion can navigate after the user has left. That pending-save race is source-confirmed, not browser-reproduced. [Board settings](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/boards/BoardSettings.tsx#L55), [app navigation guard](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/App.tsx#L116).

New prompt has the same practical risk through a different path. I entered a name and instructions, pressed Escape, and reopened the dialog. All fields were empty. Custom integration configuration also has an unconditional close path despite holding command, environment, and hook fields. Agent presets already implement dirty-dismiss confirmation, and the existing prompt editor guards navigation. The inconsistency is avoidable. [New prompt close](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/prompts/Prompts.tsx#L180), [custom integration state](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/executors/CustomProfileDialog.tsx#L43), [preset dismissal](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/executors/AgentPresets.tsx#L129).

Implement one small editor lifecycle module for dirty state, pending writes, deliberate discard, and navigation registration. Use the existing modal and leave guard. Keep persistence and domain validation in each feature. Protect Escape, X, Cancel, sidebar navigation, Back, and reload consistently; do not add confirmation when nothing changed. A pending write must not silently redirect the user later.

Acceptance: run the same lifecycle checks against Board settings, new prompt, custom integration, and presets. Failed writes retain input; successful writes clear dirty state; intentional discard works once; pending writes cannot produce surprise navigation. Check workflow node settings and nested contract editors against the same rule without conflating Apply with Save.

### H2 Scope run inspection to the selected run

`Engine.inspect` reads all retained runs, discovers descendants in JavaScript, reads all work twice, and reads all runs again for immediate children. `Store.events(runId)` parses the entire event collection before filtering. The UI calls this operation through `runs.get`, so unrelated historical payloads affect opening and refreshing one run. The work is synchronous and occupies the server while it executes. [Inspection](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/runtime/src/index.ts#L1752), [event retrieval](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/storage/src/index.ts#L851), [UI query](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/runs/RunInspector.tsx#L144).

An isolated in-memory benchmark inspected the same completed Entry → Exit run twelve times. The middle sorted sample rose from **0.42 ms to 273.67 ms** after adding 2,000 unrelated completed runs and events. Each added run had 16 KiB input and 16 KiB output. No unrelated work items or descendants were needed to expose the problem. A second run measured 0.40 ms and 268.63 ms. These are synthetic local timings, not a production latency promise.

First preserve the response contract while restricting storage queries to relevant IDs and metadata. Then let the UI load selected step payloads and event pages on demand. Reuse the existing indexed, page-first run summary and bounded continuation/result patterns. Do not require an inspector redesign before eliminating the unrestricted reads. [Existing summary query](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/storage/src/runSummaries.ts#L52).

Acceptance: inspection must not parse unrelated run, work, or event payloads. Preserve detached descendants, old Batch parent lookup, historical definitions, holds, and external callers. Test retrieval scope with substantial unrelated history; keep timing benchmarks separate from fragile CI time limits.

## Medium priority findings

### M1 Separate page readiness from sidebar counters

App combines workflow, prompt, request-attention, and trigger-attention queries into one `loaded` flag and error group. Workflow and prompt routes, plus Automations, wait for that flag. An unrelated counter failure can therefore prevent a valid page from opening on first load. Boards use different readiness rules. [Combined readiness](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/App.tsx#L76), [route gates](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/routes/index.tsx#L182).

Make each route depend on the data it needs. Sidebar counters should report stale or unknown independently, without turning failed counts into zero. Verify that a failed `requests.list` or `triggers.attention` request leaves workflow details usable and exposes a local retry.

### M2 Give refresh behavior one owner

App keeps full workflow and prompt collections active across routes. Engine events invalidate query-cache reads and also advance a legacy tick; several features still call `useRefreshOnTick`. Both systems contain logic for events arriving during a pending read. Some mutation paths refresh globally and then trigger another read through the tick. This increases request work and leaves refresh correctness in two places. [App queries and refresh](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/App.tsx#L76), [both refresh mechanisms](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/lib/query.tsx#L89), [full workflow list](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/server/src/router.ts#L518).

Complete the query-cache migration, define when the tick bridge can be deleted, and move selectors to bounded summaries. Fetch full graph and prompt content where it is needed. Measure requests and response bytes before choosing more selective invalidation. Preserve the pending-read regression tests and literal `__proto__` protections; those solve real contracts.

Acceptance: one event during an in-flight read still produces fresh data, unrelated screens do not fetch full libraries unnecessarily, and failed refreshes retain the correct cached page.

### M3 Make board pagination reduce server work

Board reads fetch all candidates, sort and count in JavaScript, then apply per-column offsets and limits. The terminal cap also applies after candidate retrieval. The SQL has already assembled ancestry, lifecycle, and event placement. A small response does not imply a small read. This is a verified implementation risk, not a measured board latency defect. [Board runtime](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/runtime/src/workflowBoards.ts#L169), [candidate query](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/storage/src/workflowBoards.ts#L38).

Measure query plans with many active runs and large event histories. Move ranking, counts, and page selection into storage before projecting cards. Add persisted column state only if indexed queries cannot meet the need. Preserve attention-first order, per-column totals, terminal windows, continuation chains, and detached lifecycles.

### M4 Standardize editor actions and conflict recovery

Creation currently means several different things. New workflow immediately persists an untitled draft and opens the editor. New prompt opens a modal, then a separate editor after creation. Boards, Variables, and Automations use routes; presets use a modal for both create and edit. The difference should follow task size and context rather than whichever pattern an agent last copied.

| Flow               | Current behavior                                             | Recommended contract                                                       |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Workflow           | Immediate draft; node Apply; workflow Save; Review & publish | Preserve the distinct stages and make the saved state explicit             |
| Prompt             | Modal creation, route editing                                | Reuse the route editor for long-form creation and editing                  |
| Board              | Route form, bottom Save/Cancel, no guard                     | Header actions, shared lifecycle, visible save status                      |
| Automation         | Route editor, header Save/Cancel, preview                    | Keep this structure; align discard and conflict language                   |
| Variable           | Route editor, header Save/Discard                            | Reuse lifecycle while preserving write-only secret handling                |
| Agent preset       | Modal with dirty confirmation                                | Keep while compact; apply the same dismissal contract elsewhere            |
| Custom integration | Long modal, unconditional close                              | Guard immediately; use a route if advanced configuration remains extensive |

For page editors, standardize Back plus primary Save/Create in the header. Use Discard for abandoning edits and Cancel for abandoning a short creation task. Reserve Apply changes for changes staged into a parent draft. Keep contextual dialog actions in their footer. This does not require one generic form builder. [Existing UI patterns](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/docs/ui-patterns.md), [Board form actions](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/boards/BoardSettings.tsx#L233).

Board settings also capture the expected revision once but offer only an error when a concurrent save makes it stale. A refetch does not reset the local initializers. Add guarded “Load latest” recovery that preserves the current draft until the user discards it. Test two-tab edits. Keep compare-and-swap protection. [Revision capture and submission](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/boards/BoardSettings.tsx#L64).

### M5 Make run navigation and attention actions predictable

A Runs row changes destination depending on current state: it opens a human request, an attention execution, or the run. I clicked a row in Active and landed on the human review page. This is a useful shortcut, but the row gives no explicit action label explaining the destination change. [Row navigation](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/runs/RunList.tsx#L252).

Make the run title a stable link to the inspector and expose a separate Review request or Resolve action. Use the same action wording on board cards, Runs, and the inspector. Prefer links for navigation so opening a new tab works naturally. Preserve scoped return navigation.

The same human review currently appears as “Human input” in the graph, “External input” in the selected-step heading and timeline, and “Person needed” in the attention strip. Centralize the human-facing label using both node kind and human-input configuration. Keep the underlying External input contract unchanged. [Inspector labels](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/runs/RunInspector.tsx#L507), [graph label](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/workflows/FlowNode.tsx#L480).

Rename the Runs header “History” menu to “History settings” or put its retention/cleanup actions in an overflow menu. It currently competes with the History tab while doing something different. In the inspector, group secondary actions such as export and version launch; keep the current required action prominent. Preserve the explicit scope distinction between Cancel run and Cancel run tree. [History menu](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/runs/RunList.tsx#L153).

### M6 Give shared lists semantic structure

`ListTable` renders column headings as spans inside a div and rows as divs, links, or buttons. Native row activation is useful, but the visual columns have no programmatic header relationships. Prompts, runs, automations, presets, and variables inherit this gap. [Shared list implementation](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/components/ListTable/ListTable.tsx#L29).

Use a semantic table for tabular data, with ordinary links and actions inside cells. Use a semantic list for independent items. Avoid introducing an ARIA grid unless cell-level keyboard interaction is required. Verify column announcements with a screen reader and retain responsive layouts. This follows the requirement to preserve relationships conveyed visually; a full accessibility conformance audit was not performed. [W3C information and relationships](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html).

### M7 Complete the shared collection states and improve task hierarchy

Boards use a small loader and plain empty text where other libraries use matched skeletons and actionable empty states. A failed search has no Clear search action. The board list also repeats an Open board button on every row instead of linking the resource name. Reuse the existing states and decide one collection-navigation rule. Keep the board's column layout; it serves a different purpose from its library list. [Board library](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/boards/Boards.tsx#L93).

The rendered UI is visually coherent at the control level. The remaining opportunity is hierarchy and density:

| View or shared component        | Proposed improvement                                                                                  | Benefit                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Run inspector                   | Put the required response beside its explanation; group low-frequency header actions                  | Less scanning before acting              |
| Run inspector on narrow windows | Prioritize the active request; collapse secondary details and reduce the header action rows           | The main task appears sooner             |
| Workflow editor                 | De-emphasize Pause for a new unpublished draft; keep Save/Publish/Run progression legible             | Less competition among unrelated actions |
| Graph nodes                     | Avoid repeating an identical type and label; retain useful stage, contract, and execution information | Less text without losing meaning         |
| Lists and board library         | Named primary links, separate secondary actions, consistent empty/error/loading states                | Predictable opening and recovery         |
| Error and conflict feedback     | Shared inline error plus retry/reload actions, without losing typed values                            | Recoverable failures across features     |
| Form composition                | Shared form container and action layout using existing spacing tokens                                 | Fewer local padding and footer rules     |

At 390 px, the inspected run page had no document-level horizontal overflow and retained navigation. However, navigation and header actions occupied much of the first viewport before the response. Treat this as a hierarchy improvement, not a claim that mobile is completely broken. Desktop remains the main operating context.

Unavailable harnesses also need an explicit policy. Normal workflow and node selectors already filter new choices to usable harnesses while preserving saved values. Preset configuration intentionally lists disabled/unavailable choices. Keep offline configuration possible, but explain that those choices will be skipped at execution. Share availability labels and reasons without forcing both contexts to use the same filter. [Workflow selector](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/executors/ExecutorSelect.tsx#L85), [preset choices](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/executors/AgentPresets.tsx#L575).

### M8 Extract workflow authoring and inspection from Engine

Engine owns authoring, graph edits, layout, publication, run creation, advancement, claims, retry, cancellation, and inspection. Its size matters because changes must account for several different lifecycles. Extract a cohesive authoring module for create/edit/validate/publish, including their transaction rules. Move inspection into a read module while fixing H2. Keep scheduler and claim transitions together until a specific seam justifies separating them. [Authoring entry points](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/runtime/src/index.ts#L760).

Keep shared server operations compatible during the move. Existing stale-revision, draft/publication, ownership, cascade publication, and import tests should exercise the extracted behavior through the same public operations. Do not replace Engine with dozens of pass-through services or a dependency container.

### M9 Separate executor configuration from supervision

ExecutorManager receives the entire Engine and uses its store, claims, holds, pauses, usage, stalls, and context groups. It also owns profile configuration, discovery caches, native and launcher sessions, recovery, and operator requests. Separate profile/catalog management from execution supervision, then give supervision a smaller internal interface to the runtime operations it actually needs. [Manager dependency](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/runtime/src/executors/manager.ts#L197), [profile methods](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/runtime/src/executors/manager.ts#L283).

Keep the native protocol adapters. Preserve integration coverage for permissions, restart, uncertain ownership, delivery receipts, retry pauses, and claim races. Judge the refactor by how much less a supervision change must know, not how many new files it produces.

### M10 Enforce package directions and simplify core imports

Cross-package relative imports reach into private `core/src` and `runtime/src` files. Core's barrel also defines foundational contracts while re-exporting modules that import those values back from the barrel. This obscures dependency direction. The successful build means these cycles are not evidence of a current initialization failure. [Server private imports](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/server/src/router.ts#L106), [core entry point](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/core/src/index.ts#L1), [import back through the barrel](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/core/src/runStarts.ts#L2).

Move foundational JSON/error contracts into a leaf module. Use direct internal imports and make the barrel an export entry point. Declare a few intentional package subpaths where needed. Extend the existing UI boundary-test approach to package directions. Verify fresh-process imports, contracts, build, and installed HTTP/stdio MCP behavior. [Existing boundary test](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/tests/designSystemBoundary.test.ts#L12).

### M11 Remove stale guidance and completed tracked task artifacts

Cleanup follow-up, November 11: the documentation cleanup removes all 431 task artifacts from Git tracking while preserving every local task file. It retires the two proposals below, keeps deferred ownership constraints in [current limits](../v1.md), and archives five superseded research notes outside the repository. Original comparison evidence remains intact. The findings and counts below describe the audited commit.

The child-workflow proposal still describes ownership moves as planned, while current limits document implemented API/MCP moves. The detached proposal retains earlier scope wording excluding descendant cancellation, while current behavior includes explicit tree cancellation. Historical designs should not compete with current user instructions. Preserve unresolved decisions, remove duplicated implemented prose, and link to the canonical behavior. [Child proposal](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/docs/child-workflows-proposal.md#L3), [detached proposal](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/docs/detached-workflow-proposal.md#L83), [current limits](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/docs/v1.md).

There are **431 tracked `.tasks` files totaling 8,242,035 bytes**, including 203 Markdown files, 62 logs, and 76 PNGs. `.tasks/` is already ignored, but previously tracked files remain. Searches outside the directory found task-directory conventions rather than concrete dependencies on the sampled artifacts. Check each run's lifecycle before removing completed artifacts from the tracked tree. Preserve active local run files and move unique current decisions into their owning docs. Git history retains the old evidence. Do not create another archive report for every removed task. [Ignore policy](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/.gitignore#L16).

The package includes `docs`, but `docs/.npmignore` already excludes research and the package smoke test checks that exclusion. Superseded proposals directly under `docs` remain packaging candidates. `.tasks` cleanup reduces repository/context weight, not npm size, because it is outside the package file list. Preserve the research exclusion and validate documentation links, site build, and package contents after pruning. [Package file list](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/package.json), [research exclusion](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/docs/.npmignore), [package smoke test](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/scripts/test-package.mjs#L49-L56).

## Low priority simplifications

### L1 Prune stale CSS and reconcile text roles

Global `.field`, `.muted`, and `.error-banner` rules have no corresponding plain-class consumers in the inspected UI source. They are deletion candidates after a final template/dynamic-class search and visual smoke check. Similarly named CSS-module classes are separate. Keep global rules that still have consumers. [Legacy styles](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/styles.css#L61).

The detector returned 48 advisories: 30 font-size, eight color, and ten radius differences from DESIGN.md. These are not 48 verified usability bugs. The guide still describes an approved target rather than current shipped CSS, and deliberate graph exceptions exist. Reconcile that provenance first. Normalize text that people must read: global code is 10 px and some inspector identifiers are 8 px, while the shared helper role is 12 px. Keep compact graph labels where zoom and context justify them. [Design provenance](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/DESIGN.md), [type scale](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/design-system/theme.ts#L51).

### L2 Share the large-query transport policy

Client and server independently enumerate the same five operations that require POST for large payloads. Share a small constant in an appropriate contract module or assert parity in transport tests. Keep independently abortable waits separate. No registry framework is needed. [Client list](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/client/src/index.ts#L15), [server list](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/server/src/app.ts#L79).

### L3 Measure dependency cost before replacing anything

The build emits an ELK chunk of about 1.44 MB minified, 439 KB gzip, and a core chunk of about 388 KB, 116 KB gzip. ELK is already dynamically imported; its existence does not prove it burdens every route. Record actual loaded chunks and route timings before narrowing imports or changing layout tooling. No dependency was proven unused in this audit. Preserve self-hosted fonts and their license. [ELK lazy import](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/src/features/workflows/workflowLayoutElk.ts#L171), [chunk configuration](https://github.com/dgca/interlock/blob/3e0964ac050c684dd4784beaac4d7dfef31ef37c/packages/ui/vite.config.ts).

## Prevent the same drift without adding another process layer

The existing UI pattern guide already asks for shared components, state checks, and rendered review. Add enforcement and concrete examples there rather than another design manifesto.

1. **Make one editor lifecycle the reference.** Document clean, dirty, saving, failed, conflicted, and acknowledged-save states. Every new editor reuses the behavior or explains a real exception. Keep one route example and one contextual-dialog example.
2. **Review matching screens together.** In the existing PR template's Details/Validation sections, name the comparable flow and shared component. A change to Save, Delete, list opening, or a selector requires inspecting the other users of that pattern. This is more useful than asking whether a screen “looks consistent.”
3. **Add a small browser journey suite.** Cover a page editor, modal editor, workflow editor, and run review. Exercise dirty close, pending navigation, conflict, failed refresh, keyboard focus, long content, and desktop/intermediate/phone layouts. Keep existing jsdom coverage; do not duplicate every unit assertion in a browser.
4. **Test read scope.** A paginated response must also bound retrieval and payload parsing. Add unrelated retained history to inspector and board scenarios. Assert scope rather than hardware-specific timing.
5. **Keep module rules executable.** Extend the current design-system boundary test to package import directions and core leaf contracts. Avoid an architecture framework or broad lint dependency just for this pass.
6. **Finish migrations by deleting their bridges.** Give `useRefreshOnTick` a concrete exit condition. Do not let both refresh mechanisms become permanent defaults for new features.
7. **Close out feature artifacts.** At release, reconcile proposal docs, retain only unique decisions, and untrack completed SDLC outputs. Keep `.tasks/<outcome>/` available locally for active workflow runs. Preserve the existing package check that excludes research from installed product documentation.

Keyboard-only completion and semantic relationships belong in these checks. Use the actual WCAG minimum target-size rule, 24 CSS px with defined exceptions, rather than treating every control below 44 px as a defect. The existing 32 px graph controls are not automatically failures. [Keyboard guidance](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html), [target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## Suggested implementation sequence

1. Fix H1 and add lifecycle regressions. Add Board conflict recovery in the same focused feature area. Do not combine this with a visual redesign.
2. Fix H2 behind the existing inspection contract. Add scoped retrieval tests and capture before/after measurements.
3. Address M1/M2, then measure M3. These remove work and make freshness behavior easier to reason about.
4. Apply M4–M7 across matching screens in small groups. Start with form actions, run navigation, and shared list semantics. Finish with spacing/type polish.
5. Refactor M8–M10 independently, using existing public-operation tests. Prune M11/L1 and consolidate L2 as separate low-risk changes. Investigate L3 only if measured loading cost warrants it.

For the substantial refactors, decide whether to use the published SDLC workflow before implementation, as the project instructions require. This audit did not start an SDLC run or authorize merge/publication. Normal non-breaking follow-ups should keep patch changesets pending for the public package.

## What should stay

Keep the runtime/core/storage separation, typed client and shared server operations, native executor adapters, Mantine-based controls, reusable contract editors, shared page header, and workflow cards. They already reduce duplication.

Keep migrations, old fixtures, legacy Bash behavior when language is omitted, immutable published versions, claim uncertainty checks, secret handling, and bounded agent inspection contracts. No test deletion or package removal was justified by the evidence gathered. A large suite is not itself bloat.

## Rendered examples

These local captures show the audited implementation, using synthetic data:

- [Workflow editor](/Users/dan/.codex/visualizations/2026/11/11/01a1ccb6-1ef9-7891-96eb-591961aecab3/interlock-audit/interlock-audit-editor.png) and [node settings](/Users/dan/.codex/visualizations/2026/11/11/01a1ccb6-1ef9-7891-96eb-591961aecab3/interlock-audit/interlock-audit-agent.png).
- [Preset creation](/Users/dan/.codex/visualizations/2026/11/11/01a1ccb6-1ef9-7891-96eb-591961aecab3/interlock-audit/interlock-audit-preset.png) and [schedule creation](/Users/dan/.codex/visualizations/2026/11/11/01a1ccb6-1ef9-7891-96eb-591961aecab3/interlock-audit/interlock-audit-schedule.png).
- [Populated board](/Users/dan/.codex/visualizations/2026/11/11/01a1ccb6-1ef9-7891-96eb-591961aecab3/interlock-audit/interlock-audit-board.png) and [human request](/Users/dan/.codex/visualizations/2026/11/11/01a1ccb6-1ef9-7891-96eb-591961aecab3/interlock-audit/interlock-audit-request.png).
- [Run inspector on desktop](/Users/dan/.codex/visualizations/2026/11/11/01a1ccb6-1ef9-7891-96eb-591961aecab3/interlock-audit/interlock-audit-inspector.png) and [at 390 px](/Users/dan/.codex/visualizations/2026/11/11/01a1ccb6-1ef9-7891-96eb-591961aecab3/interlock-audit/interlock-audit-inspector-phone.png).

## Verification and scope

The audit used a detached worktree at the fetched `origin/main` commit above. The original checkout was on `codex/workflow-boards` with local design/research changes; those were preserved. Main includes the pending boards and agent-presets changesets. Product code was not changed.

| Check                        | Result                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Frozen-lockfile installation | Passed                                                                                      |
| `pnpm test`                  | 192 files, 2,241 tests passed                                                               |
| `pnpm build`                 | Passed, including TypeScript and production UI; ELK chunk-size warning noted                |
| `pnpm format:check`          | Passed on audited main                                                                      |
| `pnpm test:package`          | Passed: packed CLI/UI, HTTP/stdio MCP, restart, scripts, recovery, and cleanup smoke checks |
| Source detector              | 48 advisories, classified above rather than treated as confirmed bugs                       |
| Browser review               | Production build, isolated temporary database, Chromium                                     |

Rendered review covered workflow library/editor/node settings, AI Settings/preset creation, board creation and populated board, prompt creation, schedule creation, Runs, human request review, and run inspection. Desktop captures used 1440×1000; editor/schedule checks included 1024×768; run inspection included 390×844. Board navigation loss and prompt Escape loss were reproduced. A synthetic human-input workflow exercised the operator views without model calls.

The architecture review covered principal runtime/storage entry points, board reads, executor supervision, import directions, transport setup, manifests, selected regression tests, and current/proposal docs. This was not a comprehensive MCP tool-description audit, security review, screen-reader certification, touch-gesture test, exhaustive dead-export scan, or full-site review. The marketing/docs site build was not run because no site content or implementation changed. Those checks remain necessary for follow-up changes that affect them.

The inspection benchmark used twelve consecutive calls before and after inserting unrelated history into `Store(':memory:')`, sorting timings and reporting element 6. Reproduce with a published two-node Entry → Exit workflow, then 2,000 completed run records with unique IDs, 16,384-character ASCII input/output payloads, and one event per added run. Compare the original target in both phases; stop the engine and close the store afterward. The source query shape is the durable evidence, not the particular timing.

Regenerate the original inventory with `git ls-tree -r -l 3e0964ac050c684dd4784beaac4d7dfef31ef37c -- .tasks`; count the entries and sum the blob sizes for the byte total. Detector counts came from `impeccable detect --json packages/ui/src` on that audited commit. No cleanup candidates were deleted during the audit itself; the later documentation cleanup is recorded under M11.
