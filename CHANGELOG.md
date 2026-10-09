# @type_of/interlock

## 0.1.17

### Patch Changes

- dff3944: Update the SDLC starter with brief UI planning, focused checks for consequential failures, and clear verification ownership that reuses trustworthy evidence within the existing review steps. Existing libraries keep their workflows.
- fa59855: Import selected workflows from public GitHub folders with dependency previews, commit-pinned sources, and atomic conflict rejection. Keep local JSON import available and provide recovery guidance for download failures and uncertain import results.
- d60b70b: New libraries start with a published SDLC workflow for planning, implementing, and reviewing software changes. Onboarding explains its executor requirements. Existing libraries remain unchanged.

## 0.1.16

### Patch Changes

- 3a3cabe: Use a compact transport selector in the MCP connection dialog, with HTTP selected by default and legacy stdio available as an alternative.
- 4b43394: Add a Prompts library for reusable Markdown instructions and ordered prompt selection on Agent nodes. Shared edits apply to future runs of published workflows, while each run retains its captured instructions through later steps and retries. Include prompt management through MCP, captured content in run inspection, and prompt dependencies in portable workflow bundles.

## 0.1.15

### Patch Changes

- 77cd6f1: Add atomic node, route, and settings edits through MCP and the shared API, with stale-draft protection and rollback. Add read-only draft preflight with structured save errors, publication blockers, and conservative contract and binding diagnostics.
- 92f6b29: Route forward edges between top-level workflow cards through column gaps, with separate channels and detours around obstructing rows. Preserve usable gaps when wide cards on other rows overlap the route's horizontal range. Loops choose the side of the graph with less loop traffic. Routing applies in the editor and run inspection and follows Tidy or manual drags without changing the definition.
- 57121de: Add polling Waits: a Wait node can run a Script or Fetch check on an interval until the check output at a path equals a value, then continue with the check output merged into its input. The slow work stays outside the node, so a restart only repeats the check. An optional deadline routes the original input through a Timeout branch. Run inspection shows the next check time and the latest check result; one execution counts once against the step limit.
- 63fcf08: Add compact run briefings, targeted input/output reads, and cancellable change waits through MCP and the shared API. Briefings distinguish claimed work, timers, Batch progress, and independent detached runs. Sequence cursors recover explicitly after restart. Database schema 3 adds transactional revision tracking with a pre-upgrade backup while preserving existing workflow and run records.
- 4ca6bfc: Add ELK as an alternative layout for Tidy, with ordered branch handles and nested Batch layouts. The Tidy button runs the last chosen layout in one click; a gear beneath it selects and remembers the mode across workflows and browser sessions. ELK loads on first use, changes only node positions, and supports one-step undo. Pending layouts are discarded when the draft changes or the editor switches away from the canvas.

## 0.1.14

### Patch Changes

- 4c8f6bd: Hovering a node or selecting exactly one highlights its connected edges, neighboring nodes, and port labels and handles while dimming the rest of the canvas. Run inspection highlights on hover, and a selected edge takes priority. Condition True and False edges now use the neutral color; Agent Timeout edges remain amber until selected.
- 9e3a73d: Bring a selected edge to the front of the workflow editor. The selected edge draws above nodes with a thicker accent stroke, its source and target nodes are outlined, and the rest of the graph dims until the selection clears.
- 5ff40d8: Route backward edges through separate lanes below the cards between their endpoints. Vertical segments use the available space beside the endpoint cards, and corners are rounded. Forward edges keep their curves. The editor and run inspector use the same routes.
- f5246e3: Pan the workflow editor by dragging with the middle mouse button. Left-button drag still selects nodes, and Space + drag still pans. The run inspector accepts the middle button too.
- efa6dfb: Show a review of draft changes against the latest published workflow version before publishing in the editor.

## 0.1.13

### Patch Changes

- f3954b6: Suggest input fields while editing Fetch URL templates.

## 0.1.12

### Patch Changes

- 243be39: Suggest input fields and match-value types in node settings from declared and upstream contracts, with an explicit action to use an inferred shape for validation. Switch and Condition match values use type-specific controls and offer free-text suggestions for declared choices. Fetch fixed body fields gain typed value controls, and Wait timestamp suggestions favor text fields.

## 0.1.11

### Patch Changes

- db21e81: Make Condition comparisons editable as typed values, Agent tool and skill requirements editable as tags, and Script and Fetch timeouts editable with time units. Clarify Batch list selection and concurrency controls without changing workflow definitions.

## 0.1.10

### Patch Changes

