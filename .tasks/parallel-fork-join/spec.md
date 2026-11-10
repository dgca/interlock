# Structured parallel sections

This specification defines behavior within the [accepted intent](intent.md). The user approved this specification with "Approved" on November 10, 2026, at SDLC run `382951dd-a69a-4dd6-832f-98db49f9d755`'s specification decision. That approval includes D1's group UI, D2's flat first-release composition, and D9's explicit simulation rejection.

## Decisions

### D1. One Parallel group with a built-in join

Use one compound Parallel node, with an input boundary, named branch paths, a Join boundary, and one output continuation. A branch name is also its result key. The graph stores explicit membership; canvas position never determines execution.

The alternative is separate Fork and Join nodes with graph-wide matching. The group makes ownership and the waiting boundary visible and prevents overlapping joins by construction. The underlying branch steps remain ordinary editable nodes. This specializes the accepted structured-section recommendation into an editor and definition contract; it does not enable duplicate success edges on ordinary nodes.

### D2. Flat sections in the first release

Parallel groups are supported at main workflow scope only. Their branches support Agent, Script, Fetch, Wait, External input, Branch, and Workflow steps. Legacy Condition/Switch nodes remain valid within branches. Workflow calls retain both waited and detached behavior; a detached call contributes its existing run-reference result, not eventual completion.

Defer Parallel inside Batch, Batch inside Parallel, and nested Parallel groups. Publication explains unsupported composition. A waited Workflow node can encapsulate a procedure that contains Batch or invokes other workflows. This preserves a useful composition path without requiring every grouped editor and binding rule to support two kinds of nested group in the initial release.

The user approved this first-release limit on November 10, 2026. Supporting inline nested groups immediately was the broader alternative.

### D3. Fixed branch set and bounded dispatch

A published group declares 2 through 50 branches in author-defined order, with distinct nonblank result keys of 1 through 64 characters and separate stable identities. The editor starts with two branches. Result keys may be renamed without changing branch identity; old published definitions and runs keep their captured keys. Literal keys are data and must remain distinct, including object-property names such as `__proto__`.

Concurrency is an integer from 1 through 50, default 5, capped in practice by the branch count and executor capacity. Concurrency 1 remains useful for constrained execution and does not change collection semantics. Undispatched branches are queued within the group and consume no external work claim. Each admitted branch occupies a slot until its local path settles; detached descendants keep their existing independent lifetime and do not extend that slot.

These proposed bounds reuse Batch's concurrency bound. They are technical defaults, not throughput promises.

### D4. All-results success and fail-fast failure

Every declared branch must succeed before the group emits an object keyed by captured result names. Each value is that branch's terminal forwarded output, including JSON null. Completion order cannot change result association. The group output contract validates the complete object. No partial object is forwarded on failure, cancellation, or contract rejection.

An unhandled branch failure or cancellation fails the group, stops dispatching new branches, and cancels unfinished waited branch trees through existing cancellation rules. Existing handled Script, Fetch, and waited Workflow failures may recover within their branch and return successfully. An unmatched Branch without a fallback is a branch failure, not a skipped expected arrival.

Failure routing, partial-success collection, quorum joins, and choosing winners are deferred for the Parallel group itself. Cancellation is distinct from a success or failure route. Stopping a claim does not establish that its external process stopped.

### D5. Invocation and data isolation

One entry into a group creates one durable invocation. Each branch receives the same captured resolved group input, validates its own step inputs and outputs, and has its own work identity and execution history. Input/result mutation by one branch cannot alter another branch's input.

Within a branch, `incoming` means the preceding branch step's forwarded output. `runInput` and `rootInput` keep their existing workflow/root meaning. There is no implicit Batch item input in a Parallel branch. A branch reads `node` and `execution` bindings only from completed executions in that same branch invocation. Cross-branch and parent-to-branch node bindings are publication blockers. Authors pass upstream values explicitly through the group's input fields; the parent reads the collected group output after Join.

Session continuity groups are branch-run local, matching existing isolation between Batch items. Parent work before and after the group retains its own continuity. A fresh reviewer remains fresh. Workflow invocations retain their independent capture and session scopes; branch runs inherit the owning run's prompt, variable, and model-alias captures.

### D6. Graph and loop boundaries

Every branch has exactly one start route. Its reachable paths remain inside that branch and return to that group's Join boundary. A conditional split can have several terminal return edges because only its selected route executes. Join waits for one successful return per branch identity, not for every incoming edge.

