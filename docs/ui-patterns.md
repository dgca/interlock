# UI interaction patterns

Variables extends the central library/editor pattern. Management reads are safe
metadata; Secret values have **Set value** and **Replace value**, never reveal.
Entered Secret text is cleared on acknowledged writes before refreshing views.
Rejected writes retain edits. Node controls use explicit metadata pickers; import
preview requires deliberate local binding or provisioning. Mobile navigation keeps
all eight workspace destinations and engine connection status visible. **Connect with MCP** is available when enabled.

Interlock uses the Mantine theme in `packages/ui/src/theme/theme.ts` and the shared CSS variables in `packages/ui/src/styles.css`. Node settings provide the reference for section navigation, spacing, and form hierarchy. These patterns extend that visual system.

## Page layout

Keep reusable page presentation in `packages/ui/src/components`. `PageLayout` owns page headers, tab bars, and `PageTabsSkeleton`. `ListTable` owns the shared list container, headings, link/button rows, responsive spacing, focus/hover states, and `ListTableSkeleton`. Features supply their columns, cell content, state labels, and navigation or action callbacks. Use these shared modules when extending Runs, Automations, Variables, AI Settings, and workflow libraries. Static table rows can contain separate controls such as a switch and Configure button.

Tabs switch sections within the current resource or list. Use sidebar navigation or an explicit link to open another workspace.

Automations, the global Runs list, Variables, and AI Settings use the shared `PageHeader`. Pages with tabs use the shared tab-row styles; Variables uses `PageToolbar` for its count and search. Automations uses `PageTabs` for URL-backed views; Runs uses `PageTabList` within Mantine Tabs for controlled in-page sections. The header contains the page title and actions. Add Back on creation and resource pages; omit it on a top-level list. Place underline navigation directly below the header on the same surface background, with search and filters aligned to the right. Keep both visible while the workspace scrolls.

Place creation and editing form fields inside a surface card with 24px padding and generous section spacing. The preview rail spans the available height below the header. Activity table bodies use the card background. Use spacing for the next-run and last-occurrence summary; avoid inset divider lines.

Automations list filters and page offsets live in the URL and survive detail navigation. Creation defaults to disabled with an explicit enable checkbox and a **Create** action. Successful creation opens ordinary detail without a review gate. Preserve edits after rejected writes, disable repeat submissions while pending, and retain acknowledged outcomes if refresh fails. Revision conflicts offer reload while preserving local edits until discarded.

Runs tables share the Automations row spacing, title-case headings, typography, status dots, and navigation chevrons. Run rows retain their stage, actor, attention reason, version, tags, comparison context, and exact start time. Tag filters open from the tab toolbar into a form card. Global history actions live in the page header; workflow-scoped history actions remain beside the run tabs.

AI Settings presents Harnesses, Model aliases, and Execution settings as sections
on one scrollable page. Each section keeps its
own actions. Expanded harness configurations stay inside the table surface;
new configurations use form cards. The alias list, empty state, and
editor share one form container, with a divider before an open editor. Alias editors retain
unsaved changes through list refreshes, guard revision conflicts, and keep
ordered candidates keyed across reordering. Execution settings retain concurrency,
stall detection, and history retention cards with consistent subheadings and
short guidance explaining their effects. Library stall switches reveal threshold
fields when enabled; workflow and node editors retain inheritance choices.
Form save actions align to the right. Existing `/settings/harnesses`
links redirect to `/settings/ai`, preserving query strings and anchors such as
`#concurrency`. Custom harness setup uses the shared modal with a scrollable body,
grouped fields, and a fixed action footer.

Variable creation and editing use the shared header with Back, Cancel or Discard changes, and Create or Save changes. Forms use the shared card and content widths. Preserve write-only Secret behavior and metadata-only list reads. List loading and failed searches never show rows from another search; rejected reads offer retry.

The Workflows library uses the shared header and Active/Archived tab toolbar. Child workflows uses the same toolbar within its parent workflow, without a repeated page heading. Search filters names and descriptions; tab counts reflect that search within the library or selected owner. Child workflows stay out of the main library. Both collections reuse `components/WorkflowCards` and `EmptyState`, with native links for library workflows and guarded buttons for child navigation. Card menus remain separate from the card's navigation target. Card footer rules reach the edges of the card. Creation lives in the toolbar; the empty library also offers starter discovery. Keep loading, no matches, no active items, and no archived items distinct.

## Items that need attention

The Runs navigation badge counts run attention items plus independent schedule alerts. Its accessible name uses “item needs attention” or “items need attention.” Run items cover pending managed approvals, questions, model selection and recovery confirmation, including cancelled runs awaiting recovery. Ordinary queued assignments, capacity waits and generic holds do not count by themselves. Owned descendants count under their nearest top-level or detached run; detached runs count independently. Schedule alerts cover automatic failure pauses and excessive fire lag, even when no run row exists. Each links to its exact workflow and schedule ID.

The shared `runs.attention` API supplies run IDs, reason categories and target execution IDs. `triggers.attention` supplies separately paged schedule alerts. The navigation badge sums their independent totals. `runs.summaries` supplies run attention markers plus `scheduleAttentionCount` for the Needs attention tab total; schedule alerts are not inserted into run rows. These bounded reads omit prompts, run inputs, claim tokens and schedule input templates. Active run rows still show wait reasons such as holds, agent assignments and external input.

