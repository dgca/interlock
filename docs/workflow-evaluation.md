# Evaluate a workflow comparison

Use the importable **Evaluate workflow comparison** starter to assess retained outputs from an existing comparison. It captures a fixed rubric, runs fresh artifact reviewers or deterministic structural grading, and records judgments against exact sample artifacts. Evaluation runs have their own usage scope. Publication and acceptance remain separate decisions.

## Import and publish the starter

1. Open **Workflows → Import → GitHub folder**.
2. Enter `https://github.com/dgca/interlock/tree/main/workflows` and select **Find workflows**.
3. Select **Evaluate workflow comparison**, then **Import selected**.
4. Review the draft and publish it.

For a local checkout or installed package, import [workflows/evaluate.json](../workflows/evaluate.json) with `interlock import @/absolute/path/to/workflows/evaluate.json`, then run `interlock publish WORKFLOW_ID`. Existing libraries and the fresh-library SDLC seed remain unchanged.

The starter uses ordinary JavaScript Script, Agent, Condition and Batch nodes. Connect an executor using [Connect a harness](connect-harness.md). Review mode requires a fresh session or isolated subagent without inherited trial history; Interlock does not launch model sessions. Preparation and recording use ordinary current-context assignments in both modes.

## Capture a fixed evaluation request

Finish a [workflow comparison](workflow-testbench.md) first. Inspect its captured cases and choose the rubric before reading either side's answers. Start the published evaluator with `start_run`:

```json
{
  "workflowId": "EVALUATOR_WORKFLOW_ID",
  "input": {
    "comparisonId": "COMPARISON_ID",
    "rubric": "Assess factual correctness against the captured case. Inspect the actual artifact and supporting evidence. Fail material factual errors; mark inaccessible or unverifiable evidence unknown. Score 0 unusable, 1 major failures, 2 substantial gaps, 3 adequate, 4 strong, 5 fully satisfies the criteria.",
    "mode": "review",
    "outputPath": "artifact",
    "maxSamples": 10
  }
}
```

`comparisonId` and a nonblank `rubric` are required. `mode` defaults to `review`; `checks_only` maps the comparison's original structural checks without semantic review. `outputPath` defaults to the whole root output (`""`); use a narrower dot path for large results. `maxSamples` defaults to 10 and caps at 100. Add an ordinary run budget when needed. Do not change criteria between sides; start an independent evaluation run to try another rubric.

The run captures the evaluator's published version and prompt snapshots. Preparation reads the comparison's immutable cases, not the current editable suite. It selects retained roots whose original observation and current state are completed, preferably complete case/repetition pairs. Failed, cancelled, not-started, stale, missing and oversized outputs remain gaps. This first starter evaluates existing completed root outputs; it does not launch trials, provision isolated workspaces, or grade retry output as an earlier observation. Record bounded reasons for skipped samples and a remaining count for other omissions.

## Review actual artifacts

Each selected sample gets a Batch item. A Script varies order deterministically from the evaluation run ID and opaque sample IDs. Grader inputs omit explicit side/version labels and prior scores. Case guidance is preserved exactly; artifacts, guidance and inspectable run references can still reveal identity. This is best-effort blinding, not access control.

Fresh reviewers read `get_run_result` with the trial root `id`, `field:"output"`, captured `path`, `includeHash:true` and `maxBytes:262144`. The response adds a SHA-256 digest of canonical JSON with sorted object keys. Ordinary reads omit the digest. Reviewers copy this selector and digest into evidence, inspect the actual answer or exact referenced artifact revision, and record criterion-level findings and limitations. A worker's `testsPassed:true` alone is not proof that its resulting patch works. Inaccessible external files or unverifiable revisions remain unknown; the server verifies the retained JSON digest, not an external file's contents.

The rubric uses a 0–5 score. Unknown uses score 0 as an unassessed placeholder; do not count it as a measured failure. Failed or unknown required checks and findings cannot yield pass. Findings are bounded to ten, with notes up to 512 characters and at most four references of 512 characters each. Evidence holds up to four root input/output selectors. The backend checks captured settings, case guidance, original checks, accepted grader input/output, fresh assignment provenance and current artifact digests before writing a receipt. Executor identity, selected model and freshness are declarations, not independent authentication or proof of review quality. Unreported model details remain unknown.

