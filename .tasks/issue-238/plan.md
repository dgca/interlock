# Implementation Plan: H11 Provider-Diversity Constraint (`distinctProviderFrom`)

## Baseline Information
- **Task Branch**: `feat/issue-238`
- **Base Commit**: `29a145daa737cf44278eda3a5c690aef2c0f5372`
- **Issue**: dgca/interlock#238
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-238`
- **Intent Reference**: See [intent.md](intent.md)
- **Specification Reference**: See [spec.md](spec.md)

---

## 1. Intended Code Areas & Changes

### 1.1 Core Contracts & Types (`packages/core`)
- **`packages/core/src/providerDiversity.ts`**:
  - Define `defaultProviderPrefixes: Record<string, string>` (`claude*` -> `anthropic`, `gpt*`/`chatgpt*`/`o1*`/`o3*`/`o4*` -> `openai`, `gemini*` -> `google`, `deepseek*` -> `deepseek`, `mistral*`/`codestral*` -> `mistral`, `qwen*` -> `alibaba`, `llama*` -> `meta`).
  - Define `resolveProvider(model?: string | null, profile?: { provider?: string; harness?: string } | null, prefixOverrides?: Record<string, string>): string | null`.
  - Normalization: trim, lowercase provider identifiers.
  - Export types `ProviderDiversityBlock`.
- **`packages/core/src/index.ts`**:
  - Export everything from `providerDiversity.ts`.
  - Add `distinctProviderFrom: z.array(z.string().min(1)).optional()` and `candidateModels: z.array(z.string().min(1)).optional()` to `nodeShapeSchema` (`kind: 'agent'`).
  - Add `distinctProviderFrom?: string[]`, `candidateModels?: string[]`, `providerDiversityBlocked?: ProviderDiversityBlock` to `WorkRequest`.
  - Add validation in `validateDefinition`: verify that node IDs listed in `distinctProviderFrom` exist in the workflow and do not reference the node itself.
- **`packages/core/src/executors.ts`**:
  - Add `provider: z.string().trim().min(1).max(200).optional()` to `executorProfileSchema`.
  - Add `providerPrefixes: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional()` to `executorSettingsSchema` and `executorSettingsUpdateSchema`.

### 1.2 Runtime Evaluation & Dispatch (`packages/runtime`)
- **`packages/runtime/src/providerDiversity.ts`**:
  - Evaluation helper `evaluateProviderDiversity(run: Run, node: AgentNode, store: Store, settings?: ExecutorSettings): ProviderDiversityResult`.
  - Checks each node ID in `distinctProviderFrom`:
    - Finds latest completed execution in `run.executions`.
    - Reads provenance provider or resolves provider from actualModel/requestedModel/profileId.
    - If unknown/missing: returns `{ status: 'blocked', reason: 'provider_diversity_unmet', excludedProviders: [...] }`.
  - Gathers candidate models (`node.candidateModels ?? [node.model] ?? [profile.model]`).
  - Evaluates candidate models in order: selects first whose provider is known and not in `excludedProviders`.
  - If continuity group is active and pinned to a session: verifies pinned model/provider against `excludedProviders`. If conflicting, returns blocked status to preserve continuity.
  - If candidates exhausted: returns `{ status: 'blocked', reason: 'provider_diversity_exhausted', excludedProviders: [...] }`.
- **`packages/runtime/src/index.ts` (`advance()` & `claim()`):**
  - In `advance()` for `kind: 'agent'`:
    - Call provider diversity evaluation when `node.distinctProviderFrom` is defined.
    - If blocked: store work as available but with `providerDiversityBlocked = { reason, excludedProviders }`. Work cannot be claimed.
    - If candidate selected: set `work.executorModel = candidate`, `work.executorModelSource = 'node'`.
  - In `claim()`:
    - Enforce that work with `providerDiversityBlocked` cannot be claimed (throws `InterlockError('Work is blocked: provider diversity constraint unmet')`).
- **`packages/runtime/src/continuation.ts`**:
  - In `blockers` mapping:
    - If `assignment?.providerDiversityBlocked`, map reason to `assignment.providerDiversityBlocked.reason` (`'provider_diversity_unmet'` or `'provider_diversity_exhausted'`).
- **`packages/runtime/src/executors/manager.ts`**:
  - In `scan()`: skip offered work if `offered.providerDiversityBlocked`.
  - In `executionProvenance()`: resolve provider using profile explicit `provider` or prefix table if usage provider is absent.

### 1.3 MCP Definitions (`packages/mcp`)
- **`packages/mcp/src/server.ts`**:
  - Mention `provider_diversity_unmet` and `provider_diversity_exhausted` blocker reasons in server instructions and tool documentation.

### 1.4 Tests (`tests/providerDiversity.test.ts`)
- Unit and integration tests covering:
  - AC1: Schema validation and definition checks for `distinctProviderFrom`.
  - AC2: First candidate model selected whose provider differs from upstream node.
  - AC3: Multiple upstream nodes referenced (e.g. author and review1); reviewer2 selects 3rd distinct provider.
  - AC4: Provider resolution via slash notation (`openai/gpt-4o`), profile `provider`, and prefix mapping.
  - AC5: Upstream unexecuted/unknown provider leads to `provider_diversity_unmet`; candidate list exhausted leads to `provider_diversity_exhausted`. Work is never claimed or executed.
  - AC6: Continuity group pinned model checked against diversity constraints; conflicting pin blocks work.

### 1.5 Documentation & Changeset
- **`docs/managed-executors.md`**: Document `distinctProviderFrom`, candidate models, provider prefix tables, and blocker states.
- **`docs/architecture.md`**: Document multi-agent provider diversity constraints in review workflows.
- **`docs/v1.md`**: Update feature scope notes.
- **`.changeset/provider-diversity-constraint.md`**: Add patch changeset for `@type_of/interlock`.

---

## 2. Risk Analysis & Verification Plan

| Risk | Mitigation & Direct Check | Planned Stage |
| --- | --- | --- |
| Silent fallback to same provider when candidates fail | Explicit test ensuring `provider_diversity_exhausted` is assigned and work remains unclaimed. Attempting to claim throws error. | Build |
| Premature dispatch before upstream node executes | Test where upstream node has not run yet; downstream node with `distinctProviderFrom` must report `provider_diversity_unmet`. | Build |
| Case sensitivity or formatting differences (`Anthropic` vs `anthropic`) | Normalization in `resolveProvider` converts to lowercase trimmed tokens. | Build |
| Breaking changes to existing Agent nodes | `distinctProviderFrom` and `candidateModels` are optional; existing Agent nodes without constraints continue unmodified. | Build |
| Continuity group corruption | Test verifying that an existing continuity group session is preserved and checked against diversity constraints. | Build |

---

## 3. Execution Sequence
1. Implement types, schemas, and provider resolution functions in `packages/core`.
2. Implement runtime evaluation, dispatch, and blocker reasons in `packages/runtime`.
3. Update `packages/mcp` instructions and tool schemas.
4. Add comprehensive test suite in `tests/providerDiversity.test.ts`.
5. Run full test suite (`pnpm test`), typecheck/build (`pnpm build`), and format checks (`pnpm format:check`).
6. Update documentation and create changeset.
7. Commit changes on `feat/issue-238`.
8. Submit `plan` and `build` results.
