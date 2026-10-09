# Import a workflow

These files are optional imports for an existing Interlock library. Fresh libraries receive the SDLC starter automatically.

| File                             | Workflow         | Purpose                                                                                                                           |
| -------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [sdlc.json](sdlc.json)           | SDLC workflow    | The same starter used by fresh installs. See [Use the SDLC workflow](../docs/sdlc-workflow.md).                                   |
| [all-nodes.json](all-nodes.json) | All nodes (demo) | Inspect every current node editor using a fictional mission briefing. Importing also adds its owned **Format crew badge** helper. |

## Import from GitHub

1. Open **Workflows → Import → GitHub folder**.
2. Enter `https://github.com/dgca/interlock/tree/main/workflows` and select **Find workflows**.
3. Select the example you want and choose **Import selected**.
4. Open the imported draft. Double-click a node to inspect its settings. The Batch group has a **Settings** button.

Alternatively, download a JSON file and upload it through **Import → Local file**. From a repository checkout, the CLI accepts `interlock import @workflows/all-nodes.json`.

Importing does not start a run. The demo imports as a draft with a published owned helper so both Workflow editors have a valid target. Reimporting the unchanged demo bundle is a no-op; conflicting local edits are preserved by import conflict checks. The SDLC file creates a new draft on each import. Only publish a root draft if you want to run it.

## Inspect the demo

The demo covers Entry, Exit, Agent, Script, Fetch, Wait, Condition, Switch, Workflow, and Batch. It includes JavaScript and Bash scripts, duration and timestamp waits, a polling check with a timeout, an unclaimed Agent timeout, and both Workflow execution modes. Contracts and earlier-node bindings populate the editors with representative settings.

Viewing editors requires no execution. If you choose to publish and run the demo, `{}` is a sample input. It fetches `https://example.com/`, formats fictional crew badges, and offers an agent a briefing assignment. An automatic briefing is used if nobody claims it within 15 seconds. Claiming stops that timeout. No files are written by the example scripts.

When node types or editor modes change, update this demo in the same file and check its coverage against `nodeSchema` in `packages/core/src/index.ts`. Keep its owned helper and Workflow pins in the bundle.
