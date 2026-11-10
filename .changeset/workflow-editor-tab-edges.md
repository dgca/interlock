---
'@type_of/interlock': patch
---

Restore workflow connections after switching from Runs or Child workflows back to Editor, while preserving canvas position, selection, and unsaved edits.

Show direct Delete buttons for saved prompts, variables, automations, and child workflow cards instead of delete-only dropdowns. Preserve confirmations, edit guards, and focus return.

Remove variable enable/disable controls and the empty Danger zone from the editor. Existing disabled variables retain their status and can be restored through the CLI.

List detected harness configurations first and sort each detection group alphabetically, keeping row positions steady when enabling or disabling a configuration.

Align harness execution-default fields, add spacing below concurrency, move model refresh beneath its input, and remove generic configuration guidance.

Skip unpublished-draft diagnostics for archived workflows while retaining published-dependency and execution-blocker checks across the UI, CLI, and MCP.
