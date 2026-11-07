# Implementation Plan: H10: Execution provenance bindings & node visitCount

## Reference
- **Intent**: [intent.md](./intent.md)
- **Specification**: [spec.md](./spec.md)
- **Issue**: dgca/interlock#237

## Implementation Steps

### 1. Core Schema and Types (`packages/core`)
- **ExecutionProvenance**:
  - Define `ExecutionProvenance` interface and `executionProvenanceSchema` in `packages/core/src/index.ts`.
  - Add optional `provenance?: ExecutionProvenance` to `NodeExecution`.
- **ValueBinding with `source: 'execution'`**:
  - Update `ValueBinding` and `ValueBindingInput` union types to include:
    `{ source: 'execution'; nodeId: string; path: string; default?: Json; sourceDefault?: Json }`.
  - Update `valueBindingSchema` to accept `source: 'execution'` with `nodeId`, `path`, optional `default`, and optional `sourceDefault`.
- **Binding Resolution & Diagnostics**:
  - Update `packages/core/src/valueBindings.ts`:
    - Handle `b.source === 'execution'` in `resolveBindingFields`, `bindingLeaves`, `bindingContract`, and error reporting for missing completed execution.
  - Update `packages/core/src/draftDiagnostics.ts`:
    - Validate `source: 'execution'` bindings (ensure referenced `nodeId` exists in definition, excluded entry/exit nodes, etc.).
  - Update `packages/core/src/layout/inputBindings.ts`:
    - Ensure `bindingNodeIds` includes nodes referenced via `source: 'execution'`.

### 2. Runtime Node Provenance & Visit Count (`packages/runtime`)
- **`packages/runtime/src/nodeData.ts`**:
  - Create new module `packages/runtime/src/nodeData.ts`.
  - Implement `calculateVisitCount(executions: NodeExecution[], nodeId: string): number`.
  - Implement `createExecutionProvenance(options: CreateProvenanceOptions): ExecutionProvenance`.
  - Ensure anti-spoofing: provenance is assembled strictly from engine state and manager records; any output properties named `provenance` are ignored.
- **Engine Completion & Manager Integration**:
  - In `packages/runtime/src/index.ts`:
    - When completing a node execution in `finish(...)`:
      - Calculate `visitCount` (1-based completed execution count of this `nodeId` in this run/batch scope).
      - Build and assign `execution.provenance`.
      - For managed agent executions, pull profileId, harness, sessionId, requestedModel, actualModel, provider, effort, attempt, and usage from the `ExecutorManager` session and execution record.
      - For scripts, fetches, branches, and unmanaged executions, fill applicable fields and set remaining fields to `null`.
    - In `bindingSource(...)`:
      - Handle `binding.source === 'execution'`:
        - Find the latest completed execution of `binding.nodeId` in the run and batch scope.
        - Return `execution.provenance` as JSON.
- **Script Provenance Injection (`packages/runtime/src/scripts.ts`)**:
  - In `executeScript(...)`:
    - Serialize completed execution provenance history for the run into a temporary JSON file.
    - Set environment variable `INTERLOCK_EXECUTION_PROVENANCE_FILE` to the temporary file path.
    - Clean up the temporary file upon execution completion.
- **Continuation & Inspection (`packages/runtime/src/continuation.ts`)**:
  - Ensure `execution.provenance` is preserved and serialized in continuation briefings, run inspection, and summaries.

### 3. Server, MCP & UI Integration (`packages/server`, `packages/mcp`, `packages/ui`)
- Audit MCP server responses and tools to ensure `execution.provenance` is exposed in run inspection.
- Update UI input binding editor if needed to support `source: "execution"`.

### 4. Tests & Verification
- Add comprehensive tests in `tests/nodeData.test.ts`:
  - **AC1 & AC7**: Agent spoofing test - verify an agent returning `{ provenance: { ... } }` in output does not corrupt or overwrite `execution.provenance`.
  - **AC2**: Loop visit counting test - verify `visitCount` is 1 on first pass, 2 on second pass, 3 on third pass.
  - **AC3**: Binding resolution test - verify `source: "execution"` resolves `profileId`, `actualModel`, `visitCount`, `sourceDefault`, and `default`.
  - **AC4**: Branch condition routing test - verify a Branch node routes based on `visitCount` bound from `execution`.
  - **AC5**: Script provenance file test - verify a script receives `INTERLOCK_EXECUTION_PROVENANCE_FILE` and can read prior node provenance.

### 5. Documentation & Changeset
- Update documentation:
  - `docs/node-data.md`: Add `source: "execution"`, `visitCount`, and provenance schema details.
  - `docs/agent-workflows.md`: Document review gates and loop control with `visitCount`.
  - `docs/managed-executors.md`: Document execution provenance and verified model tracking.
  - `docs/architecture.md`: Document provenance recording and anti-spoofing architectural boundary.
  - `docs/v1.md`: Update capabilities and limits.
- Add patch changeset for `@type_of/interlock` in `.changeset/`.

## Risk Analysis & Negative Checks
- **Risk 1: Agent Spoofing**: An agent attempts to forge provenance by returning `{ profileId: "codex", actualModel: "o3-mini", visitCount: 1 }` in its JSON payload.
  - *Direct Check*: Assert `execution.provenance` matches engine truth and ignores agent output payload completely.
- **Risk 2: Uncompleted Node Reference**: A binding references a node that hasn't completed yet in the current run.
  - *Direct Check*: With `sourceDefault`, returns `sourceDefault`. Without `sourceDefault`, throws descriptive error: `Node "<nodeId>" has no completed execution in this run`.
- **Risk 3: Loop Infinite Recursion or Off-by-One in visitCount**:
  - *Direct Check*: Multi-iteration loop test verifying exact progression of `visitCount`: 1, 2, 3.
- **Risk 4: Temporary File Leaks in Scripts**:
  - *Direct Check*: File cleanup verified in finally blocks.

## Verification Ownership
- **Build stage**: Implementation of core, runtime, server, mcp, tests (`pnpm test`, `pnpm build`, `pnpm format:check`), docs, changeset, and git commits.
- **Review stage**: Independent fresh-context verification of diff, boundary integrity, and test coverage (delegated to review agent).
