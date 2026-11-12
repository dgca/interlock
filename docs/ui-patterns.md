# UI interaction patterns

Variables extends the central library/editor pattern. Management reads are safe
metadata; Secret values have **Set value** and **Replace value**, never reveal.
Entered Secret text is cleared on acknowledged writes before refreshing views.
Rejected writes retain edits. Node controls use explicit metadata pickers; import
preview requires deliberate local binding or provisioning. Mobile navigation keeps
all eight workspace destinations and engine connection status visible. **Connect with MCP** is available when enabled.

Interlock imports visual controls from `packages/ui/src/design-system/index.ts`. That module owns the Mantine theme, shared CSS tokens, context-independent components, and curated Mantine re-exports. IBM Plex Sans supplies UI text and IBM Plex Mono supplies technical values and code. Fonts ship with the application. Let the design system own control appearance. Keep feature CSS for layout and domain-specific exceptions. Application compositions such as WorkflowCards and StatusBadge remain in `components`.

Structural areas use solid fills. Form containers use a solid fill with soft elevation. Buttons, segmented controls, workflow and run cards, and graph nodes use the shared gradients and shadows. Standard buttons, single-line inputs, selects, search fields, and segmented tracks are 40px high. Attached tabs are 44px. Graph navigation controls deliberately use flat 32px buttons. Structural dividers are 1px `#333333` rules that reach the edges of their containing panels.

## Page layout

Keep generic page presentation in the design system. Its PageLayout module owns page headers, toolbar and controlled-tab building blocks, and `PageTabsSkeleton`. The application PageLayout module adapts tabs to URL navigation. `ListTable` owns the shared list container, headings, link/button rows, responsive spacing, focus/hover states, and `ListTableSkeleton`. Features supply their columns, cell content, state labels, and navigation or action callbacks. Use these shared modules when extending Runs, Automations, Variables, AI Settings, and workflow libraries. Static table rows can contain separate controls such as a switch and Configure button.

Page headers use one shared responsive composition. Titles and optional subtitles or statuses sit on the left. Search, filters, and view controls sit on the right, followed by actions with the primary action last. The title row shares `--page-header-height`, an 88px minimum, with the sidebar brand container. When the combined controls and actions cannot fit beside the title, the whole group moves into a full-width second row below the title divider. Related control groups can wrap further at narrow widths without shrinking standard controls. Use available container width, including embedded panels, rather than page-specific viewport thresholds. Keep the logo at 32px.

Tabs switch sections within the current resource or list. Use sidebar navigation or an explicit link to open another workspace.

Automations, the global Runs list, Variables, and AI Settings use the shared `PageHeader`. Pages with tabs use the shared tab-row styles. Variables and Prompts keep counts in static header subtitles and search in header controls. Automations uses `PageTabs` for URL-backed views; Runs uses `PageTabList` within Mantine Tabs for controlled in-page sections. The header contains the page title and actions. An optional subtitle adds meaningful context without becoming a live status announcement. Add Back on creation and resource pages; omit it on a top-level list. Put page-level search, filters, and presentation controls in `PageHeader.controls`, before `PageHeader.actions`. Attached tabs follow the header directly. Scoped embedded views retain local toolbars above their own tabs. The selected tab has rounded top corners, square bottom corners, and the same solid fill as its content, covering the bottom boundary beneath it. Keep the boundary visible beside the selected tab. Headers and toolbars stay visible while the workspace content scrolls.

Place creation and editing form fields inside a solid form card with generous section spacing. The shared workspace card owns its responsive padding through `--card-padding`, which is 24px by default and 20px on narrow screens. Footers and full-width dividers inside that card use the variable instead of repeating its values or breakpoint. The preview rail spans the available height below the header. Activity table bodies use the shared list surface. Use spacing for the next-run and last-occurrence summary; avoid inset divider lines.

Use a direct neutral secondary Delete button with a trash icon when deletion is the only action in a dropdown. Reserve action menus for multiple operations. Saved prompt and variable headers place Delete before the primary Save action; automation detail headers place Edit and Delete before the Enabled switch. Child workflow cards use the same direct Delete treatment. The switch reflects saved enablement, retains disable confirmation, and is unavailable while a mutation is pending. Failed mutations preserve the saved state. The switch confirms enablement without a persistent success banner. Auto-paused remains distinct from disabled: retain the pause warning and its explicit Resume automation action.

