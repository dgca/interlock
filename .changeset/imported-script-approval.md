---
'@type_of/interlock': patch
---

Require one-time approval before imported Script code runs. Import previews list each Script, and a run that reaches an unapproved imported Script waits on a Needs attention request that shows the code. Approve it in the UI or with `interlock approve-script`. Existing workflows stay approved after upgrading, and Scripts you or an agent write run without approval. Execution settings can extend approval to agent-authored Scripts or turn it off.