- d9f851a: Add Start and continue to Workflow nodes. Dispatch a pinned workflow and immediately return its run ID, workflow ID, and version, while preserving Wait for result as the default. Independent runs survive parent completion or cancellation, can be retried directly, and remain visible in Runs with links to their launching execution. Include durable dispatch, Batch support, and CLI and MCP lifecycle guidance.

## 0.1.9

### Patch Changes

- e8d817a: Add Switch nodes with ordered JSON equality cases and named output ports. Configure cases with typed match values and named branches in the visual editor or through CLI and MCP workflow definitions, use input bindings and Batch item paths, and inspect the selected route in run history.

  Tidy accounts for output handle positions to reduce avoidable crossings between branches, including Switch, Condition, and timed Agent routes.

  Add brief node descriptions to creation and settings dialogs.

- 72d0545: Let Switch nodes fail on unmatched values without requiring a fallback branch. New nodes default to failing with an error that identifies the unmatched value and input field. Settings offer an optional fallback branch and preserve existing fallback behavior, with a connection-removal warning before disabling it.

## 0.1.8

### Patch Changes

- 9ed89b0: Document Batch output shapes for both failure policies, including failed and cancelled item records.
- 57f05c6: Add node input bindings that read an earlier node's latest completed output in the same run, including workflow loops and isolated Batch items.
- 63a75d3: Group input source selection and expected format in one Input section. Default to Previous step output, with Choose fields for named input fields, scoped node selection, and Advanced JSON. Canvas source labels select and focus referenced nodes.
- 79db9ba: Clarify that workflow-level loops are supported within the step limit, while Batch item paths must be acyclic.

## 0.1.7

### Patch Changes

- dab9cf9: Fix claim renewal shortening long leases when the duration is omitted. CLI `renew` now accepts options JSON with `leaseSeconds`. Omitted renewals across CLI, HTTP, and MCP reuse the original claim duration, including after restart. Older stored claims without a saved duration fall back to 300 seconds. Compatibility: callers that relied on every omitted renewal resetting to 300 seconds must now request that duration explicitly. Explicit overrides apply only to that renewal.

  Add `workflowId`, optional `parentRunId`, `rootRunId`, and `rootWorkflowId` to compact work discovery, and root IDs to run summaries. Dispatchers can route nested assignments by their outermost workflow without fetching execution history. Existing databases need no rewrite.

## 0.1.6

### Patch Changes

- 20dd543: Expose workflow schemas and JSON value types through MCP, add compact assignment discovery and filtered run summaries, and provide original-input bindings for later steps. Add portable workflow bundles with transactional import, preserved IDs and version pins, and explicit draft-conflict handling. Expose archive, restore, and guarded deletion through CLI and MCP, clarify context policies, and improve startup conflict diagnostics. Database schema 2 adds run lookup indexes with a pre-upgrade backup.
- 7fbba4b: Add a menu to each child workflow card so you can delete the child without opening its editor. The existing confirmation and reference checks still apply.

## 0.1.5

### Patch Changes

- be64799: Allow each Batch to configure Maximum items from 1 through 10,000, retaining 200 when unset. Larger backlogs can run with the existing concurrency and independent step budgets. Oversized-input errors report the actual count and configured limit before any item work starts.
- 803917a: Add Wait nodes with durable duration or timestamp deadlines and optional unclaimed Agent timeouts that route original input through a Timeout branch. Configure durations in the editor and inspect deadlines and timeout outcomes in runs. Clarify independent Batch step budgets and report completed item counts when a Batch fails.

## 0.1.4

### Patch Changes

- d64f7a8: Add automatic database migrations with SQLite backups before schema upgrades. Stop startup on backup or migration failures and reject unsupported newer database schemas. Document upgrades and restoring backups. Existing child workflow records need no conversion.
- 7cc28fc: Add `interlock publish <id> --cascade` and the MCP `publish_workflow` cascade option to advance shared workflow references and republish transitive dependents atomically. Existing runs and published versions keep their pins. Unpublished dependent definition edits and dependency cycles block the cascade.
- bccf4a8: Add owned child workflows that stay out of the main library. Create and browse helpers in the Child workflows tab, open them from Workflow nodes, and explicitly select published child versions in the parent. Support owner-scoped creation and listing through MCP and the CLI. Parent cloning, export, and deletion with children remain unavailable pending lifecycle support.

  Align editor defaults with option order, show short choices as segmented controls and longer choices as radio groups, and list published versions newest-first. Give workflow section tabs more space above their hover backgrounds.

## 0.1.3

### Patch Changes

