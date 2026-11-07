# Schedules UI review

Method: isolated fresh-context UI reviewer, with actual browser controls, source inspection, and one deterministic design scan. No implementation history was inherited. No fixes were applied.

Verdict: **revise**. Three medium implementation defects and one low validation defect remain. The candidate was rendered and exercised at 1440 × 1000, 900 × 1000, and 390 × 844. The source and production UI build remained stable.

## Scope and design authority

The operator's task is to configure periodic workflow starts, inspect admission outcomes, and recover paused or late schedules. This review covers workflow Schedules and Runs Needs attention for #236 and parent #223. Candidate HEAD is `45758202e0f8069677004163a7f615555c192354`. Its product files match checked source `4349fb5ec0f0993267371ef345e9fc27cddc8576`.

The design is proposed and ready under `existing_authorization`. It has no rendered human approval. The user deferred design review until the end. This review follows `ui/ui-design.md`, `ui/decision.md`, the issue responses captured beside this report, the final spec and plan, AGENTS.md, CONTEXT.md, architecture UI guidance, and `docs/ui-patterns.md`.

The visual criteria are the existing dark Mantine theme, workflow tabs, shared Modal and fixed action footer, JsonEditor, PauseControls, and Runs attention patterns. There was no incumbent schedule screen. I did not render an older build as a comparison. This is a review against the design handoff and existing product patterns, not a before-and-after visual regression claim.

## Findings

### UI236-R4 · Medium · Discarding edits leaves the editor open

Location: workflow Schedules editor, browser Back to the same workflow's Runs view. `packages/ui/src/features/workflows/WorkflowEditor.tsx:1091`, `packages/ui/src/features/schedules/Schedules.tsx:548`, and the App leave guard.

Reproduction: visit Runs, return to Schedules, edit the schedule name, then use browser Back. Keep editing correctly preserves the draft. Use Back again and select Discard changes. The URL and selected tab change to Runs, but the schedule dialog remains open with `Guarded route draft` and an enabled Save schedule action. The portal blocks access to Runs until Cancel is pressed.

Expected: accepted discard removes the local edit and closes the dialog before navigating. Observed: the kept-mounted schedule tab retains the editor and its draft after App clears the dirty flag. An operator can still save a draft they explicitly discarded.

Suggested change: coordinate accepted navigation with dismissal/reset of schedule editing and confirmation state, or unmount the editor when its view is left. Preserve pending-write protection and Keep editing behavior. The shared leave guard is the right pattern; it needs the schedule editor's discard lifecycle.

Evidence: [actual journey](journeys-route-delete.log), [discarded editor over Runs, 900 × 1000](discard-left-editor-900.png). Reproduced twice before the final successful log. Earlier harness timeouts came from the remaining modal intercepting tab clicks; they were not counted as product defects independently.

### UI236-R3 · Medium · Conflict reload leaves stale invalid JSON saveable

Location: Schedule editor, Reload current schedule and discard edits. `packages/ui/src/features/schedules/Schedules.tsx:1033`, and `components/JsonEditor/JsonEditor.tsx:25`.

Reproduction: open a schedule, change its name, and use the isolated API to commit a concurrent name change. Save in the dialog to get a real revision conflict. Switch to Run input and enter `{not valid`. Select Reload current schedule and discard edits. The invalid text and Enter valid JSON error remain visible. Save schedule then succeeds, closes the dialog, and stores the earlier valid JSON.

Expected: explicit reload shows the current server JSON and synchronizes its validity. Observed: reload sets `jsonValid` to true, but JsonEditor's raw buffer does not reset if the reloaded input serializes to the same value. The user sees one input while Save submits another.

Suggested change: give explicit reload a reset identity or controlled reset that replaces the JSON text and its validity together. Do not infer validity independently of the displayed buffer. Reuse JsonEditor's existing parsing boundary with an explicit reset signal.

Evidence: [concurrent edit, raw text, and persisted result](journeys-conflict-json.log), [stale JSON after reload, 900 × 1000](conflict-json-reload-900.png).

### UI236-R1 · Medium · Attention refresh resets pagination

Location: global and workflow Runs Needs attention, ScheduleAlerts. `packages/ui/src/features/runs/RunList.tsx:124`.

Reproduction: generate 24 actual schedule alerts in the isolated engine. Select More schedule alerts and wait for alerts 19 through 22. Start an unrelated fixture workflow through the same isolated server. Its normal event refresh changes App's tick. The list returns to page one and Previous schedule alerts disappears.

Expected: refresh updates the current page without changing the operator's place. Observed: the component key contains `tick`, so each event remounts ScheduleAlerts with offset zero. Frequent workflow activity makes later alerts difficult to inspect and can remove the focused pagination control.

Suggested change: keep identity stable per workflow scope and refresh through a prop/effect while retaining offset. Reset or clamp offset deliberately when scope or result size changes. Reuse the main run list's separate paging and refresh state.

