# Clean up obsolete published versions

Old published callers can prevent workflow deletion or ownership changes after current callers stop using a workflow. Explicit version cleanup removes selected obsolete definitions. It preserves workflow identities and run records.

## Preview before deletion

1. Save a backup with MCP `export_workflow` or `interlock export WORKFLOW_ID`. Include every workflow whose versions you plan to delete.
2. Use `list_workflow_versions` to discover retained version numbers. Do not infer them from `latestVersion`; cleanup can leave gaps.
3. Call `preview_version_deletion` with an explicit `versions` array. Each entry contains `workflowId` and `version`.
4. Review `blockers`, `affectedRuns`, and `consequences` with the person. The preview changes no data.
5. After the person explicitly accepts the impact, call `delete_workflow_versions` with the same selection, the preview's `confirmation`, and `acknowledgeHistoryLoss:true`.

The shared API exposes `workflows.previewVersionDeletion` and `workflows.deleteVersions` with those same inputs. Selections contain 1 through 1000 unique pairs. Deletion checks the current impact in one transaction. If the confirmation is stale, preview again and obtain agreement to the updated impact. A blocker or write failure leaves the entire selection unchanged. The confirmation identifies reviewed impact; it does not establish that a person approved it.

## Resolve blockers

The latest published version is always protected, including archived workflows. Drafts and retained published versions that pin a selected version also block cleanup. Update current drafts and publish updated callers before deleting their old dependencies.

For a historical caller, explicitly add that caller version to the selection after reviewing its history impact. Cleanup never expands the selection or rewrites published references. If report v1 through v8 call an obsolete child and draft/latest v9 no longer do, select those obsolete callers before deleting the child definition. Owned children follow the same rules.

Running and waiting runs protect their own definitions and all transitive published calls they might still invoke. This includes future Batch items and detached calls. Protection conservatively covers every published branch. A detached run protects its dependencies independently after its parent finishes. Wait for active runs to finish, or explicitly cancel them, then preview again.

Workflow deletion still has its existing restrictions, including owned children and runs belonging to another workflow. Version cleanup removes definition references; it does not delete workflows, runs, or parent links.

## Inspect history after cleanup

Affected runs retain inputs, outputs, executions, events, saved prompt captures, assignments, and ancestry. Full inspection returns `definitionAvailable:false` and `definition:null`. The UI shows the missing version in place of its graph, retains execution details and child navigation, and omits retry. Run lists, briefings, and selected results remain readable. Briefing run summaries include `definitionAvailable`; Batch `total` and `queued` are null without a definition, while recorded dispatched counts and progress remain available.

Starting a removed version or retrying a failed run that requires it fails before changing state. Interlock never substitutes the draft or latest version. Retained versions keep their numbers. Deleting v1 and v2 after v3 was published leaves v3; the next publication is v4.

## Restore original definitions explicitly

Ordinary imports leave deliberately deleted versions deleted and report `skippedVersions`. The `force` option does not authorize restoration. An import that retains a caller whose dependency was skipped fails without partial changes.

To restore history from a pre-cleanup backup, use MCP `import_workflows` with `restoreDeletedVersions:true`, or:

```sh
interlock import @backup.json --restore-deleted-versions
```

If the backup draft differs, supply its current revision map or `--force` as described in [portable imports](agent-workflows.md#export-and-import-portable-bundles). Restoration accepts only the original definition under the original version number and still checks ownership and published dependencies. It returns `restoredVersions`. Different content at a deleted number rejects the entire import, even with force. Restoring old callers can reintroduce reference blockers.

Exports after cleanup use bundle format 3 with retained definitions and deletion identity hashes. Deleted definitions are absent; their hashes cannot restore them. Transfer preserves cleanup restrictions in another library. Importing cleanup metadata never deletes a version retained in the destination. Other exports keep formats 1 or 2. All three formats remain supported.
