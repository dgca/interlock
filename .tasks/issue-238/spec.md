# Specification: H11 Provider-Diversity Constraint for Independent Review (`distinctProviderFrom`)

## Baseline Information
- **Task Branch**: `feat/issue-238`
- **Base Commit**: `29a145daa737cf44278eda3a5c690aef2c0f5372`
- **Issue**: dgca/interlock#238
- **Worktree**: `/Users/dan/dev/interlock-worktrees/issue-238`
- **Intent Reference**: See [intent.md](intent.md) for problem statement, outcome, scope, and constraints.

---

## 1. Declarative Schema (`packages/core`)

### 1.1 Agent Node Schema
On `kind: 'agent'` nodes in `WorkflowDefinition`:
- `distinctProviderFrom?: string[]`:
  - List of upstream node IDs whose execution model provider must be distinct from this node's provider.
  - Optional; when present, must contain at least one non-empty string.
- `candidateModels?: string[]`:
  - Ordered list of model names or profile identifiers to evaluate for provider diversity selection.
  - Optional; when present, must contain at least one non-empty string.

### 1.2 Workflow Definition Validation & Draft Diagnostics
- Every node ID referenced in `distinctProviderFrom` must exist within the workflow definition.
- A node cannot reference itself in `distinctProviderFrom`.
- Draft diagnostics surface warnings/errors when `distinctProviderFrom` references non-existent nodes or non-Agent nodes.

### 1.3 Executor Profile & Settings Schema
- `executorProfileSchema`:
  - Optional `provider?: string`: Explicit provider identity override for the profile (e.g., `'anthropic'`, `'openai'`, `'google'`, `'mistral'`, `'deepseek'`).
- `executorSettingsSchema` & `executorSettingsUpdateSchema`:
  - Optional `providerPrefixes?: Record<string, string>`: Configurable prefix-to-provider mappings extending or overriding the default table.

### 1.4 WorkRequest Schema
On `WorkRequest` (`packages/core/src/index.ts`):
- `distinctProviderFrom?: string[]`: Captured from the Agent node.
- `candidateModels?: string[]`: Captured from the Agent node.
- `providerDiversityBlocked?: { reason: 'provider_diversity_unmet' | 'provider_diversity_exhausted'; excludedProviders: string[]; details?: string }`:
  - Blocker metadata present when diversity constraints cannot be satisfied.

---

## 2. Provider Resolution & Diversity Logic (`packages/runtime`)

### 2.1 Provider Identity Resolution Hierarchy
To determine the provider of a model, profile, or catalog entry, the runtime checks in order:
1. **Model ID prefix slash notation**: If the model string contains a slash (e.g., `provider/model` such as `anthropic/claude-3-5-sonnet`, `openai/gpt-4o`, `google/gemini-2.0-flash`), the substring before the first `/` is the normalized provider (e.g., `'anthropic'`, `'openai'`, `'google'`).
2. **Profile Explicit Provider**: If an `ExecutorProfile` has an explicit non-empty `provider` property, that provider string is used.
3. **Harness Catalog Reported Provider**: If the harness catalog reports a `provider` for the model (e.g., Pi catalog `model.provider`), that provider is used.
4. **Configured Provider-Prefix Table**: Lookup in `settings.providerPrefixes` matching model name prefixes.
5. **Default Provider-Prefix Table**:
   - `claude*` -> `'anthropic'`
   - `gpt*`, `chatgpt*`, `o1*`, `o3*`, `o4*` -> `'openai'`
   - `gemini*` -> `'google'`
   - `deepseek*` -> `'deepseek'`
   - `mistral*`, `codestral*` -> `'mistral'`
   - `qwen*` -> `'alibaba'`
   - `llama*` -> `'meta'`
6. If no provider matches, provider identity is `null` (unknown). All comparisons are case-insensitive and trimmed.

