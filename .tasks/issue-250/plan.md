# Implementation plan

[Spec](spec.md) owns behavior and AC identifiers.

1. Add strict shared preview/mutation contracts and a cancellation reason field. Extend compact storage history rows with detached and forward-chain links. Share adjacency discovery in runHistory with deletion planning and tree cancellation. AC1, AC2, AC6.
2. Split cancellation state from post-commit effects while preserving legacy calls. New operation selects active members through terminal ancestors, marks chain stops, updates every selected run and lifecycle receipt in one Store transaction, then stops external operations. Reuse existing resource, usage and hold helpers. AC3, AC4, AC5.
3. Expose runs.previewCancellation and runs.cancelTree, CLI cancel-tree, MCP preview_run_cancellation and cancel_run_tree. Return bounded summaries and audit existing cancellation/resource/trigger descriptions. AC2, AC6.
4. Add inspector dialog using existing Mantine modal/form patterns with detached toggle, live bounded preview and required reason. AC7. Human UI pass is deferred by user authorization.
5. Add meaningful integration tests for tree/chain/Batch/timer/script/claim/managed/held/uncertain behavior, rollback before stop, preview purity and bounds, excluded branches, transport discovery and CLI calls. Use temporary databases. Run relevant tests, full pnpm test, pnpm build, pnpm format:check, package smoke after build.
6. Update workflow-execution, v1, architecture, resources, chain/event/agent guidance and README as affected. Add a patch changeset. Fetch/rebase current main, resolve and revalidate. Commit implementation and checks. Submit build assignment and stop before claiming fresh review.

Risks: terminal intermediate parents must remain traversable; post-commit Script saves must not overwrite newer state; managed stop must preserve uncertainty until confirmed. Existing cancellation entry points remain routed through their current scope.

Build verification boundaries: inject a late events write failure and compare all runs, work, resources, usage, holds, lifecycle receipts and chain records before/after, with a successful cancellation control. Assert no abort/stop runs before rollback. Compare complete document snapshots around preview. For resource safety, cancel a claimed resource owner and verify competing work remains blocked until exact-attempt stopped release.

Representative UI journey, AC7: open a terminal parent with active independent descendants, open Cancel run tree, enable Include detached descendants and observe updated count, enter reason, confirm and observe cancelled descendant links. Verify close returns focus and pending/error states prevent duplicate submission. Automated component coverage belongs to build; combined human visual pass remains deferred. Independent review owns diff review and adversarial boundary spot checks. Final delivery belongs to preparePr after parent-led review.
