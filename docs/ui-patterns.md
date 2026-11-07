# UI interaction patterns

Variables extends the central library/editor pattern. Management reads are safe
metadata; Secret values have **Set value** and **Replace value**, never reveal.
Entered Secret text is cleared on acknowledged writes before refreshing views.
Rejected writes retain edits. Node controls use explicit metadata pickers; import
preview requires deliberate local binding or provisioning. Mobile navigation keeps
all five workspace destinations and engine connection status visible. **Connect with MCP** is available when enabled.

Interlock uses the Mantine theme in `packages/ui/src/theme/theme.ts` and the shared CSS variables in `packages/ui/src/styles.css`. Node settings provide the reference for section navigation, spacing, and form hierarchy. These patterns extend that visual system.

## Runs that need a person

The Runs navigation badge counts runs with pending managed approvals, questions, model selection, or recovery confirmation. It clears as decisions resolve. Normal queued assignments, capacity waits, and generic holds do not contribute. The **Needs attention** tab includes cancelled runs that still need recovery. Each row explains the reason and opens the corresponding assignment. Owned descendants count under their nearest top-level or detached run. Detached runs count independently. The filter persists in the URL and survives the return from an assignment.

The shared `runs.attention` API returns only run IDs, reason categories, and the target execution IDs. Indexed reads avoid completed assignment history and omit prompts, input data, request details, and claim tokens. The UI uses this query for the navigation badge and includes the same markers in each page of run summaries. Active rows also show available wait reasons, such as an external hold, agent assignment, or external input.

Active, Needs attention, and History each show up to 100 runs per page. The tab counts include all matching runs. The run details link carries the list page so you can return to it from inspection. Pages reflect the latest run order, so rows can move between pages as runs finish or history is removed.

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

Workflow, prompt, variable, and Harnesses edits use the workspace leave guard. Inline form errors preserve input and stay beside the action. Dialogs restore focus on dismissal when the trigger remains available. Global notifications sit below dialogs. A failed workspace refresh marks cached data as possibly out of date and offers a retry.

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

## Review before shipping

For a changed interaction, inspect the rendered path at desktop, intermediate, and phone widths. Check keyboard navigation, visible focus, long content, and meaningful status announcements. Exercise loading, pending submission, success, rejection, failure, and recovery where they apply. Use temporary workflow data and simulated adapters for repeatable UI checks. Keep native harness validation separate and identify which harnesses were actually exercised.

Keep tests focused on consequences: request identity, retained answers, explicit confirmation, repeated clicks, and refresh failures after a recorded action. Screenshots and mechanical checks supplement interaction checks; neither establishes usability alone.

## References

- [n8n human review](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools/) provides the tool and proposed parameters for a human decision.
- [Visibility of system status](https://www.nngroup.com/articles/visibility-system-status/) explains feedback during actions and state changes.
- [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) explains prioritizing frequent decisions while retaining access to advanced details.
