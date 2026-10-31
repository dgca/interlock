# Check an Agent result before submission

Use MCP `preflight_result`, API `work.preflight`, or the CLI to check a candidate against its assignment's captured output contract and optional result rules:

```sh
interlock preflight WORK_ID TOKEN @candidate.json
```

The check also reads the current claim state. It does not accept a result, renew a lease, consume an attempt, process timers, or advance a run. A passing check does not reserve acceptance. `submit_result` checks the live claim and contract again in its submission transaction.

## Read the report

`accepted` is always `false` because the check accepts no new result. `alreadyAccepted` identifies an identical result accepted earlier. `claimUsable` describes the live claim at check time. `canSubmit` permits either a new valid submission or an identical completed replay.

| Code                                                                                 | Next action                                                                                                              |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `ready`                                                                              | Submit before the lease expires.                                                                                         |
| `invalid_result`                                                                     | Follow nextAction: correct listed result fields, or inspect workflow routing/output mappings, while the claim is usable. |
| `already_accepted`                                                                   | Read the result. Repeating the identical submission is safe.                                                             |
| `completed_conflict`                                                                 | Read the accepted result. A different result cannot replace it.                                                          |
| `held`, `expired`, `replaced`, `cancelled`, `inactive`, `invalid_claim`, `not_found` | Inspect the existing run and assignment before attempting recovery. Never reuse a stale token.                           |

Known expired-token receipts distinguish an expired claim from one replaced by a later active claim. Unknown tokens report `invalid_claim`. Receipt retention is bounded by existing lease-recovery rules. Cancelled work reports `cancelled` even after token invalidation.

`diagnostics` contains at most ten `items`, the full error `total`, and a `truncated` flag. Each item has a JSON Pointer `path`, a `schemaPath`, a validation or result-processing `rule`, a corrective `message`, and `pathTruncated`. The empty pointer identifies the root value. Paths retain at most 256 characters plus an ellipsis. Messages exclude candidate values and contract enum values; consult the assignment's output schema for allowed values and limits. These are structural checks, not proof of implementation correctness.

## Handle rejected submissions

Submission success responses are unchanged. A rejected submission still fails, with structured `resultCheck` data in the API error, MCP error content, and CLI JSON error on stderr. The CLI exits nonzero. `accepted: false` means that call accepted no result; it does not erase any previously accepted result. Invalid contract results leave a live claim usable for correction. Expired, replaced, or cancelled claims require recovery instead.

CLI preflight prints the report and exits successfully when the check itself completes, including when `canSubmit` is false. Automation must inspect the report. API preflight uses a POST query through the shared client, avoiding URL limits for large candidates. The 2 MiB HTTP body limit includes the transport envelope.

## Check results against assignment input

Agent nodes accept up to 32 optional `resultRules`. Rules are captured with the assignment and published definition. Full assignments and claims include them; compact discovery omits them. In Agent settings, use **Result → Additional result checks** to add or remove checks.

```json
{
  "resultRules": [
    {
      "id": "revision",
      "kind": "equalsInput",
      "outputPath": "candidate",
      "inputPath": "candidate"
    },
    { "id": "evidence", "kind": "exists", "outputPath": "evidence.0" }
  ]
}
```

`exists` requires the output path to exist. JSON null counts as present. `equalsInput` requires both paths to exist and compares JSON structurally, without type coercion. Objects ignore property order; arrays retain item order. Two missing paths fail. Input paths select the assignment's captured resolved input after bindings, within its own run or Batch item scope.

Paths use the existing dot-separated keys and array indices. Blank paths or `$` select the whole value; `$.field` is also accepted. Paths have a 256-character limit and exclude prototype-related keys. Rule IDs have 1–64 characters after trimming and must be unique at publication. Definitions with duplicate IDs or paths excluded by supported closed contracts can be saved as drafts, but cannot publish. Complex schemas remain runtime checks rather than static proofs.

Preflight and submission share the evaluator. A failed rule returns `invalid_result`, retains a usable claim for correction, and does not dispatch downstream work. Diagnostics add `ruleId` and, for equality checks, `inputPath`. They retain the ten-item limit and never return compared values. A later publication or prompt edit cannot change existing captured rules or input. No rules preserves existing behavior. These checks validate structural obligations, not whether evidence or software claims are true.

Held work reports `held` with no usable claim. [Resume explicitly](work-holds.md), inspect external side effects, and obtain a fresh claim before submitting. A pre-hold token cannot regain result authority.

Result preflight also checks the pinned node’s result routing and output mappings without dispatching downstream work. Missing or unmatched result fields reject the candidate under the live claim. Mapping errors identify `#/outputBindings` and suggest `inspect_work`; an unavailable original source or earlier execution may require fixing the workflow. Routing reads the raw candidate before forwarding fields are built. See [Step data and result branches](node-data.md).
