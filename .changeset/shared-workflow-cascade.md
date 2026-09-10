---
'@type_of/interlock': patch
---

Add `interlock publish <id> --cascade` and the MCP `publish_workflow` cascade option to advance shared workflow references and republish transitive dependents atomically. Existing runs and published versions keep their pins. Unpublished dependent definition edits and dependency cycles block the cascade.
