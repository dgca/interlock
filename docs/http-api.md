---
title: HTTP API
description: Start published workflows and follow their runs with plain JSON requests.
---

# Call Interlock over HTTP

Scripts and applications can start published workflows and follow their runs with plain JSON requests. Use it from code you own, such as a cron job, a CI step or a small relay for another system's events.

The API lives under `/api` on the running server, by default `http://127.0.0.1:4310/api`. Its routes call the same server operations as the UI, the CLI and MCP, so input contracts, start receipts, admission and cancellation follow the same rules.

## Before you start

The API is local, like the rest of Interlock:

- It accepts requests only for `127.0.0.1`, `localhost` or `[::1]`, and rejects untrusted browser origins.
- Request bodies are limited to 2 MiB.
- When the engine requires token authentication, every `/api` request needs the [API token](https://github.com/dgca/interlock/blob/main/docs/connect-harness.md#api-token). Without it the server answers `401`. Read the file reported by `interlock doctor` or use the matching path below.

```sh
TOKEN=$(cat ~/Library/Application\ Support/Interlock/keys/api-token)   # macOS
# TOKEN=$(cat ~/.config/interlock/keys/api-token)                     # Linux
# TOKEN=$(cat "$INTERLOCK_DATA_DIR/keys/api-token")                  # Configured data directory
curl -s http://127.0.0.1:4310/api/workflows -H "Authorization: Bearer $TOKEN"
```

The examples below leave out the header. Add it when the token is required.

## Start a run and follow it

A run needs something to do its work: a connected agent, a [managed harness](https://github.com/dgca/interlock/blob/main/docs/managed-executors.md), or a person answering in the UI. HTTP starts and observes runs; it does not claim assignments.

1. Find the workflow ID and the input it expects:

   ```sh
   curl -s http://127.0.0.1:4310/api/workflows
   ```

   ```json
   {
     "items": [
       {
         "id": "dba7ea93-3550-4a65-8b8e-29f938e34bbd",
         "name": "Triage issue",
         "description": "Classify an issue",
         "ownerWorkflowId": null,
         "latestVersion": 1,
         "inputSchema": {
           "type": "object",
           "properties": { "issue": { "type": "string" } },
           "required": ["issue"]
         }
       }
     ]
   }
   ```

   `inputSchema` is the JSON Schema of the latest published version, or `null` when that version was deleted. Drafts that were never published and archived workflows are not listed.

2. Start the run:

   ```sh
   curl -s -i http://127.0.0.1:4310/api/runs \
     -H 'Content-Type: application/json' \
     -H 'Idempotency-Key: github-delivery-72d3c1' \
     -d '{"workflowId":"dba7ea93-3550-4a65-8b8e-29f938e34bbd","input":{"issue":"Login fails on Safari"}}'
   ```

   ```http
   HTTP/1.1 202 Accepted
   Location: /api/runs/0936c687-21f8-4149-895d-260363837979
   ```

   ```json
   {
     "runId": "0936c687-21f8-4149-895d-260363837979",
     "workflowId": "dba7ea93-3550-4a65-8b8e-29f938e34bbd",
     "version": 1,
     "status": "waiting",
     "stage": null,
     "waiting": {
       "kind": "claim_queue",
       "since": "2026-11-13T23:32:54.349Z",
       "detail": {
         "runId": "0936c687-21f8-4149-895d-260363837979",
         "nodeId": "agent",
         "executionId": "e5ffd8c0-0211-4dbd-b98d-e82c8f0ab301",
         "workId": "086a276f-0b1c-48cf-86ca-712fca9dd242",
         "message": "Waiting for an agent"
       }
     },
     "actor": "agent",
     "requestId": "github-delivery-72d3c1",
     "createdAt": "2026-11-13T23:32:54.344Z",
     "updatedAt": "2026-11-13T23:32:54.349Z"
   }
   ```

   `202 Accepted` means Interlock recorded the run, not that the workflow succeeded. The run may be `queued` behind a capacity limit or an `after` dependency, or `running`, or `waiting` for an agent, a person, a timer or an integration.

3. Poll the status until it is `completed`, `failed` or `cancelled`. The response has the same shape as the start response:

   ```sh
   curl -s http://127.0.0.1:4310/api/runs/0936c687-21f8-4149-895d-260363837979
   ```

4. Once `status` is `completed`, fetch the output:

   ```sh
   curl -s http://127.0.0.1:4310/api/runs/0936c687-21f8-4149-895d-260363837979/result
   ```

   ```json
   {
     "runId": "0936c687-21f8-4149-895d-260363837979",
     "path": "",
     "bytes": 15,
     "value": { "label": "bug" }
   }
   ```

   Add `?path=label` to select part of the output, with dot-separated keys or array indices. Before completion the route answers `409` with code `run_not_completed` and the current status in `run`.

Status and start responses never include the full run, its executions or events. Use MCP `get_run`, the CLI or the UI for full inspection.

## Retry a start safely

Send a stable key with every start that might be repeated, either in the `Idempotency-Key` header or as `requestId` in the body. The key follows [idempotent run starts](https://github.com/dgca/interlock/blob/main/docs/idempotent-run-starts.md): 1 to 120 characters, case sensitive, unique across the library.

If the response is lost, send the same request again with the same key and body. Interlock returns the original run with `202` and does not create, advance or retry anything:

```sh
# Same key, same body: same runId
curl -s http://127.0.0.1:4310/api/runs -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: github-delivery-72d3c1' \
  -d '{"workflowId":"dba7ea93-3550-4a65-8b8e-29f938e34bbd","input":{"issue":"Login fails on Safari"}}'
```

Reusing a key with a different body is rejected with `409` and starts nothing:

```json
{
  "error": "Run start requestId was already used with different arguments; no run was started",
  "code": "conflict"
}
```

- A key whose run was deleted from history also answers `409`.
- If you send both the header and `requestId`, they must match; otherwise the request is rejected with `400`.
- Use a new key for a deliberate new attempt. Without a key, every request starts another run.

## Cancel a run

```sh
curl -s -X POST http://127.0.0.1:4310/api/runs/591c8feb-3818-4b96-a860-f242321e18cc/cancel
```

The response is the run's status, normally with `"status": "cancelled"`. Cancelling a finished run returns its final status unchanged.

Cancellation stops the run and its ordinary active children. It stops at detached children, and it does not undo effects that Scripts, Fetch requests or agents already caused.

## Turn an external event into a start

Interlock does not receive third-party webhooks itself. Run a small receiver of your own that:

1. checks the sender's signature;
2. picks the fields the workflow needs;
3. calls `/api/runs` with the sender's delivery ID as the key, so redeliveries reuse the first run.

```js
// A GitHub "issues" webhook relayed by your own server.
export async function onIssueEvent(event, deliveryId) {
  if (event.action !== 'opened') return;
  const response = await fetch('http://127.0.0.1:4310/api/runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `github:${deliveryId}`,
      // Authorization: `Bearer ${token}` when the engine requires a token
    },
    body: JSON.stringify({
      workflowId: 'dba7ea93-3550-4a65-8b8e-29f938e34bbd',
      input: { issue: `${event.issue.title}\n\n${event.issue.body ?? ''}` },
      title: `Triage #${event.issue.number}`,
      tags: { repo: event.repository.full_name },
    }),
  });
  if (response.status === 202) return (await response.json()).runId;
  throw new Error(`${response.status}: ${(await response.json()).error}`);
}
```

- Retry network errors and `5xx` with the same key. Do not retry `400`, `404` or `409` unchanged.
- Keep the receiver on the same machine as Interlock. The API is not for public exposure.
- For starts on a timer or after another run, see [schedules](https://github.com/dgca/interlock/blob/main/docs/schedules.md) and [lifecycle event triggers](https://github.com/dgca/interlock/blob/main/docs/events.md).
- The [GitHub issue intake starter](https://github.com/dgca/interlock/blob/main/docs/integration-starters.md#github-issue-intake) polls instead of receiving webhooks, and calls this route from a Fetch step.

## Choose HTTP or MCP

- **HTTP** suits code you own. It needs only an HTTP client, starts work, and reads status and results.
- **[MCP](https://github.com/dgca/interlock/blob/main/docs/connect-harness.md)** suits agents. They need assignments, claims, result submission, briefings, waits, authoring and the rest of the tool set. MCP is also better when a model decides which workflow to run.

## Read and create boards

```sh
curl -s 'http://127.0.0.1:4310/api/boards/view?workflowId=dba7ea93-3550-4a65-8b8e-29f938e34bbd&limit=10'
curl -s http://127.0.0.1:4310/api/board-types
curl -s http://127.0.0.1:4310/api/boards -H 'Content-Type: application/json' \
  -d '{"name":"Delivery","typeId":"coding"}'
