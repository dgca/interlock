# Run key-value tags

Source: https://github.com/dgca/interlock/issues/249 and parent #223.

Factory operators run the same workflows across repositories and batches. They need persistent metadata to find related runs without parsing workflow input or duplicating engine state.

Add bounded, non-secret string tags to ordinary and triggered run starts. Preserve that metadata through execution and expose it in run inspection and indexed filtering. Keep execution in runtime, contracts in core, and indexing in storage. Use existing Runs and trigger controls.

The requester authorized unattended SDLC execution with auto review and a PR. Human UI review is deferred until the full five-issue queue merges. This author stops before fresh final review for coordinator handoff.

Existing usage and comparison reports are not M10 performance reports. The repository has no M10 performance-report implementation, so this change supplies indexed run queries and documents that report integration remains planned.

No unresolved intent questions. Tags are metadata, not authorization or secrets.

Task branch: `feat/issue-249`. Original baseCommit: `6d214a936e681d3c43b449f2ff8b88dade6a2718`.