- b3e1bcd: Make the entire workflow card a link to its editor, except for the actions menu. Support keyboard navigation and opening workflows in a new tab.
- b3e1bcd: Add Editor and Runs navigation within each workflow, with filtered run history and links back from run inspection. Move workflow settings and deletion into the menu beside Run. Add Save and Discard actions beneath the raw editor and retain raw edits across section changes and failed saves.

## 0.1.2

### Patch Changes

- 587408c: Hold Z and drag from empty workflow canvas space to zoom to a rectangular area. Show a zoom cursor, rectangle, and footer hint. Escape or releasing Z cancels the gesture; text editing and Undo shortcuts keep their existing behavior.
- 587408c: Use design tool controls in the workflow editor: scroll to pan and drag the canvas to select multiple nodes.

  Show the regular arrow cursor over empty canvas when selecting nodes.

  Hold Command or Control to zoom by scrolling while keeping the arrow cursor.

  Hide node pencil buttons while multiple nodes are selected. Batch settings remain available.

- 587408c: Add Undo and Redo buttons and Ctrl/Command+Z and Ctrl/Command+Shift+Z shortcuts to the workflow editor. Keep up to 50 actions per editing session, including group moves, Batch deletion, settings changes, and applied raw edits. Saving preserves history; leaving the editor or loading an external draft clears it.
- 587408c: Distinguish node roles with teal Agent icons and Workflow icons matching Exit. Keep Script, Fetch, Condition, and Batch icons blue, card headings gray, and preserve card backgrounds and execution status colors.

  Color Condition output handles and edges green for True and red for False. Keep the handle labels and remove redundant edge labels.

- ee2f5c1: Add bookmarkable workflow and run URLs that restore the selected page on reload, preserve the selected Runs tab, and support browser Back and Forward with unsaved-edit protection.

  Rename Activity to Runs throughout the UI to match the run URLs and domain terminology.

- 587408c: Remove the Delete button from the workflow editor. Workflows can still be deleted from the workflow list.
- 587408c: Fix overlapping new nodes by using their rendered dimensions for placement and making room when Batch contents grow. Add an undoable Tidy action that arranges the workflow and nested Batch contents from left to right, then fits the result into view. Place Tidy below Fit View in the canvas controls.

## 0.1.1

### Patch Changes

- 15eff04: Replace the seeded crypto example workflows with two lighthearted ones that showcase every node type: **Size up a Pokémon** fetches live data from PokéAPI, computes a stat sheet with a JavaScript script, and branches on a condition into an agent-written mascot pitch; **Build a team roster** batches that workflow across candidate Pokémon and synthesizes a picked team.
- 24f10e9: Seed the example workflows only once per database. Previously the examples were re-seeded on every start whenever the library was empty, so permanently deleting them brought them back on the next start.

## 0.1.0

### Minor Changes

- 9f800af: Serve MCP over HTTP from the running Interlock server. Connect agents using a stable local URL that survives upgrades with global or npx startup. Keep stdio available as a fallback.

## 0.0.3

### Patch Changes

- 52f345e: Replace Map with Batch, keeping repeated steps visible together on the workflow canvas. Batch supports concurrent item execution, ordered results, failure policies, and retries that preserve successful items. **Breaking change:** Map definitions are no longer supported. Recreate repeated steps with Batch; use a Workflow child to repeat an existing workflow.

  - Add Fetch nodes for HTTP requests, with input bindings, JSON bodies, request previews, and response inspection.
  - Add Activity with Active and History tabs. Show live step states, distinguish waiting Agent assignments from claimed work, and inspect individual Batch items without losing the selected step or canvas position.
  - Expose explicit failed-run retry through MCP.
  - Add copyable agent handoff instructions for existing executions, including fresh-session or isolated-subagent guidance and a fallback prompt for the user.
  - Show concise input and output types on node cards and shared workflow contracts on Entry and Exit.
  - Add confirmed permanent workflow deletion, including versions and run history. Active executions and references from other workflows block deletion.

## 0.0.2

### Patch Changes

- dd29120: Refresh clean workflow editors after external edits, preserve unsaved changes with an explicit reload action, and prevent duplicate save or publish requests. Publishing an unchanged draft no longer attempts a stale save.
- dd29120: Show dismissible success notifications for saving and publishing workflows, library changes, and run actions. Publish feedback includes the workflow name and actual version. Errors remain visible until dismissed.
- 570a0ad: Keep the CLI, UI, and MCP server versions synchronized with the published package version.

  Update the documentation for JavaScript scripts, development MCP configuration, and the Changesets release process.