Evidence: [confirmed journey](pagination-confirmed.log), [page two, 900 × 1000](attention-page2-900.png), [after unrelated run event, 900 × 1000](attention-reset-900.png). The first exploratory log captured page content before its fetch settled. The confirmed log explicitly waits for alert 22 and establishes the defect.

### UI236-R2 · Low · Time-zone errors identify the cron field

Location: Schedule editor Timing. `packages/ui/src/features/schedules/Schedules.tsx:839` and `:852`.

Reproduction: retain valid cron `0 9 * * 1-5`, enter `Mars/Olympus` in IANA time zone, and save. The error appears under Cron expression. That input receives `aria-invalid=true` and the error description. The invalid zone field has neither association.

Consequence: the screen and assistive technology direct the user to correct a valid field. The text names the zone, so recovery is possible, but the field association is wrong.

Suggested change: retain nested validation paths and map zone errors to the IANA time zone control, expression errors to Cron expression, and interval errors to Every. Follow the existing Mantine field error pattern.

Evidence: [keyboard and ARIA results](journeys-keyboard.log), [invalid zone, 900 × 1000](invalid-zone-900.png), [validation journey](journeys-create.log).

All four findings are new and unresolved. No prior review or finding IDs were supplied. No separate design decision requires approval. The SDLC review's runtime admission-timestamp finding was relayed to this reviewer; it was not independently reproduced here or duplicated as a UI finding.

## Visible strengths

The wide screen gives inspection most of the available space and keeps dangerous actions separate from editing. Published-version guidance explains the real execution boundary. Policy descriptions explain consequences at the choice, and the input disclosure avoids filling inspection with JSON.

The intermediate layout places selection above inspection. Phone navigation retains every workspace destination, schedule IDs wrap, and selection moves focus to the inspection heading. The phone editor keeps its action footer visible while its body scrolls. No horizontal overflow was measured at 390 pixels.

Successful writes and follow-up reads have distinct states. A rejected write preserves edits. An acknowledged write closes editing and offers read-only Retry refresh. The delayed-write journey observed one POST, disabled form/dismiss controls, and Escape protection. Retry refresh kept the POST count at one.

Automatic-pause and lag alerts are independent of run attention. The initial fixture showed two schedule alerts, zero run alerts, and the accessible label `2 items need attention`. Both Inspect schedule links reached their exact schedule IDs.

## Coverage inventory

Checked means rendered or exercised here as described. Source-only checks and exclusions are named explicitly. This is a bounded UI review, not an engine test-suite result.

| View or state | Viewport | Status and evidence |
| --- | --- | --- |
| Enabled interval inspection, list, policies, real fire outcome | 1440 | Checked. [screen](schedules-1440.png), [control journey](journeys-attention.log) |
| Stacked selection and inspection, disabled cron, never fired | 900 | Checked. [screen](schedules-900.png), [create results](journeys-create.log) |
| Phone inspection and selected-heading focus | 390 | Checked. [screen](inspection-390.png), [focus and width](narrow-inspection.log) |
| Empty unpublished workflow, disabled creation, enable prerequisite | 390 | Checked. [empty screen](draft-empty-390.png), [journey](journeys-narrow.log). Enable remained disabled. |
| Timing, five-field cron, zone, interval minimum, literal JSON, bindings | 1440 and 900 | Checked through controls. [validation](journeys-create.log), [field associations](journeys-keyboard.log). Below-minimum interval clamps to 30 on blur. |
| Policy choices and failure threshold | 1440 and 390 | Checked. [wide form](create-policies-1440.png), [phone form](policies-390.png), [persisted settings](journeys-mutate.log) |
| Run input and metadata binding editor | 390 | Checked. [journey](journeys-narrow.log), [screen](run-input-390.png) |
| Enable, disable, delete, and exact-ID confirmation | 1440 and 900 | Checked actual mutations. [enable/disable](journeys-mutate.log), [delete](journeys-route-delete.log). Deleted ID returned Schedule not found. |
| Pending mutation and rejected save | 1440 | Checked using network interception. [pending/refresh](journeys-refresh.log), [rejection](journeys-mutate.log), [retained form](rejected-edit-1440.png) |
| Acknowledged save with failed refresh and read-only recovery | 1440 | Checked. [screen](acknowledged-refresh-failed-1440.png), [one-write result](journeys-refresh.log) |
| Revision conflict, retained draft, explicit reload | 900 | Checked real concurrent API edit. [JSON recovery defect](journeys-conflict-json.log). The earlier exploratory Back sequence timed out and was replaced by the completed route journey. |
| Browser Back, Keep editing, accepted discard, normal Cancel/Escape | 900 and 390 | Checked. [route journey](journeys-route-delete.log), [keyboard](journeys-keyboard.log), [normal Escape focus](journeys-narrow.log). R4 remains. |
| Keyboard trap, visible focus, labels, zone error association | 900 | Checked Enter, Tab cycles and Escape. All 16 sampled Tab steps remained in the dialog. Normal dismissal returned focus to Edit schedule. R2 remains. |
| Automatic pause after failed admission without run | 900 | Checked actual runtime. [screen](automatic-pause-900.png), [reenable confirmation and result](journeys-attention.log) |
| Pending queued run and excessive lag | 900 | Checked actual runtime. [screen](queue-lag-900.png), [outcomes](journeys-attention.log). Lag did not disable the schedule. |
| Independent attention, stable links, accessible count, no empty run panel | 1440 | Checked. [screen](attention-1440.png), [journey](journeys-attention.log), initial accessibility snapshot in `.playwright-cli` |
| More than 20 attention items | 900 | Checked real runtime failures and actual paging. [confirmed refresh defect](pagination-confirmed.log). R1 remains. |
| Missing schedule and list recovery | 900 | Checked. [screen](missing-schedule-900.png), [select valid schedule](journeys-attention.log) |
| Real run inspection link | 900 | Checked actual route navigation. [journey](journeys-attention.log) |
| Missing historical run | 900 | Checked seeded display state only. [fixture](missing-run-fixture.json), [result](missing-run.log), [held inspection also shows unavailable outcome](enabled-with-hold-900.png). No real run was deleted. |
| Named workflow hold while enabling | 900 | Checked real Pause workflow and Enable schedule controls. [journey](journeys-hold.log), [screen](enabled-with-hold-900.png). Exact hold remained present. |
| Archived workflow, removed published version, imported-disabled provenance | No rendered variant | Source-only. The unpublished prerequisite and disabled state were exercised. Import/archive operations belong to the independent SDLC review. |
| Large fire-history paging and schedule-list paging | No interaction sample | Source inspected; not independently exercised. Attention paging was exercised. These remain bounded coverage limits. |
| Physical touch device or assistive-technology speech output | Not applicable to this browser session | No physical device or screen-reader session. Browser viewport, keyboard, semantics, and focus were checked. No full WCAG conformance claim. |

