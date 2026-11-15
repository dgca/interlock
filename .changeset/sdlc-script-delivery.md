---
'@type_of/interlock': patch
---

The SDLC starter now opens pull requests with a Script. With `createPr: true`, an agent writes the title and description (and optional draft, labels, reviewers and base branch) without using the network, and a Script pushes the run's branch and runs `gh pr create` in the checkout, so `gh` finds github.com or a GitHub Enterprise host from the Git remote. An open pull request for the branch is reused. When `gh` is missing or not signed in, the remote is not GitHub, or the push is rejected, the agent opens the pull request as before and the result says why. Other failures end with `delivery_blocked`. Delivery never waits for CI, and the description no longer points reviewers at the task folder, which is removed with the worktree. Before pushing, delivery also refuses uncommitted changes to tracked files. Copies added earlier keep their agent-driven delivery; add another copy to use the new one.
