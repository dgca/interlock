# Bounded workflow improvement starter

Issue #180, direct implementation. Base main 5b67879, including isolated Git trials.

The starter changes one inline Agent prompt on an explicitly separate experimental workflow. Setup prepares that workflow with baseline version 1 and two revisioned suites. Source production identity/version, tuning/acceptance suite revisions, rubric, thresholds, prompt manifests and finite budgets are captured before proposal. The fresh proposer sees tuning cases only. The candidate is version 2 on the experimental workflow; source workflows and shared prompts/profiles are never edited.

An owned, pinned copy of the existing evaluator runs through ordinary waited Workflow nodes. Runtime owns child allocation, so interrupted delivery cannot duplicate evaluation starts. Comparison request IDs derive from the experiment run and phase. Candidate publication inspects exact version 2 content after ambiguous delivery rather than publishing another version. Resume uses the same persisted run; no new experiment, candidate or repair loop is created automatically.

The only runtime addition is optional per-sample comparison budgets with tree scope. Budgets install atomically before root work is eligible and include all descendants. They are independent allowances, not a pooled comparison cap. The starter separately installs its captured tree budget before proposal and grading. Finite claim maxima plus bounded cases/repetitions limit dispatch; reported usage thresholds remain advisory gates with their existing unknown policy and overshoot limitations. No provider billing cap is claimed.

The workflow first evaluates tuning cases. Only a qualifying result proceeds to acceptance cases. Deterministic decision scripts require complete sample membership, original successful executions, checks, matching semantic evaluation receipts, complete reported cost and elapsed evidence, and no stale production/configuration state. Missing evidence and disagreement remain insufficient evidence. Quality gains outside performance limits produce tradeoff. The first version produces a revision-bound promotion proposal; it never mutates a production consumer or invokes a promotion tool.

The baseline stays in place by default. Production setup uses explicit workflow versions. Workflow-local script sources generate the importable bundle, with generation parity and fake-executor integration tests. Temporary repositories/databases only; no paid models or user data.

## Implementation choices

Production must match its current published baseline without draft definition edits. This prevents an adoption proposal from applying an evaluated prompt over unrelated, untested pending changes. Experimental creation and suite setup happen once before the starter begins; automated workflow/run creation deduplication remains #181.

The request fixes provider/model for trials and graders. Existing comparison attribution and selected usage determine whether that requirement was met; declarations alone are insufficient. Complete grade/trial cost and timing evidence gates a qualifying recommendation. Coordinator expense may still be pending for its active collection attempt, so it stays explicit and the proposal requires final expense review before adoption. It is never guessed as zero.

Source generation embeds standalone Script functions into workflows/improve.json and a pinned owned evaluator copied from workflows/evaluate.json. The generation parity test validates the checked-in artifact. Ordinary Workflow input bindings supply evaluator settings directly; no extra Script nodes or start_run calls are needed for that handoff.

## Verification

- 1,036 tests in 90 files passed, including 20 improvement tests and four comparison-budget tests. Fake executors, temporary repositories/databases and synthetic accounting only.
- Evidence projections use a typed contract; malformed submissions reject before acceptance and can be corrected on the same claim. Tests cover real owned semantic grading, independent Git writes/source preservation, held-out regression, missing/unknown/mismatched evidence, fractional scores, dirty production drafts, fixed budgets, delayed roots across restart, and publication/dispatch recovery without duplicate candidates or comparisons.
- HTTP/stdio comparison transport calls verify atomic policy installation and matching discovery. No new MCP tools; 49 tools, 266,684 bytes of discovery JSON versus 263,059 on the base commit.
- pnpm build, pnpm format:check, git diff --check and pnpm test:package passed. Packed global/npx installation covers CLI, UI assets, HTTP/stdio MCP, restart, JavaScript and persistence.
- Reviewed affected README, architecture, limits, harness, testbench, budget, evaluator and import guidance; CLI import/start/budget commands; MCP comparison preview/start/read, run budget, claim/retry, usage, evaluation and version-inspection flow. This is an affected-flow review, not a full unrelated-tool audit.
- No paid models or user library modified. Actual model/tool enforcement remains the external executor's responsibility; no provider billing cap, general optimizer service, production pointer, automatic promotion or heartbeat is added.
