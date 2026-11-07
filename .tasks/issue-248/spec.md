# Specification: M11: Simulation for parent workflows (waited children, virtual clock & route coverage)

## Baseline Reference
- **Intent**: [intent.md](./intent.md)
- **Task Branch**: `feat/issue-248`
- **Base Commit**: `edfd6cfab93e3144cd5010fc877864e6fb1fa52b`
- **Related Issue**: dgca/interlock#248 (Parent issue: #223)

---

## 1. Overview & Architecture

This specification extends Interlock's runtime fixture simulation (`packages/runtime/src/simulation.ts`, `packages/core/src/simulation.ts`) to support:
1. **Waited Child Workflows**: Simulating parent workflows that invoke child workflows (`node.kind === 'workflow'` where `node.mode !== 'detached'`), allowing child workflow nodes to be substituted via fixtures (`kind: 'workflow'`) or executed in the isolated simulation store with nested fixtures.
2. **Deterministic Virtual Clock**: Advancing a virtual clock instantly to scheduled deadlines for `wait` nodes (duration, timestamp, and polling checks) and Agent unclaimed deadlines, eliminating wall-clock sleep and avoiding live timeouts.
3. **Agent Unclaimed Timeouts & Failure Routing**: Simulating Agent unclaimed deadlines via `timedOut: true` fixtures that route across the `timeout` port, as well as `onFailure: "route"` branches across Script, Fetch, and waited Workflow nodes.
4. **Route / Edge Coverage Analysis**: Computing graph edge traversal metrics from execution traces against the definition's declared edges, recording covered edges, unvisited edges, and coverage percentage in simulation receipts and reports.

---

## 2. Acceptance Criteria

