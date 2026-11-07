# Move in-flight runs to newer published versions

## Source and authorization

GitHub [#201](https://github.com/dgca/interlock/issues/201), under [#223](https://github.com/dgca/interlock/issues/223), requests opt-in upgrades at step boundaries and explicit operator preview and apply. The unattended sequential queue authorizes routine design decisions and SDLC auto review. Human UI review is deferred to the combined end pass. Stop before claiming final fresh review. Do not push or open a PR before coordinator review.

## Outcome and scope

Operators can deliver published fixes to long-lived runs without losing their state. Existing runs stay pinned unless explicitly opted in. Executions retain the definition that governed them. Active assignments and children complete under their original versions.

Include shared contracts, runtime, API, CLI, MCP, operator UI, relevant documentation and a patch changeset. Keep execution in runtime, contracts in core and persistence in storage. Preserve user data and use temporary test databases.

## Task identity

Repository: `/Users/dan/dev/interlock-worktrees/issue-201`.
Branch: `feat/issue-201`.
Base commit: `d7d995bf69d5ed778cde0e01ce743164671df131`.
Artifacts: `.tasks/issue-201`.

## Questions

No unresolved intent decisions. Detailed behavior belongs to spec.md.
