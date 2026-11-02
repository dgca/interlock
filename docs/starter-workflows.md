# Choose starter workflows

New libraries start empty. Existing workflows remain intact after upgrades, including earlier seeded SDLC copies. Bundled starters are explicit choices, available without a network connection or developer checkout.

## Add a starter

1. Open **Workflows → Import** or **Browse starter workflows** in an empty library.
2. Choose **Starters** and select a procedure: **SDLC workflow** or **Evaluate workflow comparison**.
3. Review its purpose and requirements, then choose **Add to library**.

This creates and publishes a copy without starting a run. Imported workflows belong to you. Editing, publishing, archive, ownership and deletion use the ordinary operations. The improvement recipe and specialized examples remain optional file imports.

Known copies offer **Open workflow**. To deliberately create another one, select **Add another copy** before adding. Existing copies are never overwritten or republished. A recognized unpublished manual copy stays a draft; review and publish it on its workflow page if needed.

After deletion, a starter remains absent until you deliberately import again. Shipped template updates change the available template and never replace your copies. There are no automatic upgrade installations or replacements.

## Import from other sources

Choose **GitHub folder**, **Local file** or **Paste JSON** in the same dialog. GitHub discovery pins the source revision. Select workflows from its results; included dependencies are available under disclosure. A conflict rejects the entire selection. Local files and pasted JSON show a preview before importing, and changing sources retains the choices already entered.

File-based imports keep their existing semantics: standalone workflow files create drafts, while portable bundles retain their IDs and included versions. The interface does not force replacement or restore deleted definitions. Review errors beside the source input and keep uncertain delivery distinct from a confirmed rejection. When a response cannot be confirmed, inspect the library before retrying, especially for standalone files that create a new ID each time.

A single import opens its workflow. Multiple roots return to the library with the imported workflows highlighted. Imports do not start runs.

## CLI and MCP

```sh
interlock starters
interlock import-starter sdlc
interlock import-starter evaluate-comparison --copy --request-id review-copy-1
```

`--copy` requests another copy. The CLI generates a new key when you omit `--request-id`. Supply your own key and reuse it when retrying an uncertain operation. Without `--copy`, known existing copies are reused. Standalone file commands such as `interlock import @workflow.json` retain their existing draft/bundle behavior.

For MCP, discover choices on demand:

```json
{ "source": "starters" }
```

Pass that to `list_workflows`; the normal default still lists the library. Choices contain bounded metadata and existing-copy references, without definitions or prompts.

Pass the chosen identity to `import_workflows`:

```json
{ "starterId": "sdlc", "requestId": "sdlc-import-1" }
```

Use `copy:true` with a new key for a deliberate additional copy. Starter requests cannot include portable-bundle replacement options. Existing calls with `bundle` keep their original behavior.

## Copies and retry records

Explicit imports track the catalog identity against the local workflow ID, so subsequent edits and renames do not lose that association. Older manual copies can be recognized by current drafts or retained published definitions, ignoring canvas positions and declaration order. An arbitrary changed and renamed old copy without retained matching content cannot be identified reliably. Display names alone never establish identity.

A starter import's nonblank request key is an opaque, case- and whitespace-sensitive string of at most 120 characters. Identical keyed retries return the same copy, even after restart; conflicting reuse and a deleted imported result reject. The request receipt commits atomically with creation/publication and copy tracking. A failed creation leaves no accepted receipt. No key is automatically changed to hide uncertain history.

Copy associations and retry receipts live in the library database and survive ordinary deletion and full database backup/restore. Portable bundles contain workflow definitions rather than local import history. Replacing the database or restoring an older backup loses decisions absent from that database.