Automations list filters and page offsets live in the URL and survive detail navigation. Creation defaults to disabled with an explicit enable checkbox and a **Create** action. Successful creation opens ordinary detail without a review gate. Preserve edits after rejected writes, disable repeat submissions while pending, and retain acknowledged outcomes if refresh fails. Revision conflicts offer reload while preserving local edits until discarded.

Runs defaults to List, with List and Overview available above the results. Only List shows Active, Needs attention, and History tabs. Overview shows Active runs first, then Needs attention and Completed runs, independently of the remembered List tab and page. Overview uses the first active page and bounded attention and completed previews; its links open the corresponding paged List tab. Automation alerts remain discoverable through Needs attention even when run tags are filtered. Mode, List tab, offset, workflow scope, and exact tag filters survive URL reload and inspector navigation. Completed runs are ordered by run creation time, so the column does not claim completion recency. Stage, actor, waiting reason, and execution count come from real summaries; a progress ratio is unavailable.

Runs tables share the Automations row spacing, title-case headings, typography, status dots, and navigation chevrons. Run rows retain their stage, actor, attention reason, version, tags, comparison context, and exact start time. Tag filters use the shared anchored popover in Runs and Report, including workflow-scoped views. Workflow-scoped Runs places the trigger in its local toolbar. The popover explains optional run metadata and offers manual key/value conditions. Apply commits all exact-match conditions; Cancel, Escape, and outside dismissal discard the draft. Conditions preserve case, whitespace, and empty values. Applied conditions appear as removable chips outside scrolling results, with Clear all. Do not infer library-wide tag availability or suggestions from a loaded page. A History menu keeps Retention settings and Clean up history available in every List tab and in Overview. The global menu lives in the page header; workflow-scoped Runs keeps it in the local toolbar. These actions retain their library or workflow scope and existing confirmation flow. Dismissing either dialog returns focus to the History trigger.

AI Settings has three URL-backed tabs: Harnesses, Agent presets, and Execution settings. Collections and policy forms use a 1040px content column and keep actions beside their headings. Harnesses shows one row per built-in harness or custom integration. **Edit defaults** expands the fields inside the row, with its own save action. **Add integration** opens a form for choosing the execution mode, transport, and command or URL. HTTP headers, launcher hooks, and advanced settings expand in place.

Board, Prompt, Automation, Variable, and custom integration editors confirm before leaving with unsaved edits. Keep editing returns to the same draft. A pending save blocks in-app navigation, and the browser warns before leaving or reloading a dirty or saving form. A failed save keeps the inputs available for retry.

Prompts use the same route editor for creation and editing. The header groups Back, Cancel or Discard changes, and the primary Create prompt or Save changes action. Saved prompts show Delete before Save changes. A revision conflict offers Load latest and confirms before replacing unsaved edits. Creation retries the original request when its outcome is unknown. After creation the saved prompt is immediately available, and workflow references load independently.

**New preset** and **Edit** use the same modal with a fixed action footer. Reordering preserves each choice's values. Dismissal protects dirty edits, and revision conflicts offer reload. Tab navigation and browser Back or Forward use the workspace discard guard. Within a tab, anchor navigation preserves edits.

The Agent node's **Executor** select lists **Workflow default** and **Connected agent** before the available harness and preset groups. A saved unavailable choice remains visible, but cannot be selected again. Direct harness selections group model and thinking effort below Executor. Inherited settings show the resolved harness and model when known.

Concurrency, stall detection, and history retention retain independent save boundaries. Stall switches reveal threshold fields; workflow and node editors retain inheritance choices. Form save actions align to the right. Existing `/settings/harnesses` links redirect to `/settings/ai`, preserving query strings and anchors. Legacy anchors such as `#concurrency` select Execution settings. Task URLs use `?tab=harnesses`, `?tab=model-aliases`, and `?tab=execution`.

Variable creation and editing use the shared header with Back, Cancel or Discard changes, and Create or Save changes. Forms use the shared card and content widths. Preserve write-only Secret behavior and metadata-only list reads. List loading and failed searches never show rows from another search; rejected reads offer retry.

The Workflows library uses the shared header for search and actions, with Active/Archived tabs directly below. Child workflows keeps a scoped toolbar within its parent workflow, without a repeated page heading. Search filters names and descriptions; tab counts reflect that search within the library or selected owner. Child workflows stay out of the main library. Both collections reuse `components/WorkflowCards` and `EmptyState`, with native links for library workflows and guarded buttons for child navigation. Card menus remain separate from the card's navigation target. Card footer rules reach the edges of the card. New workflow lives in the library header; child creation remains in its scoped toolbar. The empty library also offers starter discovery. Keep loading, no matches, no active items, and no archived items distinct.

