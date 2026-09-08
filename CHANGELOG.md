# @type_of/interlock

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
