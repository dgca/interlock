# Implement workflow variables

Status: plan review permitted progression under the accepted specification. Build
and its checks are complete; independent review follows on the committed candidate.
The user accepted the [specification](spec.md) on November 3, 2026. Scope and
constraints remain in [intent](intent.md).

## Current facts

- The task branch is `codex/workflow-variables`, based on the full commit recorded
  in intent.md. Accepted intent and specification are committed on that branch.
- The storage layer uses transactional JSON document collections in SQLite. New
  collections can preserve the existing schema; append a migration only if the
  implementation needs a new SQL structure or index. Never change shipped
  migrations.
- Runtime owns prompt capture, local Script and Fetch jobs, polling checks,
  version validation, transfer, and testbench configuration. Injecting Secret
  values into the currently persisted Fetch request would disclose them.
- UI, CLI, and MCP share the tRPC server interface. Existing transport tests cover
  HTTP and stdio. Prompts supplies an established central library/editor pattern.
- The working tree contains unrelated untracked task and design files. Stage only
  explicit task files. Do not run automated checks against the development library
  that holds this SDLC run.

## Implementation sequence

### 1. Add contracts and protected persistence

AC1, AC2, AC3, AC5, AC9, AC10, AC11.

Add core variable metadata, safe captures, supported reference schemas, and
strict grouped read/write contracts. Keep normal reads separate from the explicit
Config-value read. Treat values as sensitive input when formatting validation
errors. Validate supported locations without making incomplete drafts unsaveable.

Add a storage module for authenticated value revisions and the separate key-file
lifecycle. Accept a configurable key source for isolated tests and server startup.
Keep cryptography, file permissions, and ciphertext away from callers. Reuse
transactional document storage for metadata, immutable encrypted value revisions,
and direct portable bindings. Persist a vault identity and never replace its key
implicitly. Preserve prior-release databases without creating a key until needed.

### 2. Implement central management and resolution

AC1, AC2, AC4, AC5, AC8, AC9, AC10.

Add a runtime variable module with bounded discovery, metadata inspection,
explicit Config read, revision-protected writes, dependency inspection,
disable/enable, delete, direct binding, capture, and exact-revision resolution.
Keep lookup, dependency rules, safe errors, and deletion protections together.
Count imported identities and canonical local values in dependency checks. Expose
the module through the shared server interface.

### 3. Integrate execution and configuration capture

AC3, AC4, AC5, AC6, AC7, AC11.

Extend Fetch headers and Script environments, including polling checks. Resolve
real values only inside the local operation launch path. Persist safe request
previews. Scrub operation output and errors before contract checks, routing,
history, or forwarding. Handle stderr truncation without retaining a partial
credential. Preserve legacy Bash and existing environment behavior.

Add optional safe captures to run records. Reuse them for Batch items and
continue-as-new, capture independently for ordinary child starts, and capture the
comparison's transitive selections once before queueing. Extend comparison
configuration identities and reports with safe variable metadata. Simulation and
editor preview must not perform live resolution.

### 4. Integrate portable requirements and agent access

AC8, AC9, AC10, AC11.

Extend portable bundles with an explicit new format version for variable
requirements while preserving existing formats. Import preview presents bindings
and provisioning choices. Commit explicit bindings and imported workflow data in
one transaction. Do not rewrite retained published definitions or silently change
an existing instance-wide binding.

Add bounded grouped MCP read and management tools and a CLI path that accepts
Secret values through stdin. Update existing authoring, startup, inspection,
comparison, and transfer guidance to match the final shared interface. Keep native
executor configuration separate and do not add implicit Agent delivery.

### 5. Extend the existing library and node editors

AC2, AC4, AC8, AC9, AC12.

Add Variables navigation and routes, a searchable metadata library, and an editor
following the approved Prompts composition. Keep the incumbent theme. Implement
explicit Config editing, write-only Secret replacement, pending states, retained
edits on rejected writes, safe success handling, dependency paging, disable/delete
confirmations, and unsaved navigation protection.

Add reference pickers to Fetch headers, Script environment rows, and polling check
editors. Preserve missing IDs visibly. Add deliberate binding/provisioning to
import preview. Show safe captures in run inspection. Read the UI craft guidance
immediately before editing UI code; reuse existing controls and focus behavior.

### 6. Verify and prepare a local trial

AC1 through AC13.

