# Cancel a run tree

Source: dgca/interlock#250, parent #223 L2. Aborting a bad batch currently leaves detached work consuming quota. Operators need one previewable operation that stops the selected run tree, including independent descendants when explicitly selected.

Scope includes shared cancellation contracts, runtime discovery and atomic state changes, server, CLI, MCP, and a purposeful inspector action. Existing cancel_run keeps its current detached boundaries. Preserve stored history and unrelated trees.

The user explicitly authorized unattended SDLC auto planning and implementation. Human UI review is deferred to a combined pass after all queued issues merge. This author stops before fresh final review and does not push, create a PR, or merge.

Success means operators can inspect the exact active cancellation set, then cancel the whole selection without orphaned dispatch or partial persisted changes. Claim revocation does not prove external work stopped. Keep uncertain ownership until confirmed stop or exact-attempt reconciliation.

No unresolved intent decisions.

Task branch: feat/issue-250. Original baseCommit: 7ccab703fb4a417d6f414cf48cf07decd0ba5d5f.
