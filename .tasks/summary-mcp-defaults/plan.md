# Implementation and verification

See [spec](spec.md) for AC1–AC7 and [intent](intent.md) for scope and the fixed baseline.

## Build-owned work

1. Update MCP parameter defaults and response projection in packages/mcp/src/server.ts and responses.ts. Keep tool-specific guidance and default policy in the MCP adapter; reuse runtime summary data. Add a typed, schema-described nextCall without changing full payloads. Covers AC1–AC4.
2. Extend tests/mcp-continuation.test.ts to drive omitted defaults and explicit summary, validate discovered contracts, full compatibility, size bounds, rejected inputs, replay, Batch continuation, and executable read suggestions through HTTP and stdio. Update existing full-consumer tests and package smoke to request full explicitly where needed; use default summaries for the package execution flow with selected final retrieval. Covers AC1–AC5.
3. Audit README, docs/agent-workflows.md, connect-harness.md, architecture.md, v1.md, upgrading.md, CLI help and the affected MCP start/list/claim/submit/briefing/result/wait/get flow. Describe defaults and field contents in current-state prose. Add migration guidance and a pending minor changeset. Covers AC6.
4. Save live SDLC summary receipt sizes and retrieve a persisted stage output with get_run_result before review; retrieve the terminal result at delivery. Keep logs outside the checkout. Covers AC7.
5. Run relevant tests, full test suite, pnpm build, pnpm test:package and pnpm format:check. Record criterion mapping and observed evidence in verification.md. Use temporary test databases only.

## Risks and checks

- A default changes in discovery but not execution: assert schemas and call with omitted options over both transports, with explicit summary controls.
- Fixed full parsers lose fields: compare explicit full responses with the existing engine inspection and list results; preserve package checks for the full contract.
- A suggestion points to the wrong lifecycle or requests a nonexistent cancelled result: execute suggestions for completed, failed, waiting, claimed and cancelled states. Check ordinary children, detached descendants, truncation and cursor resets. Result retrieval must use persisted final output, including downstream transformations.
- Large responses leak back into default execution: retain the 34-node large payload size regression and follow next work through growing history.
- Invalid options mutate state or replay repeats a transition: preserve complete-state rejection and identical/different replay checks.

## Review and delivery

Fresh-context SDLC review owns the complete diff and an independent boundary check against the committed candidate. The code-review skill also checks standards and spec in parallel against the fixed base. Assess findings and fix material issues, then re-review affected changes. preparePr owns delivery after review passes; no merge or publication.

There is no UI change, so no UI journey is required. The source and docs review is scoped to the affected continuation tools, not the entire MCP tool set.