Build owns the implementation tests and required repository checks below. Use a
temporary database, temporary key file, and fake credential service for all checks
and screenshots. Provide a separate local trial instance and short instructions
so the user can try the implementation before merging. Leave the user's existing
development library and this SDLC run intact.

Independent review owns review of the exact committed candidate, the full diff
against the original baseline, and targeted boundary verification. Run that review
in a fresh session or isolated subagent without implementation history, as required
by the selected SDLC workflow. Inspect the actual saved evidence and independently
check at least one protected-store failure and one native delivery/history boundary.
Review findings return to the existing build stage. Delivery belongs to the
workflow's final stage; neither review nor local trial authorizes merge or release.

## Highest-risk checks and expected results

| Risk                                          | Direct check and valid control                                                                                                                                          | Expected result                                                                                              | Owner                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Plaintext enters SQLite or an export          | Use a distinctive fake Secret in a valid native request and Script environment, inspect raw database records, full run/result/event responses, and exported data        | Service/process receives the value; ordinary persisted and returned data does not                            | Build; review independently checks one native path |
| Missing or substituted key destroys access    | Create a valid value, close and reopen using its original key, then try missing, wrong, symlinked, permissive, and corrupted keys                                       | Original key works; invalid cases fail safely without changing protected state or creating replacement keys  | Build; review checks missing/wrong key             |
| Failed management/import partially writes     | Inject a write failure after an earlier write in the same operation, compare complete metadata, ciphertext revisions, and bindings before/after; run successful control | Failure rolls back all database changes; valid control commits once                                          | Build                                              |
| Rotation changes a retry or queued sample     | Rotate during a delayed run; retry and reopen the server; compare new root runs, Batch items, ordinary/detached children, chains, and queued comparison descendants     | Captures follow AC5 and AC6; no fallback to latest or empty values                                           | Build                                              |
| Disable or deletion leaves stale access       | Disable a captured variable before a later step; exercise draft, retained-version, active-run, and comparison deletion blockers with unreferenced control               | Consumption fails safely; blockers identify dependencies; valid deletion removes current protected revisions | Build                                              |
| Error or truncation leaks a credential        | Echo fake values across chunk boundaries and near stderr retention limits; include Fetch echoes, JSON keys, polling errors, and routed failure output                   | Redaction precedes truncation, validation, routing, and persistence; invalid redacted results fail safely    | Build                                              |
| Import silently attaches a local credential   | Preview and import missing, same-name/different-ID, explicitly bound, kind-mismatched, and conflicting-binding requirements using legacy and new bundles                | Only explicit compatible bindings are accepted; failed imports are atomic; old formats still work            | Build                                              |
| Client races overwrite or resubmit a value    | Use stale edit revisions and a write-success/refresh-failure control                                                                                                    | Conflict preserves local edits; acknowledged writes are not repeated automatically                           | Build                                              |
| UI exposes plaintext or loses reference edits | Complete the representative journey below through actual controls                                                                                                       | Secret is never read back; references and edits survive expected navigation and reopen                       | Build; review inspects evidence                    |
| MCP contracts diverge by transport            | Discover schemas and exercise grouped variable, authoring, start, inspect, comparison, and import operations over HTTP and stdio with temp stores                       | Metadata is bounded and value-free; valid operations agree and rejected writes return safe errors            | Build                                              |

## Representative browser journey

Using the isolated trial instance, create a Secret, reopen it, and see **Value
set** without a reveal control. Select it for a Fetch Authorization header and a
Script environment entry, save and publish, then run against the fake service.
Inspect safe captured metadata and redacted output. Replace the central value and
run the same published definition again. Verify the replacement reaches the
service without a publication. Exercise a rejected stale save, Cancel focus,
disabled-variable feedback, and the dependency blocker before deletion. These
steps cover AC2, AC4, AC5, AC7, AC8, and AC12.

Inspect the changed screens at desktop, intermediate, and phone widths. Check the
keyboard path through creation, replacement, selection, and confirmation, including
the unsaved-edit prompt. Expand testing only for a concrete defect or an uncovered
accepted criterion. Run the Impeccable detector once after the UI is finished.

## Required checks and evidence

- Run focused storage, variable runtime, execution, transfer, comparison, UI, and
  transport tests as each integration becomes testable. Retain results for the
  final candidate.
- Run the full test suite, `pnpm build`, then `pnpm test:package` because startup,
  CLI, and packaging behavior are affected.
