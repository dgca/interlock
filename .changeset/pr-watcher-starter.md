---
'@type_of/interlock': patch
---

Add the **Pull request watcher** starter. It watches a GitHub pull request's checks and review comments through the `gh` CLI. A failing check, or a comment from the pull request's author or an account you list, starts a fix: an agent commits a repair, SDLC v2's Change review checks it, and the watcher pushes the reviewed commit to the pull request's branch as a plain push, never forced and never to the default branch. Comments from other accounts are never passed to an agent. A repair limit, a polling floor and a watch window bound every loop, and each stop asks a person in **Needs attention**. Start it by hand with a pull request URL, or from an SDLC v2 run's completed event.
