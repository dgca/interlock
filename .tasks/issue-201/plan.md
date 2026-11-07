# Implementation and verification

## Approach

Implement a runtime RunVersions module with core request contracts and additive persisted run fields. Keep its compatibility preview and mutation path shared by policy advancement and operator apply. Call it only before execution creation, so existing execution completion uses the original definition. Record execution versions at creation. Keep bounded version history separate from full graph responses.

## Build sequence

1. AC1–AC5: Add contracts, compatibility checking, confirmation fingerprints, transactional apply and start receipt policy identity. Validate input bindings against the proposed definition without executing operations. Preserve all existing captured dependency revisions.
2. AC6–AC8: Integrate creation, Batch inheritance, chain inheritance and active-binding cleanup/history impact. Preserve budgets and continuity records without rewriting them.
3. AC9–AC10: Add shared API, grouped MCP read/policy/preview/apply, CLI and inspector dialog. Reuse existing UI and transport tests. Keep MCP payloads bounded.
4. Update affected execution, continuation, prompt, cleanup and agent docs and pending patch changeset. Check README, CLI help and the complete affected MCP path against final implementation.

## Checks and ownership

Build owns focused temporary-database runtime tests for AC1–AC8, API/MCP transport tests for AC9, and existing UI interaction tests for AC10. Highest risks are stale preview application, partial writes, accidentally replacing captured work, changed prompt pins and altered child/chain scope. Pair each negative test with a valid compatible move and compare protected state after rejection or injected failure.

Build runs `pnpm test`, `pnpm build`, `pnpm format:check` and `pnpm test:package`. Test logs must retain exit status and inspectable results. Fetch and rebase current main before final handoff, repeating affected checks if the candidate changes.

Representative UI journey for AC10: open run version controls, change policy, preview a target with a blocker, then preview a compatible target and apply with a reason. Expect correct blockers, disabled apply while blocked and refreshed version/history after success. Reuse existing test infrastructure or inspect controls manually. Record an explicit gap if unavailable. Human UI review remains deferred per intent authorization.

Independent review owns the complete task diff and targeted checks against stable AC identifiers. Stop with the fresh review assignment available, return exact HEAD/base, run and work IDs, checks and remaining gaps to coordinator. Delivery remains in preparePr after independent review.
