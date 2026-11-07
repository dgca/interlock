# Intent: M5: Revisioned model aliases

## Baseline Information
- **Task Branch**: `feat/issue-244`
- **Base Commit**: `74a3c430a9d1ac08a10bad490df6c3019deaa9bd`
- **Issue**: dgca/interlock#244
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-244`

## Problem Statement
Hardcoding specific model IDs across workflow nodes requires editing and republishing workflows whenever a model version is upgraded or deprecated.
1. **Lack of Logical Model Aliases**: Workflows currently specify explicit model strings (or profile IDs). When model versions change (e.g., `claude-3-5-sonnet` to `claude-3-7-sonnet`), all workflow definitions referencing them must be updated and republished.
2. **Deterministic Run Execution**: If model aliases are edited mid-run, active runs could experience unpredictable behavior or inconsistent candidate resolution across steps unless alias revisions are captured deterministically at run start (mirroring `variableCaptures`).
3. **Candidate Fallback and Profile/Effort Control**: Aliases need to support an ordered candidate list of `{ model, effort?, profileId? }`, allowing graceful fallback when preferred models or profiles are unavailable or constrained.
4. **Portability and Bundle Cleanliness**: Exported portable workflow bundles must declare alias requirements rather than baking in local environment overrides or local executor profile bindings.
5. **Missing Provider Diversity Run Projection**: Runs blocked by `distinctProviderFrom` currently lack explicit projection in `packages/runtime/src/runProjection.ts` beside `work?.cwdBlocked`, preventing them from projecting `kind: "human_request"`, `actor: "person"` with provider-diversity guidance.

## Desired Outcome
1. **Locally Configured, Revisioned Model Aliases**:
   - Model aliases (e.g., `builder`, `reviewer`, `evaluator`) mapping to an ordered list of candidate entries: `{ model: string, effort?: string, profileId?: string }`.
   - Stored with deterministic revisioning in local storage.
2. **Seamless Alias References in Workflows & Agent Nodes**:
   - Workflows, Agent nodes, and `distinctProviderFrom` constraints can reference model aliases anywhere a model ID is accepted.
   - Fallback order is respected during executor candidate matching.
3. **Run-Start Alias Pinning**:
   - Runs capture resolved alias revisions at start time alongside `variableCaptures` so that edits to local aliases never mutate in-flight runs.
4. **Bundle Portability**:
   - Portable bundles export required alias names and specifications without bundling private local executor profiles or overrides.
5. **Provider Diversity Run Projection Fix**:
   - `packages/runtime/src/runProjection.ts` includes the missing `work?.providerDiversityBlocked` check right beside `work?.cwdBlocked` to project `kind: "human_request"`, `actor: "person"`.
6. **Documentation & Release Artifacts**:
   - Update `docs/managed-executors.md`, `docs/architecture.md`, `docs/v1.md`.
   - Add a patch changeset for `@type_of/interlock`.

## Affected Users and Systems
- **Workflow Authors & Operators**: Can configure reusable model aliases locally and use them across workflows.
- **`packages/core`**: Schema definitions and validation for model aliases, candidate lists, and captured alias revisions.
- **`packages/storage`**: Local storage collection for model aliases with revision tracking.
- **`packages/runtime`**: `runStarts.ts` pinning of alias captures, `ExecutorManager` resolution/fallback, and `runProjection.ts` provider diversity blocker projection.
- **`packages/server` & `packages/mcp`**: Endpoints and MCP tools for managing model aliases, plus bundle export/import support.

## Settled Decisions
- Model aliases support ordered candidate entries specifying `model`, optional `effort`, and optional `profileId`.
- Alias revisions are captured at run start in the run record (e.g., `modelAliasCaptures`), ensuring immutable run semantics.
- Portable bundles export alias requirements without local overrides.
- Runs blocked by provider diversity project `kind: "human_request"`, `actor: "person"` with the provider diversity blocker reason.

## Open Questions
- None. Requirements and scope are clear.
