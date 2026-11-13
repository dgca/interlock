---
'@type_of/interlock': patch
---

Workflows can set `workspace` (repository, base ref and branch template) to give each run its own Git worktree on a new branch, inside the Interlock data folder. Agent and Script nodes without their own `cwd` work there. The worktree is removed when the run tree is quiescent unless `retention` keeps it; the branch is kept. Optional hooks run in the checkout after it is created and before it is removed, and imported hooks wait for Script approval.
