# Specification: M5: Revisioned model aliases

## Overview and Reference
This specification defines the functional requirements, schemas, runtime execution rules, and export contracts for revisioned model aliases in Interlock.
For problem background, high-level outcomes, constraints, and baseline information, refer to [intent.md](intent.md).

## Acceptance Criteria

### AC1: Locally Configured, Revisioned Model Aliases
- Interlock provides a dedicated storage collection and schemas for Model Aliases (e.g. `builder`, `reviewer`, `evaluator`).
- Each model alias record contains:
  - `id`: unique identifier (or alias name if identity is slug/name).
  - `name`: unique alias name / identifier (e.g., `builder`, `reviewer`) adhering to identifier rules (`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`).
  - `description`: optional human description.
  - `candidates`: ordered non-empty list of candidate targets: `{ model: string, effort?: string, profileId?: string }`.
  - `revision`: integer revision number incremented on each mutation.
  - `createdAt`: ISO timestamp.
  - `updatedAt`: ISO timestamp.
- Server API and MCP tools provide query and management operations:
  - List aliases, get alias by ID or name, create alias, update alias (with revision protection), and delete alias.

### AC2: Dynamic Alias References in Workflows and Agent Nodes
- Anywhere a model ID is accepted (e.g., `definition.agentModel`, Agent node `model`, Agent node `candidateModels`), a model alias name can be specified.
- Agent node resolution:
  - If a model reference matches a configured model alias, the alias's ordered candidate list is expanded in place of that single model reference.
  - When matching executors/harnesses, candidates are evaluated in declared candidate order. The first available candidate is selected.
  - Profile ID and effort overrides declared on a candidate entry take effect when that candidate is selected, falling back to node/workflow defaults.
- Provider Diversity (`distinctProviderFrom`):
  - When evaluating provider diversity against upstream completions, aliases referenced in `model`, `candidateModels`, or workflow defaults expand to their candidate list.
  - The first candidate whose resolved provider differs from excluded upstream providers is selected.
  - If all candidates are excluded, the work is blocked with reason `provider_diversity_exhausted`.

### AC3: Deterministic Run-Start Pinning
- When a run is initialized (in `runStarts.ts` / `runtime/src/index.ts`):
  - Any model aliases referenced by the workflow definition (across `agentModel`, Agent `model`, Agent `candidateModels`) are resolved against current store state.
  - The run record captures these aliases and their revisions at start time in `modelAliasCaptures` (containing `aliasId`, `name`, `revision`, `candidates`).
  - Active runs use their pinned `modelAliasCaptures` during all execution and dispatch logic, guaranteeing that subsequent edits or deletions of local aliases never alter in-flight runs.
  - Continued runs, child runs, and batch items inherit or preserve `modelAliasCaptures` from their parent/predecessor context consistently with `variableCaptures`.

### AC4: Portable Workflow Bundle Export & Import
- Workflow bundles (`packages/core/src/transfer.ts` and `packages/runtime/src/transfer.ts`) include required model aliases:
  - Export inspects referenced aliases across the exported workflows (drafts and versions).
  - Exported bundles include `modelAliases` (or `aliases`) requirements declaring `{ name: string, description?: string }` without local candidate overrides (no local profile IDs or private environment bindings).
  - Bundle format version supports the alias requirement schema (formatVersion 6).
  - On import, missing alias requirements are validated and recorded, allowing callers or local environments to bind or configure local candidates for those required aliases.

### AC5: Run Projection for Provider Diversity Blockers
- In `packages/runtime/src/runProjection.ts`, right beside `work?.cwdBlocked`:
  - If `work?.providerDiversityBlocked` is present, the run's waiting status projects:
    - `kind: "human_request"`
    - `actor: "person"`
    - reason from `work.providerDiversityBlocked.reason` (or details)
    - timestamp from `work.createdAt ?? at`

## Decisions and Alternatives Considered
- **Alias Identification**: Aliases are referenced by name (e.g. `builder`, `reviewer`), which naturally fits workflow definitions where model names are currently strings. An alias can also have a stable ID, with `name` being unique.
- **Run Record Storage**: Storing full captured candidate lists with the revision in `modelAliasCaptures: ModelAliasCapture[]` ensures runs are self-contained and reproducible even if the alias is deleted locally later.
- **Bundling Cleanliness**: Bundles only declare alias requirements (name and description), preserving user privacy and portability across machines with different available models, API keys, or harness profiles.

## Open Questions
- None.
