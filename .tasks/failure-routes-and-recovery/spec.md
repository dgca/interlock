# Failure route behavior

This specification implements the scope in [intent.md](intent.md). The user delegated routine design and asked for a small increment.

## Contract

AC1. Script and Fetch accept optional `onFailure: "fail" | "route"`. Omission and `fail` keep terminal failure behavior. `route` adds a required `failed` port alongside `default`. Incomplete drafts remain saveable. Publication requires exactly one edge per configured port and enforces existing Batch scopes and acyclic item paths. Other node kinds and polling checks do not gain this option.

AC2. Once an operation starts, an execution error, rejected Fetch HTTP status, or output-contract error follows `failed` when configured. Categories are `execution`, `http`, and `output` respectively. Execution errors include timeouts, invalid returned JSON, size limits, and network/process errors. Input bindings, input contracts, Fetch request resolution, graph errors, and step limits remain terminal. Cancellation and interrupted operations after restart never route or replay automatically. `failOnHttpError: false` retains ordinary success handling.

AC3. Failed routes receive `{input, error, output}`. `input` is the resolved input used by the operation. `output` is its returned JSON value, or null if unavailable, including a rejected HTTP response or a value that violated the success contract. `error` has required `nodeId`, `executionId`, `kind` (`script` or `fetch`), `category`, and `message`. No child reference or retry counter is needed because these node kinds do not create children or automatically retry. Each execution ID identifies one explicit operation. The fixed envelope is documented and exposed through authoring schema descriptions and destination input hints. The normal output contract never validates this envelope. The destination applies its ordinary input bindings and input contract. A destination contract mismatch fails that destination.

AC4. The failed execution keeps status `failed`, error text, timestamp, available raw output, and selected port `failed`. The run continues and may complete successfully. Events identify the original failure and routing. A `failed` edge to its own Batch End returns the envelope as that item's successful result. Unhandled item failures retain `all` and `collect` behavior. Earlier-node bindings still select completed executions only; recovery uses incoming input. Completed recovery runs cannot be retried. Existing explicit retries and step limits remain unchanged, including loops along recovery routes.

## Editor and inspection

AC5. Script and Fetch settings add one existing-style switch, **Route on failure**, beside their operation settings. Enabling it exposes an amber **Failed** output and the ordinary **Out** output. Help explains that Failed receives error data and disabling removes its connection when changes are applied. The existing dialog Apply/Cancel behavior, focus management, keyboard controls, and scrolling at narrow widths remain. Raw JSON round trips preserve the option and edge. Removing the option through Raw/MCP requires explicit edge removal. No new page, dialog, or MCP tool is introduced.

AC6. Run inspection retains the failed step indicator and original error, and adds **Followed Failed with error data.** for Script/Fetch routed failures. A completed run can therefore contain a failed step without suggesting it should be retried. Switch ports named `failed` remain ordinary named routes.

## Compatibility and limits

AC7. Existing definitions, legacy Bash, successful Script/Fetch results, Agent claim correction, timed Agent routes, waited/detached Workflow behavior, and polling Wait checks retain their behavior. Publish a new version to enable recovery. Pending patch changeset and affected documentation describe this increment and deferred automatic recovery policies. Both MCP transports discover the same optional field and support authoring, validation, publication and inspection through existing tools.

No unresolved human decisions remain. The main risk is confusing a recovered run with a successful operation; retaining the failed status and explicit route addresses that distinction. Automatic retry and broader node support remain tracked in issue #75.
