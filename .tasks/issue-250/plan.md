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


## Implementation and verification

The delegated-launcher boundary needed an additional fix within step 2. Existing launched sessions were archived on cancellation without requesting stop, and pending launches had no persisted quiescence blocker. The manager now persists starting supervision before external dispatch, invalidates late tickets, requests configured stops, and keeps interruption uncertainty through explicit exact-session reconciliation. A pre-claim launch uses attempt zero and has no claim or reservation to release. Reconciliation waits for its pending launch and stop request to settle. Existing detached cancellation boundaries remain unchanged.

| Criteria | Build evidence | Observed result |
| --- | --- | --- |
| AC1, AC2 | tests/runCancellation.test.ts; tests/runHistory.test.ts | Terminal intermediates, directed child scope, detached inclusion, forward chains, pagination, byte-free snapshots, and no pumping/aborting in preview passed. |
| AC3, AC4 | tests/runCancellation.test.ts | Explicit reasons, claim invalidation, closed holds, usage endings, bounded mutation summaries, no later Batch/timer work, and full document equality after a second cancellation-event write failure passed. No abort occurred before rollback. |
| AC5 | tests/runCancellation.test.ts; tests/runCancellationLauncher.test.ts | Real Bash/JavaScript process stops, authenticated background supervisor stop, uncertain remote owners, managed late-result rejection and real HTTP delegated pending/unclaimed/claimed stops passed. Competitors stayed blocked until exact-attempt stopped release. |
| AC6 | tests/runCancellationTransport.test.ts; tests/transport.test.ts | Shared API, CLI, HTTP and stdio preview/cancel flows passed; legacy detached cancellation behavior passed. |
| AC7 | tests/runCancellationDialog.test.ts; /tmp/issue250-ui-proof.json | Five component tests plus actual desktop/tablet/phone browser journey passed. Keyboard scope toggle, required reason, pending/error handling, focus restoration and visible stored reason verified. Human acceptance remains deferred. |

`pnpm test` passed 1,806 tests in 155 files. Evidence: /tmp/issue-250-test.log. `pnpm build`, `pnpm format:check`, `git diff --check`, and completed-build `pnpm test:package` passed. Evidence: /tmp/issue-250-{build,format,package}.log. Package smoke covered installed CLI, UI assets, HTTP/stdio MCP, persisted assignments across restart, JavaScript, supervised background recovery and reviewed history cleanup. Build retains the existing Vite chunk-size advisory.

MCP review covered the affected cancellation flow: server instructions, cancel_run, preview_run_cancellation, cancel_run_tree, manage_script, manage_executors, manage_work_resources, claim_work, list_work, get_run, get_run_briefing, wait_for_run_change, retry_run, manage_run_history and comparison cleanup/cancellation. Checked selection, defaults, request bounds, token-free summaries and uncertainty/recovery guidance against shared API. This was an affected-flow audit, not an audit of every tool. Both transports expose identical 65-tool definitions, 299,943 bytes, or 299,953 bytes with the list wrapper; server instructions are 9,820 bytes. New cancellation definitions total 1,688 bytes. Related descriptions were compacted to preserve the existing 300,000-byte discovery limit.

Two MCP tools follow existing preview_workflow_ownership/set_workflow_owner and preview_workflow_comparison/start_workflow_comparison conventions. Separate names make the pure read discoverable without a mutation mode or cancellation reason and keep cancellation's reason mandatory. The read and write contracts stay direct and match server query/mutation boundaries. The added preview avoids loading definitions, prompts, inputs and work payloads to determine scope; response lists default to 20 and cap at 100 records. The mutation's count covers the full selection regardless of its returned limit.

Docs checked and updated: README, workflow-execution, v1, architecture, agent-workflows, connect-harness, continue-as-new, events, webhooks, work-resources, history-cleanup and managed-executors. CLI help and both MCP transports agree with examples. No user .interlock data was used. No native authenticated model smoke was run because routine tests use controlled adapters and temporary databases.

Fetched origin/main at final candidate preparation. Live base remained 7ccab703fb4a417d6f414cf48cf07decd0ba5d5f. Fresh final review and delivery belong to the next workflow stages and remain unclaimed by this author.
