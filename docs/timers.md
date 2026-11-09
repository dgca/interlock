# Timers

## Wait nodes

A duration or timestamp Wait receives JSON and returns that same value when its deadline arrives. Its input and output contracts both apply.

Use a duration in milliseconds:

```json
{
  "id": "pause",
  "kind": "wait",
  "label": "Wait ten minutes",
  "timing": { "kind": "duration", "ms": 600000 }
}
```

Durations must be whole milliseconds and range from zero through 31,536,000,000 milliseconds, or 365 days. Omitting `timing` defaults to one minute. Zero resumes immediately.

To select an absolute deadline from input, use:

```json
{
  "id": "pause",
  "kind": "wait",
  "label": "Wait until due",
  "timing": { "kind": "until", "path": "dueAt" }
}
```

For example, input can contain `{"dueAt":"2026-09-12T09:00:00-06:00"}`. Paths use dot-separated keys or array indices; blank selects the whole input. A timestamp must include the date, time with seconds, and a timezone. Missing paths or invalid timestamps fail the step. A past deadline resumes immediately. The runtime selects the timestamp once and persists it as `resumeAt` on the execution.

The Wait editor suggests text fields and fields of unknown type from the input contract. You can still enter any path; suggestions do not change the runtime timestamp check.

Duration and timestamp Waits have one `default` output route. It can appear inside a Batch item path. Each waiting item occupies its concurrency slot until it finishes.

## Polling waits

A Wait can also wait for something slow outside Interlock: an environment bootstrap, a CI run, a job in another system. The slow work runs on its own; the Wait only runs a short **check** on an interval until the check's result matches.

A Script check receives the Wait's execution ID and a check number that starts at 1. See [Script execution context](architecture.md#script-execution-context).

```json
{
  "id": "lab-up",
  "kind": "wait",
  "label": "Wait until the lab is up",
  "timing": {
    "kind": "poll",
    "everyMs": 120000,
    "timeoutMs": 5400000,
    "check": {
      "kind": "script",
      "language": "bash",
      "command": "if [ -f /tmp/lab.exit ]; then echo '{\"ready\":true}'; else echo '{\"ready\":false}'; fi",
      "timeoutMs": 30000
    },
    "path": "ready",
    "equals": true
  }
}
```

- `check` is a Script (`command`, optional `language`, `timeoutMs`) or a Fetch (`url`, `method`, `query`, `headers`, `body`, `timeoutMs`, `failOnHttpError`). Both check types default to a 30-second timeout and accept 100 milliseconds through 120 seconds. A Script reads the step input on stdin or as `input`. A Fetch binds it into the request.
- The server runs the first check as soon as the step starts, then every `everyMs` milliseconds (1,000 through 365 days; default 60,000) after each check finishes. No worker is involved.
- The step continues when the check output at `path` structurally equals `equals`, as a Condition compares. The output is the step input with the check output merged over it when both are objects; otherwise it is the check output alone. The output contract applies to that value. A matched check whose completion output violates the contract fails the step; its successful check output remains available for inspection.
- A check that fails (non-zero exit, check timeout, a Fetch binding or request error, or an HTTP error with `failOnHttpError`) is recorded on the execution and runs again at the next interval. A passing check whose output has no value at `path` fails the step, as a missing path fails a Condition. A Fetch check with declared resources waits for remote-stop reconciliation after a timeout or transport failure leaves the remote outcome unknown; it does not repeat automatically.
- `timeoutMs` (1 ms through 365 days) sets a deadline from the step's start. The deadline aborts any in-flight check and ignores late results. Once the deadline has elapsed, even a matching result takes Timeout. At the deadline the step follows its `timeout` route with the original input, without applying the output contract. Publication requires the `timeout` edge when `timeoutMs` is set and rejects it otherwise.
- The schedule persists: `nextCheckAt` (also exposed as `resumeAt`), `timeoutAt`, and the latest `check` with its `count`, `at`, and `output` or `error`. A restart re-runs an overdue check, so checks should be idempotent probes. A check with declared resources waits for exact stopped reconciliation if interrupted ownership is uncertain. Cancellation aborts a check in flight.
- Optional Wait `resources` reserve named resources for each probe, releasing between checks. Resource queue time spends neither probe timeout nor the overall Wait timeout. When contention ends during a named pause, the overall deadline resumes its ordinary wall-clock behavior. See [step resources](work-resources.md).
- One execution counts once against `maxSteps` however many checks run, unlike a Wait → Script → Switch loop, which spends three steps per iteration.

