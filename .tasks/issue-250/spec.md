# Run tree cancellation requirements

[Intent](intent.md) owns scope and authorization.

- AC1: Read-only preview accepts a retained run ID and includeDetached boolean, default false. Discover ordinary descendants and forward continue-as-new successors through terminal ancestors. Explicit true crosses detached edges. A selected child never selects its parents or siblings.
- AC2: Preview returns active selected run IDs, workflow identity, status and ancestry in a paged bounded list, exact total, and omitted count. Payloads, prompts and claim tokens are absent. Preview never pumps, mutates, stops or reserves work.
- AC3: cancel_run_tree requires a nonempty bounded reason. Recompute the same selection transactionally, cancel every active selected run and associated active executions, available/held/claimed work, close holds and end usage. Persist reason per cancelled run and lifecycle event. Terminal outcomes remain unchanged. Mark selected continuation chains cancelled to prevent rollover or retry.
- AC4: All state changes and lifecycle receipts roll back together on failure. External Script stops and local aborts happen only after commit. Cancellation prevents new Batch dispatch, timer advancement, claims, results and successors in the selection. Other trees and excluded detached branches keep their existing states.
- AC5: Claims are invalidated. Unclaimed or confirmed stopped ownership releases normally. Revoked active claims and possibly active deterministic operations retain uncertain ownership until verified completion or exact-attempt stop reconciliation. This implements the issue's release requirement without falsely granting a resource while old work may still run. Existing managed supervision and background Script stop/reconciliation own actual stop behavior.
- AC6: Existing cancel_run defaults and chain option retain their current behavior. Shared API, CLI and MCP expose preview/cancellation consistently. The mutation returns bounded run references and count, not full run payloads.
- AC7: Inspector offers Cancel run tree, including after a terminal parent when active descendants remain. A dialog previews selection, provides an explicit detached toggle and required reason, and shows count with bounded run links. Loading/error/empty states prevent accidental submission. Confirm cancels current selection. Existing dialog focus/keyboard behavior and wrapping layout support narrow screens.

Technical choices: preview is advisory and cancellation recomputes live membership. No stale preview token is required. Cancellation commits logical state atomically; stopping external processes is asynchronous and is not an atomic external side effect.

No unresolved design decisions. Human UI review remains deferred by explicit authorization.