## Evidence provenance and process identity

The independent SDLC reviewer confirmed build completion before fingerprints and serving. No rebuild occurred here. [Source snapshot](independent-source-snapshot.json) contains before and after hashes for all 526 tracked source/configuration files outside `.tasks` and all 44 UI dist files. HEAD and both maps match. Git is dirty only because this review directory is untracked. [Served identity](served-identity.json) records matching SHA-256 hashes for every served production asset.

Launch command from the candidate checkout was `pnpm exec tsx .tasks/issue-236/ui/runtime-server.ts`. It started loopback port 5197 using a new temporary Store. Listener PID was 81617, tool session 85926. [Runtime provenance](runtime-provenance.json) preserves the generated directory, IDs, URL, and fixture source.

The supplied runtime-server fixture seeds an enabled due slot, then calls the real scheduler. `runtime-states.ts` added a real failed-admission automatic pause and a real capacity-queued late fire in that verified directory. [Additional alert fixture](seed-alerts.ts) created 22 schedules and seeded due slots before the real pump generated their errors. [Missing-run fixture](seed-missing-run.ts) seeded a display-only historical row with a nonexistent run ID. All mutations targeted only this isolated server or Store.

Network failure evidence is injected, not a real outage. `journeys-mutate.js` aborted `triggers.manage` to test retained edits. `journeys-refresh.js` delayed one actual mutation, then aborted the follow-up trigger GETs. The same script removed routes and clicked Retry refresh while counting mutation requests. Concurrent-edit evidence used a real revision-protected API update against the fixture server.

The author evidence in `ui/runtime-evidence/browser-checks.json`, its screenshots, and `checks/provenance.json` describes earlier work at its stated commits. It was read for scope and attribution, not substituted for fresh controls. The design prototype is a fixture, not scheduler proof. This report's cited captures and logs were produced independently against the verified candidate.

The Impeccable context command ran once. The source detector ran once on Schedules, RunList, and Sidebar and returned no findings in [detector.json](detector.json). Manual interactions found the four defects above. This review did not use the optional live overlay or claim a dual-agent critique. The rendered browser was headless Playwright Chromium, not a physical-device or screen-reader test. No design/source files were written by the reviewer. Unslop and technical-writing guidance were applied to this report.

## Cleanup and retained artifacts

[Cleanup receipt](cleanup-receipt.json) records completion at `2026-11-07T11:44:47.232634+00:00`. Browser session `review236` closed. PID 81617 exited normally after SIGTERM. Port 5197 has no listener. The exact temporary database directory and the two fixture context files were removed. Shared engine configuration, shared schedules/pauses, and user `.interlock` data were untouched.

Report, result, source/served snapshots, cleanup receipt, browser logs, fixture provenance, and representative screenshots are copied to `/tmp/interlock-236-ui-review/` for worktree-cleanup survival. No commit, push, pull request, release, publication, or deployment was performed.
