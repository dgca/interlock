# GitHub folder import plan

The [spec](spec.md) owns AC1-AC10. See [intent](intent.md) for scope and constraints.

## Inspected facts and approach

`packages/runtime/src/transfer.ts` already imports one portable bundle transactionally. `Store.transaction` supports nested savepoints. Existing import allows explicit revision or force replacement; preserve that API. The library currently imports one local file through `workflows.import` or `workflows.create`.

Add parsing and transfer inspection in core and strict selected-set import in runtime. Combine selected portable records with duplicate consistency checks before importing, then create legacy workflows within the same outer storage transaction. Validate dependency closure during discovery using an isolated in-memory Store and the actual importer. Preserve incomplete drafts as saveable while rejecting missing dependencies and invalid published definitions.

Add a server module for bounded public GitHub discovery. Restrict all requests to constructed api.github.com URLs, disallow redirects, require a public repository, resolve branch/commit prefixes with the commits API, freeze the resulting SHA, and inspect direct `.json` files using the contents API. GitHub's documented contents endpoint accepts a ref and returns directory entries. Skip directories, symlinks, and submodules. File failures become nonselectable diagnostics; global network or rate errors support retry. No authentication or remote execution.

Expose typed shared API procedures for discovery and selected import. Import re-fetches explicitly selected direct files at the preview SHA and revalidates their full set against current state, preventing a late conflict from partially writing. The API does not accept force or revision replacement for this operation.

Add a Mantine import dialog with local-file and GitHub source controls, names and descriptions, file and dependency details, selection count, error and empty states, and disabled import until selection. Use generation guards to discard obsolete discovery responses on source edits or close. Keep file import behavior. Disable closing during the committed import request so a successful import has an unambiguous result.

## Sequence and verification

1. Core/runtime transfer parsing, strict batch import, and focused transaction tests. Cover formats, root and prompt closure, published pins, owner preservation, portable no-ops, legacy duplicates, cross-selection conflicts, current-state conflicts, and rollback. Maps to AC2-AC5 and AC9.
2. Server GitHub resolution and import procedures with injected network fixtures for slash branches, direct-file filtering, invalid files, errors, limits, and pinned ref use. Maps to AC1-AC2, AC5-AC7.
3. Dialog and existing local-import integration, with interaction tests for stale loads, cancellation, selection, retry, text rendering, and explicit import. Maps to AC1-AC3, AC6-AC8.
4. Update README, current limits, architecture or agent workflow import docs as affected, add a patch changeset, and audit affected import/export/create MCP guidance and CLI help against unchanged existing flows. No new MCP tools are required for a UI source feature. If MCP definitions change, run HTTP and stdio discovery tests. Maps to AC9.
5. Run relevant tests, `pnpm build`, and `pnpm format:check`. Packaging is unchanged; run package smoke if implementation affects packaging or CLI startup. Commit the full candidate before final fresh review. Maps to AC9-AC10.

## Representative real UI journey

Start built `dist/cli.js` on port 4313 with a new database under the external evidence directory, after checking the port is free. Use actual browser controls against that server. Open Import, paste the pinned folder URL, discover files, inspect root and dependency details, select 01, 02, and 03, import, and inspect resulting library and child/prompt records. Verify no runs exist. Reopen using the slash-containing branch link and identical bundle selections, then confirm no new portable records. Select 04 against the imported 02 and confirm conflict feedback with unchanged counts. Use keyboard Tab and Space for a selection and cancellation, check focus recovery, and inspect desktop and narrow dialog layouts. Maps to AC1, AC3-AC5, AC7-AC8.

The empty folder and invalid URL/error recovery require short additional checks because those states are explicitly required but absent from the success journey. Local legacy and bundle uploads require existing and targeted checks because preserving them is mandatory. Network failures and overlapping loads use deterministic fixtures. Record observations, screenshots, commands, and limitations outside the checkout.

## Risks and completion

