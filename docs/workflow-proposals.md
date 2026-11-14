---
title: Proposed workflow changes
description: Review changes that agents or people propose to a workflow draft before they apply.
---

# Review proposed workflow changes

A proposal is a suggested edit to a workflow draft that a person reviews. Agents use it when they notice the workflow itself should change: a prompt lacks context, a check runs too late, a timeout is too short.

A proposal holds edits in the same operations `edit_workflow` accepts, a title, a rationale, links to the runs where the problem showed, and its author. It never changes a workflow by itself. Approving it saves a new draft revision, like any other draft edit. Approval never publishes; publish the draft when you are ready.

## Let agents propose

Agent proposals are off for every workflow until a person turns them on. While they are off, `propose_workflow_change` refuses with a message and nothing else changes. People can always create a proposal with **New proposal** in the **Proposals** tab, the CLI or the HTTP API.

To turn them on, open the workflow's **Proposals** tab and choose **Proposal settings**. Or from the CLI:

```sh
interlock proposals settings WORKFLOW_ID '{"agents":true,"nodeKinds":["agent"],"fields":["prompt"]}'
```

Run `interlock proposals settings WORKFLOW_ID` without JSON to read the current settings. The [settings reference](#settings) lists every field.

The scope limits agents only. It is checked again when a proposal is re-applied to a changed draft. A person can propose or approve any edit.

## Propose a change

During a claim, an agent calls `propose_workflow_change` with its `workId` and claim `token`:

```json
{
  "workId": "WORK_ID",
  "token": "CLAIM_TOKEN",
  "title": "Require changelog entries",
  "rationale": "Reviews of runs A and B rejected the change for a missing changelog entry.",
  "edits": [
    {
      "op": "update_node",
      "id": "author",
      "set": { "prompt": "… Add a changelog entry for user-visible changes." }
    }
  ]
}
```

- The proposal links to the claim's run and execution. Its workflow defaults to the run's.
- Without a claim on a run of the target workflow, the agent passes `workflowId`. The workflow must allow this with `otherWorkflows`.
- `sources` adds other runs or executions that show the problem.
- The edits must apply to the current draft. A proposal that would not save is refused.

People use `interlock proposals create` with the same fields and a `workflowId`.

## Review a proposal

1. Open the workflow's **Proposals** tab. It shows the number of open proposals. Filter the list by **Open**, **Approved** or **Rejected**.
2. Open a proposal. Read its rationale, its source runs, its changes against the current draft and its [simulation result](#simulation-result).
3. Approve, edit, or reject it:
   - **Approve** applies the edits as a new draft revision.
   - **Edit before approving** opens the operations for editing. The changes update as you edit; **Approve edited** applies your version.
   - **Reject** asks for a reason.
4. Publish the draft when you are ready.

Changes that widen what the workflow can do are listed first, expanded:

- agent permission mode and permission policy;
- workspace and working directory, and executors;
- Script code, language and environment;
- Fetch URL, method, headers and query, and polling checks;
- new Secret or Config references;
- called workflows and Agent tool routes;
- raised limits.

Changes are shown in the same layout as publication review. In the run inspector, a step that proposed a change lists the proposal and its status.

Only people decide. Agents, including through the stdio MCP bridge, cannot approve, reject or change the settings.

If an approved proposal adds or changes a Script, Interlock treats it as agent-written. When the library's [Script approval](reuse-work.md#approve-imported-scripts) covers agent edits, the Script waits for a person before its first run.

### From the CLI

```sh
interlock proposals list --workflow WORKFLOW_ID --status open
interlock proposals get PROPOSAL_ID
interlock proposals approve PROPOSAL_ID --edits @edited.json
interlock proposals reject PROPOSAL_ID "Changelog entries are only needed for user-visible changes."
interlock proposals reapply PROPOSAL_ID
```

- `list` also takes `--run RUN_ID`, `--status all`, `--offset N` and `--limit N`.
- `get` returns the proposal, the current draft, the draft the proposal would produce, the changed node, route and setting IDs, its conflict state and its simulation result.
- `approve` without `--edits` applies the proposal as it is. With `--edits`, the proposal keeps both versions.
- `reject` needs a reason.

## When the draft changed

A proposal records the draft revision it was made against. Approval applies it only to that revision. If the draft changed since:

- **`reapplicable`**: the operations still apply cleanly. Choose **Re-apply to current draft**, or run `interlock proposals reapply PROPOSAL_ID`. Check the new result, then approve.
- **`conflicting`**: the proposal lists why it no longer applies. Reject it and ask for a new proposal.

Interlock never applies a proposal to a different draft without that explicit step.

## Simulation result

When the workflow has a saved [test suite](testing-workflows.md), Interlock simulates each saved case against the current draft and against the draft with the proposal applied. This runs when the proposal is created or re-applied, or when it is first opened if that did not finish.

- Simulations run in memory: no model calls, no network effects. Only the summary is stored, on the proposal.
- The summary shows pass or fail per case for both drafts, and how many routes the cases cover before and after.
- At most 20 cases run.
- Without a suite, or when the cases cannot be simulated, the result says so.
- A missing or failing simulation never blocks a proposal.

## Reference

### Settings

| Field              | Default | Meaning                                                                                                                                                 |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents`           | `false` | Whether agents may propose changes to this workflow.                                                                                                    |
| `nodeKinds`        | all     | Node kinds an agent's edits may add, change or remove. Route edits need both endpoints, before and after the edit, in the list.                         |
| `fields`           | all     | Fields an agent's `update_node`, `update_edge` and `update_settings` edits may set or unset. With a list, agents cannot add or remove nodes or routes.  |
| `otherWorkflows`   | `false` | Whether agents may propose without a claim on a run of this workflow: from a claim in another workflow's run, or as a connected client without a claim. |
| `workflowSettings` | `false` | Whether agents may propose `update_settings` edits: permissions, permission policy, workspace, limits and other workflow-level settings.                |

### Limits

These keep a looping agent from flooding the queue.

| Limit                                             | Value                                                    |
| ------------------------------------------------- | -------------------------------------------------------- |
| Open proposals per workflow (agents)              | 20                                                       |
| Open proposals per run of the agent's claim       | 3                                                        |
| Open proposals made without a claim, per workflow | 5                                                        |
| Edits                                             | 256 KiB                                                  |
| Title                                             | 200 characters                                           |
| Rationale                                         | 4,000 characters                                         |
| Rejection reason                                  | 2,000 characters                                         |
| Sources                                           | 20                                                       |
| Simulated cases                                   | 20                                                       |
| Decided proposals kept                            | Newest 100 approved and newest 100 rejected per workflow |

- An open proposal with equivalent edits for the same workflow is returned instead of a new one, with `deduplicated: true`.
- Deleting a workflow removes its proposals.

### HTTP

| Route                               | Purpose                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/workflows/{id}/proposals` | List a workflow's proposals, newest first. Query `status`, `offset`, `limit`.         |
| `GET /api/proposals/{id}`           | Read one proposal with its conflict state and simulation result.                      |
| `POST /api/proposals`               | Create a proposal as a person.                                                        |
| `POST /api/proposals/{id}/decision` | `{"action":"approve"}`, `{"action":"reject","reason":"…"}` or `{"action":"reapply"}`. |
