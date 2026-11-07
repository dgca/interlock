# Exclusive resources for deterministic steps

## Problem and outcome

Scripts, HTTP requests, and polling checks can mutate resources shared with other runs. Only Agent claims currently participate in library resource coordination. Users must add external locks to prevent conflicting deployments, checkout mutations, or migrations.

Extend existing exclusive resources to deterministic steps so cooperating operations wait before launch and retain conservative ownership when their outcome or stop is uncertain. Existing Agent ownership and reconciliation remain compatible.

## Scope and constraints

Support Script, Fetch, and polling Wait declarations using existing value bindings and resource limits. Integrate transactional admission, completion, interruption, inspection, and reconciliation with WorkResources. Resource contention must be visible through existing run waiting projections and must not spend execution timeouts before launch.

Execution rules remain in runtime, contracts and publication validation in core, and storage in storage. Preserve omitted-language Bash and explicit JavaScript behavior, foreground interruption safety, and background Script supervision. Preserve user data and use temporary databases in checks.

Do not add fencing, unmanaged-writer protection, cross-library locks, or FIFO guarantees. Polling Wait resources cover each active check, not idle intervals between checks.

## Source and authorization

- GitHub issue [#242](https://github.com/dgca/interlock/issues/242) defines the change and required docs.
- Parent [#223](https://github.com/dgca/interlock/issues/223) requires opt-in, domain-independent engine behavior.
- The coordinator explicitly authorizes unattended execution with auto review. Human UI verification is deferred to the combined queue pass. A separate fresh reviewer must approve the final candidate before delivery.
- The task uses `/Users/dan/dev/interlock-worktrees/issue-242`, branch `feat/issue-242`, and artifacts under `.tasks/issue-242`.
- Original base commit: `74a3c430a9d1ac08a10bad490df6c3019deaa9bd`.

## Unresolved intent questions

None. Detailed behavior belongs in [spec.md](spec.md), and implementation and verification belong in [plan.md](plan.md).
