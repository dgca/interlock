# Webhook trigger reference

A webhook trigger accepts authenticated JSON at `POST /hooks/:triggerId`. Triggers belong to a workflow, separately from its draft and published versions. New triggers start disabled.

The workflow's **Triggers** tab provides **Add webhook**, a JSON configuration editor, enable and disable controls, and paged delivery outcomes. CLI `interlock triggers` and MCP `read_workflow_triggers` and `manage_workflow_triggers` use the same shared API. `interlock schedules` remains an alias for trigger operations.

## Configuration

The following create request signs the raw body, takes delivery identity and event time from that body, and starts the latest published workflow version:

```json
{
  "action": "create",
  "workflowId": "WORKFLOW_ID",
  "config": {
    "kind": "webhook",
    "name": "Issue intake",
    "tags": { "repo": "dgca/interlock", "source": "webhook" },
    "authentication": {
      "secretId": "SECRET_VARIABLE_ID",
      "header": "x-signature",
      "algorithm": "sha256",
      "prefix": "sha256=",
      "parts": [{ "source": "body" }],
      "separator": "."
    },
    "deliveryId": { "source": "body", "path": "deliveryId" },
    "timestamp": { "source": "body", "path": "timestamp" },
    "timestampFormat": "iso",
    "timestampWindowMs": 300000,
    "filters": [
      { "value": { "source": "body", "path": "action" }, "equals": "opened" }
    ],
    "action": {
      "type": "start",
      "input": {},
      "bindings": { "event": { "source": "body", "path": "" } },
      "externalTask": {
        "system": { "source": "literal", "value": "github" },
        "id": { "source": "body", "path": "issue.id" },
        "url": { "source": "body", "path": "issue.url" }
      },
      "onActiveExternalTask": "reuse"
    },
    "maxBodyBytes": 65536,
    "rateLimit": { "maxRequests": 60, "windowMs": 60000 },
    "pauseAfterConsecutiveFailures": null
  }
}
```

`WORKFLOW_ID` and `SECRET_VARIABLE_ID` are local identities. The example expects an event whose `issue.id` is a string and whose `issue.url` is an HTTP or HTTPS URL. An empty body path selects the entire parsed body. Paths otherwise use dot-separated object keys or array indices, with no JSONPath expressions or prototype keys.

A binding selects a body path, a header name, or a literal JSON value. `action.bindings` maps destination paths into the input template. At most 64 paths may be supplied. Paths must not overlap, and bindings require an object input template. A missing required source rejects the delivery.

