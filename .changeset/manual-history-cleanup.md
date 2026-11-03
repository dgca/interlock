---
'@type_of/interlock': patch
---

Add manual run-history cleanup through Runs history, the CLI, and MCP. Preview selected whole trees and chains by root workflow or age, review protection reasons and data sizes, and explicitly delete history while retaining workflows, published versions, and start-request tombstones. Active descendants, unresolved resources, and retained comparison evidence remain protected. Report removed JSON data separately from reusable database space.

Keep idle scheduling from parsing completed comparison captures or uncertain resource history. Existing databases receive a backed-up scheduling-index migration on startup; the upgrade preserves stored history.
