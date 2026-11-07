# Pause controls design

Decision status: ready for implementation under existing authorization. This proposal has rendered evidence. No person has approved the rendered proposal.

UI design run: `7eaea61e-5b68-4d61-ad34-c97b37785cae`, published version 2. Design source: GitHub [issue 230](https://github.com/dgca/interlock/issues/230), parent [223](https://github.com/dgca/interlock/issues/223), repository conventions, and the current user authorization in [context.md](context.md). Source identity: [source-snapshot.json](source-snapshot.json). No feature source changed.

## Task and direction

An operator needs to stop execution during an incident or deployment, inspect why work is paused, and release only the pause they intend. Different actors can pause the same scope independently. The primary action is to add a pause with a scope, an actor label, and a reason. Recovery releases one exact hold ID. No blanket resume control exists.

Preserve the current Mantine theme and Sidebar. Place a persistent library execution row above the page content. When clear, it has a neutral **Pause library** action. When paused, it uses restrained amber, shows the active library hold count and one reason, and offers **Review holds**. Full reasons stay in the review dialog.

The workflow editor has a **Pause workflow** action beside its existing actions. Its paused state reads **Pauses · N**. A workflow pause banner names the local hold count and reason. Library and workflow banners remain distinct because their reach differs. On a workflow or run, the review dialog lists every applicable library and workflow hold together. Outside a workflow context, it lists library holds.

Use the existing `Modal`, `ModalBody`, and `ModalFooter` because review and release require protected focus. Each hold row has scope, actor, creation time, complete reason, exact ID, and **Release…**. Expand confirmation within that row. State how many other applicable holds remain. If any remain, say **Execution stays paused**. If none remain, say **Execution can resume**. Confirm with **Release hold** or keep it with **Keep hold**.

## Interaction and save boundaries

1. **Pause library** or **Pause workflow** opens the dialog with the add form expanded and scope selected.
2. The form requires trimmed actor and reason values. A workflow context permits **Workflow: name** or **Entire library**. Library context fixes library scope.
3. **Pause library** or **Pause workflow** creates one independent hold. It does not edit an existing record.
4. **Review holds** opens the hold list without the form. **Add another pause** reveals the form within the dialog.
5. **Release…** selects one hold ID and expands its confirmation. **Release hold** submits that ID only.
6. A failed mutation retains form values or the selected hold and shows an inline error with retry. The live server result refreshes the count.
7. **Done**, the close control, or Escape closes the dialog. Unsubmitted form edits do not mutate execution state.

These actions are immediate server operations, separate from workflow draft save or publication. Actor is a descriptive label, not an authenticated identity or ownership restriction. The prototype's Dan value is fixture content. Production uses a blank required actor field unless the app already has a reliable user-supplied default.

Keep reads, navigation, workflow editing, cancellation, and cleanup available. Manual starts may create a run that waits at the pause boundary; the engine decides admission. Do not make the Run button bypass the pause gate or silently release holds.

## Run waiting integration

Use the existing `waiting.kind = pause` and `runProjectionText` pattern. An affected blocked run shows **Paused**, the applicable hold count and reasons, and **Review pause holds**. Claims are disabled with a nearby explanation. Cancellation stays available.

Do not label an actively finishing step as stopped. A library or workflow can be paused while an in-flight Agent, Script, or Fetch finishes. Retain the actual stage and execution indicators. The blocked run fixture illustrates an unclaimed Agent at a step boundary.

Input nodes retain pending submissions and revision entry while paused. Pause disables acceptance advancement, with a reason and access to the hold review. Keep the existing input-hold controls separate from library and workflow pause records. Wait deadlines retain their wall-clock meaning; a passed deadline does not advance the workflow until its pause gate clears.

## States, keyboard, and narrow layout

Cover clear execution, one hold, multiple holds, combined library and workflow holds, loading, stale read failure, mutation pending, mutation error, successful single release, and the final release. Do not show a successful release until the server confirms it. On refresh failure, keep the last known pause indication and identify stale state.

Use Mantine focus trapping and the repository's trigger restoration. Confirmation moves focus to **Keep hold**. Successful release focuses the next release action or **Add another pause** when the list empties. Error focus stays in the confirmation. Inputs have visible labels; the required fields and disabled submit communicate incomplete input. Announce mutation errors and count changes.

At 900px and 390px, wrap editor actions below the workflow name. At 390px use the existing icon action pattern and an accessible name for the pause icon. The library row keeps its summary and action. Hide its optional single-reason preview before it crowds the controls. The workflow reason wraps. The 700px dialog fits within 16px viewport margins and scrolls its body when needed. IDs and long reasons wrap. Footer controls stay reachable. Do not truncate complete reasons inside the dialog.

## References and implementation handoff

The prototype imports the actual `theme/theme.ts`, Sidebar, WorkflowLibrary, WorkflowEditor, and shared Modal components. Baseline library and workflow images at 1440px show those current components with the same three workflow fixtures. This preserves product typography, spacing, button variants, and editor patterns.

Intended production edits are App-level shared pause state and library header, workflow action/banner integration, the shared hold dialog, and run list/inspector waiting detail. Use the shared server API for pause reads and mutations. Avoid a UI-only source of truth. The prototype uses React state for pause behavior and a portal to demonstrate insertion into the unmodified editor. Production should use ordinary component props and composition.

Observable acceptance criteria:

- Two library holds and a workflow hold appear as three applicable records on that workflow. Other workflows do not inherit the workflow hold.
- Releasing a deploy hold leaves an incident hold and the workflow hold intact. Releasing the workflow hold while library holds remain does not resume execution.
- Only the final applicable release allows progress, subject to other existing blockers.
- A stale or already-released ID never causes another record to be released. Refresh after concurrent changes; counts and confirmation consequences come from current state.
- Actor, reason, scope, ID, and creation time stay available for each active hold. Use bounded server pagination or loading for large lists, rather than silently omitting records.
- Pausing does not interrupt in-flight steps or block inspection, input revision submission, cancellation, or cleanup.
- Loading, errors, pending mutation, focus restoration, and narrow layout work in the actual app.

No unresolved consequential choice requires a human answer. The implementing Author still owns the bounded schema/API and storage design, integration tests, and documented behavior. Update CONTEXT.md, docs/architecture.md, docs/work-holds.md, docs/v1.md, related README/CLI guidance, and the full affected MCP workflow. Do not claim future schedules, webhooks, doctor, recovery windows, or stall monitoring already exist.

## Rendered evidence and verification

The isolated fixture server uses checkout sources at the recorded snapshot and a database created under the operating system temporary directory. Port 4413 is the task-owned API. Port 5183 is the task-owned Vite prototype. No real .interlock database is used.

The fixture has Release pipeline, Issue triage, and Documentation check, each with Start, Build, and Complete. Pause fixtures are deploy-bot, incident-handler, and Dan, with non-secret reasons and fixed timestamps. Pause mutations stay in the fixture's browser memory. Reload resets them. The run screen is an illustrative React fixture aligned to RunInspector patterns; it does not prove scheduler behavior.

Inspected at 1440 × 1000, 900 × 900, and 390 × 844. Representative proof:

- [Baseline library](evidence/baseline-library-1440.png) and [proposal library](evidence/proposal-library-1440.png).
- [Baseline editor](evidence/baseline-workflow-1440.png) and [proposal editor](evidence/proposal-workflow-1440.png).
- [Hold review](evidence/proposal-holds-1440.png), [exact hold confirmation](evidence/proposal-release-confirm-1440.png), [failed release](evidence/proposal-release-error-1440.png), and [remaining holds](evidence/proposal-after-release-1440.png).
- [Add pause](evidence/proposal-add-pause-1440.png) and [run pause state](evidence/proposal-run-1440.png).
- [900px editor](evidence/proposal-workflow-900.png), [390px editor](evidence/proposal-workflow-390.png), [390px holds](evidence/proposal-holds-390.png), [390px confirmation](evidence/proposal-release-confirm-390.png), [empty add state](evidence/proposal-empty-add-390.png), and [final release](evidence/proposal-run-resumed-390.png).

[Interaction verification](evidence/interaction-verification.log) records 15 passing fixture checks. They cover inherited holds, remaining-hold consequences, failure and retry, independent release, add form, Escape, paused claims, cancellation availability, narrow overflow, empty-field validation, and final release. [Focus verification](evidence/focus-verification.log) observes Keep hold, the next Release action, and Review holds after closure. Visual inspection corrected a crowded editor header and verified that complete dialog reasons remain readable. The viewport check does not assert that the workflow canvas itself never pans.

Prototype limitations: pause state is not persisted, no scheduler or concurrent-operator integration is simulated, and input inhibition is specified rather than rendered. Existing source components and the fixture server are real. Engine acceptance and runtime timing require Author tests. The only browser console resource error was the fixture's absent favicon.

## Reproduce the preview

From the checkout root, start the task-owned server:

```sh
pnpm exec tsx .tasks/issue-230/ui/prototype/server.ts
```

From packages/ui, start Vite:

```sh
pnpm exec vite --config ../../.tasks/issue-230/ui/prototype/vite.config.ts
```

Open http://127.0.0.1:5183/. Use `?baseline=1`, `?view=workflow`, `?view=run`, `&state=clear`, or `&failure=1`. Baseline omits proposed pause controls. Run `playwright-cli -s=issue230ui run-code --filename=prototype/verify.js` from the ui artifact directory after opening a task-owned Playwright session.

Both task-owned servers and the browser session are stopped after evidence capture. No production changes, commits, PRs, or releases are part of this design run.

