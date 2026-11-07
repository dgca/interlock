# Implementation Plan: M5: Revisioned model aliases

## Overview and Reference
This document plans the implementation and verification of revisioned model aliases in Interlock, mapping tasks and verification directly to the acceptance criteria defined in [spec.md](spec.md) and the problem/scope outlined in [intent.md](intent.md).

## Intended Code Areas
1. **`packages/core`**:
   - Model alias candidate and saved record schemas (`modelAliasCandidateSchema`, `savedModelAliasSchema`, `modelAliasCaptureSchema`, `modelAliasRequirementSchema`).
   - Query & mutation schemas (`modelAliasReadSchema`, `modelAliasMutationSchema`).
   - Workflow reference extraction helper: `modelAliasReferences(definition: WorkflowDefinition): string[]`.
   - Update `Run` interface to include `modelAliasCaptures?: ModelAliasCapture[]`.
   - Update `WorkflowBundle` in `packages/core/src/transfer.ts` to include `modelAliases?: ModelAliasRequirement[]` with formatVersion validation.
2. **`packages/storage`**:
   - Storage collection `'modelAliases'` on SQLite `documents` table.
   - Helper methods if required for listing/fetching model aliases.
3. **`packages/runtime`**:
   - `ModelAliases` runtime service (`packages/runtime/src/modelAliases.ts`) implementing capture, lookup, mutation, and requirement extraction.
   - Update `packages/runtime/src/runStarts.ts` and `packages/runtime/src/index.ts` to capture `modelAliasCaptures` at run start (including child runs, batch items, continueAsNew chains).
   - Update `packages/runtime/src/providerDiversity.ts` to expand aliases in `node.model`, `node.candidateModels`, and workflow defaults into candidate lists.
   - Update `packages/runtime/src/index.ts` work creation to resolve alias candidate entries (mapping `model`, `effort`, `profileId`).
   - Update `packages/runtime/src/transfer.ts` to export and import model alias requirements in bundles.
   - Fix `packages/runtime/src/runProjection.ts` to check `work?.providerDiversityBlocked` right beside `work?.cwdBlocked` and project `kind: "human_request"`, `actor: "person"`.
4. **`packages/server` & `packages/mcp`**:
   - Add tRPC router `modelAliases` in `packages/server/src/router.ts`.
   - Add client bindings in `packages/client` and `packages/mcp/src/client.ts`.
   - Add MCP tool `manage_model_aliases` in `packages/mcp/src/server.ts` (or update server tool registration and system instructions).
5. **Documentation & Changeset**:
   - Update `docs/managed-executors.md`, `docs/architecture.md`, `docs/v1.md`.
   - Add patch changeset for `@type_of/interlock`.

## Implementation Steps & Verification Mapping

### Step 1: Core Schemas and Run Definitions (Maps to AC1, AC3, AC4)
- Define `ModelAliasCandidate`, `SavedModelAlias`, `ModelAliasCapture`, `ModelAliasRequirement`.
- Add `modelAliasCaptures` to `Run`.
- Add bundle format version 6 support with `modelAliases` requirements validation.
- Add `modelAliasReferences(definition)` utility in `packages/core`.

### Step 2: Runtime ModelAliases Service and Run-Start Pinning (Maps to AC1, AC3)
- Create `packages/runtime/src/modelAliases.ts` with CRUD, revision checking, and `capture(definition, inheritedCaptures)` methods.
- Integrate `engine.modelAliases` in `packages/runtime/src/index.ts`.
- Pin `modelAliasCaptures` at run start in `packages/runtime/src/index.ts`, ensuring continuity across continueAsNew, batch items, and child runs.
- Verify that editing an alias after run start does not affect the active run.

### Step 3: Candidate Resolution and Provider Diversity (Maps to AC2, AC5)
- Enhance `packages/runtime/src/providerDiversity.ts` to resolve aliases to candidate lists and evaluate providers against upstream completions.
- Enhance work dispatch in `packages/runtime/src/index.ts` to resolve aliases to the first available candidate (honoring model, effort, profileId).
- Update `packages/runtime/src/runProjection.ts` to handle `work?.providerDiversityBlocked` as `kind: "human_request"`, `actor: "person"`.

### Step 4: Bundle Export & Import (Maps to AC4)
- Update `packages/runtime/src/transfer.ts` to extract required model aliases during `exportWorkflows` without local candidates.
- Update `importWorkflows` to validate alias requirements and ensure required aliases are noted.

### Step 5: Server Router & MCP Tools (Maps to AC1)
- Add `modelAliases` router to `packages/server/src/router.ts`.
- Expose MCP tool `manage_model_aliases` in `packages/mcp/src/server.ts` with actions `list`, `inspect`, `create`, `update`, `delete`.
- Update MCP system prompt instructions.

### Step 6: Tests and Documentation (Maps to AC1 - AC5)
- Add comprehensive test suite in `tests/modelAliases.test.ts` covering:
  - Alias creation, revision checking, updates, and deletion.
  - Candidate fallback matching.
  - Run-start pinning and immunity to mid-run alias mutations.
  - `distinctProviderFrom` integration with aliases and provider diversity blocker projection in `runProjection`.
  - Workflow bundle export and import of alias requirements.
- Run `pnpm test`, `pnpm build`, `pnpm format:check`.
- Update docs and create patch changeset.

## Risk Analysis & Targeted Failure Checks
1. **Mid-run mutation risk**: An alias is modified while a run is active.
   - *Direct check*: Start a run using an alias `builder -> model-A`. Mutate `builder -> model-B`. Advance the run and verify the dispatched execution/work uses `model-A` captured at start time.
2. **Provider diversity candidate exhaustion**: All candidates in an alias belong to excluded providers.
   - *Direct check*: Upstream node used Anthropic. Alias `reviewer` has candidates all from Anthropic. Work must remain unclaimed with `providerDiversityBlocked` reason `provider_diversity_exhausted`, and `runProjection` must project `human_request` / `person`.
3. **Bundle export leakage**: Local candidate profiles or overrides leak into exported bundles.
   - *Direct check*: Export a workflow referencing `builder`. Verify bundle only contains requirement `{ name: "builder" }` with no candidate list or private profile IDs.

## Open Questions
- None.
