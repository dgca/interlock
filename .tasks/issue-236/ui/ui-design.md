# Workflow schedules

Ready for implementation under existing authorization. This proposal has rendered fixture evidence, not human approval. UI design v2 run `e45a3f5d-2885-4e7c-8754-8361ccca722b` addresses [#236](https://github.com/dgca/interlock/issues/236) and parent [#223](https://github.com/dgca/interlock/issues/223).

The operator needs to start a workflow periodically, understand why a fire did or did not start a run, and recover a paused or delayed schedule. The primary action is **Add schedule**. Inspection remains the default view after creation and selection.

## Chosen structure

Add **Schedules** beside Editor, Runs, and Child workflows. At wide widths, place a compact selectable schedule list beside inspection. At intermediate widths, place selection above inspection. On phones, stack the list and inspection, retain all workspace destinations, and move focus to the inspection heading after selection.

Inspection shows the schedule name and ID, cadence, enabled or disabled state, last and next fire, lag, consecutive failures, policy summary, and bounded recent fire outcomes. Input and bindings are a disclosure. A fire outcome such as **Started** or **Queued** describes admission, not successful workflow completion. Link an existing run to the current run inspector. Show a missing or deleted run as unavailable without breaking schedule inspection.

Editing uses the shared settings dialog with Timing, Run input, and Policies sections. Local edits stay in the dialog until **Save schedule** or **Create schedule** succeeds. Cancel discards them. The footer stays visible while the form scrolls. Delete belongs to inspection and its own confirmation, separate from editing.

## Settled decisions

These are design decisions under the user's authorization, constrained by the issue and current product patterns. They do not claim that the feature already exists.

| Decision            | Behavior and source                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operational records | Schedule writes apply immediately and are separate from workflow draft save and publication. Parent #223 defines persisted `workflowTriggers`.                                                                                                                                                                      |
| Published target    | Fire against the latest published workflow. Identify the current version and explain that draft edits do not affect scheduled runs. Save a disabled schedule for an unpublished workflow, but block enable with a publication next step. This follows the current manual-run boundary.                              |
| Safe creation       | New schedules start disabled. After creation, inspect the schedule, then explicitly enable. Imported schedules remain disabled, as required by both issues.                                                                                                                                                         |
| Timing              | Fixed interval defaults to 2 minutes and accepts seconds, minutes, or hours, with a 30-second minimum. Cron accepts exactly five fields and an IANA time zone. Show three upcoming times from the shared calculation, including offset or zone so clock changes are visible.                                        |
| Overlap             | Default `skip`. Labels are **Skip this fire**, **Queue at most one run**, and **Allow another run**. Keep the consequence beside each choice. Admission limits still apply to `allow`.                                                                                                                              |
| Missed fires        | Default `skip`. **Run once** makes one recovery attempt after downtime or pause, never a catch-up burst. Enabling or re-enabling explains the selected policy before it can start work.                                                                                                                             |
| Automatic pause     | Off by default. Turning it on suggests 3 consecutive failures and accepts a positive whole number. A dedicated **Re-enable schedule** action clears this schedule's automatic pause after inspection. It never releases library or workflow holds.                                                                  |
| Bindings            | Keep JSON input literal. Optional checkboxes map `scheduledAt`, `firedAt`, `triggerId`, and `previousRunId` into explicit destination paths. Show that a bound value replaces the template value at that path. Validate paths and collisions in core. `previousRunId` is null before this trigger starts a run.     |
| Attention           | Include schedule alerts in the existing Runs **Needs attention** tab, grouped as schedule alerts and linked to the exact schedule. Count schedule items independently of runs so pre-admission failure is visible. Use “items need attention” in the shared navigation accessible label when it includes schedules. |
| Excessive lag       | Display the server's current excessive-lag condition and measured lag. An alert does not disable a schedule. UI does not invent an independent threshold.                                                                                                                                                           |

## Interaction and recovery

1. Add a schedule. Enter a name and choose interval or cron timing.
2. Enter literal JSON and optional fire bindings. Choose overlap, missed-fire, and automatic-pause policies.
3. Create the schedule disabled. Inspect the recorded settings, then enable the exact schedule.
4. Inspect recent fires and follow run links. Disable to stop future fires while preserving active and queued runs.
5. Re-enable an automatic pause after reviewing failure details. Library and workflow holds still gate starts.

Enable, disable, re-enable, and delete confirmations name both the schedule and its ID. Delete removes only that trigger and its future fires; existing runs remain. Do not offer bulk resume or delete. No “run now” action is added because it would introduce another start contract.

Keep field errors beside fields and mark a hidden section when it contains an error. On submit failure, retain all entered values. On acknowledged success followed by refresh failure, close the mutation dialog, preserve the recorded outcome, mark inspection stale, and offer read-only **Retry refresh**. While pending, disable repeated submission, dismissal, and form editing together. A revision conflict retains edits and requires an explicit reload or reconciliation.

Use the shared Modal's focus trap and return-focus behavior. Fields have visible labels and associated errors. Radio groups support arrow keys. Section buttons and schedule selection work with a keyboard. On narrow selection, focus the inspection heading. Announce success and asynchronous failures without depending on color. Preserve long names, paths, error details, and JSON through wrapping or bounded scrolling.

## State coverage

The fixture demonstrates normal enabled and disabled schedules, no schedules, unpublished workflows, imported disabled schedules, never-fired schedules, loading, failed loading with retry, automatic pause, excessive lag, and workflow pause holds. Save rejection retains input. Successful mutation plus failed refresh retains the outcome. Schedule actions are independent from the exact pause-hold release UI.

Archived workflows, missing published versions, deleted run links, large histories, revision conflicts, and remote updates need production coverage using the shared API. In those cases, keep inspection available, explain why enabling is blocked, and never treat missing timestamps as zero lag. Keep history bounded with on-demand paging rather than fetching every fire.

## Existing product references

The prototype imports the real `theme/theme.ts`, `styles.css`, Sidebar, Modal, ModalBody, ModalFooter, and JsonEditor. The workflow header and tabs follow `features/workflows/WorkflowEditor.tsx`. Pause feedback follows `features/pauses/PauseControls.tsx`. Attention grouping extends `features/runs/RunList.tsx`. These are the visual authority; this is an Operate interface within the current dark Mantine design.

There is no incumbent schedule screen to compare. Current source identity and selected reference fingerprints are in [source-snapshot.json](source-snapshot.json). No running user engine was used as a baseline.

## Rendered evidence

All images were opened and inspected. Fixture time is 2026-11-07 at approximately 03:22 America/Denver. Names, IDs, outcomes, delays, and errors are non-secret fixtures.

| Evidence                                                | Viewport and observed state                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Schedules](evidence/schedules-1440.png)                | 1440 × 1000. List beside inspection, policy summary, fire outcomes, and exact actions.  |
| [Policies](evidence/policies-1440.png)                  | 1440 × 1000. Grouped radio policies and automatic-pause control, fixed footer.          |
| [Automatic pause](evidence/auto-paused-900.png)         | 900 × 1000. Selection above inspection and actionable pause explanation.                |
| [Cron timing](evidence/cron-900.png)                    | 900 × 1000. Five-field expression, zone, and clearly labeled fixture next-slot preview. |
| [Input and bindings](evidence/input-bindings-900.png)   | 900 × 1000. Existing JSON editor and explicit metadata destinations.                    |
| [Phone schedules](evidence/schedules-390.png)           | 390 × 844, full page. Stacked inspection and reflowed fire rows.                        |
| [Phone policies](evidence/policies-390.png)             | 390 × 844. Section navigation above scrolling form and visible footer.                  |
| [Unpublished empty state](evidence/draft-empty-390.png) | 390 × 844. Disabled-run boundary and useful disabled-schedule path.                     |
| [Save failure](evidence/save-failure-1440.png)          | 1440 × 1000. Retained edit and inline retry context.                                    |
| [Needs attention](evidence/needs-attention-1440.png)    | 1440 × 1000. Existing Runs tabs with schedule alert and exact inspection link.          |

