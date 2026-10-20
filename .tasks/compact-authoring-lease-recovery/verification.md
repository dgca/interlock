# Build evidence

Baseline and scope are recorded in [intent.md](intent.md). Checks below apply to the implementation committed with this document. Evidence paths are local temporary files; automated regression tests remain in the repository.

- AC1–AC3: `tests/compact-authoring.test.ts` passes over HTTP and stdio. A synthetic 27-node definition produces 390,066 bytes of full publication text versus 159 bytes of summary text and 134 bytes of structured summary. Tests validate discovered object-root schemas, full/default compatibility, IDs/revisions/publication status, archive/restore, cascade dependent pins, compact imports, invalid modes and stale writes. The work laptop's exact workflow was unavailable; the size fixture is synthetic.
- AC2: the same suite verifies bounded samples of existing warnings, all errors on rejection, a new downstream warning from an upstream edit, stable-node index changes, and exact deduplicated counts. `tests/workflowEdits.test.ts` retains full atomic-edit validation coverage. Compact diagnostics do not impose a byte cap or suppress newly introduced warnings.
- AC4: a temporary HTTP server exercises actual CLI start/submit summaries, full defaults, positional version and file JSON, fresh-context enforcement, explicit flags over JSON options, and invalid flags/lease bounds. Suggested next calls reuse the same core projection as MCP. Full package smoke confirms bundled CLI startup.
- AC5–AC6: `tests/lease-recovery.test.ts` and `tests/leases.test.ts` pass. Cases include independent exhaustion, mixed failures/expiries, monotonic claims, exact expiry, restart, pinned policy, timeout/cancellation, completed replay, unknown tokens, receipts excluded from public work, and A-expiry/B-claim/B-expiry/A-submit rejection. An additional clock-crossing test advances time between pump and ownership check; rejection still persists the expiry and permits a valid replacement claim. Tests use temporary or in-memory databases.
- AC7: `tests/nodeEditorUx.test.ts` verifies control enable/disable, default 3, invalid bounds, and saved values. Actual browser check on the isolated server at port 52927: created a temporary workflow, opened Agent settings, enabled the budget, typed 0 with native keyboard input and confirmed Apply did not close/save, typed 4, applied and saved, reloaded and reopened to verify 4, then disabled and saved. The saved definition omits `maxLeaseExpiries`. Evidence: `/tmp/interlock-authoring-ui.S0pSPy/budget-enabled.png` and `disabled-workflow.json`. The screenshot uses the same UI source as this commit; the later runtime-only clock-crossing fix does not affect that journey. Temporary server and browser tab were stopped/closed. User databases were not used for tests.
- AC8: audited README, agent-workflows, architecture, connect-harness, timers, current scope, upgrade/release guidance, CLI command help, and the affected MCP flow: schema/definition guidance, create/update/edit/validate/publish/import, start/list/claim/submit/renew/fail, briefing/inspection/retry/cancel. Added explicit compact-mode guidance and corrected combined-budget-only claims. Unrelated MCP tools were not comprehensively audited. The root patch changeset remains pending.

## Commands

- `pnpm test`: 670 tests passed in 55 files. `/tmp/interlock-authoring-tests.log`.
- `pnpm build`: passed TypeScript, UI and bundled build. `/tmp/interlock-authoring-build.log`.
- `pnpm test:package`: passed packed global and npx installs, CLI, UI assets, HTTP/stdio MCP, persistence/restart and JavaScript execution. `/tmp/interlock-authoring-package.log`.
- `pnpm format:check`: passed. `/tmp/interlock-authoring-format.log`.
- Focused transport checks: `/tmp/interlock-authoring-transports.log`; final full suite includes the latest runtime clock-crossing fix.

Existing build chunk-size and test-environment warnings remain. No changed defaults, late-token acceptance, release, or merge.

## Independent review and revision

The full fresh-context review of `5d68a6eaa000b6de31230c3785c0de886b2392c9` verified AC1–AC3 and AC5–AC8, and found one AC4 compatibility regression: `5d68a6eaa000-cli-negative-json`. The reviewer independently reproduced rejection of negative JSON inputs/results and exercised the maximum separate budgets through 19 claims, restart, ten hashed expiry receipts, exhaustion, stale-token rejection, receipt privacy, and explicit retry resetting counters. Review and independent boundary evidence: `/tmp/interlock-authoring-review.json`, `/tmp/interlock-authoring-independent-cli.log`, and `/tmp/interlock-authoring-independent-boundary.log`.

The revision separates negative JSON number positionals from strict summary-option parsing. The actual CLI test now completes start → claim → submit for `-1`, `-0`, `-0.25`, `-2e3`, and `-3.5E-2` in both full and summary modes, checking persisted inputs and outputs. It also covers flag placement, the `--` separator, unknown short/long flags, and invalid boolean values. AC4 regression coverage passes against a temporary HTTP server. No API, runtime, MCP, UI, or documented behavior changed in this revision; the prior review and UI evidence remain applicable at their original commit.

Revision checks:

- `pnpm exec vitest run tests/compact-authoring.test.ts`: 5 tests passed, including HTTP/stdio and the expanded CLI journey. `/tmp/interlock-authoring-revision-cli.log`.
- `pnpm test`: 670 tests passed in 55 files. `/tmp/interlock-authoring-revision-tests.log`.
- `pnpm build`: passed. `/tmp/interlock-authoring-revision-build.log`.
- `pnpm test:package`: passed packed global and npx installs, CLI, UI assets, HTTP/stdio, restart and persistence. `/tmp/interlock-authoring-revision-package.log`.
- `pnpm format:check`: passed. `/tmp/interlock-authoring-revision-format.log`.

The revised committed candidate requires independent review before local completion.

## PR diagnostic correction

The final PR review of `2179f444d661a493af5fb4181753134756241fea` reproduced a separate AC2 defect: summary diagnostics merged duplicate-ID errors at different array locations. The regression tests failed before the fix over both HTTP and stdio, losing one node location and one edge location. A repeated-error test also confirmed an incorrect count. Red evidence: `/tmp/interlock-diagnostic-errors-red.log`.

Summary projection now retains every error with its original path. Only exact warning repeats are deduplicated. Array-index normalization applies to warning comparison across edits. Tests assert identical full/summary error lists, four duplicate-ID error locations and the matching count, unchanged workflow state, preserved repeated errors, distinct warning paths, and existing sampling/index-shift behavior. The focused authoring/edit tests passed 59 checks before adding two additional warning-path cases. Evidence: `/tmp/interlock-diagnostic-errors-tests.log`.

Final correction checks:

- `pnpm test`: 672 tests passed in 55 files. `/tmp/interlock-diagnostic-errors-full-tests.log`.
- `pnpm build`: passed. `/tmp/interlock-diagnostic-errors-build.log`.
- `pnpm test:package`: passed. `/tmp/interlock-diagnostic-errors-package.log`.
- `pnpm format:check`: passed. `/tmp/interlock-diagnostic-errors-format.log`.

Reviewed README, the agent authoring guide, CLI help, and MCP edit/validate guidance and output schemas for this correction. Clarified count semantics in the guide and edit tool descriptions; response fields and defaults are unchanged. HTTP and stdio discovery and responses pass in the full suite. Existing lease and UI evidence remains applicable because those implementations are unchanged. Independent review of the correction follows before PR update.
