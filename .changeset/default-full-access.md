---
'@type_of/interlock': patch
---

Managed Agents whose harness and workflow set no permission level now run with **Full access** when no default agent permissions are chosen; before, they ran with Standard. This includes harnesses saved with the original Standard value, so after upgrading those Agents run commands and edit files without asking. To keep approvals, choose **Standard** in AI Settings → Execution settings → **Default agent permissions**, or set Standard on a harness or workflow. Explicit levels still win: a workflow's or harness's Standard or Read only, and Agent preset permissions, and work that already captured a level keeps it. The first-enable question still preselects Full access, and enabling a harness over the CLI or MCP without a stored default now yields Full access. Execution settings shows **Not set (Full access)** until a default is saved.
