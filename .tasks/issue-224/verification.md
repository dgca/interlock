# Verification for issue 224

The implementation commit is `a16640e2e3ec1d669ba652d50dbcc8382fbcc7c0`. Original task baseline and fetched `origin/main` are `535f0f56e441b0ba4cff49df215662867f5b2b1f`. `git fetch origin main` and `git rebase origin/main` completed on 2026-11-06; the branch was already current. The final evidence commit adds this report and clarifies two documented limits without changing executable code.

| Check | Result | Evidence and criteria |
| --- | --- | --- |
| `pnpm build` | Passed | `/tmp/interlock-224-build.log`; TypeScript, UI and packed CLI build. AC1–AC7. Vite retains its existing large-chunk advisory. |
| `pnpm test` | Passed | `/tmp/interlock-224-test.log`; 117 files, 1,404 tests. AC1–AC7. |
| Background process tests | Passed | 16 tests in `tests/backgroundScripts.test.ts`, included in the full run. `/tmp/interlock-224-background.log` also records the focused run. Running/offline restart and repeated recovery preserve execution and one effect; offline timeout, cancel/stop descendants, pre-spawn cancellation, missing launch supervisor, identity mismatch, corrupt receipt, explicit reconciliation, Bash, routed error/output/timeout, split secrets, multibyte logs and stdout limits. AC1–AC7. |
| `pnpm test:package` | Passed | `/tmp/interlock-224-package.log`; global and npx installs, HTTP/stdio MCP, CLI `script inspect`, actual server restart, one background result and one effect marker. AC2/AC6/AC7. |
| `pnpm format:check` | Passed | `/tmp/interlock-224-format.log`; final evidence/doc-only additions formatted separately and checked again. |
| `git diff --check` | Passed | No whitespace errors. |
| UI journey | Passed | See plan.md Build evidence. Real mouse and Space controls, apply/save/reload checked persistence, publication/run and selected execution progress. Screenshots `/tmp/interlock-224-ui/background-{toggle,progress}-{desktop,narrow}.png`; snapshots under `/tmp/interlock-224-ui/.playwright-cli/`. Desktop 1280px and narrow 600px inspected. Temporary server and browser stopped. AC1/AC5/AC6. |
| Impeccable detector | Passed | `impeccable detect --json` on both changed UI files returned `[]`. |

Affected documentation checked against code: README, architecture including execution context, current limits, failure routes, agent workflows and CLI top-level/command help. MCP affected flow checked: definition authoring through core schemas, publish/start, get_run/briefing/result inspection, new grouped manage_script inspect/stop/reconcile, cancel_run and retry_run guidance, and history protection. Both HTTP and stdio transport tests discover identical new schemas; positive authoring/reconcile controls and unsafe stopped:false rejection are exercised. This is an affected-flow review, not an audit of every MCP tool.

MCP impact: one grouped tool exposes the three operational actions across transports without adding separate tools or unbounded run history. Its response contains one execution target/state and at most 8 KiB progress. Core authoring schemas add one optional field; get_run describes the new metadata; cancellation/retry descriptions explain cleanup and uncertainty. Discovery count moves from 55 to 56, reflected in existing transport assertions. Cross-tool instructions distinguish foreground interruption from durable background recovery.

Documented limits: same host/user and file-backed database; original adjacent spool and protected-value key required; secret-consuming live stderr is suppressed until completion to prevent split-value leakage. Spool files, encryption keys and launch records are retained separately from history deletion. Foreground-only E2BIG context fallback remains documented. Host loss, process-group escape, automatic spool retention and transactional external effects are outside scope. No user database or shared server was modified.

Fresh-context final review is pending. No push or PR creation has occurred. Delivery must fetch/rebase again immediately before push; a changed candidate requires fresh review.