[Browser checks](evidence/browser-checks.json) records exercised fixture paths. The prototype proves layout and local interaction only. Fire history, cron slots, loading delays, and failures are fixtures. Cron validation checks field count and zone validity, not full cron grammar. There is no scheduler, database, production API, persisted edit, real run navigation, actual pause-hold mutation, screen-reader session, or DST execution proof. The imported Sidebar still uses its incumbent run-only accessible count wording; production must update it when adding schedule items. Prototype-only controls sit under **Design fixtures** and do not belong in the product.

## Implementation handoff

Reuse Mantine controls directly, the shared Modal layout, JsonEditor, existing navigation protection, API feedback patterns, status colors, and pause controls. Route schedule selection and attention links by stable trigger ID. Keep shared validation in core and use shared API responses for upcoming times, effective pause state, failure counts, lag, and recent fire outcomes. The UI must not recalculate scheduler truth.

Acceptance requires all #236 UI operations, enabled state distinct from scope pauses, disabled imports, published-only activation, explicit policies, retained errors, bounded history, and responsive keyboard operation. Compare implementation against the representative evidence, then run independent UI review. Production tests must cover real API rejection and conflict behavior, cron and DST calculations, overlap and missed-fire behavior, restart idempotency, pause transitions, and attention creation and resolution.

No consequential UI choice remains open. SDLC must settle the engine contract for failure counting, excessive-lag threshold, queue accounting, missed-slot anchoring, and re-enable timing, then keep UI labels consistent with that contract. These are implementation semantics, not permission to silently change the chosen UI or issue requirements. No existing spec was edited by this design task.

## Preview

From the checkout root, run:

```sh
./packages/ui/node_modules/.bin/vite --config .tasks/issue-236/ui/prototype/vite.config.ts
```

Open `http://127.0.0.1:5196/`. Use `?state=attention`, `?state=paused`, `?state=lag`, `?state=draft`, or `?state=imported`. `?modal=edit&section=policies` opens the policy editor. Run fixture checks with `playwright-cli -s=ui236 open http://127.0.0.1:5196/`, then `playwright-cli -s=ui236 run-code --filename=.tasks/issue-236/ui/prototype/checks.js`. Close only that browser session after use. The preview uses no database or backend. The original server and browser were stopped after capture.
