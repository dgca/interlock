# Intent: H11: Provider-diversity constraint for independent review (distinctProviderFrom)

## Baseline Information
- **Task Branch**: `feat/issue-238`
- **Base Commit**: `29a145daa737cf44278eda3a5c690aef2c0f5372`
- **Issue**: dgca/interlock#238
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-238`

## Problem Statement
Multi-agent review and verification workflows require review steps (e.g., code review, security audit, architecture evaluation) to run on distinct model providers from the author and each other (e.g., Anthropic vs. OpenAI vs. Google). Today, enforcing distinct model providers requires custom external orchestrator scripts or complex manual routing logic.
1. **Lack of Declarative Provider Diversity Constraints**: Agent nodes cannot declaratively express that their assigned model or executor profile must belong to a different provider than the models used by specified upstream Agent nodes.
2. **Provider Resolution & Provenance Matching**: Without native support, orchestrators cannot easily match candidate models against actual recorded model execution provenance (from H10) or resolve provider identity across diverse harnesses (Pi harness catalog `provider/model`, profile `provider`, or prefix fallbacks).
3. **Risk of Silent Fallback**: If candidates are exhausted or upstream providers are unknown, naive fallbacks risk assigning the same provider, invalidating independent review guarantees. A clear blocker reason must leave the work unclaimed.

## Desired Outcome
1. **Declarative Constraint on Agent Nodes**:
   - Agent nodes can declare `distinctProviderFrom: string[]` (referencing upstream Agent `nodeId`s).
   - Agent nodes can declare an ordered list of candidate models (e.g. `candidateModels?: string[]` or candidate profile/model targets).
2. **Deterministic Candidate Selection at Dispatch/Claim Time**:
   - At dispatch or claim time, Interlock evaluates candidate models in order and selects the first candidate whose provider differs from the actual providers recorded in execution provenance by the latest accepted executions of the referenced upstream nodes.
   - Provider identity is resolved using:
     a) Harness catalog when reported (e.g. Pi harness `provider/model`),
     b) Profile `provider` field if present, or
     c) Configurable local provider-prefix table in server settings (e.g. `claude*` -> `anthropic`, `gpt*`/`o*` -> `openai`, `gemini*` -> `google`).
   - Continuity groups: respects continuity group pinned model/provider when applicable.
3. **Explicit Blocker on Exhaustion or Unknown Upstream**:
   - If referenced upstream nodes have unknown providers (e.g. not executed yet or provider cannot be determined), or if all candidate models belong to excluded providers, the work remains unclaimed with an explicit blocker reason (e.g., `provider_diversity_unmet` or `provider_diversity_exhausted`). Work never silently falls back to an excluded provider.
4. **Comprehensive Documentation & Changeset**:
   - Update `docs/managed-executors.md`, `docs/architecture.md`, and `docs/v1.md`.
   - Add a patch changeset for `@type_of/interlock`.

## Affected Users and Systems
- **Workflow Authors**: Can declare independent review constraints directly on Agent nodes without external glue scripts.
- **`packages/core`**: Schema validation and node types for `distinctProviderFrom` and `candidateModels`.
- **`packages/runtime`**: `ExecutorManager`, `advance()` continuation, provider resolution logic, candidate evaluation, and continuation blocker reasons.
- **`packages/server` & `packages/mcp`**: Server settings for provider prefix mapping and MCP tool awareness.

## Settled Decisions
- **Anti-Collusion Guarantee**: Review assignments will never silently fall back to an excluded provider.
- **Precedence Order for Provider Resolution**:
  1. Explicit `provider` on executor profile or catalog entry (e.g. Pi harness `provider/model` or executor metadata).
  2. Configurable provider-prefix table (defaults: `claude*` -> `anthropic`, `gpt*`/`o*` -> `openai`, `gemini*` -> `google`, etc.).
- **Blocker Semantics**: Work with unmet provider diversity conditions is flagged as blocked (`provider_diversity_unmet` / `provider_diversity_exhausted`), visible in run briefings and blocker queries.

## Open Questions
- None. Requirements and scope are clear.