Run pages show at most 100 rows. Schedule alert pages show 20 items and refresh their current offset after engine events; a vanished last page clamps to the last available page. Workflow scope changes reset schedule paging. Run tab/filter and run page persist in the URL, and run inspection retains that return destination. Schedule links open inspection using the stable trigger ID. Counts include all matching run and schedule items, independently of which page is visible.

The run summary identifies the action that needs attention. **Review request** or **Review recovery** selects that assignment and focuses its details. Multiple assignments use a bounded menu. Attention in an owned child belongs to the parent run; detached runs retain their own attention state.

The selected step appears beside the graph on wide screens and before the graph on narrow screens. On narrow screens, selecting a graph node or timeline row moves focus to the details. Assignment actions precede the prompt and context disclosure. A manual result remains in the inspector while its claim is active, including when another step is selected.

An agent waiting for a human response is **Waiting for your response**, even while its ownership claim remains active. Interrupted managed work is **Recovery needed**. These are presentation labels; they do not change execution or claim state.

## Approval requests

A request shows the native title and complete captured action details beside **Deny** and **Allow once**. Instructions explain that approval applies to this request only. Technical text remains selectable, keyboard-focusable, and scrollable. It is never replaced with an inferred summary.

Submission disables the request's controls and shows a pending label. Successful submission shows the recorded outcome. A failed refresh preserves that outcome and offers **Reload execution** without offering the same request again. Mutation failures retain entered answers. Execution details include the recent resolved requests supplied by inspection.

## Recovery

**Stop agent** is visible without opening execution details. Recovery separates checking the previous attempt from starting another:

1. Check the agent session and commands it started.
2. Inspect changes that retrying might repeat.
3. Explicitly confirm that the agent and its commands stopped.
4. Retry the held assignment, or release reservations without restarting a cancelled run.

The recovery panel explains where to inspect the session and what confirmation does. It never treats a missing process or expired claim as proof that external work stopped. A new attempt clears the previous attempt's confirmation and feedback. Retrying may produce another native approval request.

## Saving and connection feedback

Workflow, automation, prompt, variable, and AI Settings edits use the workspace leave guard. Inline form errors preserve input and stay beside the action. Dialogs restore focus on dismissal when the trigger remains available. Global notifications sit below dialogs. A failed workspace refresh marks cached data as possibly out of date and offers a retry.

## Modal layout

Use the shared `Modal`, `ModalBody`, and `ModalFooter` from `components/Modal`. Node settings are the reference for the title and close button, scrollable content, and separated action bar.

- Size the dialog for its content. Let confirmations and simple forms fit their contents. Give sectioned editors enough height to keep navigation and actions steady as users switch sections.
- Use a single-column body by default. Use a flush body for a sidebar or other editor layout that manages its own scrollable content. Put section navigation above the content on phones.
- Put the dismissal action and primary action at the end of the footer, in that order. Use the footer's optional aside for a secondary destructive action or a short consequence that matters before committing. Use the danger variant when deletion or discard is the decision itself.
- When an action is blocked, give the user the available next step. For example, a parent workflow with children offers **View child workflows**.
- Keep field validation beside its field. Keep submission feedback inside the dialog. While a write prevents dismissal, disable the close button, Escape, and the footer dismissal action together.
- Keep keyboard focus inside the dialog and return it to the opening control on dismissal when that control remains available. When a contract editor opens as a page within settings, put Back beside the title. Back and Escape return to settings and restore focus to the contract's edit button.

## Loading views

Use static skeletons shaped like the content being loaded. Keep the loading announcement available to assistive technology and hide the decorative placeholders from it. Preserve the action label when a write is in progress.

The Automations and Runs lists keep their shared headers and status tabs in place during route and initial data loading. Placeholder rows match the list columns. Background refreshes retain loaded rows for the same query. Changing Automations filters or pages shows a loading state until that query succeeds; a failed read does not display another query's rows. Errors show retry feedback instead of an indefinite skeleton.

Workflow pause controls use a direct **Pause workflow** and **Resume workflow** toggle, with shared pending state and a fresh status check before writing. Each acknowledged change stays visible while status refresh is pending or unavailable. **Retry pause status** repeats only the read. Library holds remain visible blockers with CLI/MCP recovery guidance.

## Review before shipping

For a changed interaction, inspect the rendered path at desktop, intermediate, and phone widths. Check keyboard navigation, visible focus, long content, and meaningful status announcements. Exercise loading, pending submission, success, rejection, failure, and recovery where they apply. Use temporary workflow data and simulated adapters for repeatable UI checks. Keep native harness validation separate and identify which harnesses were actually exercised.

Keep tests focused on consequences: request identity, retained answers, explicit confirmation, repeated clicks, and refresh failures after a recorded action. Screenshots and mechanical checks supplement interaction checks; neither establishes usability alone.

## References

- [n8n human review](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools/) provides the tool and proposed parameters for a human decision.
- [Visibility of system status](https://www.nngroup.com/articles/visibility-system-status/) explains feedback during actions and state changes.
- [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) explains prioritizing frequent decisions while retaining access to advanced details.
