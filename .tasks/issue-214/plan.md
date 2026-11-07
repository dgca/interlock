# Implementation Plan: Code-Split UI Routes with React.lazy

## References
- Intent: [intent.md](./intent.md)
- Spec: [spec.md](./spec.md)

## Intended Code Areas
- `packages/ui/src/routes/index.tsx`: Dynamic imports via `React.lazy()`, route wrappers with `<Suspense>`, and fallback UI.
- `.changeset/*.md`: Patch changeset for `@type_of/interlock`.

## Implementation Sequence

1. **Step 1: Convert Static Route Imports to React.lazy (AC1)**
   - In `packages/ui/src/routes/index.tsx`, replace static imports of `WorkflowLibrary`, `WorkflowEditor`, `RunList`, `RunInspector`, `Harnesses`, `PromptLibrary`, `PromptEditor`, `VariableLibrary`, and `VariableRoute` with `lazy(() => import(...))`.
   - Ensure named exports are properly mapped (e.g. `.then(m => ({ default: m.WorkflowLibrary }))`).

2. **Step 2: Add Suspense Route Boundaries & Fallbacks (AC2)**
   - Define a shared route loading fallback (`RouteLoading` using Mantine `Center` + `Loader`) for routes without specialized skeletons.
   - Wrap each lazy route component in `<Suspense fallback={...}>`:
     - `LibraryRoute`: `<Suspense fallback={<RouteSkeleton subject="workflows" />}><WorkflowLibrary ... /></Suspense>`
     - `WorkflowRoute`: `<Suspense fallback={<RouteSkeleton subject="workflow" />}><WorkflowEditor ... /></Suspense>`
     - `PromptsRoute`: `<Suspense fallback={<RouteSkeleton subject="prompts" />}><PromptLibrary ... /></Suspense>`
     - `PromptRoute`: `<Suspense fallback={<RouteSkeleton subject="prompt" />}><PromptEditor ... /></Suspense>`
     - `RunsRoute`: `<Suspense fallback={<RouteLoading label="Loading runs…" />}><RunList ... /></Suspense>`
     - `RunRoute`: `<Suspense fallback={<RouteLoading label="Loading run…" />}><RunInspector ... /></Suspense>`
     - `HarnessesRoute`: `<Suspense fallback={<RouteLoading label="Loading harnesses…" />}><Harnesses ... /></Suspense>`
     - `VariableLibraryRoute`: `<Suspense fallback={<RouteLoading label="Loading variables…" />}><VariableLibrary ... /></Suspense>`
     - `VariableRoute`: `<Suspense fallback={<RouteLoading label="Loading variable…" />}><VariableRoute ... /></Suspense>`

3. **Step 3: Build Verification & Bundle Size Measurement (AC3)**
   - Run `pnpm --filter @interlock/ui build` and check output chunk sizes.
   - Verify that the initial `dist/assets/index-*.js` chunk size is well below 500 kB (target < 250 kB) and that Vite emits no chunk size warnings for the entry bundle.

4. **Step 4: Test Suite & Route Functionality Verification (AC4, AC5)**
   - Run unit and route integration tests (`pnpm test` and specifically `tests/routes.test.ts`).
   - Run formatting check (`pnpm format:check`).

5. **Step 5: Changeset Documentation (AC6)**
   - Create a patch changeset file under `.changeset/` for `@type_of/interlock` describing route-level dynamic code splitting with `React.lazy`.

## High-Risk Failure Cases & Direct Checks

| Failure Case | Direct Check | Expected Outcome |
| :--- | :--- | :--- |
| **Missing default export in lazy resolution** | Route navigation in `tests/routes.test.ts` and UI build | All routes resolve their component without runtime error or unhandled promise rejection. |
| **Suspense boundary missing on dynamic chunk fetch** | Rendering a route before its chunk resolves | React Suspense boundary catches the pending promise and displays the assigned fallback without crashing the app shell. |
| **Unsaved edits guard regression during route transition** | `tests/routes.test.ts` ("guards unsaved edits on browser Back and app navigation...") | Modal confirmation prompts correctly when navigating away from dirty editor state. |
| **Entry chunk remains over 500 kB** | Production build chunk analysis via `pnpm --filter @interlock/ui build` | Entry bundle `index-*.js` is minified to < 250 kB, eliminating the Vite warning. |

## Representative UI User Journey
1. **Navigate to root (`/`)**: App redirects to `/workflows`. Main entry bundle loads without fetching heavy editor code. `WorkflowLibrary` chunk loads and displays the library.
2. **Open a workflow (`/workflows/:id`)**: The `WorkflowEditor` chunk and dependencies (e.g. React Flow) are loaded on demand. `<RouteSkeleton subject="workflow" />` is rendered during loading. The editor canvas appears once ready.
3. **Switch to Runs tab (`/workflows/:id?view=runs`)**: Child view switches to `RunList` chunk seamlessly.
4. **Inspect run (`/runs/:runId`)**: Navigating to `RunInspector` loads the inspector chunk with smooth loading transition.
5. **Back navigation**: Browser Back returns to the workflow editor cleanly.

## Ownership of Verification Checks
- **Build stage**:
  - Implementation of route splitting and Suspense boundaries.
  - Production build verification (`pnpm --filter @interlock/ui build` and `pnpm build`).
  - Bundle size metrics check (< 500 kB warning eliminated).
  - Test suite verification (`pnpm test`).
  - Formatting verification (`pnpm format:check`).
  - Changeset creation and commit.
- **Review stage**:
  - Independent verification of diff against `AGENTS.md`.
  - Boundary verification of route chunking and lazy import safety.
