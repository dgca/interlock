# Opt-in starters and workflow imports

Issue #185. The user chose direct implementation, then changed the delivery preference to easy explicit imports and asked for an import dialog consistent with the node settings UI. #71 remains deferred. Based on main 5d9e73b on branch codex/starter-installations.

## Delivery and review status

The user reviewed the opt-in import flow and source ordering, then authorized pushing the changes to PR #192. The implementation replaces automatic starter installation with explicit imports. The PR title and description must reflect the opt-in flow. The original checkout and user databases were not changed. Preview and tests use temporary databases.

## Product behavior

New libraries start empty. The empty library offers Browse starter workflows, while the toolbar still supports blank creation. One Import workflows dialog lists GitHub folder, Local file, Paste JSON and Starters in that order. Starters remains the default selected source. The source sidebar and footer remain stable while only the content panel scrolls. Mobile uses a horizontally scrolling source navigation. Local-file capability gating remains intact.

The small offline catalog contains SDLC and Evaluate workflow comparison. Specialized examples remain optional files. Explicit starter imports create and publish v1 without starting a run. Known copies offer Open workflow; Add another copy is a separate opt-in. Existing drafts, versions, archive flags, ownership and runs are never overwritten or republished. New template versions do not replace copies. Deletion leaves a workflow absent until another explicit import.

GitHub discovery preserves commit pinning, atomic selection imports, conflict checks and confirmed rejection versus uncertain-delivery guidance. Result rows show purpose first and disclose dependency IDs, filenames and revisions on demand. Local files stay inside the dialog. Files and pasted JSON preview through the shared server parser before mutation, retaining existing standalone draft and portable bundle import semantics. Previews are read-only; actual imports revalidate and can still reject destination conflicts. One root opens directly; multiple roots return to highlighted library cards. Source changes preserve inputs and selections. Asynchronous file/discovery results cannot replace newer choices.

## Copy identity and retries

starterCopies associates catalog identities with local workflow IDs and survives later edits and renames. Old manual or seeded copies can be recognized from a matching draft or retained version, ignoring canvas positions and declaration order. Display names alone do not establish identity. Arbitrarily changed old copies without retained matching content cannot be identified reliably.

starterImports records keyed results atomically with creation, publication and copy association. Request keys are opaque, case- and whitespace-sensitive, nonblank strings of at most 120 characters. Identical retries return the original current workflow reference; conflicting reuse and deleted results reject. A new key with copy:true requests an intentional extra copy. Failure rolls back the new workflow and its records. Full database backups preserve local records; portable bundles exclude them. Startup never interprets old seed markers as instructions to install anything.

## Shared callers and compatibility

The server exposes starters, importStarter and read-only previewImport. The browser sends large previews as POST queries with a matching server allowlist. CLI offers starters and import-starter, including explicit request keys. Packaged CLI inspection commands were also missing from the entrypoint allowlist; assignment-size, work-hold and work-resources now dispatch correctly and have installed-package coverage.

No MCP tools were added. list_workflows accepts source:starters for bounded metadata and existing-copy references; normal library queries keep their existing shape and filters. import_workflows accepts starterId plus requestId, with optional copy. Starter and portable-bundle modes are mutually exclusive. Existing bundle calls and replacement/restoration rules remain unchanged. Server instructions stay unchanged. Discovery is 50 tools and 279,154 bytes over both transports, 701 bytes above the pre-change baseline. Starter metadata is fetched only on demand, without workflow definitions or prompts.

## Validation and documentation

Full suite passed: 1,111 tests across 96 files. Coverage includes atomic rollback, restart, legacy recognition, edits/archive/name collisions, deliberate duplicates, keyed retries, deleted results, portable exports, unchanged SDLC behavior, HTTP/stdio discovery and imports, large HTTP previews, source switching, stale discovery/file reads, invalid JSON, file gating and multi-root completion.

Build, installed-package smoke, formatting and diff checks passed after final edits. Browser checks covered actual starter addition/opening, file upload and JSON preview/import, GitHub multi-selection and library highlighting, plus desktop and 390px-wide modal layouts. The UI detector reported no findings. Screenshots are in /tmp/interlock-import-*.png. Existing UI bundle-size warnings remain. Real provider accounts were not used.

README, starter/evaluation/SDLC/embedded UI guides, architecture, upgrade/release guidance, current limits, workflow examples, CLI help and affected MCP discovery/import/get/publish/export/archive/delete flows were checked against the implementation. This is an affected-flow review, not a complete audit of every MCP tool. Keep the patch changeset pending; do not apply release versioning.

## Local review instance

The temporary preview runs the real server startup and built UI at http://127.0.0.1:49266/workflows, starting from an empty temporary library. /tmp/interlock-import-preview-state.json records its process and database directory. /tmp/interlock-import-preview.mts is the restart helper. Stop the process recorded in that state file when review is finished. The replacement PR body is at /tmp/interlock-185-pr.md. UI review is complete and the user authorized the PR update.
