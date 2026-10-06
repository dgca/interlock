# Create and reuse saved prompts

## Create instructions

1. Open **Prompts** in the sidebar and select **New prompt**.
2. Enter a name and Markdown instructions. Add a description if it helps you find the prompt.
3. Select **Create prompt**. Use **Save** for subsequent edits, or **Discard changes** to return to the latest saved content.

The editor lists workflows that reference the prompt, including drafts and published versions. Unsaved text receives navigation protection. If someone changes the prompt while you edit, saving fails and preserves your text. Discard your changes to load the latest revision before editing again.

## Attach prompts to an Agent node

1. Open the Agent node's settings.
2. Use **Saved prompts** to select one or more prompts. Move them up or down to set their order.
3. Open **View instructions** to inspect a selection. Add this step's specific work in **Task instructions**.
4. Open **Preview combined instructions**, then apply, save, and publish the workflow.

Saved prompt sections precede the node's task instructions. The existing Context controls still govern session isolation and required capabilities. Saved instructions do not provide tools or skills, change input or output contracts, or control the external agent's system prompt. Review contradictory instructions in the preview before running.

## Apply improvements centrally

Editing a saved prompt changes the guidance used by future runs of every workflow referencing it, including published workflows. You do not need to republish those workflows. Published definitions keep the same prompt IDs.

Each workflow run captures the latest content when it starts. Later Agent steps, loops, Batch items, claim recovery, retries, and server restart keep that content. A Workflow node starts a separate run that captures the latest instructions at its own startup. A parent and child can use different revisions if a prompt changes between their start times. Detached workflows follow the same rule.

Open **Captured prompts** in run inspection to see the actual content and revisions. Agent assignments show the composed instructions and their saved prompt revisions. Prompt revisions are retained internally; history restoration UI and prompt pinning are outside the current scope.

## Remove an unused prompt

Open the prompt, select **Delete prompt**, and confirm. Any draft or published workflow version reference blocks deletion and identifies the dependent workflows. Removing a reference from the latest draft does not remove it from historical published versions. Deleting an unused prompt keeps historical captured run instructions available.

## Transfer workflows and prompts

Workflow exports include current content for every referenced saved prompt across drafts, published versions, dependencies, and owned children. Prompt-bearing bundles use format version 2 and require a version of Interlock that supports Prompts. Prompt-free bundles keep format version 1.

Import preserves shared IDs. Identical content reuses the local prompt and revision. Different current content under the same ID rejects the entire import, even with the workflow `force` option. Resolve the shared content deliberately through a prompt edit before importing. Workflow bundles exclude prompt revision history and historical run captures. See [portable bundles](agent-workflows.md#export-and-import-portable-bundles).

## Use prompts through MCP

Discover IDs with `list_prompts` and inspect content and usage with `get_prompt`. Use `create_prompt`, revision-protected `update_prompt`, and guarded `delete_prompt` for management.

An Agent definition can include:

```json
{
  "id": "research",
  "kind": "agent",
  "label": "Research",
  "promptIds": ["saved-prompt-id"],
  "prompt": "Research the supplied topic and return your findings."
}
```

Use a real ID returned by the prompt library. Missing IDs block publication and startup, while incomplete drafts remain saveable. Full work discovery and claims include the composed assignment `prompt` and captured `savedPrompts`; `get_run` includes `promptSnapshots`. Summary discovery and run briefings omit instruction bodies. Execute the assignment's captured guidance instead of reloading newer content.