```

`GET /api/boards/view` takes `id` (a board) or `workflowId` (that workflow's stage board), and optional `lane`, `offset` and `limit` (30 cards per lane by default, at most 100). `POST /api/boards` creates a typed board and answers `201` with the board. Column boards and board updates stay with the UI, the CLI and MCP. See [Boards](workflow-boards.md).

## Evaluate a comparison

The [evaluation starter](https://github.com/dgca/interlock/blob/main/docs/workflow-evaluation.md) uses two routes from its Scripts. Other callers rarely need them.

`GET /api/comparisons/{id}/evaluation-plan?evaluationRunId=RUN_ID` returns the plan for an evaluation run whose input captured this comparison:

- the fixed settings;
- `samples`, each with its exact grader input;
- `skipped`, with reasons (at most 100);
- `remaining`.

Selection is deterministic, and the plan names no side, version or worker.

`POST /api/comparisons/{id}/judgments` records the grade that a Batch item run's completed `review` or `checks` step produced:

```json
{
  "evaluationRunId": "RUN_ID",
  "reviewerRunId": "ITEM_RUN_ID",
  "sampleId": "SAMPLE_ID"
}
```

The server reads the grade from that step and records it the same way as MCP `update_workflow_comparison` `record_quality`, with request key `RUN_ID:SAMPLE_ID` and the same provenance checks. The response is the judgment.

- Repeating the request returns the original judgment, so retry it unchanged after a network error or `5xx`.
- A grade that fails a provenance check answers `400`. A missing comparison answers `404`.

## Review proposed workflow changes

`GET /api/workflows/{id}/proposals`, `GET /api/proposals/{id}`, `POST /api/proposals` and `POST /api/proposals/{id}/decision` list, read, create and decide [proposed workflow changes](workflow-proposals.md) as a person.

## Launchers

Pull launcher clients use `POST /api/launchers/{profileId}/poll` and the `complete` and `fail` routes under `/api/launchers/{profileId}/operations/{operationId}`. See [pull transport for launchers](https://github.com/dgca/interlock/blob/main/docs/managed-executors.md#pull-transport-for-launchers-interlock-cannot-call).

## Reference

### Routes

| Route                                                               | Purpose                                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/workflows`                                                | List published workflows with their IDs and input contracts.                                 |
| `POST /api/runs`                                                    | Start a run of a published workflow.                                                         |
| `GET /api/runs/{id}`                                                | Read a run's compact status.                                                                 |
| `GET /api/runs/{id}/result`                                         | Read a completed run's output.                                                               |
| `POST /api/runs/{id}/cancel`                                        | Cancel a queued or active run and its ordinary active children.                              |
| `GET /api/boards/view`                                              | Read a board's lanes and cards: `id` or `workflowId`, optional `lane`, `offset`, `limit`.    |
| `GET /api/board-types`                                              | List board types: the built-in `coding`, `design` and `research` until saved, then your own. |
| `POST /api/boards`                                                  | Create a typed board. Answers `201` with the board.                                          |
| `GET /api/comparisons/{id}/evaluation-plan`                         | Select the samples an evaluation run grades.                                                 |
| `POST /api/comparisons/{id}/judgments`                              | Record a Batch item's accepted grade once.                                                   |
| `GET /api/workflows/{id}/proposals`                                 | List a workflow's proposed changes.                                                          |
| `GET /api/proposals/{id}`                                           | Read one proposed change.                                                                    |
| `POST /api/proposals`                                               | Create a proposed change.                                                                    |
| `POST /api/proposals/{id}/decision`                                 | Approve or reject a proposed change as a person.                                             |
| `POST /api/launchers/{profileId}/poll`                              | A pull launcher client waits for queued operations.                                          |
| `POST /api/launchers/{profileId}/operations/{operationId}/complete` | Report a launcher operation's result.                                                        |
| `POST /api/launchers/{profileId}/operations/{operationId}/fail`     | Report a failed launcher operation.                                                          |

