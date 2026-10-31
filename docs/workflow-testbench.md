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

Call `preview_workflow_comparison` with `suiteId`, `suiteRevision`, `baselineVersion` and `candidateVersion`. Optional `repetitions` defaults to 1 and `concurrency` to 2. Preview is read-only. It lists exact root-run count, case input/assertion hashes, transitive version pins/hashes, selected saved prompt revisions/hashes, per-side identities/differences, and blockers. Five cases with one repetition produce ten roots, plus whatever children their definitions dispatch.

If `canStart` is true, call `start_workflow_comparison` with the same selection, its `confirmation`, and a caller-generated `requestId`. Start rechecks the plan transactionally. Changes to selected prompt content, suite revisions, pins or eligibility require another preview. Current library edits leave explicitly selected retained revisions unchanged. Repeat identical arguments and request ID after a lost response to recover the same comparison. Conflicting reuse rejects without starting another experiment.

Use `list_work`, `claim_work`, `submit_result` and existing renewal/failure tools to perform Agent assignments. The testbench does not launch an executor. Exact published versions and selected prompt captures persist across queued samples, delayed Batch items, child invocations and restart. By default, both sides capture current content for matching saved prompt IDs. This does not recover the library as it existed when an older definition was published. Ordinary runs retain their existing capture behavior.

## Select exact side configurations

To compare a prompt change, include `configurations` in preview and start. Each side can supply a complete `promptRevisions` manifest covering every saved prompt referenced by its root and transitive child definitions. Omit the manifest to use current content for that side. An explicit empty array is valid only when the side uses no saved prompts. Extra, duplicate, missing or unavailable revisions reject before work starts.

```json
{
  "suiteId": "SUITE_ID",
  "suiteRevision": 1,
  "baselineVersion": 1,
  "candidateVersion": 2,
  "configurations": {
    "baseline": {
      "promptRevisions": [{ "id": "PROMPT_ID", "revision": 1 }]
    },
    "candidate": {
      "promptRevisions": [{ "id": "PROMPT_ID", "revision": 2 }],
      "executor": { "provider": "example", "model": "example-model" },
      "environment": {
        "identity": "trial-manifest",
        "receipt": "local:manifest-reference"
      }
    }
  }
}
```

Use actual IDs from the suite and prompt library. `get_prompt` with `id` and `history:{"offset":0,"limit":10}` lists retained revisions newest first, without instruction bodies. Follow `history.nextOffset` until null. Read one with `get_prompt` and `revision`; `currentRevision` identifies the editable current revision, or null for a deleted prompt. Retained history can have gaps, including imports that begin at a later revision. Interlock never fills a missing historical revision with current content. Current content can supply its own revision when a legacy library lacks that history record.

Preview and report `configurations.baseline` and `.candidate` identify each side by SHA-256, transitive definition pins, selected prompt revisions/content hashes, and optional executor/environment metadata. `differences` names changed prompt IDs and flags different pins, executor requests or environment references. The top-level `prompts` list is the union of selected revisions, so the same ID can appear twice; use the side manifests to associate them. Preview confirmation includes exact selections and identities. Changing a selection, dependency or metadata requires another preview. Editing the current library does not invalidate an explicitly selected retained revision. Start responses and list items include compact `configurationIds`.

The comparison retains the selected content once per distinct revision, independently of later library edits or lost revision records. Both sides together allow 64 distinct prompt IDs and at most 128 revisions totaling 1 MiB. Each side manifest has at most 64 entries. Legacy comparisons retain their shared capture and return `configurations:null` with their existing prompt metadata. No storage migration is required.

Retained prompt revisions survive normal prompt deletion. Comparisons do not restore deleted prompts, change ordinary startup rules, or alter portable workflows. Normal workflow deletion removes its comparison records; workflow exports exclude experiments, revision history, and environment references. Deleting a comparison's retained history removes that evidence rather than reconstructing it from current state.

### Executor and environment attribution

Optional `executor` fields are `profile`, `tier`, `provider`, and `model`, with at least one supplied. Tier uses `max`, `balanced`, or `fast`; other values are nonblank labels up to 200 characters. These are requested experiment conditions, not a provider adapter, claim constraint, or model switch. The external executor must choose how to honor them. Normal Agent context and capability rules still apply.

Reports keep `executorConditions.declared` separate from `.reported`. The first compares the request with captured claim `modelSelection`; the second compares it with model identities in selected usage receipts. A known difference produces `mismatch`; missing requested fields or non-final reporting retain `unknown` coverage. Usage cannot verify a tier or profile. Claims do not currently declare profile identity, so requested profiles remain unknown. A declaration alone cannot fill missing usage. Trials with no measured Agent attempts cannot establish a requested model match. These states describe attribution, not independent proof of provider execution.

