# Compare workflow behavior

A workflow comparison executes two published versions on the same saved cases. Each side uses ordinary Agent assignments, scripts, Fetch requests, timers and child runs. Script and Fetch steps perform their usual external actions. Connected executors must claim Agent work. Publication and promotion remain separate operations.

## Save representative cases

Use `save_test_suite` with `request.action: "create"`, a workflow ID and named content:

```json
{
  "request": {
    "action": "create",
    "workflowId": "WORKFLOW_ID",
    "content": {
      "name": "Research checks",
      "cases": [
        {
          "id": "uncertain-request",
          "name": "Uncertain request",
          "sourceRunId": "SOURCE_RUN_ID",
          "assertions": [
            {
              "kind": "output",
              "path": "sources",
              "operator": "exists"
            },
            {
              "kind": "output",
              "path": "confidence",
              "operator": "gte",
              "expected": 0.5
            },
            {
              "kind": "route",
              "nodeId": "review",
              "visit": 1,
              "port": "human"
            }
          ],
          "qualityGuidance": "Assess evidence quality and whether uncertainty is explained."
        }
      ]
    }
  }
}
```

Replace node IDs and ports with routes in both selected definitions. A source run must belong to the suite's workflow. Capture copies only its original input and identity provenance. Alternatively, provide explicit `input`, including JSON null. Provide exactly one of `input` or `sourceRunId`.

Use `read_test_suites` with `request: {"action":"list"}` for compact discovery, or `request: {"action":"get","id":"SUITE_ID"}` for full cases and the current revision. Use `save_test_suite` with `request.action: "update"`, `id`, `revision` and replacement `content` to save an existing suite. Updates require the revision and never implicitly create a suite. Case IDs are stable and unique within a suite. Informational source metadata returned by reads is omitted when saving an explicit input case. Captured input survives source-run deletion. Existing comparisons retain their own suite revision and case snapshots.

## Preview and start a comparison

Call `preview_workflow_comparison` with `suiteId`, `suiteRevision`, `baselineVersion` and `candidateVersion`. Optional `repetitions` defaults to 1 and `concurrency` to 2. Preview is read-only. It lists exact root-run count, case input/assertion hashes, transitive version pins/hashes, current saved prompt revisions/hashes, and blockers. Five cases with one repetition produce ten roots, plus whatever children their definitions dispatch.

If `canStart` is true, call `start_workflow_comparison` with the same selection, its `confirmation`, and a caller-generated `requestId`. Start rechecks the plan transactionally. Changed suite/prompt revisions, pins or eligibility require another preview. Repeat identical arguments and request ID after a lost response to recover the same comparison. Conflicting reuse rejects without starting another experiment.

Use `list_work`, `claim_work`, `submit_result` and existing renewal/failure tools to perform Agent assignments. The testbench does not launch an executor. Exact published versions and current prompt captures persist across queued samples, delayed Batch items, child invocations and restart. Both sides use the same captured content for matching saved prompt IDs. This capture describes the prompt library at comparison start; it does not recover the library as it existed when an older definition was published. Ordinary runs retain their existing capture behavior.

## Inspect results and record quality

Use `read_workflow_comparisons` with `request.action: "list"` for compact progress, or `request: {"action":"report","id":"COMPARISON_ID"}` for paged results. Each sample identifies its case, side, repetition, run URL and counterpart. Open these runs in the existing Runs UI to inspect graphs and full values. Labels include the short comparison ID, suite, case, side and repetition. Comparison labels appear in run rows and inspection, with counterpart navigation. Suite editing and comparison controls remain MCP/shared-API operations.

Execution failures, structural checks and quality judgments are separate. A completed run can fail checks. A passed check does not establish semantic accuracy. Root observations are recorded after the execution tree finishes; later explicit retries do not silently rescore that evidence. Reports show current run status separately from the observed status. Missing underlying history is explicit.

