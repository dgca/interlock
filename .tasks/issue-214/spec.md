# Specification: Code-Split UI Routes with React.lazy

## References
- Intent: [intent.md](./intent.md)
- Issue: #214

## UI Proposal
### User Flow & Experience
When a user navigates to the application or switches between major sections (Workflows, Runs, Prompts, Variables, Settings):
1. **Initial Load**: The browser downloads only the shell, router, Mantine core styles, and common utilities. The main bundle chunk (`index-*.js`) is kept compact (< 250 kB minified).
2. **On-Demand Route Loading**: When navigating to a specific route, Vite's code-split chunk for that feature is fetched on demand.
3. **Suspense Loading State**: While the asynchronous chunk is loading, a `<Suspense>` fallback renders:
   - For routes with existing layout skeletons (`workflows`, `workflow`, `prompts`, `prompt`), `<RouteSkeleton subject={...} />` renders smoothly.
   - For other routes (`runs`, `runs/:runId`, `variables`, `settings/harnesses`), an unobtrusive loading indicator (such as Mantine `<Center h="100%"><Loader size="md" /></Center>` or a skeleton container) renders inside `<main className="main">`, preserving the persistent `<Sidebar>` and top shell.
4. **Transition**: Once the chunk resolves, the feature component renders immediately without layout jump or flicker.
5. **Narrow-Screen & Keyboard Behavior**:
   - Navigation links and keyboard shortcuts behave identically to statically loaded routes.
   - Focus is retained within the main content area upon route load.

## Acceptance Criteria

### AC1: Dynamic Route Imports
In `packages/ui/src/routes/index.tsx`, dynamically import all feature components via `React.lazy()`:
- `WorkflowLibrary` from `../features/workflows/WorkflowLibrary`
- `WorkflowEditor` from `../features/workflows/WorkflowEditor`
- `RunList` from `../features/runs/RunList`
- `RunInspector` from `../features/runs/RunInspector`
- `Harnesses` from `../features/executors/Harnesses`
- `PromptLibrary` and `PromptEditor` from `../features/prompts/Prompts`
- `VariableLibrary` and `VariableRoute` from `../features/variables/Variables`

### AC2: Route Suspense Boundaries
- Wrap lazy route components with `<Suspense fallback={...}>`.
- Ensure fallbacks use appropriate loading indicators (e.g. `RouteSkeleton` for workflows/prompts, and centered loader/placeholders for runs/variables/harnesses) so that pending chunk downloads do not throw uncaught Suspense exceptions or break the page shell.

### AC3: Initial Bundle Size Reduction
- Building the UI (`pnpm --filter @interlock/ui build` and root `pnpm build`) must result in an entry `index-*.js` chunk significantly below Vite's 500 kB warning limit.
- Vite's warning regarding `index-*.js` exceeding 500 kB must no longer appear during production build.

### AC4: Preserved Routing & Navigation Behaviors
- Direct navigation and deep links to:
  - `/` (redirects to `/workflows`)
  - `/workflows`
  - `/workflows/:workflowId`
  - `/runs`
  - `/runs/:runId`
  - `/prompts`
  - `/prompts/:promptId`
  - `/variables`
  - `/variables/:variableId`
  - `/settings/harnesses`
  all resolve and function identically to the static import baseline.
- Unsaved changes confirmation dialogs, tab switching, and query parameter handling (such as `?view=runs&tab=history`) remain intact and functional.

### AC5: Test and Lint Verification
- All automated tests pass (`pnpm test`).
- Code formatting satisfies `pnpm format:check`.

### AC6: Changeset
- Include a patch changeset for `@type_of/interlock` describing the dynamic route code splitting with React.lazy.
