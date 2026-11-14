---
'@type_of/interlock': patch
---

Add board types: reusable lanes, lane rules and card fields that place runs from several workflows on one board, computed from run state. Each workflow also gets a Stages board in its Runs. Read any board's lanes and cards with `interlock board view`, `GET /api/boards/view` or MCP `read_workflow_boards` action `view`.