- **AC1: Waited Child Workflow Simulation**:
  - `simulationFixtureSchema` accepts `kind: 'workflow'`.
  - A fixture with `kind: 'workflow'` provides either `output` (JSON conforming to the child workflow's contract) or `error` (a string message).
  - When a waited `workflow` node is executed, the simulation engine substitutes the fixture result without requiring external processes. If `error` is provided and the node has `onFailure: 'route'`, the workflow follows its `failed` port; otherwise, it records child failure.
  - Unsupported check in `simulation.ts` permits `workflow` nodes as long as `mode !== 'detached'`. Detached child workflows (`mode === 'detached'`) remain rejected as unsupported.

- **AC2: Deterministic Virtual Clock**:
  - `Engine` supports a configurable or pluggable clock (`options.clock`), with a default to real-time `Date.now()`.
  - In simulation mode, the virtual clock starts at an initial timestamp and advances deterministically to the next pending timer deadline whenever the run is waiting and no immediate work is executable.
  - Duration `wait` nodes (`timing.kind === 'duration'`) and until `wait` nodes (`timing.kind === 'until'`) resolve immediately upon virtual clock advancement without real-world latency.
  - Polling `wait` nodes (`timing.kind === 'poll'`) execute their check steps according to the virtual clock schedule, handling both passing checks that resume execution and check timeouts (`timing.timeoutMs`) that route across the `timeout` port.

- **AC3: Agent Unclaimed Timeout Simulation**:
  - `simulationFixtureSchema` allows `timedOut: true` for `kind: 'agent'`.
  - When `timedOut: true` is specified, `output` and `error` are omitted.
  - When an Agent assignment with `unclaimedTimeoutMs` is available, the simulation driver does not claim the work; instead, the virtual clock advances to `work.availableUntil`, triggering the engine's `work.timed_out` event and routing across the `timeout` port.
  - The substitution receipt records `outcome: 'timed_out'`.

- **AC4: Failure Route Traversal (`onFailure: 'route'`)**:
  - Script, Fetch, and waited Workflow nodes with `onFailure: 'route'` route to their `failed` port when their fixture specifies an `error` or an HTTP failure status (for fetch with `failOnHttpError`).
  - The simulation trace and substitution receipts record the `failed` port traversal and execution status.

- **AC5: Route / Edge Coverage in Receipts**:
  - The simulation receipt and report include a `coverage` object with:
    - `totalEdges`: Total number of executable edges defined in the workflow definition.
    - `coveredEdges`: Number of unique edges traversed during simulation.
    - `percentage`: Number between 0 and 100 representing percentage of edges covered.
    - `untested`: Array of untraversed edge descriptors (`{ edgeId, source, target, port }`).
  - Untested edges identify missing branch test coverage across fixture suites.

- **AC6: Core Schemas and API Compatibility**:
  - `packages/core/src/simulation.ts` updates `simulationFixtureSchema` to include `kind: 'workflow'` and `timedOut: boolean`.
  - `routeCoverageSchema` is defined and exported from `packages/core`.
  - MCP and server routers expose the updated simulation reports and schema.

- **AC7: Documentation & Changeset**:
  - `docs/workflow-simulation.md`, `docs/architecture.md`, and `docs/v1.md` updated to document waited child workflows, virtual clocks, agent timeouts, and route coverage.
  - Patch changeset for `@type_of/interlock` created.
  - All automated tests (`pnpm test`, `pnpm build`, `pnpm format:check`) pass.

---

## 3. Detailed Technical Design

### 3.1 Core Schema Updates (`packages/core/src/simulation.ts`)

```typescript
export const simulationFixtureSchema = z
  .object({
    nodeId: id,
    kind: z.enum(['agent', 'script', 'fetch', 'workflow']),
    output: z.lazy(() => jsonSchema).optional(),
    error: z.string().min(1).max(512).optional(),
    expectRejection: z.boolean().optional(),
    timedOut: z.boolean().optional(),
  })
  .strict()
  .superRefine((fixture, ctx) => {
    if (fixture.timedOut) {
      if (fixture.kind !== 'agent') {
        ctx.addIssue({
          code: 'custom',
          message: 'timedOut is only supported for Agent fixtures',
        });
      }
      if (fixture.output !== undefined || fixture.error !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'timedOut fixtures must not provide output or error',
        });
      }
      return;
    }
    if ((fixture.output === undefined) === (fixture.error === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of output or error',
      });
    }
    ...
  });
```

### 3.2 Coverage Schema (`packages/core/src/simulation.ts`)

```typescript
export const routeCoverageSchema = z
  .object({
    totalEdges: z.number().int().min(0),
    coveredEdges: z.number().int().min(0),
    percentage: z.number().min(0).max(100),
    untested: z.array(
      z.object({
        edgeId: z.string(),
        source: z.string(),
        target: z.string(),
        port: z.string().optional(),
      }),
    ),
  })
  .strict();
export type RouteCoverage = z.infer<typeof routeCoverageSchema>;
```

### 3.3 Engine Virtual Clock Support (`packages/runtime/src/index.ts`)

- Provide an optional `clock?: { now: () => number }` in `EngineOptions`.
- Replace direct `Date.now()` calls in `Engine` with `this.nowMs()`, where:
  ```typescript
  private nowMs(): number {
    return this.options.clock ? this.options.clock.now() : Date.now();
  }
  ```
- Similarly, `now(): string` helper in `Engine` can format `new Date(this.nowMs()).toISOString()`.
- During simulation, a mutable virtual clock is passed to `Engine`:
  ```typescript
  let virtualTime = Date.now();
  const clock = {
    now: () => virtualTime,
    advanceTo: (timestamp: number) => {
      if (timestamp > virtualTime) virtualTime = timestamp;
    },
    advance: (ms: number) => {
      virtualTime += ms;
    },
  };
  ```

### 3.4 Simulation Execution Loop (`packages/runtime/src/simulation.ts`)

1. **Unclaimed Timeout Detection**:
   - When an available work item exists for an Agent node and the current fixture specifies `timedOut: true`:
   - Consume the fixture (`cursor++`).
   - Advance the virtual clock to `Date.parse(work.availableUntil)`.
   - Call `engine.step()` (or trigger deadline check) so the work times out and transitions to `work.timed_out`.
   - Record receipt with `outcome: 'timed_out'`.

2. **Wait Node Advancement**:
   - When run status is `'waiting'` and no work items can be claimed:
   - Identify pending resume deadlines:
     - Duration/Until wait: `execution.resumeAt`
     - Poll check: `execution.nextCheckAt`
     - Poll timeout: `execution.timeoutAt`
   - Advance virtual clock to the earliest deadline.
   - Advance engine turn to process the wait completion or next poll check.

3. **Waited Child Workflows**:
   - When `node.kind === 'workflow'` (with `mode !== 'detached'`), if a fixture is provided with `kind === 'workflow'`:
     - If `f.error`: throw / trigger child failure. If `hasFailureRoute(node)`, route to `failed`; otherwise fail parent run.
     - If `f.output`: substitute as child workflow output, finishing the execution with `output`.
     - Record substitution receipt with `kind: 'workflow'` and outcome `'substituted'` or `'failure'`.

4. **Edge Coverage Computation**:
   - Map execution transitions: for each finished execution in `run.executions`, matching edges in `definition.edges` that connect `execution.nodeId` with outgoing port `execution.port ?? 'default'` are marked as traversed.
   - Compute `coveredEdges`, `totalEdges`, `percentage = totalEdges > 0 ? (coveredEdges / totalEdges) * 100 : 100`, and list `untested` edges.
   - Include `coverage` in the simulation `Record` and report output.

---

## 4. Risks & Alternatives Considered

- **Alternative: Running Real Child Workflows in Scratch Engine**:
  - Running nested child workflows without fixtures requires pinning child workflow versions and prompt snapshots in the parent simulation capture.
  - Supporting fixture substitution (`kind: 'workflow'`) allows isolated, fast, deterministic testing of parent orchestration without requiring child workflow implementation details to be in place. Both fixture substitution and child workflow definition dispatch can coexist.
- **Risk: Polling Loop Infinite Iteration**:
  - If a polling check never succeeds and has no `timeoutMs`, virtual clock advancement could loop until the 10,000 driver turn limit.
  - Mitigation: The 10,000 turn limit protects against infinite loops; clear error message is produced when the limit is exceeded.

---

## 5. Open Questions
- None.
