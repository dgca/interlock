---
'@type_of/interlock': patch
---

Workflows can set a permission policy: allow rules for file reads and edits, command patterns and named tools that managed Claude Code, Codex and Pi sessions with standard permissions apply inside the run workspace only. Actions outside the policy still ask in Review. A policy from an import or written by an agent waits for a person's approval before it applies, and import review lists it. The workflow report shows permission approvals per run, split into asked and allowed by policy. Workspace hooks accept `environmentMode` and `environmentPassthrough` like Scripts; hooks added in the editor start in minimal mode, and existing hooks keep the full environment.
