# Recover background Script executions

Source: https://github.com/dgca/interlock/issues/224 and parent #223 H2, read live on 2026-11-06.

Long Scripts can finish external effects while Interlock is offline. Losing their result makes a manual retry unsafe. Add an opt-in background Script mode whose local supervisor owns the process, deadline, and durable result independently of the server. A restarted server resumes the same execution and accepts its outcome once.

Workflow authors opt in for deployments and other long local commands. Operators inspect progress and explicitly recover uncertain executions. Existing foreground Scripts, JSON results, JavaScript and legacy Bash behavior, and operation failure routes retain their contracts. This work does not expand timeout bounds or add automatic replay, distributed execution, resource locks, or host-reboot survival.

The local trusted-user model remains. Bind all recovery evidence to the run and execution, verify OS process identity before trusting liveness or signalling, protect captured secrets and bound retained progress. Preserve runtime/core/storage ownership.

Settled decisions from the coordinator: use SDLC reviewPolicy auto and createPr true; use branch feat/issue-224 and .tasks/issue-224 in this checkout; update README, architecture, current limits, and affected agent instructions; add a patch changeset; preserve user data. Stop before the final fresh-context review. Rebase onto fetched origin/main before final verification and review. Do not push or open a PR until the coordinator resumes delivery after review.

No material intent questions remain. Implementation details and failure windows require investigation during specification and planning.

Task branch: `feat/issue-224`. Original baseCommit: `535f0f56e441b0ba4cff49df215662867f5b2b1f`.
