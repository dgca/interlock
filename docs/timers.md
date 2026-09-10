# Timers

## Wait nodes

A Wait receives JSON and returns that same value when its deadline arrives. Its input and output contracts both apply.

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

Wait has one `default` output route. It can appear inside a Batch item path. Each waiting item occupies its concurrency slot until it finishes.

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

The deadline starts when work becomes available and appears as `availableUntil` on the assignment. Claiming stops the timer. If a failed or expired claim can be retried, a new full unclaimed interval starts when the assignment becomes available again. An exhausted attempt limit fails the run instead. Renewal does not have a total execution ceiling. Claiming for manual completion also stops the timer, so this is a deadline to pick up work, not a deadline to submit an answer. If the timeout wins a claim race, the claim fails. The old assignment cannot accept a late reply; inspect the existing run to find its current work.

Drafts may omit routes. Publication requires both Agent routes when `unclaimedTimeoutMs` is set and rejects a `timeout` edge when it is absent. Removing the setting in Raw JSON or through MCP does not remove its edge automatically.

In the editor, disabling the timeout removes its outgoing Timeout edge when settings are applied. The destination node remains in the draft. Reconnect or remove any disconnected steps before publication.

## Inspect timer state

`get_run` returns the root run, its executions, descendants, assignments, and events. Timer state appears in these fields:

| Field                                                       | Meaning                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| Wait execution `status: "waiting"` and `resumeAt`           | The step is waiting until its persisted ISO deadline.          |
| Assignment `status: "available"` and `availableUntil`       | Work can be claimed before its ISO deadline.                   |
| Assignment `status: "timed_out"`                            | Nobody claimed this availability interval before the deadline. |
| Agent execution `status: "completed"` and `port: "timeout"` | The step followed Timeout with the original input.             |

A completed timeout step does not mean the whole run completed. The next step can still be running or waiting. Deadlines remain in execution history after completion or cancellation, so status determines whether a deadline is active. Claiming clears `availableUntil`; releasing work for another attempt sets a new value.

The runtime records `node.waiting` when a Wait starts and `work.timed_out` when an unclaimed deadline expires. `list_work` includes only available assignments. An empty list can mean a Wait is active or another executor holds a claim. The CLI exposes the same data through `interlock run RUN_ID` and `interlock work RUN_ID`.

## Persistence and step budgets

The engine checks deadlines on its one-second server tick and during operations that advance runs. Deadlines are earliest continuation times, not exact scheduling guarantees. Stopping the server pauses execution; restarting processes overdue deadlines. Wait and unclaimed deadlines survive restarts. Editing or publishing a draft does not change an existing run or its deadline. A retried failed Wait creates a new execution: durations start again, and timestamp paths resolve again from the saved input. Cancellation prevents later timer continuation, including in child runs.

A waiting execution consumes one step regardless of how long it waits or how many times the engine checks it. Re-entering that node through a loop creates another execution and consumes another step. Agent claim attempts reuse an execution. An explicit retry that creates a new execution consumes another step.

`maxSteps` defaults to 100 and allows 2 through 1000 executions per run. Entry and Exit count. Each Batch item and referenced workflow has its own budget; item work does not consume the parent's budget. Batches independently permit at most 200 items and 50 concurrent items. Step-limit errors name the limit and node; With the `all` failure policy, a failed item fails its Batch and reports the number of completed items. With `collect`, the Batch returns per-item statuses and errors instead.

Timer fields are optional additions to persisted records and require no data migration. Existing Agent definitions without `unclaimedTimeoutMs` retain indefinite waiting. Timers pause existing runs; they do not schedule new or recurring runs.