Publication rejects missing starts or returns, orphan members, crossed branches, foreign group returns, cycles inside a branch, Entry/Exit members, duplicate keys, and unsupported group composition. Ordinary node ports still select exactly one next step.

An outer workflow loop may re-enter the group after its previous invocation has fully settled. The new invocation captures fresh input and creates fresh branch histories. Earlier outputs, late submissions, cancelled attempts, and prior execution provenance cannot satisfy its Join. Existing live-version policy cannot rewrite an in-flight branch set, captured keys, or routes. An incompatible group change blocks an upgrade until a safe boundary, with the existing inspection guidance.

### D7. Steps, admission, and budgets

The owning workflow run's `maxSteps` includes its ordinary node executions, the Parallel invocation once, and every branch-local node execution created by all its Parallel invocations. Join is a boundary of the same group execution and does not spend a separate step. Creating a branch container does not spend a step. The runtime checks the shared remaining allowance atomically before starting each node.

Completed branch steps remain spent after failure or retry. A resumed failed or cancelled branch spends the allowance required by any new node executions; successful siblings are not rerun. Claim retries and waiting within one existing execution keep their current accounting. Invoked Workflow runs retain independent step limits. This increment does not change Batch item budgets elsewhere in a workflow or within an invoked workflow.

Branch containers share parent workflow admission and do not consume additional `maxActiveRuns` slots, avoiding a parent waiting on descendants it cannot admit. Invoked workflows retain their existing admission rules. Branch dispatch respects the shared child depth bound, pauses, resource ownership, and existing managed global/profile limits.

Reported usage, claim budgets, ancestry, tags, captures, and lifecycle cancellation include branches through the same ordinary-descendant rules as Batch. Existing `run`, `lifecycle`, and `tree` budget meanings remain unchanged. A user who wants an aggregate Agent budget chooses lifecycle or tree scope. Scope must be documented without implying that a run-only budget covers separate branch runs.

### D8. Recovery and inspection

Restart resumes the same retained invocation and branch identities without duplicating successful work. Existing Script recovery and uncertain-ownership gates apply before replay or reuse. Root cancellation traverses unfinished ordinary branch descendants and invalidates their pending claims; detached work retains its current independence.

Explicit retry of a failed group retains successful branch results and resumes failed or cancelled branches within concurrency and remaining step allowance. It starts undispatched branches when slots permit. Contract-only group output failure rechecks retained successful results without redoing branch work. A terminal parent must not be silently reopened by a late branch result or an independent retry. Group recovery is the coordinating path for a failed section.

Routine run summaries and MCP mutations remain bounded. A group exposes its invocation identity, branch counts by state, queued count, and branch references. On-demand detail exposes branch name, result key, run ID, status, and available result/error references. Node inspection keeps branch histories separate across outer loop visits. Existing waits, attention, actor, claims, usage, cancellation, and child-run navigation remain truthful for multiple active branches.

### D9. Simulation and compatibility

Fixture simulation rejects any published definition containing Parallel before running operations or consuming fixtures. The diagnostic names the unsupported node and directs callers to ordinary deterministic runs or live comparisons. Branch-aware fixture simulation is deferred, as Batch simulation currently is. Simulation continues to report truthful route coverage for supported definitions.

Existing definitions, Batch graphs, published versions, imports, exports, and defaults retain their behavior. Old run records need no destructive migration. Visual/Raw editing, atomic edits, layout, publication review, import/export, and MCP discovery describe the same new group contract. No additional standalone MCP tool is required merely to author or execute Parallel.

## UI proposal

The audience and visual authority are the existing workflow editor and run inspector. Preserve their Mantine controls, theme, contract editors, node selection, and contained settings forms. This is an operating interface, with no separate design system or new page.