Workflow card descriptions initially show at most four rendered lines. Show the link-style **Show More** action only when text is truncated at the current width. It expands the complete description inside the same card, preserving paragraph breaks, and changes to **Show Less** to restore the clamp. Render the shared `Anchor` as a native button for Enter/Space activation, `aria-expanded`, and `aria-controls`; expansion does not navigate. Preserve keyboard focus when collapsing or when responsive changes remove an unnecessary action. The shared card applies this behavior to both library and child workflows.

## Items that need attention

The Runs navigation badge counts run attention items plus independent schedule alerts. Its accessible name uses “item needs attention” or “items need attention.” Run items cover pending managed approvals, questions, model selection and recovery confirmation, including cancelled runs awaiting recovery. Ordinary queued assignments, capacity waits and generic holds do not count by themselves. Owned descendants count under their nearest top-level or detached run; detached runs count independently. Schedule alerts cover automatic failure pauses and excessive fire lag, even when no run row exists. Each links to its exact workflow and schedule ID.

The shared `runs.attention` API supplies run IDs, reason categories and target execution IDs. `triggers.attention` supplies separately paged schedule alerts. The navigation badge sums their independent totals. `runs.summaries` supplies run attention markers plus `scheduleAttentionCount` for the Needs attention tab total; schedule alerts are not inserted into run rows. These bounded reads omit prompts, run inputs, claim tokens and schedule input templates. Active run rows still show wait reasons such as holds, agent assignments and external input.

Run pages show at most 100 rows. Schedule alert pages show 20 items and refresh their current offset after engine events; a vanished last page clamps to the last available page. Workflow scope changes reset schedule paging. Run tab/filter and run page persist in the URL, and run inspection retains that return destination. Schedule links open inspection using the stable trigger ID. Counts include all matching run and schedule items, independently of which page is visible.

The run summary identifies the action that needs attention. **Review request** or **Review recovery** selects that assignment and focuses its details. Multiple assignments use a bounded menu. Attention in an owned child belongs to the parent run; detached runs retain their own attention state.

The selected step appears beside the graph on wide screens and before the graph on narrow screens. On narrow screens, selecting a graph node or timeline row moves focus to the details. Assignment actions precede the prompt and context disclosure. A manual result remains in the inspector while its claim is active, including when another step is selected.

Narrow run inspection scrolls as one page so a long handoff or action header does not leave the graph and details in a small trapped pane. Wide inspection retains separate overview and detail scrolling. Shared headers keep room for their title and wrap actions when needed; icon-only Back actions use the standard 40px action control.

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

Use this lifecycle for persistent resource editors, including creation dialogs. These are implementation requirements; verify each editor rather than assuming that shared styling provides the behavior. Temporary filter popovers retain their documented dismiss-to-discard behavior.

| State                 | Required behavior                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean                 | Allow dismissal without a discard confirmation.                                                                                                                                                                             |
| Dirty                 | Protect edits on Escape, Close, Cancel, route or tab changes that unmount the editor, and browser Back. Register with the workspace leave guard and browser-unload warning. Explicit discard clears the draft deliberately. |
| Saving                | Prevent repeated submission and in-app dismissal while the write is unresolved. Warn on browser unload. Preserve any edits accepted during the pending save. Completion must not redirect a user who has left the editor.   |
| Rejected              | Retain input and show the error beside the action. Allow correction and resubmission.                                                                                                                                       |
| Revision conflict     | Retain local edits and offer an explicit load-latest action. Confirm before replacing dirty input; keep the server's revision check.                                                                                        |
| Acknowledged          | Retain the saved outcome even if the subsequent refresh fails. Retry the read without repeating the write.                                                                                                                  |
| Unknown write outcome | Preserve input and report uncertainty. Reconcile saved state before offering a retry that could duplicate the operation.                                                                                                    |

Share lifecycle behavior across editors while keeping validation and persistence specific to the resource. **Apply changes** stages changes into a parent draft; **Save** persists them. Preserve that distinction in labels and dirty state. A child editor's Apply must not imply that the parent draft was saved.

Workflow **Save draft** and **Publish version** block navigation while a write is pending. Draft text remains editable where the editor allows it, including in Raw. Draft persistence and publication keep their separate validation steps.

If Interlock cannot confirm publication, **Check published version** reads the current workflow before another publication. An observed newer version leaves any local draft edits intact.

