# Implement deterministic resource ownership

Behavior and criterion identifiers are defined in [spec.md](spec.md). Scope and baseline are defined in [intent.md](intent.md).

## Build ownership

1. Extend core node declarations and publication binding checks for AC1. Extend reservation and reconciliation contracts to identify either an Agent work attempt or a deterministic run/execution attempt. Preserve legacy Agent request and response compatibility.
2. Extend WorkResources with exact deterministic owner acquisition, completion, interruption, and inspection. Persist resolved names and admission state on executions. Acquire inside a transaction before external launch. Keep execution timeout creation after admission. Suspend and restore polling deadlines during resource queueing, covering AC2–AC4.
3. Integrate startup, cancellation, shutdown, background Script outcome/reconciliation, and polling restart with conservative ownership. No late callback may release a replacement owner. Retain cleanup blockers, covering AC5–AC6.
4. Extend run projections, bounded continuation records, shared reconciliation API, CLI help, and MCP definitions. Inspect existing owner rendering and adapt only affected labels, covering AC3 and AC6.
5. Update required docs and affected README wording. Review authoring, discovery, inspection, cancellation, reconciliation, and history cleanup MCP instructions against actual schemas and runtime. Add a patch changeset, covering AC7.
6. Run focused resource/core/projection tests, HTTP and stdio discovery transport tests if definitions change, then `pnpm test`, `pnpm build`, and `pnpm format:check`. Record evidence and commit the complete candidate, covering AC8. Use temporary databases only.

## Highest-risk checks

- Acquisition races: two valid operations compete for overlapping names. One launches and the other stays resource-blocked with no partial reservation. Include an uncontended valid control.
- Queue clocks: hold a resource beyond configured operation timeout, then release. The queued operation launches with its full timeout. For polling, the resource-blocked interval moves the total deadline while idle polling retains normal elapsed time.
- Stale settlement: cancel an active operation, explicitly reconcile its exact owner, and launch a replacement. The old callback must not clear replacement reservations.
- Restart: reopen a temporary file-backed database containing an active foreground or polling owner. Ownership becomes uncertain and blocks replay until explicit stopped confirmation. Background control retains ownership while its authenticated supervisor remains active.
- Manual release: active ownership rejects release. Exact uncertain owner releases, repeated release is harmless, and wrong attempt cannot release another attempt.
- Publication: valid declarations survive serialization and binding validation; invalid names, scopes, duplicates, excess names, and non-poll Wait declarations reject publication while incomplete drafts remain saveable.

## Independent review ownership

The coordinator assigns a separate fresh reviewer to inspect the complete baseline-to-candidate diff, verify every spec criterion and required documentation, and independently verify `pnpm test`, `pnpm build`, and `pnpm format:check`. The author stops before claiming that assignment. Any findings return to the author for repair and another review round. Human UI review remains deferred as authorized in intent.md.

## Delivery

Delivery follows only a passing fresh review at the exact candidate commit. The coordinator directs rebasing, CI, PR creation using the repository template, merge, and worktree cleanup. A changed candidate needs renewed review as required by the workflow.

## Build results

- AC1: `tests/stepResources.test.ts` checks valid declarations and rejects duplicate, empty, excess, invalid-scope, and non-poll Wait requirements. Draft creation remains separate from publication.
- AC2–AC4: the same suite checks atomic mixed Agent/Script/Fetch contention, bounded execution blockers, a real Script that waits beyond its timeout before launch, polling deadline suspension, and release between probes. Injecting the second reservation write failure leaves the complete prior ownership set unchanged and launches no operation.
- AC5–AC6: the suite checks Script/Fetch/poll restart uncertainty, queued restart safety, exact uncertain release, active-release rejection, stale callback isolation, and authenticated background recovery. The 25 existing Agent resource tests and 18 background Script tests also pass. Named-pause coverage proves a polling deadline resumes wall-clock behavior when contention ends during a pause.
- AC7: checked README, the required architecture/resources/v1 docs, timers, agent workflow guidance, and CLI help. Updated affected descriptions for server instructions, briefings, resource inspection/release, Script reconciliation, and cancellation. Reviewed authoring schemas, full inspection, discovery/claim, retry, submission/failure/renewal, and history deletion guidance against the shared API. This is an affected-flow review, not an audit of the complete MCP tool set.
- AC8: `pnpm test` passed 1,594 tests in 134 files. `pnpm build` passed TypeScript, UI, and package bundling. `pnpm format:check` passed. Proof logs are `/tmp/interlock-242-test.log`, `/tmp/interlock-242-build.log`, and `/tmp/interlock-242-format.log` outside the checkout. The build retains its existing large-chunk advisory.
- HTTP and stdio transport tests passed identical discovery contracts, including both resource target shapes. Discovery remains at 60 tools and 282,261 bytes, within existing bounds. No tool was added; deterministic targets and owner identities extend the existing bounded, on-demand operation.
- Human UI verification is deferred by the coordinator's explicit instruction. Existing run progress labels distinguish resource waits, and the owner label covers Agent and deterministic owners. No new UI authoring flow or layout was added.
- Package smoke testing is not required for this change to execution behavior and CLI help; packaging, CLI startup, and versions are unchanged.


## Repair after fresh review

Finding `9654023388ab-fetch-uncertainty` exposed a distinction the original synthetic failures did not reach. A client timeout or connection loss does not establish that remote work stopped. The cause was loss of dispatch/response-completion information before ordinary and polling settlement released reservations.

The repair classifies failures at the actual Fetch boundary. Failures after dispatch and before full response consumption carry uncertainty through secret redaction and settlement. Protected ordinary Fetch stays terminal; protected polling enters its resource queue immediately and preserves the remaining deadline until exact remote-stop reconciliation. Failures before dispatch and fully observed HTTP or invalid JSON outcomes keep normal release behavior. Unconfigured Fetch behavior stays compatible.

Real local HTTP regressions exercise ordinary and polling timeouts and connection loss while remote work remains active, block another owner and another probe, and require exact reconciliation. Controls exercise fully observed HTTP/JSON failures, missing bindings before dispatch, and polling resumption after confirmed remote stop. The original two timeout cases failed before repair, with empty reservations, in `/tmp/interlock-242-fetch-red.log`. Repair checks and the original review reproduction are retained outside the checkout.

Repair validation passed `pnpm test` with 1,601 tests in 134 files, `pnpm build`, and `pnpm format:check`. Logs are `/tmp/interlock-242-repair-test.log`, `/tmp/interlock-242-repair-build.log`, and `/tmp/interlock-242-repair-format.log`. HTTP and stdio discovery agree at 60 tools and 282,446 bytes, below existing bounds. `/tmp/interlock-242-fetch-boundary-repaired.log` records the original reviewer reproduction retaining an uncertain reservation while the remote handler remains active. The seven additional cases in `tests/stepResources.test.ts` pass, including routing known response failures and resuming polling only after exact reconciliation. Updated Fetch/failure-route/resource/timer documentation and retry/resource MCP guidance describe this distinction. No new public field or tool was added.
