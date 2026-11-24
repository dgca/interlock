---
'@type_of/interlock': patch
---

Fix the SDLC starter so it can open a pull request when another workflow calls it. Scripts that run in a managed worktree now receive `INTERLOCK_WORKSPACE_BRANCH`. Import the SDLC starter again to update a library copy.
