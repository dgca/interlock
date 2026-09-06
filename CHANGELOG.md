# @type_of/interlock

## 0.0.2

### Patch Changes

- 677a893: Refresh clean workflow editors after external edits, preserve unsaved changes with an explicit reload action, and prevent duplicate save or publish requests. Publishing an unchanged draft no longer attempts a stale save.
- 677a893: Show dismissible success notifications for saving and publishing workflows, library changes, and run actions. Publish feedback includes the workflow name and actual version. Errors remain visible until dismissed.
- 570a0ad: Keep the CLI, UI, and MCP server versions synchronized with the published package version.

  Update the documentation for JavaScript scripts, development MCP configuration, and the Changesets release process.