### Start body

`POST /api/runs` accepts these fields. Others are rejected.

| Field        | Required | Meaning                                                                                                                     |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `workflowId` | Yes      | The workflow to start.                                                                                                      |
| `input`      | Yes      | Input that matches the workflow's input contract.                                                                           |
| `version`    | No       | A retained published version. The latest by default.                                                                        |
| `requestId`  | No       | Start key; see [Retry a start safely](#retry-a-start-safely).                                                               |
| `title`      | No       | Run title shown on boards and in **Runs**.                                                                                  |
| `tags`       | No       | Run tags, as an object of string keys and values.                                                                           |
| `hold`       | No       | `{"reason": "..."}` keeps the run queued until `interlock board release` or MCP `manage_pause` `release_start` releases it. |

`POST /api/boards` accepts `name`, `typeId` and optional `scope`, `stageMap` and `fieldPaths`.

### Status fields

| Field            | Meaning                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`         | `queued`, `running`, `waiting`, `completed`, `failed` or `cancelled`. Only `completed` means the workflow succeeded. `failed` adds `error`.                                              |
| `stage`          | The workflow's current named stage, or `null`. See [agent workflow operations](https://github.com/dgca/interlock/blob/main/docs/agent-workflows.md) for how it rolls up from child runs. |
| `waiting`        | What the run is waiting for, or `null`. `detail` identifies the node and, where relevant, the queue position, resume time or blockers.                                                   |
| `actor`          | Who acts next. `agent`: an agent assignment or integration. `person`: every active branch needs someone in the UI. `engine`: Interlock itself.                                           |
| `title`, `tags`  | Present when the run has them.                                                                                                                                                           |
| `requestId`      | The start key, when one was sent.                                                                                                                                                        |
| `costProjection` | Start response only. The workflow's median recent run cost, present when a [start warning threshold](run-budgets.md#warn-before-large-runs) is set. The start is never refused.          |

`waiting.kind` is one of `claim_queue`, `managed_launch`, `human_request`, `input_node`, `hold`, `pause`, `budget`, `resource`, `timer`, `poll` or `admission_queue`. These are the same projection fields the UI and MCP use.

### Result limits

`GET /api/runs/{id}/result` accepts `path` and `maxBytes`. Outputs larger than `maxBytes` (default 65536, at most 262144) are rejected with `400`; select a narrower path.

### Errors

Errors are JSON with an `error` message and, from `/api` routes, a `code`. The `413` response is plain text.

| Status | Code                | When                                                                                                                   |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_request`   | The body is not JSON, has unknown fields, the input does not match the contract, or the header and `requestId` differ. |
| 401    | none                | The engine requires a token and it is missing or wrong.                                                                |
| 403    | none                | The request used another host name or an untrusted browser origin.                                                     |
| 404    | `not_found`         | The workflow, run or route does not exist.                                                                             |
| 409    | `conflict`          | A start key was reused with different arguments or refers to deleted history.                                          |
| 409    | `run_not_completed` | A result was requested before the run completed.                                                                       |
| 413    | none                | The body exceeds 2 MiB.                                                                                                |

Launcher routes add their own codes:

| Status | Code                           | When                                                                            |
| ------ | ------------------------------ | ------------------------------------------------------------------------------- |
| 401    | `launcher_credential_missing`  | The `X-Interlock-Launcher-Credential` header is missing.                        |
| 403    | `launcher_credential_invalid`  | The credential is not valid for this profile, or was replaced.                  |
| 404    | `launcher_operation_not_found` | The operation does not exist. It may have completed, been cancelled or expired. |
| 409    | `launcher_client_conflict`     | Another client is active for this profile.                                      |
| 409    | `launcher_lease_invalid`       | The operation's lease expired and it was delivered again.                       |
| 409    | `launcher_profile_disabled`    | The launcher profile is disabled.                                               |
| 429    | `launcher_poll_busy`           | Two polls for this profile are already waiting.                                 |

Other rejections from the engine, such as an unpublished or archived workflow or a deleted version, return `400` with the engine's message.

Input that breaks the workflow's contract names the fields, as in the UI and MCP:

```json
{
  "error": "Workflow input: Missing required field \"issue\".",
  "code": "invalid_request"
}
```

A malformed body lists each problem in `issues`:

```json
{
  "error": "Invalid request",
  "code": "invalid_request",
  "issues": [
    { "path": "input", "message": "Invalid input" },
    { "path": "", "message": "Unrecognized key(s) in object: 'inputs'" }
  ]
}
```

A missing run (`GET /api/runs/missing`):

```json
{ "error": "Run not found", "code": "not_found" }
```

### Compatibility

Interlock is pre-1.0. The supported HTTP API covers:

- every route in the [Routes](#routes) table, including the proposal and launcher routes;
- the request fields listed for `POST /api/runs` and `POST /api/boards`, and the launcher request bodies in [pull transport for launchers](https://github.com/dgca/interlock/blob/main/docs/managed-executors.md#pull-transport-for-launchers-interlock-cannot-call);
- the response fields shown on this page and in that section;
- the status codes and error `code` values.

- Patch releases can add routes, optional request fields, response fields, `waiting.kind` values and error codes. Ignore fields you do not know.
- Removing or renaming a supported field or route, or changing a status code, is a breaking change. It follows the [release rules](https://github.com/dgca/interlock/blob/main/docs/releases.md): it is flagged before the release bump is chosen and described in the changelog.
- `/trpc` is the UI's internal transport and can change in any release. Do not build integrations on it.

An OpenAPI description is not published. With this few routes, this page and curl cover discovery, and workflow input contracts already arrive as JSON Schema from `GET /api/workflows`. A generated OpenAPI file becomes worthwhile if the API grows enough that typed client generation saves real work.