1. **Create and configure.** Add Parallel through the existing **Add node** action. Its settings contain the label, ordered branch list, concurrency, input fields/contract, and joined output contract. Each branch row has an editable result key and actions to add or remove it. Use the existing safe removal behavior so referenced steps and routes cannot disappear without clear consequences. Validate duplicate and blank keys next to the field.
2. **Edit paths.** The expanded group displays each named start and its member steps, with clear return connections to Join and one Out continuation. Use existing graph grouping, add-step controls, collapse/expand, pan/zoom, connection selection, undo/redo, and tidy behavior. The branch label and return boundary explain structure; do not add repeated descriptive subtitles. A collapsed group shows its label and branch count.
3. **Save and publish.** Incomplete groups can be saved. Existing validation shows precise branch/node diagnostics and blocks publication when starts, returns, membership, or limits are invalid. Raw and visual views preserve the same definition. Unknown inferred contracts stay unknown; runtime validation remains authoritative.
4. **Inspect and recover.** During execution, the group shows completed/total branches and queued/active counts. Its detail lists named branches with explicit status text and opens existing child-run inspection. Failed states expose the failed branch and the existing Retry/Cancel actions. Joined output uses existing JSON inspection and contract display. No result shape is inferred from whichever branch finishes first.
5. **Interaction states.** Newly created, partly connected, saved, published, queued, active, human-waiting, paused, failed, cancelled, and completed states use current application feedback. Loading retains the current inspector shell. Read failures retain usable prior data with the existing error action. Empty branch output is shown as JSON null or its actual JSON value, never as a missing result. Unsupported nesting errors name the affected group.
6. **Keyboard and narrow screens.** Branch fields and actions follow normal Tab order with visible focus, labelled icon actions, inline errors, and focus restoration after dialogs close. Add/remove focuses the new row or the nearest remaining action. Graph controls retain their current keyboard behavior. Settings use the existing responsive modal and scrollable body/footer. On narrow screens, branch rows stack their controls, long names wrap or truncate with accessible full labels, and the canvas remains pannable without covering the existing controls.

## Acceptance criteria

- **AC1.** A saved and published workflow expresses two named Agent branches with different models, and ordinary nodes retain one route per selected port.
- **AC2.** Both branches become eligible without waiting for the other's result when concurrency and executor gates permit. Concurrency 1 and saturated capacity remain bounded and inspectable.
- **AC3.** Different inputs across group invocations, out-of-order completion, heterogeneous branch outputs, null values, and literal special keys produce the correctly associated contract-checked joined object exactly once.
- **AC4.** Publication rejects the invalid graph and naming cases in D3/D6, while incomplete draft saves remain available. The supported composition matches the human decision on D2.
- **AC5.** Conditional paths return once per started branch without waiting on untaken edges. Internal cycles reject, while two outer loop visits retain separate identities, inputs, outputs, and provenance.
- **AC6.** Bindings and continuity follow D5; sibling/parent branch-history reads reject, captured input cannot be mutated across branches, and Workflow calls retain existing scopes.
- **AC7.** The shared maxSteps allowance includes branch work across visits and explicit retries, survives restart, and does not duplicate or refund spent steps. Existing Batch and invoked Workflow limits remain unchanged.
- **AC8.** A branch failure stops new dispatch and cancels unfinished waited siblings. Pause, resource, admission, budget, managed capacity, and detached boundaries preserve their documented rules.
- **AC9.** Restart, late submission, explicit group retry, cancelled branches, and joined output-contract failure cannot duplicate successful work, bypass uncertain ownership, or reopen an unrelated invocation.
- **AC10.** The visual editor can create, configure, connect, save, reload, tidy, undo/redo, collapse, inspect, and remove the proposed group consistently with Raw and atomic edits.
- **AC11.** Run inspection distinguishes active, queued, waiting, completed, failed, and cancelled branches, opens the correct branch history, and offers applicable existing recovery actions.
- **AC12.** A representative actual UI journey verifies group editing and run inspection, keyboard/focus behavior, invalid keys or connections, long names, and narrow layout against the UI proposal.
- **AC13.** MCP HTTP and stdio discover equivalent authoring/validation and bounded execution/inspection contracts. Existing CLI/shared callers can author, publish, run, inspect, cancel, and retry the group without a second execution implementation.
- **AC14.** Simulation rejects Parallel before consuming fixtures or performing operations; supported simulation behavior and route coverage stay unchanged.
- **AC15.** Existing ordinary, Batch, Workflow, legacy Bash, and immutable publication behavior passes relevant regression checks; imports/exports retain group identity and stable result keys.
- **AC16.** README, domain terms, architecture, workflow/data/limit/simulation docs, demo, CLI help, MCP instructions and affected tools match the final implementation; a pending patch changeset describes user-visible behavior.

## Risks and alternatives

The main risks are incorrect scope boundaries, stale results joining a later loop visit, non-atomic shared step accounting, retries that repeat external effects, and summaries that hide a blocked branch. They need direct verification in the plan. Parallel execution does not reduce token spend and requires executor capacity to reduce elapsed time.

The existing Batch-plus-Branch workaround remains valid. Separate unrestricted Fork/Join nodes and a general graph scheduler are broader alternatives to D1. Inline nested groups are the scope alternative in D2. Neither alternative is required to prove the two-reviewer outcome.

## Human review

Approved by the user with "Approved" on November 10, 2026. Preserve these decisions during implementation and review; ask again only for new consequential changes.
