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

## First independent review corrections

The fresh review of `77cd6f16f5ef511fb32681fa05f285ccdbce724a` requested four localized AC6 corrections. The build addresses all original finding IDs:

- `77cd6f1-S1`: encode inference cache and recursion identities as a JSON tuple of node ID and port. The colon-ID/port regression asserts the conflict remains identical after renaming the producer.
- `77cd6f1-SPEC-001`: select contract properties by literal key, retaining binding data-path syntax separately. Regression cases cover dotted, empty, `$`, and `$.a` names with identical, conflicting, and missing closed-object schemas. Special property names use bracket quoting in diagnostics.
- `77cd6f1-SPEC-002`: check unsupported keywords on the final selected binding schema. A leaf `anyOf` without an explicit consumer contract now reports unknown.
- `77cd6f1-SPEC-003`: retain each projected field's shape and uncertainty, and report unknown for whole projections containing recursive or unknown fields. Independent known fields still produce supported type conflicts. Regression tests include a self-referential Wait with no input contract and a mixed recursive/known projection read by another node.

These changes refine the accepted preflight subset without changing edit, persistence, execution, or publication policies. The first reviewer independently passed all 433 tests, build, formatting, packed installation smoke, and an additional 100/101-edit transaction boundary. Updated focused checks pass with 50 tests across workflowEdits, inputHints, and both MCP transports. Final revision checks are recorded in the next SDLC build result.

Revision validation passed: pnpm test completed all 440 tests across 40 files, pnpm build passed, pnpm test:package passed after that build, and pnpm format:check passed. The final targeted workflowEdits regression run passed all 42 tests, and the production build was repeated after restoring the unchanged unknown-field diagnostic path format. No additional scope or policy decisions were required.

## Second independent review correction

The fresh review of `79d47afa7cff1e4d2e01f54a4135f5ef72b1c7f5` verified all four original findings as resolved and identified `79d47af-SPEC-001` under AC6. Declared shapes now require a supported primitive type and carry bounded uncertainty from nested properties, array items, and schema-valued additional properties. Bindings to type unions, annotation-only schemas, and entire objects or arrays containing unsupported leaves report unknown without requiring an explicit consumer contract. Field selection still retrieves independently known siblings and distinguishes excluded paths.

Eight regression cases cover those boundaries. The targeted workflowEdits, inputHints, and HTTP/stdio transport checks passed all 58 tests; pnpm typecheck passed. Broader checks were repeated because declared-shape classification affects shared inference: pnpm test passed all 448 tests across 40 files, pnpm build passed, pnpm test:package passed after that build, and pnpm format:check passed. The affected agent-workflows guidance now names type unions, annotation-only schemas, and nested uncertainty. Edit and persistence policies, interfaces, and the accepted specification remain unchanged. All intended changes are committed before the next fresh review.

## Third independent review correction

The full fresh review of `9ca764236a776dd67f37754b22f2c863cd7ed8e6` resolved all five historical findings and independently passed 448 tests, build, formatting, package smoke, and additional schema boundaries. It identified `9ca7642-SPEC-001` under AC2: ownership error attribution matched edge IDs to node IDs. The reverse scan now considers only node additions and updates. Four regression cases cover later add/update/remove edge operations sharing the rejected node ID and attribution to a later node update. Each case verifies complete rollback and unchanged revision.

Affected checks passed: pnpm test tests/workflowEdits.test.ts tests/childWorkflows.test.ts tests/transport.test.ts completed 67 tests, including all 54 editing cases and both MCP transports. pnpm build, pnpm format:check, and post-build pnpm test:package passed. Earlier full-suite evidence remains at the prior reviewed commit; unrelated checks were not repeated for this localized diagnostic-index change. Core inference, persistence, interfaces, documentation, and accepted policies are unchanged. Existing affected-flow documentation describes indexed errors accurately after the correction. The intended fix, regressions, and this record are committed together before fresh review.
