# Compare workflow behavior

A workflow comparison executes two published versions on the same saved cases. Each side uses ordinary Agent assignments, scripts, Fetch requests, timers and child runs. Script and Fetch steps perform their usual external actions. Connected executors must claim Agent work. Publication and promotion remain separate operations.

## Save representative cases

Use `create_test_suite` with a workflow ID and named content:

```json
{
  "workflowId": "WORKFLOW_ID",
  "content": {
    "name": "Research checks",
    "cases": [
      {
        "id": "uncertain-request",
        "name": "Uncertain request",
        "sourceRunId": "SOURCE_RUN_ID",
        "assertions": [
          { "kind": "output", "path": "sources", "operator": "exists" },
          {
            "kind": "output",
            "path": "confidence",
            "operator": "gte",
            "expected": 0.5
          },
          { "kind": "route", "nodeId": "review", "visit": 1, "port": "human" }
        ],
        "qualityGuidance": "Assess evidence quality and whether uncertainty is explained."
      }
    ]
  }
}
```

Replace node IDs and ports with routes in both selected definitions. A source run must belong to the suite's workflow. Capture copies only its original input and identity provenance. Alternatively, provide explicit `input`, including JSON null. Provide exactly one of `input` or `sourceRunId`.

Use `list_test_suites` for compact discovery, and `get_test_suite` for full cases and the current revision. `update_test_suite` replaces content under that revision. Case IDs are stable and unique within a suite. Informational source metadata returned by reads is omitted when saving an explicit input case. Captured input survives source-run deletion. Existing comparisons retain their own suite revision and case snapshots.

## Preview and start a comparison

Call `preview_workflow_comparison` with `suiteId`, `suiteRevision`, `baselineVersion` and `candidateVersion`. Optional `repetitions` defaults to 1 and `concurrency` to 2. Preview is read-only. It lists exact root-run count, case input/assertion hashes, transitive version pins/hashes, current saved prompt revisions/hashes, and blockers. Five cases with one repetition produce ten roots, plus whatever children their definitions dispatch.

If `canStart` is true, call `start_workflow_comparison` with the same selection, its `confirmation`, and a caller-generated `requestId`. Start rechecks the plan transactionally. Changed suite/prompt revisions, pins or eligibility require another preview. Repeat identical arguments and request ID after a lost response to recover the same comparison. Conflicting reuse rejects without starting another experiment.

Use `list_work`, `claim_work`, `submit_result` and existing renewal/failure tools to perform Agent assignments. The testbench does not launch an executor. Exact published versions and current prompt captures persist across queued samples, delayed Batch items, child invocations and restart. Both sides use the same captured content for matching saved prompt IDs. This capture describes the prompt library at comparison start; it does not recover the library as it existed when an older definition was published. Ordinary runs retain their existing capture behavior.

## Inspect results and record quality

Use `list_workflow_comparisons` for progress and `get_workflow_comparison_report` for paged results. Each sample identifies its case, side, repetition, run URL and counterpart. Open these runs in the existing Runs UI to inspect graphs and full values. Comparison labels appear in run rows and inspection, with counterpart navigation. Suite editing and comparison controls remain MCP/shared-API operations.

Execution failures, structural checks and quality judgments are separate. A completed run can fail checks. A passed check does not establish semantic accuracy. Root observations are recorded after the execution tree finishes; later explicit retries do not silently rescore that evidence. Reports show current run status separately from the observed status. Missing underlying history is explicit.

Use `record_comparison_quality` with comparison `id`, `sampleId`, declared `reviewer` and `reviewerKind` (`human` or `agent`), explicit `rubric`, `score` from 0 to 5, and optional `notes`. Judgments are append-only and labeled by declared source. This operation neither launches an evaluator nor proves that a person reviewed an answer. Use `get_run_result` to read selected actual values without copying full history into a report.

## Reference

Shared server API operations are `testbench.suites`, `suite`, `createSuite`, `updateSuite`, `preview`, `start`, `comparisons`, `report`, `cancel` and `judge`. HTTP and stdio MCP register the same ten tools. No testbench CLI commands or dedicated dashboard are included.

Output assertions use `kind: "output"`, optional root-scope `nodeId`, positive `visit` (default 1), `path` (default empty), and `operator`. `exists` has no expected value. `equals` requires a JSON `expected` value and ignores object key order. `gte` and `lte` require numeric expected and actual values. Paths use Interlock's dot-separated object keys and array indices; an empty path selects the entire value. Route assertions require `kind: "route"`, `nodeId`, positive `visit` and expected `port`.

Only root-scope checkpoints are supported. Preview rejects unknown nodes, Batch-member selectors and undeclared ports in either definition. Batch/child execution remains supported. A present null passes an existence check. Missing paths on available output fail. Missing output, unvisited node visits, unfinished execution and unavailable history yield `unknown`; unknown never counts as pass. An unequal available output or route fails. Numeric comparison against a non-number fails. Individual reasons and execution errors are bounded to 512 characters in reports.

| Bound                     | Value                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Cases per suite           | 1–25, each input at most 64 KiB                                                                           |
| Assertions per case       | At most 50                                                                                                |
| Saved suite               | At most 1 MiB                                                                                             |
| Repetitions               | 1–10, default 1                                                                                           |
| Root runs per comparison  | At most 100                                                                                               |
| Concurrency               | 1–10 trees per comparison, default 2; ten globally                                                        |
| Active comparisons        | At most four, including cancelled comparisons with active descendants                                     |
| Capture                   | At most 64 transitive version pins and 64 prompts totaling 1 MiB                                          |
| Preview blockers          | At most 50 details, with exact `blockerCount`                                                             |
| Discovery                 | Limit 1–100, default 20, with exact total                                                                 |
| Report samples            | Limit 1–25, default 10; zero-based `offset`                                                               |
| Checks per sample page    | Limit 1–10, default 5; zero-based `checkOffset`                                                           |
| Judgments per report page | Limit 1–25, default 10; zero-based `judgmentOffset`                                                       |
| Quality judgments         | At most 1000 per comparison                                                                               |
| Report JSON               | At most 256 KiB; byte truncation returns exact totals, `truncated`, `nextOffset` and `nextJudgmentOffset` |

An active root and all its active descendants consume one concurrency slot, even after the root finishes. Completion waits for independent detached descendants too. `cancel_workflow_comparison` stops queued starts and uses ordinary cancellation for roots. Detached work remains independent by default; `cancelDetached: true` explicitly cancels that comparison's detached descendants as well. Reports retain counts and a bounded list of independent active run IDs. Use normal run inspection for the full tree. A cancelled experiment can still have independent active work.

In-flight comparisons protect their queued/active version pins from explicit version cleanup and workflow deletion. Once terminal, comparison observations remain available after permitted definition cleanup; graph inspection and retry follow the ordinary missing-definition rules. Guarded workflow deletion removes its local suites/comparisons and ordinary history. Portable workflow bundles exclude suites, comparisons, judgments and captured case data. Saved comparisons never rewrite definitions or automatically publish a winner.