### 2.2 Excluded Upstream Providers Determination
For an Agent node declaring `distinctProviderFrom: string[]`:
- For each `upstreamNodeId` in `distinctProviderFrom`:
  - Find the latest completed execution of `upstreamNodeId` in `run.executions`.
  - Extract provider from:
    1. `execution.provenance.provider` if non-null,
    2. or resolve from `execution.provenance.actualModel`, `execution.provenance.requestedModel`, or `execution.provenance.profileId`.
    3. If the upstream node was part of a continuity group with a pinned model/provider, inspect the continuity session's model/provider.
  - If any referenced upstream node has NOT completed an accepted execution, or its provider cannot be determined (`null`), upstream providers are considered unknown.
  - In this case, Interlock leaves the work unclaimed and sets `providerDiversityBlocked = { reason: 'provider_diversity_unmet', excludedProviders: [...] }`.

### 2.3 Candidate Selection at Dispatch & Claim Time
When evaluating a node with `distinctProviderFrom`:
- Collect all candidate models from:
  1. `node.candidateModels` if specified,
  2. otherwise `[node.model]` if specified,
  3. otherwise `[profile.model]` if an executor profile is configured.
- Evaluate candidates in given array order:
  - For candidate `c`:
    - Resolve candidate provider `p`.
    - If `p` is known and `p` is NOT in the set of excluded upstream providers:
      - Select candidate `c`!
      - Assign `work.executorModel = c` and clear any provider diversity blocker.
      - If candidate models are exhausted without finding an acceptable provider:
        - Work remains unclaimed with `providerDiversityBlocked = { reason: 'provider_diversity_exhausted', excludedProviders: [...] }`.
        - The engine never silently falls back to an excluded provider.

### 2.4 Continuity Group Interaction
- If an Agent node belongs to a `continuityGroup` that is already pinned to an existing session with an established model/provider:
  - Verify whether that pinned provider is in `excludedProviders`.
  - If the pinned provider conflicts with upstream providers:
    - The work is blocked (`provider_diversity_exhausted` or `provider_diversity_unmet`) to preserve continuity integrity without violating diversity constraints.
  - If the continuity group is not yet pinned, candidate selection proceeds normally and pins the selected model upon the first claim.

### 2.5 Continuation & Blocker Reasons
- In `packages/runtime/src/continuation.ts`:
  - When an assignment has `providerDiversityBlocked`:
    - Blocker reason reports `assignment.providerDiversityBlocked.reason` (`'provider_diversity_unmet'` or `'provider_diversity_exhausted'`).
  - Briefings expose the diversity blocker in `run.blockers`.

---

## 3. Acceptance Criteria

- **AC1: Schema Declaration**:
  `kind: 'agent'` nodes accept optional `distinctProviderFrom: string[]` and `candidateModels: string[]`. Invalid node references are flagged during definition validation.
- **AC2: Deterministic Candidate Selection**:
  Interlock iterates `candidateModels` in order and selects the first candidate whose provider does not collide with the upstream nodes' recorded execution provenance providers.
- **AC3: Multiple Upstream Nodes**:
  `distinctProviderFrom` can reference multiple upstream nodes (e.g. `['author', 'review1']`). The candidate selected must differ from all resolved upstream providers.
- **AC4: Provider Resolution Order**:
  Provider identity is resolved by checking slash prefix (`provider/model`), profile `provider`, harness catalog provider, configured prefix table, and built-in prefix defaults.
- **AC5: Fallback Rejection & Explicit Blockers**:
  If upstream providers cannot be determined, the work remains unclaimed with blocker reason `provider_diversity_unmet`.
  If all candidates belong to excluded providers, the work remains unclaimed with blocker reason `provider_diversity_exhausted`. Work never silently executes on an excluded provider.
- **AC6: Continuity Group Preservation**:
  A continuity group with a pinned model/provider is checked against `distinctProviderFrom`. If the pinned provider collides, work is blocked rather than silently switching models.
- **AC7: Documentation & Changeset**:
  `docs/managed-executors.md`, `docs/architecture.md`, and `docs/v1.md` are updated. A patch changeset is added for `@type_of/interlock`.

---

## 4. UI Proposal (Brief)
The Node Inspector for Agent nodes:
- Displays a "Provider Diversity" section when editing Agent nodes.
- Multi-select or tag input for `distinctProviderFrom` listing upstream Agent nodes in the workflow.
- Ordered list input for `candidateModels`.
- Work panel & Run Inspector display a badge or blocker alert when an assignment is blocked on `provider_diversity_unmet` or `provider_diversity_exhausted`, showing the excluded providers and candidate status.
