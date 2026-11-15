---
'@type_of/interlock': minor
---

Breaking: workflow variables no longer have an enabled or disabled state, and upgrading deletes every variable that is disabled. Run `interlock doctor` with your current version before upgrading to list them; enable any you want to keep.

The upgrade (database schema 23) takes a backup first and is one-way. Deleted variables lose their protected values and portable bindings. Runs that captured one fail at the step that uses it, and retries keep failing even if a variable with the same identity is provisioned again. Workflows that reference one report the variable as missing.

Variable changes that send `enabled` through the API, CLI or MCP are rejected with an explanation instead of being ignored, and variable metadata no longer returns `enabled` or the `disabled` availability. To stop a variable from being used, delete it. The doctor check for disabled variables is removed.
