# Specification: H10: Execution provenance bindings & node visitCount

## Reference
- **Intent**: [intent.md](./intent.md)
- **Issue**: dgca/interlock#237

## Acceptance Criteria

### AC1: Engine-Verified Execution Provenance Schema & Population
Every accepted node completion in Interlock records a tamper-proof provenance record on `NodeExecution`:
```ts
export interface ExecutionProvenance {
  profileId: string | null;
  harness: string | null;
  sessionId: string | null;
  requestedModel: string | null;
  actualModel: string | null;
  provider: string | null;
  effort: string | null;
  attempt: number;
  visitCount: number;
  startedAt: string | null;
  endedAt: string | null;
  usage: ModelUsage[] | null;
}
```
1. **Managed Agent Execution**: When an Agent node completes via `ExecutorManager`, the manager populates provenance using verified runtime data:
   - `profileId`: The executor profile ID (e.g. `"codex"`, `"claude"`, `"pi"`).
   - `harness`: The harness name (e.g. `"codex"`, `"claude"`, `"pi"`).
   - `sessionId`: The session identifier (e.g. native session ID or continuity session key).
   - `requestedModel`: The requested model ID or alias, or null if unspecified.
   - `actualModel`: The actual model ID returned by the harness/provider, or requestedModel if actual is not separately reported.
   - `provider`: The provider name (e.g. `"openai"`, `"anthropic"`), or null if unknown.
   - `effort`: The thinking effort (e.g. `"low"`, `"medium"`, `"high"`), or null.
   - `attempt`: 1-based attempt number for this work execution.
   - `visitCount`: 1-based count of completed executions of this `nodeId` in the current run and batch scope.
   - `startedAt`: ISO timestamp when execution started.
   - `endedAt`: ISO timestamp when execution finished.
   - `usage`: Array of `ModelUsage` records reported for this execution, or null if unknown.
2. **Unmanaged / Other Nodes**: For unmanaged Agent nodes, Scripts, Fetches, Conditions, Switches, Waits, Entries, Exits, and Workflows:
   - Fields not applicable (e.g. `profileId`, `harness`, `sessionId`, `requestedModel`, `actualModel`, `provider`, `effort`, `usage`) are set to `null`.
   - `attempt`, `visitCount`, `startedAt`, `endedAt` are always recorded.
3. **Anti-Spoofing Guarantee**:
   Provenance is created and assigned directly by the engine and executor manager when completing a node execution. Any fields matching `provenance` in the agent's submitted output JSON are ignored and have no effect on `execution.provenance`.

### AC2: Node Visit Count (`visitCount`)
1. In any run, the engine computes `visitCount` for a node execution as `1 + priorCompletedVisits`, where `priorCompletedVisits` is the count of previously completed executions for that `nodeId` in the same run and batch scope.
2. The initial completion of `<nodeId>` receives `visitCount: 1`.
3. Subsequent loop iterations visiting the same `<nodeId>` receive `visitCount: 2`, `visitCount: 3`, etc.
4. Failures or retries within an uncompleted visit do not increment `visitCount`; `visitCount` only reflects completed visits.

### AC3: Execution Value Binding Source (`source: "execution"`)
1. Extend `ValueBinding` and `ValueBindingInput` schemas in `packages/core`:
   ```ts
   | {
       source: 'execution';
       nodeId: string;
       path: string;
       default?: Json;
       sourceDefault?: Json;
     }
   ```
2. In `resolveBindingFields`, when `binding.source === 'execution'`:
   - Interlock finds the latest completed execution of `nodeId` in the run and batch scope, and reads its `provenance` record.
   - If no completed execution exists for `nodeId`:
     - If `sourceDefault` is provided, return `sourceDefault`.
     - Otherwise, fail with an `InterlockError`: `Node "<nodeId>" has no completed execution in this run`.
   - If the completed execution has provenance:
     - Read `binding.path` from `execution.provenance`.
     - If the path is missing or undefined:
       - If `default` is provided, return `default`.
       - Otherwise, fail with an `InterlockError`: `Input has no path "<path>"`.
3. Support `execution.<nodeId>.visitCount` as shorthand or direct path binding:
   `{ source: "execution", nodeId: "<nodeId>", path: "visitCount" }`.

### AC4: Branch Conditions and Standalone Switches
1. Branch nodes (`condition` and `switch`) can bind execution metadata into their evaluated input using `inputBindings`, for example:
   ```json
   {
     "inputBindings": {
       "attempts": {
         "source": "execution",
         "nodeId": "repairStep",
         "path": "visitCount",
         "sourceDefault": 0
       }
     },
     "path": "attempts",
     "cases": [
       { "port": "retry", "equals": 1 },
       { "port": "retry", "equals": 2 }
     ],
     "default": "escalate"
   }
   ```
2. Also support direct routing on execution provenance where `source: "execution"` is used.

### AC5: Script Provenance Injection via `INTERLOCK_EXECUTION_PROVENANCE_FILE`
1. Before running a Script node (foreground or background), the runtime writes a JSON file containing the provenance of all prior completed node executions in the current run:
   ```json
   {
     "<nodeId>": {
       "visitCount": 2,
       "latest": {
         "profileId": "codex",
         "harness": "codex",
         "sessionId": "...",
         "requestedModel": "o3-mini",
         "actualModel": "o3-mini",
         "provider": "openai",
         "effort": "medium",
         "attempt": 1,
         "visitCount": 2,
         "startedAt": "...",
         "endedAt": "...",
         "usage": [...]
       },
       "history": [
         { ...visit 1... },
         { ...visit 2... }
       ]
     }
   }
   ```
2. The runtime sets the environment variable `INTERLOCK_EXECUTION_PROVENANCE_FILE` to the absolute path of this file.
3. For cleanup, temporary provenance files are placed in an isolated temporary location or the run's scratch directory and cleaned up when the script completes or is destroyed.

### AC6: Run Inspection & MCP
1. `NodeExecution` in `get_run`, MCP tool responses, run summaries, and `list_runs` preserves `provenance`.
2. UI / Inspector can display `provenance` (profile, model, effort, visitCount) on node executions.

### AC7: Verification & Tests
1. **Anti-Spoofing Test**: An Agent returns `{ provenance: { actualModel: "gpt-4o", visitCount: 99 } }` or `{ result: { ... } }`; verify that the stored `execution.provenance` reflects engine data (e.g. `actualModel: "claude-3-5-sonnet"` or test profile, `visitCount: 1`), not the agent payload.
2. **Binding Test**: Node input bindings with `{ source: "execution", nodeId: "agentA", path: "actualModel" }` resolve correctly. Missing node uses `sourceDefault`. Missing path uses `default`.
3. **Loop visitCount Test**: A workflow with a loop (`nodeA` -> `branch` -> (loop back to `nodeA` if visitCount < 3)) increments `visitCount` from 1 to 2 to 3, and terminates when reaching 3.
4. **Script Provenance Test**: A script reads `process.env.INTERLOCK_EXECUTION_PROVENANCE_FILE`, parses the JSON, and asserts on prior node provenance.

### AC8: Documentation & Changeset
1. Docs updated:
   - `docs/node-data.md`: Detail `source: "execution"`, `visitCount`, and provenance field schema.
   - `docs/agent-workflows.md`: Document review gates and loop control patterns with provenance.
   - `docs/managed-executors.md`: Document engine-verified execution provenance and model tracking.
   - `docs/architecture.md`: Document provenance recording and anti-spoofing architectural boundary.
   - `docs/v1.md`: Update limits/capabilities to include execution provenance bindings and visitCount.
2. Add a patch changeset in `.changeset/` for `@type_of/interlock`.
