# Check an Agent result before submission

Use MCP `preflight_result`, API `work.preflight`, or the CLI to check a candidate against its assignment's captured output contract:

```sh
interlock preflight WORK_ID TOKEN @candidate.json
```

The check also reads the current claim state. It does not accept a result, renew a lease, consume an attempt, process timers, or advance a run. A passing check does not reserve acceptance. `submit_result` checks the live claim and contract again in its submission transaction.

## Read the report

`accepted` is always `false` because the check accepts no new result. `alreadyAccepted` identifies an identical result accepted earlier. `claimUsable` describes the live claim at check time. `canSubmit` permits either a new valid submission or an identical completed replay.

| Code                                                                         | Next action                                                                                    |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ready`                                                                      | Submit before the lease expires.                                                               |
| `invalid_result`                                                             | Correct the listed fields, then check or submit again while the claim is usable.               |
| `already_accepted`                                                           | Read the result. Repeating the identical submission is safe.                                   |
| `completed_conflict`                                                         | Read the accepted result. A different result cannot replace it.                                |
| `expired`, `replaced`, `cancelled`, `inactive`, `invalid_claim`, `not_found` | Inspect the existing run and assignment before attempting recovery. Never reuse a stale token. |

Known expired-token receipts distinguish an expired claim from one replaced by a later active claim. Unknown tokens report `invalid_claim`. Receipt retention is bounded by existing lease-recovery rules. Cancelled work reports `cancelled` even after token invalidation.

`diagnostics` contains at most ten `items`, the full error `total`, and a `truncated` flag. Each item has a JSON Pointer `path`, a `schemaPath`, a JSON Schema `rule`, a corrective `message`, and `pathTruncated`. The empty pointer identifies the root value. Paths retain at most 256 characters plus an ellipsis. Messages exclude candidate values and contract enum values; consult the assignment's output schema for allowed values and limits. These are structural checks, not proof of implementation correctness.

## Handle rejected submissions

Submission success responses are unchanged. A rejected submission still fails, with structured `resultCheck` data in the API error, MCP error content, and CLI JSON error on stderr. The CLI exits nonzero. `accepted: false` means that call accepted no result; it does not erase any previously accepted result. Invalid contract results leave a live claim usable for correction. Expired, replaced, or cancelled claims require recovery instead.

CLI preflight prints the report and exits successfully when the check itself completes, including when `canSubmit` is false. Automation must inspect the report. API preflight uses a POST query through the shared client, avoiding URL limits for large candidates. The 2 MiB HTTP body limit includes the transport envelope.
