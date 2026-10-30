# Continue as new

Issue #168 needs durable repeated Agent work with explicit compact checkpoints. Implement directly, using the scope agreed in chat.

- Exit `continueAsNew:{maxRuns}` is optional, with a required integer limit from 2 through 10,000 total members. Continuing Exits in one definition must agree. Normal Exit behavior remains unchanged.
- Standalone workflow runs only. Batch item execution within a standalone run retains existing behavior. Invoked workflows with continuing Exits, live comparisons and fixture simulations are unsupported.
- Validate checkpoint against Exit constraints and workflow inputSchema. Do not apply final workflow outputSchema. Persist predecessor completion, successor creation, bidirectional links and chain count in one transaction/savepoint. A continuing predecessor has no final run output; its Exit execution stores the checkpoint.
- Successors retain workflow/version and original prompt capture, reset run-local input/context scope, and have fresh maxSteps. Step-limit failure never triggers automatic continuation.
- Chain relationship is separate from parent ancestry. Each run stores root/index/previous/next metadata. One `runChains` record stores latestRunId, count, maxRuns and cancellation. No database schema migration.
- Every run-budget scope counts all chain members, including policies installed later. Lifecycle/tree scopes add ordinary/all descendants as before. No allowance reset or policy copying. Usage reads opt into includeChain.
- Existing cancellation defaults remain per run. Explicit chain cancellation from any member stops the latest run and its ordinary descendants and prevents retries/continuation. Detached descendants keep their existing independent lifecycle.
- Yield after one rollover per chain per pump. Query active run documents for execution instead of deserializing all completed histories. Retained history and budget/usage aggregation still have costs; this is bounded continuation, not indefinite scheduling or retention management.
- Invalid checkpoints and cap exhaustion fail visibly with the attempted Exit input retained. No new repair operation, pause/resume, automatic retry, scheduler, or MCP tool.

Verify rollback and restart, source prompt/version capture, caps, cancellation, budgets, normal final output, Batch behavior, transports, CLI packaging, editor controls, and a 300-member chain. Include docs and a pending patch changeset, then open a PR against main.
