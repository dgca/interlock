# Implementation plan

[Intent](intent.md) owns scope. [Specification](spec.md) owns behavior and stable acceptance identifiers.

1. Add a core editing module with strict ordered operations and structured diagnostics. Apply edits to a copy, retain definition defaults and optional language semantics, and compare final definitions for actual changes. Add independent shape, publication, and conservative contract checks. Covers AC1, AC2, AC3, AC4, AC5, AC6.
2. Add transactional Engine edit and read-only validation methods. Reuse ownership validation, expected revisions, existing storage transactions, and immutable publication lookup. Expose them through shared server procedures and MCP registration. Covers AC2, AC3, AC4, AC7.
3. Add focused core/runtime tests with in-memory storage for rollback, unknown fields, IDs, stale revisions, no-ops, script defaults, nested Batch deletion, source-port repair, child ownership, immutable versions, diagnostics, binding paths, explicit contracts, and ambiguity. Extend existing HTTP/stdio discovery and calls. Covers AC1 through AC7.
4. Update README, architecture, agent operations, connection overview, current limits, and affected MCP authoring guidance. Review CLI help against available commands without adding an unrequested CLI operation. Add a pending patch changeset. Covers AC7, AC8.
5. Run relevant tests, pnpm build, and pnpm format:check. Run package smoke after the completed build because MCP discovery is bundled in the executable. Commit all intended artifacts and changes. Use the workflow's fresh-context review assignment to independently check standards and AC1 through AC8, repair findings, and re-review the current commit. Open and attach the PR only after a passing review. Covers AC8.

## Facts, risks, and verification

Engine.update currently parses definition structure and validates ownership at save; validateDefinition enforces publication. No database change is planned. Existing editor deletion recursively removes Batch members and incident edges. Atomic operations will preserve this separation. Unsupported schema cases need explicit unknown diagnostics, especially multiple incoming routes, pass-through loops, Batch outputs, and root inputs in child runs. Targeted tests will assert these limits rather than claiming complete compatibility.

No UI changes are planned, so no UI journey is required. Tests use temporary or in-memory databases; the real account smoke script is excluded. The SDLC run is recorded in intent.md. Review progression records user authorization, not human approval.