Per-side metrics count matched, mismatched, unknown, pending, and not-requested samples across the whole comparison. Requested unknown or mismatched conditions add availability reasons. `metricsDetail:"full"` exposes at most ten distinct declaration and usage-model identities per sample, with totals and truncation flags. For further inspection, use `get_run_usage` with the sample run ID, `includeDescendants:true`, and `groupBy:"attempt"`. Late selected usage reports update attribution for the original frozen cohort; retries do not change it. Before observation, attribution stays pending. Without an executor request it stays `not_requested`.

Optional `environment` has a nonblank `identity` up to 200 characters and optional `receipt` reference up to 512. Use non-secret labels or references to an external harness manifest. It is retained and fingerprinted, but does not prepare a workspace, verify a receipt or prove isolation. Reports mark this gap as `environment_unverified`. Different trial environments can be described by the referenced manifest. Never put credentials, logs or workspace contents in these fields.

## Inspect results and record quality

Use `read_workflow_comparisons` with `request.action: "list"` for compact progress, or `request: {"action":"report","id":"COMPARISON_ID"}` for paged results. Each sample identifies its case, side, repetition, run URL and counterpart. Open these runs in the existing Runs UI to inspect graphs and full values. Labels include the short comparison ID, suite, case, side and repetition. Comparison labels appear in run rows and inspection, with counterpart navigation. Suite editing and comparison controls remain MCP/shared-API operations.

Execution failures, structural checks and quality judgments are separate. A completed run can fail checks. A passed check does not establish semantic accuracy. Root observations are recorded after the execution tree finishes; later explicit retries do not silently rescore that evidence. Reports show current run status separately from the observed status. Missing underlying history is explicit.

Use `update_workflow_comparison` with a `request` containing `action: "record_quality"`, comparison `id`, `sampleId`, declared `reviewer` and `reviewerKind` (`human` or `agent`), explicit `rubric`, `score` from 0 to 5, and optional `notes`. Judgments are append-only and labeled by declared source. Optional `requestId` makes identical writes idempotent; conflicting reuse rejects. Use the [evaluation starter](workflow-evaluation.md) for captured rubric/grader provenance, artifact digests, fresh review and separate evaluator usage. Optional `evaluation` receipt metadata requires `requestId` equal to evaluation run ID + colon + sample ID; it validates the retained completed source and accepted grader execution. This operation neither launches an evaluator nor proves that a person reviewed an answer. Use `get_run_result` to read selected actual values without copying full history into a report; `includeHash:true` adds a canonical selected-JSON SHA-256 digest.

Reports identify each evaluated assertion from the captured suite revision. Expected values up to 1 KiB appear inline; larger values set `expectedOmitted: true`. Use `read_workflow_comparisons` with a `request` containing `action: "case"`, `id` from `assertionRef.comparisonId` and `caseId` from `assertionRef.caseId` to read the immutable full case, including input, expectations and quality guidance. This explicit read is bounded by the 1 MiB suite limit. `read_test_suites` with `request.action: "get"` reads the current editable revision, which may differ from the comparison snapshot.

## Compare measurements

`read_workflow_comparisons` with `request.action:"report"` returns `metrics.sides.baseline` and `metrics.sides.candidate` for the whole comparison, independently of every report page. `metrics.cases.items` groups the same measurements by case and pairs repetitions. Default `metricsDetail:"summary"` keeps sample state and compact case comparisons. Set `metricsDetail:"full"` for sample timing/usage and complete per-case side statistics; narrow `limit` and `caseLimit` when reading that detail. Whole-comparison side statistics are available in either mode.

```json
{
  "request": {
    "action": "report",
    "id": "COMPARISON_ID",
    "caseOffset": 0,
    "caseLimit": 5
  }
}
```

Case pages default to five and cap at 25. Follow `metrics.cases.nextOffset` until null. Sample, check, judgment, and case paging are independent. The report retains its 256 KiB cap and can shorten pages with `truncated:true`; follow the returned offsets.

| Measurement                    | Meaning                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `execution`                    | Observed run outcomes, queued/pending trials, and trials cancelled before starting                        |
| `checks`                       | Pass/fail/unknown assertion counts, kept separate from execution and quality                              |
| `timing.rootElapsedMs`         | Root creation to its recorded terminal event                                                              |
| `timing.treeElapsedMs`         | Root creation through the latest terminal event in its ordinary/detached tree                             |
| `timing.claimIntervalMs`       | Sum of claim-to-recorded-end intervals, including failed, expired and held attempts                       |
| `timing.unclaimedAssignmentMs` | Assignment elapsed intervals minus known claim and declared-hold intervals; includes queue/budget waiting |
| `timing.declaredHoldMs`        | Declared external-hold intervals for assignments                                                          |
| `usage`                        | Reported usage for the frozen trial cohort, with coverage, source counts and separate currencies          |
| `quality`                      | Judged/unjudged sample counts, judgment count and distinct exact rubric text count; no score averaging    |