Dialogs restore focus on dismissal when the trigger remains available. Global notifications sit below dialogs. A failed workspace refresh marks cached data as possibly out of date and offers a retry.

## Modal layout

Use the shared `Modal`, `ModalBody`, and `ModalFooter` from the design-system barrel. Node settings are the reference for the title and close button, scrollable content, and separated action bar.

- Size the dialog for its content. Let confirmations and simple forms fit their contents. Give sectioned editors enough height to keep navigation and actions steady as users switch sections.
- Use a single-column body by default. Use a flush body for a sidebar or other editor layout that manages its own scrollable content. Put section navigation above the content on phones.
- Put the dismissal action and primary action at the end of the footer, in that order. Use the footer's optional aside for a secondary destructive action or a short consequence that matters before committing. Use the danger variant when deletion or discard is the decision itself.
- When an action is blocked, give the user the available next step. For example, a parent workflow with children offers **View child workflows**.
- Keep field validation beside its field. Keep submission feedback inside the dialog. While a write prevents dismissal, disable the close button, Escape, and the footer dismissal action together.
- Keep keyboard focus inside the dialog and return it to the opening control on dismissal when that control remains available. When a contract editor opens as a page within settings, put Back beside the title. Back and Escape return to settings and restore focus to the contract's edit button.

## Loading views

Gate each page on its required data. A failed sidebar counter must not block an otherwise usable editor or appear as a confirmed zero. The Runs badge shows the combined request and automation attention count. A question mark means the total is unavailable. A tilde marks a total that includes stale data after a failed refresh. **Retry attention count** refreshes only the failed sources. The workflow editor keeps its draft available while the saved prompt picker waits for the prompt catalog. Keep background refreshes from replacing unsaved input. When changing refresh logic, test an event arriving during a pending read so the final view includes that change.

Use static skeletons shaped like the content being loaded. Keep the loading announcement available to assistive technology and hide the decorative placeholders from it. Preserve the action label when a write is in progress.

Single-workflow loading keeps the shared title-row and attached-tab geometry, with a centered spinner in the remaining canvas area. Omit fake graph nodes and canvas-toolbar placeholders. Initial data loading and the lazy editor use the same loading view, with one accessible loading announcement and no interactive placeholder controls.

The Automations and Runs views keep their shared headers in place during route and initial data loading. Status-tab placeholders appear for Automations and Runs List; Runs Overview omits status tabs. Header placeholders mirror the loaded control and action groups, including History actions, at standard 40px heights so responsive wrapping stays consistent. Runs lazy-route loading uses row placeholders to match the default List view. Selecting Overview uses a column-shaped placeholder while its data loads. Needs attention and History use matching row placeholders. Tag-filtered Overview empty states explain their scope and offer the existing Clear filters action. Background refreshes and return navigation retain cached content for the exact same query. Show a skeleton only when that query has no successful cached data. Keep refresh errors visible beside retained data. Cache keys include resource IDs, workflow scope, filters, and pagination; never substitute another query's rows. Changing Automations filters or pages shows a loading state until that query succeeds; a failed read does not display another query's rows. Errors show retry feedback instead of an indefinite skeleton.

Workflow pause controls use a direct **Pause workflow** and **Resume workflow** toggle, with shared pending state and a fresh status check before writing. Each acknowledged change stays visible while status refresh is pending or unavailable. **Retry pause status** repeats only the read. Library holds remain visible blockers with CLI/MCP recovery guidance.

## Review before shipping

Compare changed interactions with matching screens, including their action placement, labels, and recovery behavior. Record which screens were checked and explain intentional differences in the PR. For editor changes, exercise the applicable states in [Saving and connection feedback](#saving-and-connection-feedback), including navigation during a pending write and a conflicting edit from another client.

For a changed interaction, inspect the rendered path at desktop, intermediate, and phone widths. Check keyboard navigation, visible focus, long content, and meaningful status announcements. Exercise loading, pending submission, success, rejection, failure, and recovery where they apply. Use temporary workflow data and simulated adapters for repeatable UI checks. Keep native harness validation separate and identify which harnesses were actually exercised.

Keep tests focused on consequences: request identity, retained answers, explicit confirmation, repeated clicks, and refresh failures after a recorded action. Screenshots and mechanical checks supplement interaction checks; neither establishes usability alone.

## References

- [n8n human review](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools/) provides the tool and proposed parameters for a human decision.
- [Visibility of system status](https://www.nngroup.com/articles/visibility-system-status/) explains feedback during actions and state changes.
- [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) explains prioritizing frequent decisions while retaining access to advanced details.
