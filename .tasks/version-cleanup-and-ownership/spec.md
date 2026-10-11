# Explicit published-version cleanup

This specification defines version cleanup within the scope and authorization recorded in [intent.md](intent.md). Ownership mutation follows separately.

## Preview and explicit deletion

**AC1.** The shared server API and MCP expose a read-only cleanup preview for an explicit set of workflow ID and published version pairs. Validate nonempty selections, positive integer version numbers, existing workflows and versions, and reject duplicate selections. Return selected identities and names, exact blockers, affected historical run IDs and statuses, and the consequences for inspection and retry. No preview changes stored data.

**AC2.** A separate deletion operation requires the exact selected set, acknowledgment of history loss, and confirmation tied to the previewed impact. Recompute the impact inside the deletion transaction. Reject an outdated preview, missing acknowledgment, or any blocker without changing state. A successful response identifies what was deleted. Remove only selected definitions, atomically. Do not rewrite retained definitions, automatically expand the selection, or delete run, work, event, prompt, or workflow records.

The MCP descriptions require the executing agent to show the preview and obtain the person's explicit agreement before deletion. A token establishes which impact was reviewed; it cannot prove that a person approved it.

## Dependencies and active execution

**AC3.** The latest published version of each workflow is protected, including archived workflows. A draft that pins a selected version blocks deletion. A retained published version that pins a selected version also blocks deletion. Name the caller, draft or version, node, and target version. A historical caller may be removed only if that exact caller version is also explicitly selected. If a draft or latest caller still pins an old child, change and publish that caller before cleanup. A null draft version follows latest and does not pin an obsolete version.

**AC4.** Running and waiting runs block deletion of their own definitions and any transitively referenced definition they may still invoke. Inspect nested Workflow nodes throughout the published graph, including nodes inside Batch and detached invocations that have not started. Detect cycles without infinite traversal. This protection conservatively covers all published call paths, including branches that might not execute. Existing active detached runs protect their own dependencies independently of their parent's terminal status.

**AC5.** Failures during deletion roll back the complete deletion set and any records needed to preserve version identity. Dependency checks, active-run checks, and impact confirmation precede mutation. Newly created runs or changed drafts invalidate unsafe previews. The existing transaction boundary prevents a run start or publication from interleaving with the committed deletion.

## Version identity and transfer

**AC6.** Version lists contain only retained versions in numeric order. Publishing increments the existing latest version number. Cleanup cannot delete that latest version or decrement the counter. Deleting v1 and v2 from a workflow published through v3 leaves v3; its next publication is v4.

**AC7.** Export and import support gaps while preserving published version identities and dependency validation. Existing bundles with consecutive versions remain supported. Duplicate or unordered version records fail clearly. An import cannot install a different definition under the number of a deliberately deleted version. Ordinary imports leave deliberately deleted versions deleted and report skipped versions. An explicit restore option accepts only original definitions, preserves their version numbers, and validates ownership and dependencies. Forced import continues to reject published-definition and ownership conflicts. Export preserves deletion identity information so transfer to another library also preserves these restrictions.

## Historical records and retries

**AC8.** Run lists, full inspection, continuation briefings, results, and descendant history remain readable after cleanup. Missing definitions are explicit. Retain original run inputs, values, outputs, executions, saved prompt captures, events, and parent links. Full inspection returns a missing definition marker with a null definition when unavailable. Existing retained-definition responses keep their existing content and behavior.

**AC9.** Starting a deleted version fails clearly without creating a run. Retrying a failed run whose required definition is deleted fails before mutating run or work state, including a nested retry queued through its parent. Do not substitute latest or the current draft for the deleted definition. Explain that cleanup removed the required version and that retry is unavailable.

**AC10.** Existing UI history remains usable when a definition was deliberately removed. Show a concise explanation that graph inspection and retry are unavailable. Continue to show stored results, execution details, events, and child links. Retained-definition runs keep their graph and actions. No new cleanup UI controls are in scope.

### History UI proposal

Keep the existing run title, navigation, and result panels. Replace the graph panel with the missing-version explanation. Execution selection uses recorded node labels when graph node metadata is absent. Hide or disable retry with the reason beside the action. Keep child navigation usable. The explanation has no focusable control; existing keyboard and panel behavior remains. On narrow screens, the explanation, timeline, and recorded details stack vertically within the existing inspector. Loading and error states follow existing run inspection behavior.

## Guidance and compatibility

**AC11.** Workflow deletion diagnostics explain that explicit old-version cleanup can remove historical reference blockers, while retaining existing restrictions for drafts, owned children, and runs belonging to other workflows. Owned children use the same cleanup rules. Cleanup does not itself delete a workflow or change ownership.

**AC12.** Documentation and affected MCP flows describe preview, human acknowledgment, stale-impact rejection, protected dependencies, version gaps, missing history definitions, retry failure, and the final backup policy. Check creation, publication, version listing, run start, inspection, briefings/results, retry, deletion, and transfer against the shared API. HTTP and stdio discovery expose consistent contracts. Include a pending patch changeset for `@type_of/interlock`.

## Alternatives and risks

Retirement would introduce a second version lifecycle and rules for when older callers remain executable. The accepted request chooses explicit deletion. Silent deletion of historical caller versions would erase more history than the person selected, so cleanup instead reports each blocker.

Checking only currently dispatched children misses a queued Batch item or a later nested call. Protecting all transitive published references is deliberately conservative. A user can wait for active execution to finish before cleanup.

The main compatibility risk is an inspection consumer that assumes every run has a definition. Import must not silently restore obsolete callers and reintroduce blockers. The backup policy below applies consistently in storage, export/import, and MCP guidance.

## Settled backup policy

The user chose the recommended policy with "Let's go with your recommendation" at the workflow's spec review gate. Ordinary imports leave deliberately deleted versions deleted. Explicit restoration accepts only original definitions and validates ownership and dependencies. Version identity information survives deletion and transfer. This permits recovery while preventing a routine import from silently undoing cleanup. Permanent deletion within the workflow identity was considered and rejected.

There are no unresolved specification decisions.
