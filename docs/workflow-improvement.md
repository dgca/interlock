# Improve one workflow prompt

Use the optional **Improve one workflow prompt** starter for one controlled experiment. It proposes one inline Agent prompt change on a separate experimental workflow, tests tuning cases, grades actual outputs, and checks separate acceptance cases if tuning qualifies. It returns a revision-bound adoption proposal. Production stays unchanged.

This first version supports one target Agent's inline `prompt`, one candidate, and zero automatic repairs. It does not edit shared saved prompts, executor profiles, evaluation criteria or a production consumer. It uses ordinary agents, Scripts, result bindings and a pinned owned copy of the [comparison evaluator](workflow-evaluation.md). No optimizer service, scheduler or model provider is launched.

## Prepare an experiment once

1. Import [workflows/improve.json](../workflows/improve.json) through **Import → GitHub folder** or **Import → Local file**. The bundle includes its published owned evaluator. Publish the root draft after reviewing it. Existing libraries are unchanged until you import.
2. Select the production workflow and its current published baseline version, with no unpublished definition edits. Read its immutable definition with `list_workflow_versions`; `get_workflow` returns current metadata and draft. Keep production consumers on an explicitly selected version.
3. Create a separate experimental workflow using `create_workflow` with that exact baseline definition. Publish it once as version 1. Do not use a current edited draft as a substitute for the baseline. The experiment must have no other published version or draft changes when the starter captures it. Record its ID before starting the experiment.
4. Save two test suites on the experimental workflow with `save_test_suite`: tuning and acceptance. Each has 1–5 cases. Use distinct IDs and different original inputs across both sets. Record their current revisions. Keep acceptance cases out of the proposal conversation.
5. Choose the hypothesis, target Agent node ID, rubric, required output/route assertions, quality gain and allowed cost/elapsed increases before running the experiment. Record any earlier cases or findings that informed the hypothesis. Use fresh acceptance cases if prior optimization already used the old ones.
6. For repository work or workflows with possible external effects, prepare a local repository and capture a full commit for `trialSetup`. Follow the [local Git policy](local-git-trials.md), including scoped tools, reviewed Script code and disabled outbound writes. Native Fetch remains unsupported. Pure Agent tasks can omit Git setup only when the executor prevents external writes.

Copies that reference owned children of the production workflow cannot reuse those children as a different owner. Prepare an independent experimental tree with valid ownership before starting, or begin with a flat workflow. Do not change ownership or overwrite production to make an experiment publish.

