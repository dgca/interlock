# Continue as new

A continuing Exit completes one run and atomically creates one standalone successor using its checkpoint as input. Each successor uses the same published workflow version and the first run's captured saved prompts, with a fresh `maxSteps` allowance. This supports recurring Agent work that carries compact state between iterations.

For repeated Script or Fetch checks that only wait for a condition, prefer a [polling Wait](timers.md#polling-waits). It already uses one execution regardless of check count.

## Configure an Exit

Enable **Continue as new** in the Exit settings and set **Maximum runs in chain**, or use this definition node:

```json
{
  "id": "continue",
  "kind": "exit",
  "label": "Continue research",
  "continueAsNew": { "maxRuns": 100 }
}
```

`maxRuns` is required, an integer from 2 through 10,000, including the first run. All continuing Exits in the same definition must agree. Normal Exits can coexist with continuing Exits; route to a normal Exit when work is finished. Neither reaching `maxSteps` nor failing a step triggers continuation automatically.

The Exit receives the incoming JSON unchanged. Use an earlier Script or Agent to produce a compact checkpoint such as `{lastSeenId, findingsSummary, nextCheckAt}`. Exit node input/output constraints still apply, and the checkpoint must match the workflow's `inputSchema`. The final workflow `outputSchema` applies only to normal Exits.

The predecessor completes only after input validation and durable successor creation succeed in one transaction. It has no final run output; the completed Exit execution stores the checkpoint. Invalid successor input, persistence failure, or exhaustion of `maxRuns` leaves a failed predecessor with its attempted checkpoint in the Exit input and creates no successor. Ordinary retry retains the same cap and definition; it cannot repair an invalid checkpoint or raise the chain limit. Inspect and preserve the checkpoint before deciding how to recover.

## Execution scope

The initial implementation supports standalone workflow runs. Invoking a workflow containing a continuing Exit from a Workflow node fails before creating its child. Live comparisons and fixture simulations do not support continuing Exits. A standalone continuing workflow may use Batches; item paths keep their existing behavior and cannot contain continuing Exits.

The successor starts at Entry with its checkpoint as both `runInput` and `rootInput`. Earlier node outputs and run-local continuity groups do not cross the handoff. A harness can reuse its own session, but Interlock does not restore agent sessions. New published versions and prompt edits do not change the chain's captured version or prompts.

A chain is separate from child ancestry and does not consume nesting levels. Every run has `chain:{rootRunId,index,previousRunId?,nextRunId?}`. The first index is 1. Full run inspection additionally returns compact `chain` state with `latestRunId`, `runCount`, `maxRuns`, `latestStatus`, and optional `cancelledAt`. The run inspector links previous/next members and can stop the chain.

The engine yields after one rollover per chain per pump call. Successor work can therefore appear on the next timer tick. An immediately repeating definition cannot create its entire chain in one pump. Cancellation and run/chain records survive restart; a committed handoff is not replayed. Failed successors are never automatically retried.

## Budgets and usage

Continuation renews step history, not spending allowances. Every [run budget](run-budgets.md) scope includes all members of the chain containing its anchor run. `run` counts those members alone; `lifecycle` adds ordinary descendants of every member, and `tree` also includes detached descendants. A policy installed on a later member still counts earlier retained chain history. Every applicable policy must permit a claim. Disabling a successor's local policy cannot bypass a predecessor's policy.

Agent claim gates retain their existing behavior: scripts, waits and successor creation can continue while Agent claims are blocked. The finite chain cap also bounds chains without Agent work. Reported usage remains optional and can arrive late.

Usage queries still default to one run. Set `includeChain:true` on `get_run_usage`, `runs.usage`, or CLI usage options to include all chain members. `includeDescendants:true` then adds all their descendants, including detached runs, once each. Existing source selection, coverage and pagination rules apply.

## Inspect and stop a chain

Use existing tools, without restarting a run:

- `get_run` reads lineage, the checkpoint execution and the latest chain state.
- `list_runs` accepts `chainRootRunId` and retains its existing status and limit filters.
- Briefings and compact start/submission responses expose run chain links. `next:continue_as_new` means follow the returned `nextCall` to the successor's briefing, even though the predecessor completed. A briefing is a snapshot of one run and its children, not the whole chain's execution history.
- `cancel_run` defaults to `scope:"run"`, preserving existing cancellation. Explicit `scope:"chain"` accepts any member ID, including a completed predecessor, stops the latest run and prevents further continuation or retries. Detached descendants remain independent under either scope. Cancellation never changes already completed predecessor outcomes.

CLI equivalents:

```sh
interlock runs --chain ROOT_RUN_ID --limit 50
interlock run RUN_ID
interlock usage RUN_ID '{"includeChain":true,"includeDescendants":true,"groupBy":"attempt"}'
interlock budget RUN_ID
interlock cancel RUN_ID --chain
```

The shared API uses `runs.find({chainRootRunId})`, `runs.get({id})`, and `runs.cancel({id,scope:"chain"})`.

## Retention and limits

Rollover bounds each run's history, not the total database size. Runs, checkpoints, work and usage remain retained. Execution reads active run documents without deserializing completed execution histories, but SQLite scans and usage/budget aggregation still grow with retained data. The 10,000-run validation bound is not a throughput guarantee or an indefinite monitoring service.

Deleting a workflow's history also removes its chain records. Active successors block deletion and protect their published definitions through existing cleanup rules. Portable workflow bundles include Exit configuration and exclude execution chains. Chain records use an additive `runChains` collection and optional run fields; no database schema migration is needed.

Recurring scheduling, chain pause/resume, automatic checkpoint repair, automatic successor retry, and history pruning are outside this change.
