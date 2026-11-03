# UI interaction patterns

Interlock uses the Mantine theme in `packages/ui/src/theme/theme.ts` and the shared CSS variables in `packages/ui/src/styles.css`. Node settings provide the reference for section navigation, spacing, and form hierarchy. These patterns extend that visual system.

## Runs that need a person

The Runs navigation badge counts runs with pending managed approvals, questions, or recovery confirmation. It clears as decisions resolve. Normal queued assignments, capacity waits, and generic holds do not contribute. The **Needs attention** tab includes cancelled runs that still need recovery. Each row explains the reason and opens the corresponding assignment. Owned descendants count under their nearest top-level or detached run. Detached runs count independently. The filter persists in the URL and survives the return from an assignment.

The shared `runs.attention` API returns only run IDs, reason categories, and the target execution IDs. Indexed reads avoid completed assignment history and omit prompts, input data, request details, and claim tokens. The existing UI refresh and event stream update the count. This query adds no MCP tool or discovery text.

The run summary identifies the action that needs attention. **Review request** or **Review recovery** selects that assignment and focuses its details. Multiple assignments use a bounded menu. Attention in an owned child belongs to the parent run; detached runs retain their own attention state.

The selected step appears beside the graph on wide screens and before the graph on narrow screens. Its assignment comes before input data, usage, and diagnostics. Managed assignments keep prompt/context and step data collapsed initially. Connected-agent assignments retain their prompt and manual completion controls.

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

## Review before shipping

For a changed interaction, inspect the rendered path at desktop, intermediate, and phone widths. Check keyboard navigation, visible focus, long content, and meaningful status announcements. Exercise loading, pending submission, success, rejection, failure, and recovery where they apply. Use temporary workflow data and simulated adapters for repeatable UI checks. Keep native harness validation separate and identify which harnesses were actually exercised.

Keep tests focused on consequences: request identity, retained answers, explicit confirmation, repeated clicks, and refresh failures after a recorded action. Screenshots and mechanical checks supplement interaction checks; neither establishes usability alone.

## References

- [n8n human review](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools/) provides the tool and proposed parameters for a human decision.
- [Visibility of system status](https://www.nngroup.com/articles/visibility-system-status/) explains feedback during actions and state changes.
- [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) explains prioritizing frequent decisions while retaining access to advanced details.
