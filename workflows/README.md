# GitHub workflow import fixtures

These synthetic files support the SDLC and gstack comparison for importing workflows from a public GitHub folder. They contain no exported user data, credentials, external-service configuration, or machine-specific paths. Use temporary Interlock databases for the trials.

The fixture branch is `codex/github-import-fixtures`. Freeze the trials to the fixture commit reported when setup completes. A commit-based folder URL has the form `https://github.com/dgca/interlock/tree/<commit>/workflows`. The branch URL also exercises a branch name containing a slash.

## Files and existing import behavior

| File                                | Expected behavior                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-quick-summary.json`             | Valid legacy `{name, description, definition}` file. Creates one unpublished library workflow.                                                                                                      |
| `02-review-checklist.json`          | Valid format-version-1 portable bundle. Imports one library workflow with published version 1. Reimport is a no-op.                                                                                 |
| `03-team-summary.json`              | Valid format-version-2 portable bundle. Imports the Team summary root, one owned child pinned at version 1, and one saved prompt. Reimport is a no-op.                                              |
| `04-review-checklist-conflict.json` | Valid on its own. Uses the same workflow ID and version as file 02 with different published content. Importing either after the other fails without replacing existing data, including when forced. |
| `05-invalid-workflow.json`          | Valid JSON with an unsupported node kind. Definition parsing rejects it.                                                                                                                            |
| `06-invalid-json.json`              | Deliberately truncated JSON. JSON parsing rejects it. Excluded from formatting so its malformed bytes remain intact.                                                                                |
| `07-missing-dependency.json`        | Schema-valid bundle whose root references an omitted child. Import fails and rolls back the root and saved prompt.                                                                                  |
| `repository-metadata.json`          | Ordinary JSON with no workflow definition. It is not an importable workflow.                                                                                                                        |
| `nested/hidden-summary.json`        | Valid legacy workflow in a subfolder. Used to check direct-folder discovery without recursive crawling.                                                                                             |
| `no-workflows/README.md`            | A separate folder with no importable JSON files.                                                                                                                                                    |

For the normal multiple-selection scenario, use files 01, 02, and 03. Together they produce three library workflows, one owned child, and one saved prompt. File 03 is one selectable root with its dependencies included, rather than two independent workflow choices.

Importing these files saves definitions and prompts. It does not start workflow runs or execute scripts. Positive fixtures use a `topic` input and `summary` output. Do not infer workflow compatibility from the `.json` extension alone.

Use this folder to evaluate discovery, selection, validation, repeat imports, dependency preservation, and conflicts. The table describes current import semantics; it does not prescribe the new dialog's layout or its policy for multiple selected files when one fails. Decide that policy before the paired implementation trials.
