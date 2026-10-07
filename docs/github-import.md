# Import workflows from GitHub

In **Workflows**, open **Import**, then **GitHub folder**. Paste a public folder URL and click **Load workflows**:

```text
https://github.com/dgca/interlock/tree/4c43bd7e54651dd9f8356456d647fb86f504252c/workflows
```

Select the workflows you want, then click **Import workflows**. Loading and selection save nothing. A portable bundle is one selectable root with its included workflow and saved-prompt dependencies. **Details** shows their identities, ownership, and published versions. Invalid files have separate diagnostics. Nested folders are excluded.

Import validates the entire selection against current local data and saves it in one transaction. A conflict rejects the whole selection. Existing differing drafts, names, descriptions, ownership, published versions, and shared prompt content cannot be overwritten. Inspect existing data or deselect conflicting files before importing again. Import saves definitions and prompts without starting runs or executing scripts. Review imported scripts before running a workflow.

Identical portable reimports change nothing. Legacy files create a new workflow each time. If a submitted import loses its connection, inspect the library before retrying: the operation may have completed. A library refresh failure after success does not undo the import.

Use **Import > Local file** for existing local legacy files and portable bundles. Their existing behavior remains available. CLI and MCP bundle replacement options are described in [portable import](agent-workflows.md#export-and-import-portable-bundles).

## Supported sources and bounds

Sources must be HTTPS `github.com/<owner>/<repository>/tree/<ref>/<folder>` links to public repository folders. Commit links and branch names with slashes are supported. GitHub discovery uses unauthenticated public REST reads for metadata and pinned raw.githubusercontent.com downloads for file bytes. There is no private-repository login, recursive scan, update subscription, or gallery.

Discovery resolves the longest matching ref prefix first and pins the result to its commit. A missing folder after that resolution is an error. The server retains reviewed source data for 15 minutes. Import uses that data, even if a branch moves. Restart, expiry, or eviction requires **Load workflows** again. At most eight previews and 64 MiB of preview content are retained per engine.

A scan allows 16 ref probes, 200 direct entries, and 100 JSON files. Each JSON file is limited to 1 MiB; total downloaded JSON is limited to 8 MiB. Directory metadata is limited to 2 MiB and commit metadata to 1 MiB. Retrieval has four concurrent file requests, a 15-second request timeout, and a 60-second operation deadline. Limits that prevent a complete folder scan require a smaller folder. Oversized individual files appear as unavailable choices. Symlinks and submodules are excluded.

Network errors and GitHub rejection retain an editable URL and **Retry**. Rate-limit messages include the service's retry metadata when available. **Cancel loading**, closing the dialog, or changing the source discards the preview and selection. Old responses cannot enable import. Once import starts, cancellation and closing are disabled until its result arrives.

Remote portable files must include their referenced workflows, pinned versions, and saved prompts independently of the installed library. Drafts may have incomplete routes and unpinned workflow references. Published definitions must pass publication validation. Local-file import retains its existing draft rules.

## Shared API reference

`workflows.discoverGithubFolder` is a read-only query with `{url}`. It returns `previewId`, `expiresAt`, `source`, `choices`, `diagnostics`, and `ignoredCount`. `source` includes owner, repository, requested ref, resolved commit, folder, and the pinned URL. Choices include file identity, path, filename, SHA-256 content digest, root name and description, format, included versions, workflow dependencies, and saved-prompt identities. Prompt bodies and import data remain on the server.

`workflows.importGithubSelection` is a mutation with `{previewId, fileIds}`. It requires 1 through 100 unique file IDs from the same retained preview. It accepts no force or draft-revision override. It returns `source`, per-file `results`, `changedWorkflowIds`, and `changedPromptIds`. Each result includes the source filename and file ID, resulting root ID, format, whether the root changed, and changed dependency IDs. Validation or rollback errors begin with `Nothing imported:`. Transport failures without that confirmed result require inspection before retrying.

These operations are shared server API operations used by the UI. Existing CLI `import` and MCP `import_workflows` accept files or bundles; they do not accept GitHub URLs.
