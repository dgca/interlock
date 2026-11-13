---
'@type_of/interlock': patch
---

Workflows can set `workspace` (repository, base ref and branch template) to give each run its own Git worktree on a new branch, inside the Interlock data folder. Agent and Script nodes without their own `cwd` work there, and the worktree is removed when the run tree is quiescent; the branch is kept.
