# GitHub folder import comparison

Build a medium-sized Interlock feature that lets a person paste a public GitHub folder URL, inspect the workflows available there, select the ones they want, and import them into their local library. Keep local-file import available.

Use the existing legacy single-workflow and portable bundle formats. Each selectable bundle represents its root workflow and includes its workflow and saved-prompt dependencies. Show enough name, description, source-file and dependency information to make a useful selection. Unrelated and invalid files must not prevent discovering valid choices.

Import only after an explicit selection and import action. Validate the entire selection before committing it. If any selected item is invalid or conflicts with existing data, fail the whole selection without changing workflows or prompts. Do not overwrite differing existing drafts, published versions, ownership or shared prompts. Identical portable reimports remain no-ops; legacy files retain the current create-new-workflow behavior. Import never starts a workflow or executes its scripts.

Limit this version to public github.com repository folders and their direct files. Support folder links using a commit or a branch, including the fixture branch containing a slash. No private-repository authentication, recursive crawling, auto-update, hosted gallery or new workflow format. Follow Interlock's existing package boundaries, UI patterns and repository instructions. Make normal technical and design decisions within this scope. Ask only for a new consequential product or authorization decision that this brief does not settle.

Keep loading, empty, selection, error, cancellation and retry behavior clear. Changing the source must not import stale results from the prior source. Preserve usable keyboard navigation and focus. Render imported descriptions as data. Preserve the existing local-file import behavior.

Fixture source, frozen to commit 4c43bd7e54651dd9f8356456d647fb86f504252c:
https://github.com/dgca/interlock/tree/4c43bd7e54651dd9f8356456d647fb86f504252c/workflows
Branch-link scenario:
https://github.com/dgca/interlock/tree/codex/github-import-fixtures/workflows
No-workflows scenario:
https://github.com/dgca/interlock/tree/4c43bd7e54651dd9f8356456d647fb86f504252c/workflows/no-workflows
Fixture README documents the existing import semantics and individual cases. Use 01, 02 and 03 for the normal selection; use 04 to test a published-version conflict against 02. Do not modify the fixtures.

Work only in the assigned disposable repository and temporary application databases. Keep code and task commits local; do not push, create a PR, merge, deploy, publish a package, change the original library workflows, or modify primary main. Store verification observations outside the committed checkout. Finish locally with the exact reviewed commit and truthful evidence. No deliberately injected bugs or failures are part of this ordinary build comparison.

The shared acceptance checklist is at /Users/dan/.codex/interlock-comparison-2026-10-07.pZ2oTo/acceptance.md.