- Run `pnpm format:check`. If unrelated untracked files cause baseline failures,
  report that limit and separately check all tracked task changes. Do not repair
  unrelated files.
- Check README, current scope, architecture, node data and Fetch/Script guidance,
  transfer docs, CLI help, and the full affected MCP authoring/execution/inspection
  flow against implementation. Record exactly what was checked rather than claiming
  a comprehensive audit of unrelated tools.
- Add a pending patch changeset for `@type_of/interlock`. Save representative
  screenshots and concise browser/check results under this task directory.
- Finish on an exact committed candidate for fresh review. Preserve the original
  baseline and reviewed commit identity. The run currently requests local
  completion, not PR creation, merging, or publication.

## Open questions

None. Investigation may reveal implementation defects or contradictions, but the
accepted product and storage decisions do not need another approval merely to
start construction.

## Build evidence

- AC1 through AC13: `pnpm test` passed 111 files and 1,310 tests. The new variable
  suite covers protected storage, key recovery failures, complete database rollback,
  metadata and optimistic edits, native delivery and redaction, unsupported delivery,
  direct same-kind bindings, portable import, deletion/reprovisioning, disabled use,
  restart/retry, children, Batch, chains, and queued comparisons. See
  [tests.log](evidence/tests.log).
- AC4, AC7, AC10, and AC11: HTTP and stdio variable transport checks passed valid
  controls and unsafe-input rejection. Invalid mutation bodies are sanitized before
  SDK validation so enum diagnostics cannot quote supplied credentials. The existing
  affected transport suites also passed. Discovery grew from 52 tools and 304,132
  bytes on the running baseline to 54 tools and 316,070 bytes on the candidate.
  The two grouped tools replace separate per-operation variants; normal reads and
  dependency/version samples are bounded. New schema volume describes explicit
  header/environment references, portable requirements, and revision-protected
  management. No per-provider tools or implicit Agent delivery were added.
- AC2, AC4, AC5, AC7, AC8, AC9, and AC12: the representative browser journey passed
  through real controls, including creation, reference selection, save/publication,
  execution, central rotation without republishing, stale-save preservation, focus
  restoration, keyboard submission, disable/re-enable, deletion protections, and
  explicit portable import binding. A forced refresh failure after an acknowledged
  write cleared Secret entry and produced exactly one mutation. See
  [browser-checks.json](evidence/browser-checks.json).
- AC12: inspected viewport captures at 1280, 900, and 390 pixels. No horizontal
  overflow; all five mobile destinations remain visible. See the
  [desktop](evidence/editor-desktop.png),
  [intermediate](evidence/editor-intermediate.png), and
  [phone](evidence/editor-phone.png) captures. The one completed Impeccable detector
  pass returned no findings in [ui-detector.json](evidence/ui-detector.json).
- AC3, AC10, AC11, and AC13: `pnpm build` and the subsequent `pnpm test:package`
  passed. See [build.log](evidence/build.log) and [package.log](evidence/package.log).
  No real provider account or user credential store was used.
- The changed-file formatting check and `git diff --check` passed. Root
  `pnpm format:check` still reports 393 pre-existing untracked artifact files; these
  remain untouched. See [changed-format.log](evidence/changed-format.log), with the
  full root output retained locally at `/tmp/interlock-variables-format-final.log`.
- Checked README, CONTEXT, architecture, current scope, Fetch and node-data guidance,
  portable transfer and prompt/version-cleanup documentation, upgrade guidance,
  connection instructions, CLI help, and the new variable guide. Checked the full
  affected MCP flow: server instructions, variable reads/writes, definition
  create/update/edit/validate, startup and safe inspection, comparisons, and transfer.
  This was not an audit of every unrelated MCP tool.

## Try the feature locally

From the repository, run `pnpm build`, then:

```sh
pnpm exec tsx .tasks/workflow-variables/serve-trial.ts
```

Open `http://127.0.0.1:4440/variables`. The trial seeds `service_token` and two
published native workflows, **Fetch variable trial** and **Script variable trial**.
Run them, replace the shared value with another fake value, and run the same
published versions again. Inspect captured revisions and redacted output. Try
creation, disable/re-enable, and the dependency blocker before deletion.

The server uses a temporary database, key, and local fake HTTP service. It does
not change the development library that holds this SDLC run. Stop it with Ctrl-C
to remove trial data. `INTERLOCK_TRIAL_PORT` selects another local port if needed.
Local testing and the accepted design do not authorize a merge or release.
