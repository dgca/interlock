---
'@type_of/interlock': patch
---

Bounded MCP tool profiles now omit server instructions and tool guidance that name tools outside the profile. The `execute` profile adds `manage_work_hold`, and `operate` adds `manage_work_resources`, so the hold and resource-release steps their tools describe are available. Custom launcher sessions receive `$INTERLOCK_API_TOKEN` when the server requires the API token. A failure while recording a background scheduler error no longer stops the server.
