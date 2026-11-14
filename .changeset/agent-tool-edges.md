---
'@type_of/interlock': patch
---

Add tool edges: an Agent node can call a connected Script or Fetch step as a tool during its turn. Each call runs as a recorded child run linked to the calling execution and claim attempt, with per-edge call limits and the step's own resources, holds, approval and timeout.