Setup is deliberately explicit. The starter does not create workflows or suites after it begins, so a lost creation response cannot silently create another experimental copy. Starting the starter twice still creates two experiments; serialize admission in your external heartbeat until [idempotent run creation](https://github.com/dgca/interlock/issues/181) is available.

## Start with fixed settings and budgets

Call `start_run` with the imported root ID, its explicit published `version`, and input shaped like this:

```json
{
  "production": { "workflowId": "PRODUCTION_ID", "version": 1 },
  "experimentWorkflowId": "EXPERIMENT_ID",
  "nodeId": "triage",
  "hypothesis": "Explicit data-loss criteria improve issue triage without over-escalating ordinary requests.",
  "tuning": { "suiteId": "TUNING_SUITE_ID", "suiteRevision": 1 },
  "acceptance": { "suiteId": "ACCEPTANCE_SUITE_ID", "suiteRevision": 1 },
  "executor": { "provider": "ACTUAL_PROVIDER", "model": "ACTUAL_MODEL" },
  "rubric": "Classify data loss or corruption as urgent. Keep ordinary feature and cosmetic requests normal. Inspect the actual classification and rationale. Score 0 unusable through 5 fully correct; fail unsupported escalation or missed data loss.",
  "outputPath": "artifact",
  "repetitions": 1,
  "criteria": {
    "minQualityGain": 1,
    "maxCostIncreasePercent": 10,
    "maxElapsedIncreasePercent": 25
  },
  "orchestratorBudget": {
    "scope": "tree",
    "unknownUsage": "block",
    "limits": {
      "claims": { "max": 50 },
      "cost": { "currency": "USD", "threshold": { "max": 5000000 } }
    }
  },
  "sampleBudget": {
    "scope": "tree",
    "unknownUsage": "block",
    "limits": {
      "claims": { "max": 2 },
      "cost": { "currency": "USD", "threshold": { "max": 1000000 } }
    }
  }
}
```

Replace every placeholder with a recorded ID or actual executor provider/model. The same selected model applies to both trial sides and graders. Claim declarations and final usage reports must match it; missing or mismatched attribution keeps the result insufficient. The setting records a requirement for your external executor and does not launch or configure a provider. For Git trials, add `trialSetup:{"kind":"local_git","repository":"/absolute/repository/root","commit":"FULL_CAPTURED_COMMIT_ID"}`. Do not put credentials in input.

The preparation assignment installs the exact `orchestratorBudget` before proposal or publication. Its own initial claim counts toward that allowance. If you supply `budget` on `start_run`, use the same policy; a different existing policy rejects rather than being replaced. The tree budget governs proposal, coordination and all evaluator descendants. Every policy needs an explicit `unknownUsage` setting and a finite claim maximum of 1–1,000.

Comparisons create independent roots outside that tree. Each root receives the captured `sampleBudget` atomically before Agent work becomes eligible, including queued samples after restart. Tree scope also governs Batch and detached descendants. This is an independent allowance per sample, not a shared comparison cap. Total reserved claims are bounded by the coordinator allowance plus both phases' root counts multiplied by the per-sample allowance. At most five cases per phase and two repetitions produce 40 trial roots in total. The starter does not create additional candidates or trial rounds.

Reported-cost and token thresholds gate future claims using the existing [budget policy](run-budgets.md); late reports and in-flight work can overshoot. These are not provider billing caps. Scripts, Fetch and native scheduling are not claim-metered, so fixed trial counts, step limits and the external-effect policy still matter. Cost checks and decisions in this starter use USD without currency conversion. Missing, partial or mixed-currency evidence cannot establish a cost improvement.

## Follow the persisted experiment

Connect an executor through the ordinary work/claim loop. Configure it to use the captured provider/model for both trial and fresh grader assignments, declare actual modelSelection, and report measured per-attempt usage. This routing is the external executor's job; Interlock does not select the model. The preparation assignment captures baseline definitions, current production revision, suite revisions, disjoint cases, complete prompt revision selections and budgets. The fresh proposal receives only tuning cases and the chosen inline prompt. It records exactly which tuning cases informed its proposal.

The candidate Script constructs the entire experimental version 2 definition by replacing only that prompt. The publication assignment verifies the persisted result. It reuses an identical version 2 after a lost response and rejects different or later versions. It never publishes on the source workflow or edits a saved prompt.

Tuning and acceptance comparisons use stable request IDs derived from the existing experiment run and phase. Both sides use the captured prompt revisions, selected candidate definition and per-sample budgets. Git preparation, work and cleanup follow the existing trial lifecycle. The pinned owned evaluator starts through an ordinary waited Workflow node, so runtime resumes its existing child instead of issuing an ambiguous second `start_run`.

If the run is interrupted, resume its existing ID and assignments. Inspect failures before an explicit retry. Do not restart the starter, publish version 3, change the candidate, choose a new comparison request ID, or raise a budget to continue. A changed suite revision or unrelated experimental draft requires inspection. Budget-blocked runs remain recoverable and visible through `get_run_briefing` and `get_run_budget`; they are not evidence of a completed experiment. Cancellation retains ordinary detached boundaries; inspect and cancel owned comparisons separately, and reconcile uncertain Git workers before confirmed cleanup.

## Read the outcome

A deterministic Script compares complete case/repetition pairs using the captured rules:

- `retain_baseline`: a candidate case regresses, a required candidate check or grade fails, or the average score gain falls below `minQualityGain`.
- `candidate_better`: required semantic grades are assessed, no case regresses, average quality gain reaches the threshold, and total measured cost/elapsed stay within the captured allowances.
- `tradeoff`: quality qualifies but total cost or elapsed exceeds an allowance. The starter does not relax the allowance or decide that tradeoff for you.
- `insufficient_evidence`: membership, execution, checks, semantic grading, trial and grader usage, timing, cleanup or configuration or model-attribution evidence is missing, disputed or stale. Changed production or budget policies also prevent a proposal.

Malformed evidence projections reject at the collection assignment's output contract, keeping its claim usable for correction. Missing facts use explicit null or unknown values and produce insufficient evidence.

Only a qualifying tuning result uses acceptance cases. A qualifying acceptance result produces `acceptance:"proposal_only"` and `promotionProposal` with expected production revision/version/definition and prompt revisions, the exact candidate version/hash, side configuration identities and comparison/evaluator references. Every other result has no promotion proposal. Coordinator expense is tracked separately as complete or `pending_final_usage`: the collector may not have its own final cost yet. Pending expense is never substituted with zero, and the proposal requires a final expense review before adoption. The result also records scope, informed case IDs, reasons, measured evidence and a regression link.

A coordinator Agent retrieves facts from bounded comparison, budget and usage reads; deterministic Scripts constrain the change and apply the decision rules. Executors must return those facts truthfully and follow the captured policy. This is a reusable procedure, not a security boundary against an executor that falsifies evidence or uses unrelated tools.

These outcomes describe the selected cases and reported measurements. One successful experiment is not proof of general improvement. Repeated tuning against the same cases, or repeatedly inspecting and reusing acceptance cases, weakens the evidence. Retain failed experiments, use representative cases, calibrate the rubric and spot-check actual artifacts with a human.

## Review and apply a proposal explicitly

Before changing production, inspect the actual candidate artifacts and both comparisons. Re-read production `latestVersion`, `draftRevision`, `draftMatchesLatest`, retained baseline definition and selected prompt revisions against `expectedProduction`. Recheck the candidate hash, grading receipts, final coordinator/evaluator expense, trial usage coverage and side configuration identities. Any change or missing evidence prevents applying that proposal as recorded.

If authorized, apply only the proposed inline prompt change using the current expected draft revision, publish deliberately, and update the explicitly selected factory consumer version. The starter does not perform those actions or infer authorization. Keep the experiment run and its `regressionLink` on the external issue or task, so a later regression can cite the experiment that motivated the change. Do not overwrite earlier findings or silently reinterpret an old result after late usage arrives.

`usageRefs.coordinator` reads only the coordinator run's own claims. Each `usageRefs.evaluators` entry includes that evaluator's descendants. Trial expense remains in comparison metrics. These scopes avoid double-counting grading as baseline/candidate work. Re-read usage after final or observer reports arrive; missing expense remains unknown rather than zero.

## Work through factory issue triage

Start with a flat issue-triage workflow whose Agent returns `{"artifact":{"priority":"normal","rationale":"..."},"selfReport":true}`. Keep its production consumer pinned. Prepare its exact experimental baseline and two suites as above.

Use tuning cases such as an upgrade deleting saved files and a request for a new color theme. Use acceptance cases such as workflow corruption during save and a request for keyboard shortcuts. Give cases stable distinct IDs, expected priority checks and guidance about evidence in the rationale. Capture the rubric and the allowed quality/cost/time changes before proposing a candidate. The proposer sees the tuning pair; acceptance remains separate until the candidate is frozen.

Start the imported workflow using the request above, actual node/suite IDs and authorized limits. Have the executor report measured usage for proposal, trial and grader claims. Inspect the resulting evidence and promotion proposal, or its explicit reasons for retaining the baseline or stopping. This setup exercises the complete loop without changing the factory's live triage workflow.

For a reproducible checkout demonstration, run `pnpm exec vitest run tests/improvement.test.ts tests/comparisonBudgets.test.ts`. Fake workers change the same file in independent temporary Git checkouts and return known good/bad artifacts. The real owned evaluator records semantic receipts against those artifacts. Tests cover held-out regression, missing evidence, disagreement, changed budgets, fixed allowances, lost publication/dispatch responses and restart. Synthetic costs are accounting fixtures, not measured model prices or evidence that a real triage prompt improved.

Maintainers regenerate the bundle with `node scripts/build-improvement-starter.mjs` after changing its source or the evaluator starter. The parity test rejects stale generated output. The installed/imported JSON is self-contained and does not need the generator.