In the editor, choose **When a check passes**, pick Script or Fetch, set **Check every**, the **Check output field**, and the value to continue on, and optionally **Give up after a deadline**. Disabling the deadline or switching to a duration or timestamp Wait removes the outgoing Timeout connection when changes are applied; the destination node remains. Raw JSON and MCP edits must remove that edge explicitly. The run inspector shows the next check time and the latest check result.

## Claimed Agent leases

Set **Claim lease** in Agent settings, or `leaseSeconds` in the node definition, to a whole number from 10 through 3600 seconds. An explicit claim duration overrides this published setting; when both are omitted the duration is 300 seconds. Workers must renew before `leaseUntil`. Omitted renewals reuse the original effective claim duration. Longer leases give workers more time but delay recovery from abandoned claims.

Expiry records `work.lease_expired` and consumes the separate `maxLeaseExpiries` budget when configured, otherwise the combined `maxAttempts` budget. Inspect the run before reclaiming available work or explicitly retrying a failed step; external work may already have happened. Expired tokens cannot renew or submit a result. See [claim duration and expiry](agent-workflows.md#claim-duration-and-expiry).

## Unclaimed Agent timeouts

`unclaimedTimeoutMs` is an optional integer and ranges from one millisecond through 365 days. Omitting it preserves indefinite waiting for a claim.

```json
{
  "id": "reply",
  "kind": "agent",
  "label": "Review request",
  "prompt": "Review the request and return your decision.",
  "unclaimedTimeoutMs": 259200000
}
```

A timed Agent requires two outgoing edges:

```json
[
  {
    "id": "answered",
    "source": "reply",
    "port": "default",
    "target": "continue"
  },
  {
    "id": "unanswered",
    "source": "reply",
    "port": "timeout",
    "target": "remind"
  }
]
```

The editor labels these handles **Result** and **Timeout**. Result carries the submitted answer and enforces the Agent output contract. Timeout carries the original input, without applying the answer contract; the destination's input contract still applies. The timeout execution completes successfully and records `port: "timeout"`. Its assignment becomes `timed_out` and is no longer claimable.

The deadline starts when work becomes available and appears as `availableUntil` on the assignment. Claiming stops the timer. If a failed or expired claim can be retried, a new full unclaimed interval starts when the assignment becomes available again. An exhausted failure or expiry budget fails the run instead. Renewal does not extend the optional `maxExecutionMs` active execution limit. Without that setting, there is no total execution ceiling. Claiming for manual completion also stops the timer, so this is a deadline to pick up work, not a deadline to submit an answer. If the timeout wins a claim race, the claim fails. The old assignment cannot accept a late reply; inspect the existing run to find its current work.

Drafts may omit routes. Publication requires both Agent routes when `unclaimedTimeoutMs` is set and rejects a `timeout` edge when it is absent. Removing the setting in Raw JSON or through MCP does not remove its edge automatically.

In the editor, disabling the timeout removes its outgoing Timeout edge when settings are applied. The destination node remains in the draft. Reconnect or remove any disconnected steps before publication.

## Inspect timer state

Use `get_run_briefing` for current blockers and active deadlines, then `wait_for_run_change` with its cursor for a finite wait. These reads do not advance timers. Polling blockers include `nextCheckAt`, optional `timeoutAt`, and latest check metadata (`count`, `at`, optional `error`) without check output. Active polling deadlines have kinds `poll_check` and `poll_timeout`; `nextDeadline` selects the earliest across all timer kinds. Use `get_run` to inspect the latest probe output. See [continuation fields, cursor recovery, and cancellation](agent-workflows.md#resume-a-run-with-a-briefing).

`get_run` returns the root run, its executions, descendants, assignments, and events. Timer state appears in these fields:

| Field                                                       | Meaning                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Wait execution `status: "waiting"` and `resumeAt`           | For duration or timestamp Waits, the persisted ISO deadline; for polling, the next check time. |
| Wait execution `nextCheckAt`, `timeoutAt`, `check`          | A polling Wait: its next check, its deadline, and the latest check result.                     |
| Assignment `status: "available"` and `availableUntil`       | Work can be claimed before its ISO deadline.                                                   |
| Assignment `status: "timed_out"`                            | Nobody claimed this availability interval before the deadline.                                 |
| Agent execution `status: "completed"` and `port: "timeout"` | The step followed Timeout with the original input.                                             |

A completed timeout step does not mean the whole run completed. The next step can still be running or waiting. Deadlines remain in execution history after completion or cancellation, so status determines whether a deadline is active. Claiming clears `availableUntil`; releasing work for another attempt sets a new value.

The runtime records `node.waiting` when a Wait starts, `node.timed_out` when a polling deadline expires, and `work.timed_out` when an unclaimed deadline expires. `list_work` includes only available assignments. An empty list can mean a Wait is active or another executor holds a claim. The CLI exposes the same data through `interlock run RUN_ID` and `interlock work RUN_ID`.

## Persistence and step budgets

The engine checks deadlines on its one-second server tick and during operations that advance runs. Deadlines are earliest continuation times, not exact scheduling guarantees. Stopping the server pauses execution; restarting processes overdue deadlines. Wait and unclaimed deadlines survive restarts. Editing or publishing a draft does not change an existing run or its deadline. A retried failed Wait creates a new execution: durations start again, and timestamp paths resolve again from the saved input. Cancellation prevents later timer continuation, including in child runs.

A waiting execution consumes one step regardless of how long it waits or how many times the engine checks it. Re-entering that node through a loop creates another execution and consumes another step. Agent claim attempts reuse an execution. An explicit retry that creates a new execution consumes another step.

`maxSteps` defaults to 100 and allows 2 through 1000 executions per run. Entry and Exit count. Each Batch item and referenced workflow has its own budget; item work does not consume the parent's budget. Batch `maxItems` independently allows 1 through 10,000 items and defaults to 200; concurrency allows up to 50 active items. Step-limit errors name the limit and node. With the `all` failure policy, a failed item fails its Batch and reports the number of completed items. With `collect`, the Batch returns per-item statuses and errors instead.

Timer fields are optional additions to persisted records and require no data migration. Existing Agent definitions without `unclaimedTimeoutMs` retain indefinite waiting. Timers pause existing runs; they do not schedule new or recurring runs. For repeated Agent work, [continuing Exits](continue-as-new.md) explicitly pass checkpoints to bounded successor runs with fresh step budgets; reaching maxSteps never triggers rollover automatically.

[External holds](work-holds.md) suspend the remaining unclaimed timeout of available Agent work. Holding claimed work invalidates its lease; resumption starts a full unclaimed interval. Budget blocking can keep that interval suspended after resumption. No lease or unclaimed timeout advances while held, and a deadline that has already elapsed wins before a hold.

An Agent with [result routing](node-data.md) connects its configured success branches and the independent Timeout port. Timeout sends the original input and bypasses result routing and output mappings.

## Stall detection and active attempt deadlines

All four stall thresholds are opt-in. Each accepts whole milliseconds from 1 through 2,592,000,000, or 30 days. Each field inherits independently from its applicable node to workflow definition to local library settings. Agent nodes expose unclaimed, claimed-idle and transition clocks; Input nodes expose human-wait and transition clocks; other nodes expose transition clocks. Omission inherits. Explicit `null` disables an inherited threshold. Existing definitions have no stall monitoring unless a library default is configured.

| Field                | Clock                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `unclaimedStallMs`   | Active time an Agent assignment remains available. A failed attempt starts another availability interval.                       |
| `claimedIdleStallMs` | Active time since the latest claim, managed progress callback, or successful renewal.                                           |
| `humanWaitStallMs`   | Active time waiting at an unheld External input node, including acceptance. The caller can be a person or an integration.       |
| `runStallMs`         | Active time without a transition or progress. Queued admission, intentional Wait nodes and active waited children are excluded. |

Named library and workflow pauses, declared assignment holds, managed `needs_human` permission/question intervals and External input acceptance holds freeze these clocks. Overlapping intervals count once. `humanWaitStallMs` does not alert merely because an explicitly declared `needs_human` hold remains unanswered. It observes unheld input nodes and does not change their actor classification.

Crossing a threshold creates a durable `stalled` Needs attention reason and a `stalled` lifecycle event. Attention links to the execution and reports the threshold. It does not fail, claim, resume or reclassify the run. Progress or a change of waiting interval resolves the current item. A later stall emits a new event. The one-second pump observes thresholds, so detection can occur after the exact crossing time. Events survive restart. Configure a `kind: "event"` trigger with `events: ["stalled"]` to start a handler workflow. See [lifecycle event triggers](events.md) for source scopes, compact payloads and causal-chain limits.

Library settings are local and revision protected. In the UI, open **Harnesses → Execution settings** and edit **Stall detection**. Workflow settings and each node's **Stall detection** section provide overrides. The same operations use `stalls.settings/configure/inspect` in the shared API, `manage_stalls` in MCP and `interlock stalls` in the CLI. Inspection returns current records with `offset`, default `limit:20`, maximum `100`, exact `total` and `nextOffset`, without task payloads or claim tokens.

```sh
interlock stalls
interlock stalls '{"action":"configure","expectedRevision":0,"policy":{"unclaimedStallMs":300000,"claimedIdleStallMs":600000}}'
interlock stalls '{"action":"inspect","runId":"RUN_ID","limit":20}'
```

Use the revision returned by settings when replacing `policy`. An empty policy disables library defaults. Library changes affect current monitoring; existing runs retain their published workflow and node overrides. Portable workflow bundles carry those authored fields, and exclude library settings and runtime stall history.

An Agent can separately set `maxExecutionMs`, a whole number from 1 through 2,592,000,000. It bounds total active wall-clock duration per successful claim attempt. It has no inherited default. Claim responses and briefings expose the configured limit; full assignments also expose `claimedAt` and `lastActivityAt`. The Run Inspector shows the attempt limit.

The deadline excludes the same pause and declared-hold intervals and persists across restart. Lease renewals, H7 continuation turns and transient retries in the same claim do not reset it. A new claim attempt receives a new start time. Deadline expiry records `work.execution_timed_out`, rejects late results and renewals, and spends the ordinary failure allowance. Resource ownership becomes uncertain until the previous worker is confirmed stopped. A deadline cannot prove external processes stopped. The existing failure/lease/claim-count budgets and managed reconciliation gates still apply. This limit does not add a Timeout route or change unclaimed timeout routing.

When a managed attempt reaches its active deadline, Interlock revokes its claim, requests a launcher stop when supported, and exposes recovery attention. A retryable assignment stays held until the operator confirms the old session and subprocesses stopped through managed reconciliation. A spent ticket cannot claim again; a new ticket is issued only after reconciliation. Deadline failure and claim budgets are preserved. An exhausted attempt can still need stop/resource reconciliation.

For a local Git trial, an execution deadline ends the sample even when ordinary attempts remain. The deadline spends failure allowance and preserves uncertain workspace ownership. Cleanup stays blocked until an explicit `quiescent:true` confirmation. A deadline does not establish that an external worker stopped.

Holding an available assignment preserves the accumulated eligible unclaimed-stall interval. Holding a claimed assignment ends that interval; resumption starts a fresh availability clock, excluding its earlier claimed execution. Current stall monitoring and attention use an indexed unresolved-record query. Resolved records remain retained for explicit history inspection and cleanup.
