# Review proposed workflow changes

An agent working inside a workflow often notices that the workflow itself should change: a prompt lacks context, a check runs too late, a timeout is too short. A proposal records that change for a person to review. It is a stored edit to the workflow draft, in exactly the operations `edit_workflow` accepts, with a title, a rationale, links to the runs and executions where the problem showed, and its author.

A proposal never changes a workflow by itself. Approving one applies its edits as a new draft revision through the same path as any other draft edit. Approval never publishes; publish the draft as usual when you are ready.

## Let agents propose

Agent proposals are off for every workflow until a person turns them on. With them off, `propose_workflow_change` refuses with a message and nothing else changes. People can always create a proposal from the CLI or the HTTP API.

The setting is per workflow:

| Field            | Default | Meaning                                                                                                                                                |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agents`         | `false` | Whether agents may propose changes to this workflow.                                                                                                   |
| `nodeKinds`      | all     | Node kinds an agent's edits may add, change or remove. Route edits need both endpoints in the list. Workflow settings are not node edits.              |
| `fields`         | all     | Fields an agent's `update_node`, `update_edge` and `update_settings` edits may set or unset. With a list, agents cannot add or remove nodes or routes. |
| `otherWorkflows` | `false` | Whether a claim in a run of another workflow may propose changes to this one. Without it, a claim can only propose changes to its own run's workflow.  |

```sh
interlock proposals settings WORKFLOW_ID '{"agents":true,"nodeKinds":["agent"],"fields":["prompt"]}'
```

The scope applies to agents only. A person can propose or approve any edit.

## Propose a change

During a claim, an agent calls `propose_workflow_change` with its `workId` and claim `token`. The proposal links to that run and execution, and its workflow defaults to the run's. A connected client without a claim passes `workflowId`. `sources` adds other runs or executions that show the problem.

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

The edits must apply to the current draft; a proposal that would not save is refused. People use `interlock proposals create` with the same fields and `workflowId`.

To keep a looping agent from flooding the queue:

- An identical open proposal (the same edits for the same workflow) returns the existing proposal with `deduplicated: true`.
- An agent cannot propose while the workflow has 20 open proposals, or while the run of its claim has 3.

## Review a proposal

```sh
interlock proposals list --workflow WORKFLOW_ID --status open
interlock proposals get PROPOSAL_ID
interlock proposals approve PROPOSAL_ID [--edits @edited.json]
interlock proposals reject PROPOSAL_ID "Changelog entries are only needed for user-visible changes."
```

`get` returns the proposal, the current draft and the draft the proposal would produce, the changed node, route and setting IDs, its conflict state and its simulation result. Pass `--edits` to approve an edited version of the operations; the proposal keeps both. Rejection needs a reason.

Only people decide. Agents, including the stdio MCP bridge, cannot approve, reject or change the setting.

If an approved proposal adds or changes a Script, Interlock treats the Script as agent-written: when the library's [Script approval](reuse-work.md#approve-imported-scripts) covers agent edits, the Script waits for a person before its first run.

## When the draft changed

A proposal records the draft revision it was made against, and approval only applies it to that revision. If the draft changed since:

- When the operations still apply cleanly, the proposal is `reapplicable`. Run `interlock proposals reapply PROPOSAL_ID` to move it onto the current draft, check the new result, then approve it.
- Otherwise the proposal is `conflicting` and lists why. Reject it and ask for a new proposal.

Interlock never applies a proposal against a different draft without that explicit step.

## Simulation result

When the workflow has a saved [test suite](workflow-simulation.md), Interlock runs each saved case as a fixture simulation against the current draft and against the draft with the proposal applied, when the proposal is created or re-applied, or first opened if that did not finish. Simulations run in memory: no model calls, no network effects, nothing stored except the summary on the proposal. The summary lists pass or fail per case for both drafts and the number of routes the cases cover before and after. At most 20 cases run.

Without a suite, or when the cases cannot be simulated, the result says so. A missing or failing simulation never blocks a proposal.

## HTTP

| Route                               | Purpose                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/workflows/{id}/proposals` | List a workflow's proposals, newest first. Query `status`, `offset`, `limit`.         |
| `GET /api/proposals/{id}`           | Read one proposal with its conflict state and simulation result.                      |
| `POST /api/proposals`               | Create a proposal as a person.                                                        |
| `POST /api/proposals/{id}/decision` | `{"action":"approve"}`, `{"action":"reject","reason":"…"}` or `{"action":"reapply"}`. |