Timing summaries report `count`, `unknown`, `min`, `max`, and `median`. Sample timing values retain partial/unknown coverage for summed intervals. Distributions include only complete values. Assignment intervals can overlap across concurrent work and must not be interpreted as wall time or model compute time. Invalid or missing timestamps remain unknown. Recorded terminal events measure workflow progress, not provider latency. Later budget or context metadata updates do not extend a completed run's duration. Missing terminal events leave elapsed time unknown.

Paired timing and cost deltas use **candidate minus baseline**. Negative means a lower measured value, not a better overall workflow. Cost deltas require complete matching single-currency trials. Multiple currencies remain separate and are never converted or filled with zero. Summaries return at most ten currency groups with `currencyCount` and `currenciesTruncated`; pass `currency:"USD"`, for example, to inspect a specific currency outside that selection. The filter does not change other metrics or the trial cohort.

At first observation, Interlock freezes run/attempt membership and timing. Subsequent retries cannot rewrite them or add new work to that trial's costs. Late executor or observer receipts can improve usage for the original attempts, following [source selection](usage-reporting.md#report-measured-usage-as-an-observer). `metrics.asOf` identifies report time. Missing receipts, partial counts, overflow and different currencies remain explicit. Legacy observations without a frozen inventory use `state:"legacy"` and unknown measurements, even if current run history exists. Captured timing survives later history loss; missing receipts become unknown. Routine reports omit the internal inventory and claim credentials.

`metrics.availability.state` is `pending`, `insufficient_evidence`, or `descriptive`, with reasons for missing execution, measurement history, timing, cost, grading, or matching rubrics. `descriptive` means those measurement gaps were not found; it is not statistical confidence or proof of quality. A recorded judgment is still a declared assessment. Repeated judgments do not increase judged-sample counts, and unrelated rubric scores are never averaged. `bothJudged` and `sharedRubricPairs` describe paired coverage. Enhanced receipts require matching specification hashes; legacy receipts use exact rubric text. `checksOnlySamples` counts samples with only checks-only receipts; `unassessedSamples` counts those with only unknown evaluation verdicts.

Comparison `status:"completed"` continues to mean execution finished. Completion does not start evaluation; run the optional [evaluation starter](workflow-evaluation.md) explicitly. No winner, acceptance threshold or promotion is inferred. Check representative repeated trials and the evidence behind judgments before deciding whether a change is useful.

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

The four grouped tools require a `request` object with one explicit `action`. Each action accepts only its own fields. Read actions cannot save or execute work. Preview and start retain their separate top-level parameters. These tools expose the shared operations above without changing their behavior. Comparison preview, start and report remain MCP/shared-API operations; no comparison CLI commands or dedicated dashboard are included.

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
| Capture                   | At most 64 transitive version pins, 64 prompt IDs and 128 selected revisions totaling 1 MiB               |
| Preview blockers          | At most 50 details, with exact `blockerCount`                                                             |
| Discovery                 | Limit 1–100, default 20, with exact total                                                                 |
| Report samples            | Limit 1–25, default 10; zero-based `offset`                                                               |
| Checks per sample page    | Limit 1–10, default 5; zero-based `checkOffset`                                                           |
| Case measurement page     | Limit 1–25, default 5; zero-based `caseOffset`, nullable `metrics.cases.nextOffset`                       |
| Currency detail selection | At most ten groups; optional three-letter `currency` selects one without conversion                       |
| Judgments per report page | Limit 1–25, default 10; zero-based `judgmentOffset`                                                       |
| Quality judgments         | At most 1000 per comparison                                                                               |
| Report JSON               | At most 256 KiB; byte truncation returns exact totals, `truncated`, `nextOffset` and `nextJudgmentOffset` |

An active root and all its active descendants consume one concurrency slot, even after the root finishes. Explicit retries that would add an active tree reject before mutation when per-comparison or global capacity is full, including four active comparisons. Retry after another tree finishes. Retrying within an already active tree uses its existing slot. Completion waits for independent detached descendants too. `update_workflow_comparison` with a `request` containing `action: "cancel"` and comparison `id` stops queued starts and uses ordinary cancellation for roots. Detached work remains independent by default; `cancelDetached: true` explicitly cancels that comparison's detached descendants as well. Reports retain counts and a bounded list of independent active run IDs. Use normal run inspection for the full tree. A cancelled experiment can still have independent active work.

In-flight comparisons protect their queued/active version pins from explicit version cleanup and workflow deletion. Once terminal, comparison observations remain available after permitted definition cleanup; graph inspection and retry follow the ordinary missing-definition rules. Guarded workflow deletion removes its local suites/comparisons and ordinary history. Portable workflow bundles exclude suites, comparisons, judgments and captured case data. Saved comparisons never rewrite definitions or automatically publish a winner.

Cases may also contain ordered `fixtures` for [workflow simulation](workflow-simulation.md). Simulations use a separate report store and perform no model calls or Script/Fetch effects. Live comparisons ignore fixtures and retain their normal execution behavior. The CLI `test-suite` command supports create/update/get/list for the same saved cases.
