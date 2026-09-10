# @type_of/interlock

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
