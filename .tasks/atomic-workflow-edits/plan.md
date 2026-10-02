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

## Implementation and verification record

The task baseline is `5ffc4cac1d081e40b0067c018899b1bc61884e05`, fetched from main before the implementation commit. The worktree initially used the prior cached main; the intervening release version/changelog update was merged before validation. The task branch is `codex/atomic-workflow-edits`.

Core editing and diagnostics are separate modules. Runtime adds persisted ownership and version diagnostics once, and commits only effective changes. MCP edit lists retain JSON inputs until the indexed operation parser so malformed operations receive actionable operation indexes. This deliberately uses the operation vocabulary description rather than rejecting individual operations at the transport boundary. Existing full replacement and runtime execution semantics are unchanged.

| Criteria | Concrete evidence                                                                                                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1, AC2 | workflowEdits.test.ts prompt/insertion transaction, ordered operations, rollback matrix, stale-first rejection, final shape errors, equivalent edits, and object-key order checks.                                            |
| AC3      | workflowEdits.test.ts candidate read-only validation, incomplete save, independent errors, schema diagnostics; authoritative validateDefinition remains the publication check.                                                |
| AC4      | workflowEdits.test.ts immutable version, persisted run, unrelated layout and ownership assertions, plus legacy Bash and new script defaults.                                                                                  |
| AC5      | workflowEdits.test.ts nested Batch deletion, binding retention/repair, circular membership, port retention/repair, ownership rollback, and missing-pin diagnostics.                                                           |
| AC6      | workflowEdits.test.ts explicit upstream type conflicts, missing binding paths, unknown merges/schemas, Batch item contracts, timeout source contracts, and inference cycles.                                                  |
| AC7      | transport.test.ts HTTP and stdio discovery and calls for edits, preflight, stale revisions, rollback, no-op behavior, unknown fields, and incomplete drafts. Existing authoring and execution transport coverage also passes. |
| AC8      | Tests, production build, formatting, package smoke, pending patch changeset, and the SDLC fresh-context review before PR preparation.                                                                                         |

Executed checks: final pnpm test passed with 433 tests across 40 files, including the additional ambiguous-ID, final-shape attribution, defaults, and timeout checks. The affected workflowEdits and transport tests also passed separately with 38 tests. pnpm build passed after those changes. pnpm test:package passed, exercising packed global and npx installs, UI assets, HTTP/stdio MCP, JavaScript execution, and persisted claims across restart. pnpm format:check passed. Final check output is also recorded in the SDLC build result.

Reviewed README, architecture, agent operations, current limits, connection overview, CLI help/commands, and affected MCP authoring flow: server instructions, create/get/update/edit/validate/publish, and import/export schema/lifecycle guidance. Both transport tests validate all discovered input schemas. This is an affected-flow review, not an audit of every MCP tool. CLI commands retain their existing behavior; atomic edits are exposed through MCP and the shared API, so no CLI edit command is documented. No UI interaction or real-account smoke was required. Contract completeness, runtime node-output availability, open-object field presence, array-index existence, and first-error graph scope checks remain explicit limits.
