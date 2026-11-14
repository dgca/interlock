---
'@type_of/interlock': patch
---

Add tool edges: an Agent node can call a connected Script or Fetch step as a tool during its turn. Each call runs as a recorded child run linked to the calling execution and claim attempt, with per-edge call limits and the step's own resources, holds, approval and timeout. Assignments list their tools, connected agents call them with the MCP tool `call_work_tool`, and managed sessions use the same tool. The editor draws tool edges from an Agent's Tools handle, Agent settings edit call limits, the run inspector lists tool calls under the Agent step, and simulations accept `toolCalls` on Agent fixtures.
