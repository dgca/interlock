# Isolated evaluation trials

Issue #179 builds on #178 at main `875341f`. Direct implementation, using existing comparison tools and the shared API.

## Direction

Add an opt-in local Git trial setup to comparisons. Keep ordinary workflows and comparisons unchanged. Preview captures a local repository path and a full commit ID. Each sample gets its own independent clone before its root run can be allocated. Original case input remains unchanged.

Runtime lifecycle support is necessary because Script nodes currently start immediately in the server cwd, and a workflow cannot run a finally step after cancellation. Keep Git operations, artifact capture, and cleanup in a separate module, outside database transactions.

## Small interface

- Preview/start accept optional `trialSetup` for the local Git recipe.
- Existing comparison reads expose compact per-sample preparation and cleanup state. An explicit trial receipt read exposes local paths and bounded errors.
- Existing grouped comparison updates can retry cleanup after a harness confirms that uncertain workers have stopped. No new MCP tool family or node type.
- A local helper creates independent clones at the exact commit, without shared Git storage, templates/hooks, submodule initialization, inherited credentials or push remotes. All Script execution, including polling probes, uses the prepared cwd. Agent assignments carry the same workspace identity separately from task input.
- The initial recipe supports trusted local repository work. Native Fetch and Fetch polling are rejected before trial preparation. A cooperating external Agent harness must supply scoped local tools and prevent external writes. Cwd, removed remotes and clean environment are not an OS sandbox or proof that arbitrary code has no network access. Keep that limit explicit; never label a caller declaration as verified isolation.

## Lifecycle and evidence

Persist preparation before launching Git work and gate roots until ready. Bind receipts to comparison/sample/configuration IDs and the requested base commit. Validate owned directories and markers before execution and deletion; never fall back to server cwd.

Capture a binary Git diff against the base commit and bounded untracked files before removing the disposable clone. Retain receipts/artifacts for evaluation. Artifact-capture failures retain the workspace with actionable cleanup state.

Wait for native jobs and the entire sample tree, including detached descendants, to stop before cleanup. Successful/cooperatively failed Agent work can finish normally. Cancellation of claimed work, lease expiry and process loss require explicit harness reconciliation before deleting a workspace. Interrupted preparation and cleanup remain visible. Cleanup is idempotent and must never delete a caller checkout or follow a replaced/symlinked directory.

## Verification

Use temporary Git repositories and databases. Prove independent baseline/candidate writes to the same file, unchanged caller input/source checkout, JavaScript and legacy Bash cwd, queued/nested/Batch inheritance, restart and interrupted cleanup, cancellation, stale markers, preparation failure, artifact retention, and rejected external Fetch effects. Verify existing HTTP/stdio tools and packed installation. Keep model/provider work out of routine tests.

## Final behavior and tradeoffs

Git setup and cleanup live in small runtime modules rather than a general resource framework. Trial records are optional comparison/sample data, so existing stored comparisons and ordinary executions retain their behavior. Each sample records independent environment, setup and configuration identities.

Preparation reserves comparison concurrency before a root exists, including global capacity shared with ordinary comparisons. Up to ten preparation/cleanup filesystem jobs run concurrently. Native Script execution and polling probes receive the prepared cwd and clean environment. Full Agent assignments carry structured trial context and scoped-executor requirements; summaries retain only the environment ID. Assignment size inspection counts that context.

Agent lease expiry cancels the sample tree instead of redispatching into uncertain state. Restart cancels samples with interrupted native work, pending polling checks or claimed Agents. Pending polling checks are treated conservatively even between probes. Interrupted preparation and cleanup require explicit external reconciliation. Cancellation retains detached independence; cleanup waits for the entire sample tree. Unknown worker liveness requires explicit harness confirmation before deletion.

Cleanup captures a binary diff against the original base and bounded non-ignored untracked regular files. An atomic artifact receipt commits that evidence before workspace deletion. Retrying interrupted deletion reuses committed evidence, including after partial workspace removal. Capture errors retain the workspace; exports remain available after cleanup and workflow deletion. There is no automatic export retention policy.

Native Fetch and Fetch polling reject during transitive preview. This recipe requires reviewed Script code and real external executor tool restrictions. It does not prevent arbitrary filesystem or network effects in code, and capability declarations are never described as verified containment. Provider adapters, new MCP tools, UI comparison controls and sandbox provisioning remain outside this change.

The importable local Git example requires managed environment variables before touching its fixture, so accidental ordinary starts fail without modifying the source. Documentation includes external executor obligations, artifact bounds, cancellation/expiry/restart recovery, and deletion behavior.

## Validation and review

- Temporary repositories/databases only; no paid models, production services or user workflow data.
- Integration coverage includes independent writes and fixed-base repetitions, original input/source preservation, JavaScript and legacy Bash, Batch/detached inheritance, polling probes, preparation failures/interruption, restart, lease expiry, native cancellation, stale/symlinked receipts, oversized artifacts, partial deletion recovery, global capacity, and rejected direct/nested Fetch effects against a fake service.
- HTTP and stdio discovery and calls cover preview/start, scoped claims, briefings and assignment sizes, bounded reports, explicit trial receipts, cancellation and idempotent cleanup. No new MCP tools.
- Affected documentation and MCP flow reviewed: README, architecture, current limits, testbench, harness setup, example import guidance; preview/start/read/update comparison tools, work discovery/claim/renew/failure/submission, briefing/result inspection, assignment size and workflow deletion. CLI deletion guidance checked. This is an affected-flow review, not a full-tool audit.
- Git clone options checked against primary Git documentation through Context7: independent object copies, dissociation, empty templates, disabled hooks and no lazy fetching.
- Full suite: 1,012 tests in 88 files passed. Focused trial/transport checks: 26 tests passed. Build, formatting and packed install checks passed. Final checks are recorded in the PR.
