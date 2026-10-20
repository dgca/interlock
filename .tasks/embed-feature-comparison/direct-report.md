# Direct implementation evidence

## Timing and isolation

- First recorded wall-clock observation: 2026-10-20T08:30:33Z. Initial tool discovery and required reads preceded this observation, so it is not an exact first-work timestamp.
- Base: `dd710316deae685957f52f53bd3f45f45850c47a`.
- Branch: `codex/embed-direct`.
- No SDLC workflow, extra agents, other candidate files, or historical implementation artifacts were inspected.
- The required focused Hindsight query explicitly excluded historical results, but the service returned unrelated historical comparison summaries anyway. These were disregarded. The coordinator was notified immediately. Relevant durable preferences were to verify live facts and follow established project patterns.
- Human questions: none. Human waits: none.
- Implementation and verification completed: 2026-10-20T08:39:54Z. The following local commit freezes this candidate; its Git commit timestamp records the final candidate timestamp.
- The temporary browser session and server were stopped after verification. Artifacts remain available for review.

## Implementation

- Startup configuration is resolved once in `main.tsx` before router creation and supplied through an immutable React context. Both feature defaults are enabled.
- Host booleans override URL values independently. URL keys are `interlock.localFileImport` and `interlock.connectAgent`; exact `false` disables, exact `true` enables, invalid values use the enabled default. Invalid host values defer to URL values. The first repeated URL key wins. Unknown settings are ignored.
- Local-file UI and its input are conditionally mounted. Sidebar and waiting-run connection controls, connection-opening callbacks, and the dialog itself are gated. Copy instructions remain unchanged.
- Paste JSON uses the same extracted JSON dispatch as local files, calling the existing create or portable-import operation. No runtime, core, storage, API, MCP, CLI, transport, or version behavior changed.
- A pending patch changeset is included. No push, PR, merge, versioning, or publication was performed.

## Verification

- `pnpm typecheck` passed on the first attempt.
- `pnpm test -- tests/uiFeatures.test.ts tests/import-dialog.test.ts tests/agentHandoff.test.ts tests/routes.test.ts tests/transfer.test.ts tests/githubImport.test.ts` ran the complete suite because of argument forwarding: 56 files, 686 tests passed. The full suite includes HTTP/stdio transport tests. Log: `output/embed-direct/tests.log`.
- `pnpm build` passed on the first attempt. Vite reported the existing large-chunk advisory. Log: `output/embed-direct/build.log`.
- `pnpm format:check` initially found formatting in the supplied comparison brief. Prettier formatted that file without changing scope. The next check passed. Logs: `output/embed-direct/format.log` and `format-retry.log`.
- `git diff --check` passed. Self-review checked every changed component, all connection openers and guidance, startup timing, import dispatch, pending-action guards, and the final diff.
- Package smoke was not run because packaging, CLI startup, and versions did not change. Built CLI `commands` and `--help` were read and saved in `output/embed-direct/cli-help.txt` and `server-help.txt`.

### Real browser and server checks

Used the `embed-direct` Chromium session and the built UI at port 44215 with the disposable `output/embed-direct/browser.db`. The development and installed user databases were untouched.

- Normal controls: GitHub default, Local file source and mounted hidden input, connection dialog, explicit legacy paste, and invalid JSON feedback passed. `browser-normal.log` records assertions.
- Embedded controls: absent local source and input, absent sidebar connection and guidance, available Paste JSON, portable bundle import, conflict feedback retaining pasted text, and stable configuration across navigation passed. `browser-embedded.log` records assertions.
- Waiting runs: hidden Connect an agent and sidebar actions, retained copy action, and clipboard text targeting the same existing run passed. Normal waiting-run connection dialog also passed.
- Host true over URL false, host false over URL true, malformed host/URL fallbacks, ignored post-start global mutations, and same-origin iframe URL settings passed. `browser-settings-retry.log` records assertions.
- Local file selection imported through the actual chooser using CLI click/upload. `local-import.yml` records the opened imported workflow. The first combined browser script handled the chooser directly, causing the CLI to retain a stale modal notice despite the import and later assertions executing. That attempt remains in `browser-settings.log`. The settings checks were rerun independently, and the chooser check was repeated through dedicated CLI commands. This was a verification-tool repair, not a product change.
- Server checks confirmed imports created no runs, legacy import stayed unpublished, conflict left existing metadata unchanged, and exporting the imported format-2 bundle reproduced the original exactly, including IDs, owned child, saved prompt, and published definitions. `server-verification.log` records these checks. A temporary legacy run was then explicitly published and started only to check waiting-run controls.
- Screenshots were visually inspected for Paste JSON and the waiting-run handoff. `embedded-paste-ready.png` captures the settled selection; the earlier `embedded-paste.png` captured the segmented-control animation before it settled. The final browser console check reported zero errors and warnings.

All browser logs, scripts, fixtures, screenshots, and temporary database files are under `output/embed-direct/`, ignored by Git. Important screenshots are `normal-invalid-json.png`, `embedded-paste-ready.png`, `embedded-conflict.png`, `embedded-handoff.png`, and `framed-import.png`.

## Documentation and MCP review

Updated README import guidance, architecture, current scope, connection guidance, and the new `docs/embedded-ui.md`. Reviewed CLI import dispatch and help. Reviewed MCP server instructions and affected create/import/export and run handoff tools, including briefing/result/wait, work discovery/claim/submission, against unchanged shared API behavior. No MCP definitions required changes. This was an affected-flow review, not an audit of every MCP tool.

## Limitations

- Browser coverage used Chromium and a same-origin iframe. Cross-origin sandbox policies, other browsers, and restrictive clipboard policies were not tested.
- Live GitHub network discovery was not repeated. Existing GitHub import tests passed and the GitHub UI remained the default in both browser modes.
- Format-2 portable content was exercised end to end in the browser. Existing automated transfer and cleanup tests cover the remaining bundle formats.
- No token, cost, or model metrics were collected. The first recorded timestamp excludes a short uninstrumented initial interval. Human waits were zero.