Use `update_workflow_comparison` with a `request` containing `action: "record_quality"`, comparison `id`, `sampleId`, declared `reviewer` and `reviewerKind` (`human` or `agent`), explicit `rubric`, `score` from 0 to 5, and optional `notes`. Judgments are append-only and labeled by declared source. This operation neither launches an evaluator nor proves that a person reviewed an answer. Use `get_run_result` to read selected actual values without copying full history into a report.

Reports identify each evaluated assertion from the captured suite revision. Expected values up to 1 KiB appear inline; larger values set `expectedOmitted: true`. Use `read_workflow_comparisons` with a `request` containing `action: "case"`, `id` from `assertionRef.comparisonId` and `caseId` from `assertionRef.caseId` to read the immutable full case, including input, expectations and quality guidance. This explicit read is bounded by the 1 MiB suite limit. `read_test_suites` with `request.action: "get"` reads the current editable revision, which may differ from the comparison snapshot.

## Reference

Shared server API operations are `testbench.suites`, `suite`, `createSuite`, `updateSuite`, `preview`, `start`, `comparisons`, `report`, `case`, `cancel` and `judge`. HTTP and stdio MCP register the same six tools:

| Tool                          | Actions                    |
| ----------------------------- | -------------------------- |
| `read_test_suites`            | `list`, `get`              |
| `save_test_suite`             | `create`, `update`         |
| `preview_workflow_comparison` | Read-only preview          |
| `start_workflow_comparison`   | Confirmed execution        |
| `read_workflow_comparisons`   | `list`, `report`, `case`   |
| `update_workflow_comparison`  | `cancel`, `record_quality` |

The four grouped tools require a `request` object with one explicit `action`. Each action accepts only its own fields. Read actions cannot save or execute work. Preview and start retain their separate top-level parameters. These tools expose the shared operations above without changing their behavior. No testbench CLI commands or dedicated dashboard are included.

Output assertions use `kind: "output"`, optional root-scope `nodeId`, positive `visit` (default 1), `path` (default empty), and `operator`. `exists` has no expected value. `equals` requires a JSON `expected` value and ignores object key order. `gte` and `lte` require numeric expected and actual values. Paths use Interlock's dot-separated object keys and array indices; an empty path selects the entire value. Route assertions require `kind: "route"`, `nodeId`, positive `visit` and expected `port`.

A Script or Fetch execution that follows its configured Failed route retains status `failed`. Its recorded route can satisfy a route assertion. Output assertions against that failed node remain `unknown`; check the recovery step or run output instead.

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

An active root and all its active descendants consume one concurrency slot, even after the root finishes. Explicit retries that would add an active tree reject before mutation when per-comparison or global capacity is full, including four active comparisons. Retry after another tree finishes. Retrying within an already active tree uses its existing slot. Completion waits for independent detached descendants too. `update_workflow_comparison` with a `request` containing `action: "cancel"` and comparison `id` stops queued starts and uses ordinary cancellation for roots. Detached work remains independent by default; `cancelDetached: true` explicitly cancels that comparison's detached descendants as well. Reports retain counts and a bounded list of independent active run IDs. Use normal run inspection for the full tree. A cancelled experiment can still have independent active work.

In-flight comparisons protect their queued/active version pins from explicit version cleanup and workflow deletion. Once terminal, comparison observations remain available after permitted definition cleanup; graph inspection and retry follow the ordinary missing-definition rules. Guarded workflow deletion removes its local suites/comparisons and ordinary history. Portable workflow bundles exclude suites, comparisons, judgments and captured case data. Saved comparisons never rewrite definitions or automatically publish a winner.

Cases may also contain ordered `fixtures` for [workflow simulation](workflow-simulation.md). Simulations use a separate report store and perform no model calls or Script/Fetch effects. Live comparisons ignore fixtures and retain their normal execution behavior. The CLI `test-suite` command supports create/update/get/list for the same saved cases.
