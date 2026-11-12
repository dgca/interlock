---
'@type_of/interlock': patch
---

Refresh run details, automation lists, variable editors, and workflow pause status through the same query cache. Refresh again when an engine event arrives during a pending read, and keep the last loaded data available when a refresh fails. Config value reads include the saved value revision, so the editor can verify it before displaying the value.