In `checks_only`, a Script maps frozen checks: any fail → fail/0; a nonempty all-pass set → pass/5; no checks or any unknown without failure → unknown/0. Receipts explicitly say semantic quality was not reviewed. Notes and findings must match the frozen checks. This mode still uses preparation and recording agents, so its total evaluation cost may be nonzero or unreported.

## Resume and record each grade once

Reuse the evaluation run ID after interruption. Continue its persisted assignments through `list_work`, `claim_work`, `submit_result` and normal failure/retry handling. The recording assignment copies the accepted grade verbatim into `update_workflow_comparison` with `request.action:"record_quality"` and `requestId:"EVALUATION_RUN_ID:SAMPLE_ID"`.

Identical writes return the original receipt after an ambiguous response, including after source history cleanup; changed arguments under the same key reject. The backend validates retained provenance only on a new write. Independent evaluator runs use separate keys and preserve independent judgments. Ordinary judgments without `requestId` keep append-only behavior.

Enhanced receipts include the evaluation run, grader run/execution, evaluator/grader workflow versions, specification hash, mode, verdict, findings, artifact selectors/digests and available grader assignment/model provenance. The specification hash incorporates fixed settings, captured suite, workflow versions, prompt captures and declared grader model selection. Reports pair these judgments only when their recorded specification hashes match; legacy judgments still pair by exact rubric text. Missing provenance cannot establish that two executors used the same model.

Batch collection preserves grading/recording failures. Final output reports selected/recorded/failed/skipped/remaining counts, pass/fail/unknown verdicts, receipt references, `state:"complete"|"partial"` and `acceptance:"not_decided"`. Complete means all comparison samples were assessed without gaps; it can include failing quality verdicts. It does not mean the candidate is better. Comparison metrics also expose `checksOnlySamples` (only checks-only receipts) and `unassessedSamples` (only unknown verdicts); the latter produces `quality_unassessed` availability. No score average or winner is inferred.

## Calibrate before relying on agent scores

Start with a small representative set that includes a good result, a known failure and evidence the reviewer cannot verify. Have a human independently assess those same artifacts with side labels hidden, using the fixed rubric. Compare criterion findings and evidence with agent receipts, especially false passes and unknowns. If the rubric is ambiguous, revise it in a new evaluation run and retain the earlier judgments.

After calibration, spot-check samples from both sides when evaluator prompts/models or task types change, and periodically inspect high scores, failures and unknowns. Keep human judgments as independent append-only records with a declared source. A matching score alone is weaker evidence than agreement on the cited artifact and its limitations. Resolve material disagreement before using scores to guide workflow changes; this starter never promotes a workflow automatically.

## Account for the whole evaluation

After the evaluator finishes, pass its returned `usageRef` to `get_run_usage`:

```json
{
  "runId": "EVALUATION_RUN_ID",
  "includeDescendants": true,
  "groupBy": "attempt"
}
```

Include descendants so preparation, all graders, recording attempts and any nested evaluator work are counted. These are separate runs from the original comparison trials, so grader spending cannot alter baseline/candidate usage totals. Actual models and costs come from reported usage. Missing, partial or late telemetry keeps its existing coverage; never substitute zero or estimate missing charges. Re-read after late reports arrive. Compare trial and evaluation costs separately before deciding whether an improvement is worth adopting.

## Try a reproducible example

`tests/evaluation.test.ts` runs the packaged starter with fake executors and temporary databases. Both comparison sides return `selfReport:true` and pass that structural assertion. Their actual outputs differ:

```json
{"artifact":{"answer":"bad"},"selfReport":true}
{"artifact":{"answer":"good"},"selfReport":true}
```

The fixed rubric asks whether the actual answer is good, and `outputPath:"artifact"` selects the evidence. Fresh fake reviewers read that selected result: the first sample fails at 0 and the second passes at 5. Both receipts share a specification hash; the starter reports complete coverage and leaves acceptance undecided. Synthetic usage reports give each trial 100 micro-USD and the entire evaluator 50 micro-USD, including its descendant grading and recording assignments. The trial totals remain 100 each. These numbers test attribution, not expected provider prices.

Run `pnpm exec vitest run tests/evaluation.test.ts` from the checkout. The suite also covers checks-only pass/fail/unknown, rejected provenance, independent evaluations, persisted resume and idempotent recording after a lost response. No real model account is used.

Grader receipt provenance uses the raw accepted result when a grader configures output fields. Read it with `get_run_result`, the grader execution ID, and `field:"result"`; forwarding a smaller object does not discard the accepted grade. See [step data and result branches](node-data.md).
