# Run inspector UI review

## Scope

Started from fetched `origin/main` at `10cf015eadbf600925c5c7d418fcbe7ee54454fa`, including PRs #197 and #199. Implementation is on `codex/run-inspector-ux` in an isolated worktree. The original checkout and its untracked files were left untouched.

The run inspector prioritizes managed approvals and recovery, gives the selected step a wider pane, moves usage below execution context, and adapts to narrow screens. Native permission decisions, stop confirmation, claims, resource reconciliation, and retry budgets retain their existing server contracts. The phone navigation adjustment preserves the desktop sidebar.

## Validation

- Full suite: 108 files and 1,265 tests passed.
- Focused interaction, attention grouping, route, and migration checks passed.
- `pnpm build` passed TypeScript, UI, and package bundling. The existing large-chunk warning remains.
- `pnpm test:package` passed installed CLI/UI, HTTP/stdio MCP, persistence, restart, and history checks.
- `pnpm format:check` and `git diff --check` passed.
- Impeccable source scan of the affected controls returned no findings. The final keyboard focus correction was verified in the browser afterward.

## Browser checks

Used the real application and shared API with a simulated harness adapter and a temporary database. The adapter never calls a model, starts a native harness, or executes a requested command.

- Approval completed with `{approved:true}`.
- Denial completed with `{approved:false}`.
- A custom question answer arrived under the exact question ID.
- Stop retained the assignment for explicit recovery. Retry was disabled before confirmation, keyboard confirmation enabled it, and reconciliation completed on attempt 2 with `{recovered:true}`.
- Multiple Batch requests were individually identified as Item 1 and Item 2. Keyboard selection opened Item 2's actual assignment and placed focus on Selected step.
- Inspected 1440, 1024, 760, and 390-pixel layouts. At 390 pixels, a 12-file patch retained all details inside a 420-pixel scroll region. Keyboard End scrolled to the final file. Document width matched viewport width.
- Browser console reported no warnings or errors during the exercised paths.
- Native Claude/Codex integration was not rerun for this presentation change. This is not a full accessibility or browser compatibility audit.

## Documentation and MCP review

Updated managed-execution instructions for Review request, the request menu, Stop agent, explicit recovery, and Retry assignment. Added reusable interaction and browser-review conventions, linked from the UI architecture section.

Checked README, connect-harness, current limits, CLI executor operations, and the relevant MCP managed-executor/discovery guidance against the unchanged server behavior. No tool, schema, response, instruction, or discovery text changed. No extra MCP context was added. This was not an audit of unrelated MCP tools.

## Local preview

From the repository root, run `pnpm build`, then `pnpm exec tsx .tasks/run-inspector-ux/preview.ts`. The script prints the temporary database directory and four run IDs. Open `http://127.0.0.1:4332/runs/RUN_ID` for approval, recovery, questions, or a long patch. Stop the preview process with SIGINT or SIGTERM. Each start uses a new temporary database and preserves existing Interlock data.

A preview remains running. After the initial UI review, the user requested the global attention indicator on this branch and authorized opening a PR.

## Global attention indicator

The Runs badge counts unique responsibility roots, with an attention filter and exact assignment links. Owned children roll up; detachment starts a new count. Pending approvals, questions, and interrupted sessions contribute. Queue waits, capacity waits, and generic holds do not. Cancelled sessions remain visible until reconciliation.

Added a compact read-only `runs.attention` API and schema-6 index migration. No documents are rewritten. Existing migration backup behavior applies. The actual SQLite query plan uses `work_attention` for both state lookups and primary-key lookup for execution records. Only pending request kinds and ancestry metadata are read; task payloads are not returned. The existing event stream updates the UI, with no MCP tool or discovery change.

Browser verification showed the badge decrement from 4 to 3 after approval, exact execution deep-linking, filter preservation on return, a cancelled run retaining Recovery needed, and a readable 390-pixel list with no horizontal document overflow. The final preview uses isolated simulated agents and retains three examples needing attention.
