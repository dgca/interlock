# Fixture simulation

Save optional ordered fixtures with testbench cases. Pin one published workflow version and case revision per simulation and capture both, plus current saved prompts, before execution. Use a private in-memory engine with mandatory Script/Fetch substitution. Agent outputs go through real claim and submission validation. No live runs, workers, usage or effects enter the application database.

Support flat graphs with Entry, Exit, Agent, Script, Fetch, Condition and Switch nodes. Reject Workflow, Batch, Wait and Agent timeout nodes before execution. Retain published step limits, cap fixtures at 1,000 and concurrent simulations at four. Expected Agent contract rejections consume a fixture and preserve the claim for a correcting fixture. Ordered fixtures identify repeated visits and retries without guessing.

Persist simulated receipts, compact execution traces and assertions separately from live comparison evidence. Return bounded pages by default and immutable captures only on request. Request IDs make startup retry-safe. Cancellation and shutdown stop scratch execution; restart marks unfinished reports interrupted. Interrupted simulations require a new request ID, never resume live operations.

Expose one grouped simulation operation through the shared API, MCP and CLI. Add CLI suite authoring through existing suite APIs. Test actual contract/routing behavior, effect isolation, unsupported definitions, malformed/missing/extra fixtures, bounds, immutable captures, cancellation, restart and both MCP transports. This proves control flow under supplied outcomes, not prompt or implementation quality.
