# Resume comparison metrics

Stopped at the user's request while travelling. Resume #176 directly; the user selected direct implementation. Do not start an SDLC run.

Worktree: `/Users/dan/.codex/worktrees/agent-result-checks/interlock`
Branch: `codex/workflow-comparison-metrics`
Base: `origin/main` at `8b49cc1`

## Implemented

- Private frozen run/attempt inventory and timing at first trial observation. Later retries cannot join the original cohort; late original-attempt receipts can improve usage.
- Comparison-wide side summaries, independently paged case comparisons, explicit measurement availability, and quality coverage without score averaging or automatic winner selection.
- Root/tree elapsed time, summed claim intervals, unclaimed assignment time and declared holds. Missing/partial/overflow data and separate currencies remain explicit.
- Scoped storage reads and shared usage aggregation. Legacy observations remain unknown rather than reconstructed from mutable history.
- Existing report gains `caseOffset`, `caseLimit`, `currency`, and `metricsDetail`. Summary is default; full provides sample timing/usage and complete per-case side statistics. No new MCP tool.
- Updated docs, pending patch changeset, task spec, runtime and HTTP/stdio regressions.

## Verification completed

- Full suite: 933 tests in 80 files passed before the final compact-default report refinement.
- Build, format check and package smoke passed before that refinement.
- After the refinement: typecheck and 36 focused tests passed, including HTTP/stdio and existing testbench tests.
- Latest focused run: all 14 comparison-metrics tests passed, including the added compact-response regression.
- `git diff --check` passed before this checkpoint.
- Synthetic six-case report measurements: default 15,434 bytes, full 34,499 bytes, narrow full 8,443 bytes; previous field shape 6,424 bytes. These are fixture measurements, not model usage or billing.
- Latest discovery measurement before adding `metricsDetail`: both transports had 49 tools and 234,497 bytes of definitions. Remeasure final discovery for the PR.

## Remaining work

1. Review the final compact/full contract and affected MCP/doc flows for consistency. No UI change or browser check is needed for this scope.
2. Run final full tests, build and format check. Run the package smoke after the final build. Tests use temporary/in-memory databases and fake work; do not use paid models or the user's database.
3. Inspect final diff and pending changeset. Keep report caps, exact continuation offsets, cohort privacy and no-winner semantics intact.
4. Prepare the PR using the repository template, with `Closes #176`, measured MCP discovery/response impact, validation and limitations. Push the branch, open and attach the PR, then check CI. No PR has been opened or branch pushed yet.

Relevant logs are `/tmp/interlock-comparison-metrics-*.log`. The latest focused log is `/tmp/interlock-comparison-metrics-final-focused.log`. Earlier successful full/build/format/package logs end in `tests.log`, `build.log`, `format.log`, and `package.log`. The summary-refinement checks are `summary.log` and `typecheck3.log`.
