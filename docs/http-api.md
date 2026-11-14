# Call Interlock over HTTP

Scripts and applications can start published workflows and follow their runs with plain JSON requests under `/api` on the running server, by default `http://127.0.0.1:4310/api`. The routes call the same server operations as the UI, the CLI and MCP, so input contracts, start receipts, admission and cancellation follow the same rules.

| Route                        | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `GET /api/workflows`         | List published workflows with their IDs and input contracts.    |
| `POST /api/runs`             | Start a run of a published workflow.                            |
| `GET /api/runs/{id}`         | Read a run's compact status.                                    |
| `GET /api/runs/{id}/result`  | Read a completed run's output.                                  |
| `POST /api/runs/{id}/cancel` | Cancel a queued or active run and its ordinary active children. |

The API is local, like the rest of Interlock. It accepts requests only for `127.0.0.1`, `localhost` or `[::1]`, rejects untrusted browser origins, and limits request bodies to 2 MiB. When `INTERLOCK_REQUIRE_TOKEN=1` is set, every `/api` request needs the [API token](connect-harness.md#api-token):

```sh
TOKEN=$(cat ~/Library/Application\ Support/Interlock/keys/api-token)   # macOS
# TOKEN=$(cat ~/.config/interlock/keys/api-token)                     # Linux
curl -s http://127.0.0.1:4310/api/workflows -H "Authorization: Bearer $TOKEN"
```

Without it the server answers `401`. The examples below omit the header; add it when the token is required.

## Start a run and follow it

Find the workflow ID and the input it expects. Drafts that were never published and archived workflows are not listed.

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

`inputSchema` is the JSON Schema of the latest published version, or `null` when that version was deleted.

Start the run. The body accepts `workflowId`, `input`, and optionally `version` (a retained published version; the latest by default), `requestId`, `title` and `tags`. Other fields are rejected.

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

`202 Accepted` means Interlock recorded the run. It does not mean the workflow succeeded. The run may be `queued` behind a capacity limit or `after` dependency, or it may be `running` or `waiting` for an agent, a person, a timer or an integration. Read the outcome from the status.

Poll the status:

```sh
curl -s http://127.0.0.1:4310/api/runs/0936c687-21f8-4149-895d-260363837979
```

The status response has the same shape as the start response. Its fields:

- `status`: `queued`, `running`, `waiting`, `completed`, `failed` or `cancelled`. Only `completed` means the workflow succeeded. `failed` adds `error`.
- `stage`: the workflow's current named stage, or `null`.
- `waiting`: what the run is waiting for, or `null`. `kind` is one of `claim_queue`, `managed_launch`, `human_request`, `input_node`, `hold`, `pause`, `budget`, `resource`, `timer`, `poll` or `admission_queue`. `detail` identifies the node and, where relevant, the queue position, resume time or blockers.
- `actor`: who must act next. `agent` means an agent assignment or integration, `person` means every active branch needs someone in the UI, and `engine` means Interlock itself.

These are the same projection fields that the UI and MCP use; see [agent workflow operations](agent-workflows.md) for how `stage` rolls up from child runs. The response never includes the full run document, executions or events. Use MCP `get_run`, the CLI or the UI for full inspection.

A run needs something to do its work: a connected agent, a [managed harness](managed-executors.md), or a person answering in the UI. HTTP starts and observes runs; it does not claim assignments.

Once `status` is `completed`, fetch the output:

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

`?path=label` selects part of the output with dot-separated keys or array indices. Outputs larger than `maxBytes` (default 65536, at most 262144) are rejected with `400`; select a narrower path. Before completion the route answers `409` with code `run_not_completed` and the current status in `run`.

## Cancel a run

```sh
curl -s -X POST http://127.0.0.1:4310/api/runs/591c8feb-3818-4b96-a860-f242321e18cc/cancel
```

The response is the run's status, normally with `"status": "cancelled"`. Cancelling a run that already finished returns its final status unchanged. Cancellation stops at detached children and does not undo effects that Scripts, Fetch requests or agents already caused.

## Retry a start safely

Send a stable key with every start that might be repeated: in the `Idempotency-Key` header or as `requestId` in the body. If you send both, they must match. The key follows [idempotent run starts](idempotent-run-starts.md): 1 to 120 characters, case sensitive, unique across the library.

If the response is lost, send the same request again with the same key and the same body. Interlock returns the original run with `202` and does not create, advance or retry anything:

```sh
# Same key, same body: same runId
curl -s http://127.0.0.1:4310/api/runs -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: github-delivery-72d3c1' \
  -d '{"workflowId":"dba7ea93-3550-4a65-8b8e-29f938e34bbd","input":{"issue":"Login fails on Safari"}}'
```

Reusing a key with a different body is rejected and starts nothing:

```json
{
  "error": "Run start requestId was already used with different arguments; no run was started",
  "code": "conflict"
}
```

That is `409`, as is a key whose run was deleted from history. Use a new key for a deliberate new attempt. Without a key, every request starts another run.

## Errors

Errors are JSON with an `error` message and, from `/api` routes, a `code`. The `413` response is plain text.

| Status | Code                | When                                                                                      |
| ------ | ------------------- | ----------------------------------------------------------------------------------------- |
| 400    | `invalid_request`   | The body is not JSON, has unknown fields, or the input does not match the input contract. |
| 401    | none                | `INTERLOCK_REQUIRE_TOKEN=1` is set and the token is missing or wrong.                     |
| 403    | none                | The request used another host name or an untrusted browser origin.                        |
| 404    | `not_found`         | The workflow, run or route does not exist.                                                |
| 409    | `conflict`          | A start key was reused with different arguments or refers to deleted history.             |
| 409    | `run_not_completed` | A result was requested before the run completed.                                          |
| 413    | none                | The body exceeds 2 MiB.                                                                   |

Input that breaks the workflow's contract names the fields, as in the UI and MCP:

```sh
curl -s http://127.0.0.1:4310/api/runs -H 'Content-Type: application/json' \
  -d '{"workflowId":"dba7ea93-3550-4a65-8b8e-29f938e34bbd","input":{}}'
```

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

A missing workflow or run:

```sh
curl -s http://127.0.0.1:4310/api/runs/missing
```

```json
{ "error": "Run not found", "code": "not_found" }
```

Other rejections from the engine, such as an unpublished or archived workflow or a deleted version, return `400` with the engine's message.

## Choose HTTP or MCP

Use HTTP from code you own: a script, a cron job, a CI step or a small relay that receives another system's events. It needs only an HTTP client, starts work, and reads status and results.

Use [MCP](connect-harness.md) for agents. Agents need assignments, claims, result submission, briefings, waits, authoring and the rest of the tool set. MCP is also the better choice when a model decides which workflow to run.

## Translate an external event into a start

Interlock does not receive third-party webhooks itself. Run your own small receiver that checks the sender's signature, picks the fields the workflow needs, and calls `/api/runs`. Use the sender's delivery ID as the key so redeliveries reuse the first run:

```js
// A GitHub "issues" webhook relayed by your own server.
export async function onIssueEvent(event, deliveryId) {
  if (event.action !== 'opened') return;
  const response = await fetch('http://127.0.0.1:4310/api/runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `github:${deliveryId}`,
      // Authorization: `Bearer ${token}` when INTERLOCK_REQUIRE_TOKEN=1
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

Retry on network errors and `5xx` with the same key. Do not retry `400`, `404` or `409` unchanged. Keep the receiver on the same machine as Interlock; the API is not for public exposure. For starts on a timer or after another run, see [schedules](schedules.md) and [lifecycle event triggers](events.md).

## Compatibility

Interlock is pre-1.0. The supported HTTP API is the five routes above, the request fields listed for `POST /api/runs`, the response fields shown on this page, the status codes and the error `code` values. Within that contract:

- Patch releases can add routes, optional request fields, response fields, `waiting.kind` values and error codes. Ignore fields you do not know.
- Removing or renaming a supported field or route, or changing a status code, is a breaking change. It follows the [release rules](releases.md): it is flagged before the release bump is chosen and described in the changelog.

`/trpc` is the UI's internal transport and can change in any release. Do not build integrations on it.

An OpenAPI description is not published. With five routes, this page and curl cover discovery; workflow input contracts already arrive as JSON Schema from `GET /api/workflows`. A generated OpenAPI file becomes worthwhile if the API grows enough that typed client generation saves real work.
