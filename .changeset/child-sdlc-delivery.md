---
'@type_of/interlock': patch
---

Fix the SDLC and Pull request watcher starters so they work in their own worktree when another workflow calls them. Scripts that run in a managed worktree now receive `INTERLOCK_WORKSPACE_BRANCH`.

A library copy keeps its old Script. To update an SDLC copy, open its setup Script, set `dedicatedBranch` to `process.env.INTERLOCK_WORKSPACE_BRANCH === branch`, and publish. Adding the starter again creates a separate copy without your settings.