Slash-ref/path ambiguity is resolved by the longest existing commit prefix with a remaining folder path. Bounds on URL depth, file count, response bytes, and total request time protect discovery. Duplicate portable records must be compared structurally before merging to avoid ordering-based conflict acceptance. No writes occur during discovery. Import uses an outer transaction and validated fixed-commit contents.

Completion requires a clean committed candidate, truthful verification evidence, and the published workflow's fresh independent review of the complete diff from the original baseline. Any required repairs receive another verification and review cycle. There are no unresolved product decisions.

## Verification observed

The external evidence directory is `/Users/dan/.codex/interlock-comparison-2026-10-07.pZ2oTo/sdlc/evidence/`. Verification observations and temporary application state remain there.

- AC1 and AC2: Actual Playwright controls on `http://127.0.0.1:4313/workflows` discovered the pinned folder and slash branch, both resolving fixture commit 4c43bd7e54651dd9f8356456d647fb86f504252c. Four valid root choices showed descriptions, source files, and dependency metadata. Malformed JSON, invalid workflow, missing dependency, and unrelated files remained nonselectable; nested files were absent. Pinned snapshot `.playwright-cli/page-2026-10-07T05-51-54-919Z.yml` and branch snapshot `page-2026-10-07T05-52-49-080Z.yml`. Local legacy and bundle chooser uploads passed, opening new legacy and stable bundle root editors, in snapshots `page-2026-10-07T05-55-51-043Z.yml` and `page-2026-10-07T05-57-18-788Z.yml`.
- AC3 and AC4: Pointer selection of 01 and 02 plus keyboard Space on 03, then Import selected, added three library workflows, one owned child, and one saved prompt. The database began with two seeded example workflows. `after-normal-import.json` proves six total workflows, one prompt, zero runs. Reimporting 02 and 03 through the branch preview left the complete records identical, in `after-portable-reimport.json`. `final-state.json` confirms child owner, prompt references, and version pin; the extra legacy local upload adds one more new workflow.
- AC5: Real selection of 01 and conflicting 04 rejected with complete records unchanged, in `after-conflict.json`. Native tests also establish cross-selection published conflicts and a late existing-state conflict after preview. Repaired strict guidance is visible in snapshot `page-2026-10-07T05-58-22-551Z.yml`; this path cannot force draft replacement.
- AC6: Real invalid URL produced correction guidance. Real nested empty-folder discovery initially exposed GitHub's 422 response for an invalid longer ref prefix. After the resolver repair and regression test, the same controls displayed the empty state in `page-2026-10-07T05-57-45-530Z.yml`, then recovered on a corrected URL. Native network fixtures cover missing folders, offline requests, rate limits, malformed JSON, and missing dependencies. No private credentials were used.
- AC7: Dialog tests prove overlapping loads cannot replace the newest source, closing cannot import, and error retry recovers. The real journey changed sources, closed with Escape, and reopened without a retained selection.
- AC8: Desktop 1280x720 screenshot `page-2026-10-07T05-52-08-331Z.png` and narrow 390x844 screenshot `page-2026-10-07T05-53-51-986Z.png` were inspected. Content wraps and scrolls inside the existing Mantine dialog. Actual Tab and Space selected Quick summary in the final narrow journey; Escape returned focus to Import after explicit focus recovery was added. No clipboard behavior changed or is claimed verified.
- AC9: Full native suite passed 46 files and 535 tests in `tests.log`. Focused import, transfer, and dialog checks passed in `focused-tests.log`. `pnpm build` and `pnpm format:check` passed in `build.log` and `format.log`. README, current scope, architecture, and agent workflow import documentation were updated with a patch changeset. The affected MCP create/export/import flow and server instructions, plus CLI import/help, were checked and remain unchanged; this was not an audit of the entire MCP tool set.
- AC10: The complete candidate is committed for the published workflow's fresh independent review against the original baseline. That review remains the next stage.

Broader checks were limited to explicitly required empty/error, local preservation, and conflict cases uncovered by the representative journey. Network error fixtures supplement successful real GitHub interaction; no claim is made that every browser, OS, or GitHub failure was tested.
