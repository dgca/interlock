# Reusable prompts specification

This document owns observable behavior and acceptance criteria for the outcome in [intent.md](intent.md). Implementation and verification belong in [plan.md](plan.md).

## Prompt library

The Prompts sidebar item opens a searchable library. Authors can create a prompt, open it, edit its name, optional description, and plain Markdown instructions, and save or discard changes. A saved prompt has a stable ID and revision. Names are nonempty after trimming and follow the existing 120-character workflow-name bound. Instructions must contain non-whitespace text. Names need not be unique; references use IDs.

Each effective edit advances the revision and retains its previous content internally. Saving unchanged content does not create a revision. A stale editor cannot overwrite a newer save; it reports the conflict and preserves the author's unsaved text. Unsaved edits receive the existing navigation protection. Prompt pages have bookmarkable URLs.

The edit page lists workflows that reference the prompt, distinguishing draft and published use. History restoration UI is outside this first version; preserved revisions and captured run instructions remain available for later support.

## Agent authoring and composition

Agent nodes optionally reference an ordered list of saved prompt IDs. Omission preserves existing behavior. An ID appears at most once per node. The Agent form has a searchable Saved prompts picker above Task instructions, controls to remove and reorder selected prompts, and a way to inspect their content in the form.

Execution includes saved prompts in their selected order, followed by the node's task instructions. Each saved prompt is identified by name and separated from the task text. With no saved prompts, the existing assignment prompt remains unchanged. Context instructions, mode, required tools and skills, input, and output contracts retain their existing meanings. Instructions cannot grant capabilities or change contracts. The UI guidance says that runs use the latest saved prompts and describes capture at startup.

Composition does not attempt to infer or resolve contradictions in arbitrary prose. Authors can inspect the assembled instructions and correct conflicts. Contracts and execution policy remain enforced by existing behavior.

## Updates and run capture

Published definitions store prompt references. Prompt edits do not change the published definition or require republishing. A newly started execution resolves the latest saved content, including edits made after workflow publication. It captures prompt ID, name, description, revision, and instruction content durably. Edits and renames after that capture do not affect the execution. Loops, assignments discovered later, lease reclaim, explicit retries, and server restart retain the captured instructions.

Batch item runs inherit their enclosing workflow's capture, including items dispatched after a library edit. An old stored run without capture continues to use its existing published definition and existing assignment instructions. Existing released definitions have no saved-prompt references.

### S1: Capture across Workflow nodes

Each separately invoked workflow captures the latest prompts when its own run starts, including detached runs. Batch items inherit their enclosing workflow's capture. Parent and child workflows may therefore use different revisions of the same saved prompt if it changes between their start times. Retries of an existing child retain that child's original capture; a newly dispatched child captures current content.

Source: the user's response at the SDLC spec decision, "it'd be fine for v1 to have both workflows use the latest instructions they had at the time of their run" and "it'd be fine if they use different instructions."

Capturing the entire invocation tree at the parent's startup was considered. The user chose independent capture for v1 and deferred broader consistency controls until there is a demonstrated need.

## Inspection and lifecycle

Run inspection identifies the captured prompt revisions and shows their actual instructions together with the node task instructions. The full work assignment delivered through MCP contains the same assembled instructions as inspection. A fresh-session handoff uses the captured assignment. Compact discovery and run briefings continue to omit large instruction bodies.

Prompt deletion requires confirmation. Deletion is blocked when any draft or published workflow version references the prompt; the error identifies the dependent workflows. Authors can delete unused prompts. Captured historical runs remain inspectable after an unused prompt is deleted. Archive and bulk reference replacement are outside this first version.

Drafts with missing prompt references can be saved, with actionable publication diagnostics. Missing references block publication and new run startup rather than silently dropping instructions. Raw JSON and stable-ID edits preserve references. A missing prompt has a visible identity in the editor instead of disappearing from the selection. The delete guard normally prevents published missing references; startup validation also covers malformed or legacy imported data.

## Portability and caller behavior

Workflow export includes all prompts referenced by exported drafts and published versions, including workflow dependencies and owned children. It includes their current content, since published workflows use the latest guidance. Bundles are definitions and library dependencies, not archives of run capture history.

Import into an empty library preserves prompt IDs and shared references. Importing an identical prompt is idempotent. When an existing prompt ID has different current content, import rejects the bundle with an explicit prompt conflict and writes nothing. The workflow draft force option does not silently overwrite shared prompts. Authors can resolve a conflict by deliberately editing their library prompt before re-importing. No automatic name matching or renaming occurs. Existing bundles without prompts remain importable.

Prompt management and references use the shared server interface for UI and agent callers. MCP provides discovery, inspection, creation, revision-protected editing, and guarded deletion. Workflow authoring schemas, validation, export/import, execution discovery and claims, and fresh-context guidance describe prompt references and capture consistently. Existing CLI workflow authoring, export/import, and run inspection preserve the new data; a separate prompt CLI command group is outside this first version.

## Acceptance criteria

- AC1: Authors can reach Prompts through the sidebar and create, search, open, edit, save, discard, and reopen named Markdown prompts. Saved data survives restart. Stale saves and navigation preserve unsaved author text appropriately.
- AC2: An Agent node can select zero, one, or multiple distinct prompts, reorder and remove them, and inspect their content. Saving and reopening in visual or raw editing preserves selected IDs and order.
- AC3: Editing or renaming a referenced prompt affects a new run of an already published workflow without changing its published definition or requiring publication.
- AC4: A captured run retains the same prompt content and revision through later Agent steps, Batch dispatch, loops, reclaim, explicit retries, and restart. Invoked Workflow runs independently capture current content as specified in S1.
- AC5: Run inspection, full assignments, and fresh-session handoffs expose the instructions actually used. Compact discovery and briefings omit instruction bodies and preserve their existing bounds.
- AC6: Deletion of referenced prompts reports dependents without damaging references or captured runs. Deletion of unused prompts succeeds. Missing references remain saveable in drafts and block publication and new runs with an actionable error.
- AC7: Export and import preserve shared prompt references and current content across workflow dependencies and owned children. Identical imports are idempotent, prompt conflicts roll back all writes, and existing prompt-free bundles remain importable.
- AC8: Shared-server and MCP prompt management support revision protection and lifecycle errors. Affected workflow authoring, validation, transfer, discovery, claim, and context-handoff guidance agrees across HTTP and stdio.
- AC9: Existing workflows and runs without prompt references retain their behavior and existing assignment prompt text. Current and fresh context, contracts, publication immutability, and script-language compatibility remain intact.

## Decision sources and assumptions

Library and Agent behavior trace to [intent decisions D1, D2, D5, and D6](intent.md#settled-decisions). Central updates and capture trace to D3 and D4. Portability and caller coverage implement the feature's authorized scope and repository requirements.

Revision-protected saves, stable IDs, navigation protection, and guarded deletion follow existing workflow conventions. No archive, revision-restoration UI, prompt-specific CLI commands, or optional pinning is added. S1 records the human resolution of Q1. No blocking product decisions remain.

## Risks and alternatives

Central editing intentionally changes future executions of published workflows. Usage lists and startup-capture guidance make that impact visible. Prompt conflicts can still change agent behavior. Capture storage grows with the instructions required by each execution. Import rejects divergent shared content to avoid changing unrelated workflows as a side effect.

Pinning at publication was considered and rejected by the user's central-update decision. Resolving prompts at each Agent step was rejected in favor of consistent captured instructions. Attaching skills or granting tools remains outside this feature.