Optional top-level `config.tags` captures static tags for `action.type: "start"`, with the [ordinary tag bounds](idempotent-run-starts.md#tag-and-filter-runs). Tags are configuration, not body or header bindings. Other actions preserve the target run's existing tags. Active-task reuse keeps the reused run's tags.

## Authentication and signed time

`authentication.secretId` references an Interlock **Secret**, never a literal key or Config variable. Enablement requires an enabled, set, readable Secret and a retained published, unarchived workflow target. Each delivery uses the current Secret value, so rotation applies to subsequent deliveries without republishing. Disabled, unset, or locked Secrets reject delivery. Secret values never appear in trigger inspection or exports.

`authentication.algorithm` is `sha256` by default or `sha512`. The signature header contains the literal `prefix`, followed by a hexadecimal HMAC digest. The default prefix is `sha256=`. The prefix is independent of the algorithm, so SHA-512 configurations must specify the provider's prefix explicitly. Header names are case-insensitive.

`authentication.parts` defines the exact signed bytes, in order. It contains the raw request body exactly once, as the last part. Any preceding parts name distinct headers, and none may name the signature header. `separator` joins the parts and defaults to `.`. Header parts require a nonempty separator, and their values must not contain that separator. These constraints prevent changing the boundaries between signed fields. For material `<timestamp>.<body>`, the parts are:

```json
[{ "source": "header", "path": "x-event-time" }, { "source": "body" }]
```

The signature covers the original body bytes, including whitespace. Reformatting JSON after signing invalidates the signature. Signature verification precedes parsing and routing.

`deliveryId` and `timestamp` are mandatory body or header sources. Header sources must appear in `authentication.parts`. The same rule applies to every header used by filters, input bindings, or external-task mappings. A configuration with unsigned routing headers cannot be saved. A provider that signs only a body must include delivery identity and event time in that body.

`timestampFormat` accepts `iso`, `unix_seconds`, or `unix_ms`. The default is `iso`. The absolute difference between server time and signed event time must not exceed `timestampWindowMs`, so both stale and future events outside the window reject. The window defaults to five minutes and accepts 1000 through 86400000 milliseconds. Delivery identity must be a nonblank string or number of at most 500 characters when converted to text.

## Filters and actions

All configured filters must match their JSON `equals` value structurally, without coercion. A nonmatching event returns HTTP 202 with `code: "ignored"` and increments the ignored count. Delivery history stores no request payload.

| `action.type` | Result                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`       | Starts the latest retained published version with mapped input and optional `externalTask`. Uses ordinary run admission and `onActiveExternalTask`, default `allow`.             |
| `input`       | Submits mapped input to exactly one current waiting input execution in this trigger's workflow, selected by `externalTask` and exact `nodeId`.                                   |
| `cancel`      | Cancels active or queued runs in this trigger's workflow whose external-task system and ID match. Ordinary descendants cancel; detached runs retain their independent lifecycle. |
| `hold`        | Holds external-input acceptance for matching admitted runs and attached descendants. A queued match rejects the action.                                                          |

`externalTask` is required for `input`, `cancel`, and `hold`. Its `system` and `id` bindings must resolve to strings accepted by the ordinary external-task contract. Title and URL are optional. A non-default `onActiveExternalTask` policy requires an external task. The [run-start policy](idempotent-run-starts.md) owns `allow`, `reuse`, `reject`, and `cancel_previous` behavior, including library-wide active-task matching.

An input action requires `nodeId`. Its `input` template defaults to `{}`, with optional `bindings`. Zero or multiple current waiting matches reject with `input_target_not_unique`. The signed event time must be at or after the selected execution's `startedAt`. This prevents an old event from being delivered to a later visit to the same node. A successful submission returns `submitted`; it does not accept the revision or advance the input node. Existing [input acceptance controls](external-input.md) remain authoritative. Webhook cancellation retains ordinary detached boundaries. For an explicit operator action that also stops independent descendants, use [tree cancellation](workflow-execution.md#cancel-a-run-tree). A hold action does not cancel work or pause ordinary Agent and Script execution. Release uses the existing explicit input-hold operation.

Library and workflow named pause holds reject start, cancel, and hold actions. Pending input submissions remain allowed during a named pause, while acceptance remains blocked. Re-enabling a trigger clears its automatic failure pause and counter, while named holds remain effective. Disable and delete preserve existing runs. Trigger kind is fixed after creation.

## Receipts, limits, and outcomes

A successful or ignored authenticated delivery retains a receipt keyed by trigger identity and signed delivery identity. Starts use the deterministic request ID `hook:<receiptHash>`. Identical repeated signed material returns `duplicate` without repeating effects. Reusing a delivery identity with different signed material rejects with `delivery_id_conflict`. Signature and timestamp validity are checked on repeats. Receipts remain after delivery rows are trimmed and are removed with their trigger.

| Setting                         | Default          | Bounds                                |
| ------------------------------- | ---------------- | ------------------------------------- |
| `maxBodyBytes`                  | 65536            | 1 through 1048576 bytes               |
| `rateLimit.maxRequests`         | 60               | 1 through 10000 requests              |
| `rateLimit.windowMs`            | 60000            | 1000 through 3600000 milliseconds     |
| `filters`                       | Empty            | At most 32                            |
| Configuration JSON              |                  | At most 64 KiB                        |
| `pauseAfterConsecutiveFailures` | `null`, disabled | Whole number 1 through 10000 when set |

Rate accounting uses a persisted fixed window per trigger and precedes signature verification. Body limits apply to streamed bodies as well as declared content lengths. Rejections use HTTP 400 for invalid data, 401 for authentication or timestamp failures, 409 for disabled, paused, conflicting, or invalid action targets, 413 for excessive bodies, and 429 for rate limits. Unknown trigger IDs return 404.

Inspection pages delivery rows with a default of 20 and maximum of 100. Each trigger retains at most 200 recent rows. Rows contain outcome, status, code, receipt time, and optional event time or run reference. They exclude payloads, headers, signatures, and Secrets. `started` and `queued` describe admission rather than successful completion. A run may later fail.

Optional failure auto-pause observes failed triggered runs and action failures. It adds an independent **Needs attention** item with a reason. Authentication failures never auto-pause a valid trigger. Inspection reports consecutive failures and delivery, ignored, and rejected counts.

## Interfaces and listener boundary

The shared API uses `triggers.read` and `triggers.manage`. Read actions are `list`, `inspect`, `preview`, and `attention`; preview is for schedule timing only. List accepts optional `workflowId` and `kind: "webhook"` or `"schedule"`. Management actions are `create`, `update`, `enable`, `disable`, and `delete`. Create requires `workflowId` and `config`; other changes require the current `id` and `expectedRevision`. Update replaces the full configuration. Revision conflicts preserve the saved configuration.

The CLI accepts the same JSON requests, either inline or from a file:

```sh
interlock triggers manage @webhook.json
interlock triggers read '{"action":"list","kind":"webhook","workflowId":"WORKFLOW_ID"}'
interlock triggers read '{"action":"inspect","id":"TRIGGER_ID","limit":20}'
interlock triggers manage '{"action":"enable","id":"TRIGGER_ID","expectedRevision":1}'
```

MCP wraps each JSON request under `request` for `read_workflow_triggers` or `manage_workflow_triggers`. These operations manage configuration and inspect history. Event delivery uses the authenticated HTTP hook route.

The main server binds to `127.0.0.1`. Its hook route uses the same host and origin restrictions as its local UI and APIs. Optional `--hooks-port` opens a separate listener on `0.0.0.0`:

```sh
interlock --port 4310 --hooks-port 4311
```

The hooks port must be different from the main port. That listener mounts only `POST /hooks/:triggerId`; UI, tRPC, `/mcp`, health, and event routes return 404. A reverse proxy or tunnel can target the hooks port while the main listener remains loopback-only. The hooks listener supplies no TLS termination.

## Portable bundles

Format 7 adds webhook configurations with safe Secret requirements. Exports always set `enabled:false` and exclude delivery logs, receipts, rate windows, and other operational state. Import binds each Secret requirement to a local Secret or provisions it unset. Imported webhook triggers remain disabled, including identical or forced reimports. Enablement requires local Secret provisioning and inspection. Existing differing configurations require explicit `force`, and a trigger identity cannot change workflow or kind.
