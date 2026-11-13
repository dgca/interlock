# SDLC starter assessment

Investigated on November 12, 2026. This assessment includes a design recommendation and an initial managed-execution pilot. It is not a comparative quality benchmark.

Improve the existing SDLC starter before adding another full development lifecycle. A software factory and a connected coding agent need the same decisions and completion evidence. They differ mainly in how execution starts, how questions reach a person, and what delivery the caller requires.

## Ideas worth borrowing

The source links below pin the inspected revisions. The upstream workflows were not executed during this investigation.

| Project                 | Distinctive idea                                                                                                                                           | Fit for Interlock                                                                                  | Automation limit                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Spec Kit                | Compare actual implementation with accepted requirements, including tasks already marked complete. Append traceable repair tasks without rewriting intent. | Make requirement coverage and correction work explicit in the existing review loop.                | Its runner pauses at review gates without supplied verdicts. Its bundled workflow does not include its separate convergence command. |
| OpenSpec                | Keep durable system behavior separate from the current change, and reconcile planning artifacts in either direction.                                       | Add explicit replanning and update the repository's owning docs when the change lands.             | Apply can pause for design problems. Update requires confirmation for each artifact edit. Archive is not a verification verdict.     |
| Superpowers             | Persist task progress, continue ordinary execution without routine check-ins, bound repair, and restrict re-review to the fix.                             | Use a compact task ledger, explicit repair limits, and one implementation context by default.      | Its repair cap can leave real findings parked. Reaching the end does not mean all findings were fixed.                               |
| Elephant-Goldfish Model | Ask a fresh reader to explain the proposal and existing system before critiquing them.                                                                     | Test whether a significant spec or plan contains enough context for another agent to implement it. | Uninterrupted mode produces a report. The iterative repair loop still requires human turns.                                          |

Sources: [Spec Kit convergence](https://github.com/github/spec-kit/blob/2ee2b1e8005905db05f5717300a469b3068b908f/templates/commands/converge.md), [Spec Kit runner](https://github.com/github/spec-kit/blob/2ee2b1e8005905db05f5717300a469b3068b908f/docs/workflows/overview.md), [bundled Spec Kit workflow](https://github.com/github/spec-kit/blob/2ee2b1e8005905db05f5717300a469b3068b908f/workflows/speckit/workflow.yml), [OpenSpec schema](https://github.com/Fission-AI/OpenSpec/blob/d12c2817776779e06891d68230773b3bb673b106/schemas/spec-driven/schema.yaml), [OpenSpec update](https://github.com/Fission-AI/OpenSpec/blob/d12c2817776779e06891d68230773b3bb673b106/skills/openspec-update-change/SKILL.md), [OpenSpec apply](https://github.com/Fission-AI/OpenSpec/blob/d12c2817776779e06891d68230773b3bb673b106/skills/openspec-apply-change/SKILL.md), [OpenSpec archive](https://github.com/Fission-AI/OpenSpec/blob/d12c2817776779e06891d68230773b3bb673b106/skills/openspec-archive-change/SKILL.md), [Superpowers inline execution](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/executing-plans/SKILL.md), [Superpowers repair loop](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/subagent-driven-development/references/fix-loop.md), [EGM comprehension](https://github.com/google/elephant-goldfish-model/blob/96e9d6f4e1f504f33385019547c26518390ae56c/agents/comprehension.md), [EGM review](https://github.com/google/elephant-goldfish-model/blob/96e9d6f4e1f504f33385019547c26518390ae56c/skills/egm-review/SKILL.md), [EGM review loop](https://github.com/google/elephant-goldfish-model/blob/96e9d6f4e1f504f33385019547c26518390ae56c/skills/egm-review-loop/SKILL.md).

Spec Kit's most useful contribution is the discipline of checking the current software independently of completion claims. Interlock already has acceptance evidence and final review. Extend that mechanism with complete criterion coverage and explicit repair work instead of adding another largely duplicate review stage. Do not let an implementer resolve a failing criterion by silently weakening it.

OpenSpec provides the complementary idea. Sometimes the accepted approach really is wrong. A failing implementation should not trap the run in repeated code fixes when the plan needs revision. Route the finding to its owning artifact, record the reason and authority for the change, and invalidate affected downstream evidence. Reuse existing project documentation rather than imposing a second specification directory. OpenSpec's separate verification categories also help distinguish work that is complete, correct, coherent, or still unverified. [OpenSpec verification](https://github.com/Fission-AI/OpenSpec/blob/d12c2817776779e06891d68230773b3bb673b106/skills/openspec-verify-change/SKILL.md).

Superpowers gives two useful implementation choices. Its subagent path uses fresh task implementers and task reviews. Its inline path retains one implementation context and a final fresh reviewer. Interlock's default should stay closer to the latter. Use extra isolated review when the task's risk warrants it. Record task IDs, dependencies, status, relevant criteria, candidate commits, evidence references, and unresolved findings once. Avoid copying the full ledger and every log into every assignment. [Superpowers subagent execution](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/subagent-driven-development/SKILL.md).

EGM's paraphrase is a useful test because a reviewer can understand every word yet misunderstand how the design fits together. Apply it before expensive construction for substantial changes. Give the reviewer the proposal and named repository sources without the author's conversation. A wrong paraphrase prompts a targeted clarification. It does not justify five specialist stages on every small fix.

I would not copy mandatory new document trees, universal per-task reviewer teams, fixed conversational approval rituals, or automatic success after exhausted repair. The transferable value is in the decisions and evidence these mechanisms preserve.

## Interlock baseline

The baseline is the shipped [SDLC definition](../../workflows/sdlc.json) at repository commit `c5df02df9d360935aebf48ea54af7548c9024dd3`. The connected Interlock library returned no workflows during inspection, so this assessment does not claim to inspect a separately installed or customized SDLC version.

SDLC has 27 nodes. It resolves the repository, drafts and reviews intent, specification, and implementation plan, builds the change, runs a fresh final review, and delivers locally or through a PR. Planning reviews choose proceed, revise, or human input. `reviewPolicy` defaults to `auto`; `always` adds explicit human approval at each planning stage. The build and final review can repeat. These are useful foundations to preserve. [SDLC guide](../sdlc-workflow.md).

Several practices suggested by popular development workflows already exist here:

- Stable acceptance criterion identifiers and links from requirements to implementation and verification.
- Repository-aware planning, a UI proposal when needed, and checks chosen from actual risks.
- A fresh final reviewer, separate specification and standards checks, and an independent boundary check.
- Evidence tied to exact commits, stable finding IDs, and focused review after localized corrections.
- Reuse of the original run and task baseline, preservation of settled decisions, and no automatic merge or deployment.

The main gaps are in how the graph represents work and decisions:

| Current behavior                                                                                          | Consequence                                                                                                  | Proposed change                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Human gates are Agent nodes instructed to remain unclaimed until a person answers.                        | Waiting for a person depends on executor cooperation and looks like Agent work.                              | Use native Human input with captured questions and artifact revisions.                                           |
| Setup and build can ask questions inside an active assignment.                                            | A long human wait is not an explicit workflow transition.                                                    | Return a structured question and checkpoint, enter Human input, then resume the same phase.                      |
| One build assignment owns the entire implementation.                                                      | The workflow cannot inspect or schedule individual implementation units.                                     | Persist a small task ledger and execute bounded units when the change warrants them.                             |
| Final review routes every non-pass result back to build.                                                  | Requirement or plan errors have no explicit route to the phase that owns them.                               | Classify findings and route to specification, planning, or implementation.                                       |
| `maxSteps: 100` is the general loop bound.                                                                | Exhaustion does not explain whether progress stalled or a particular repair limit was reached.               | Add explicit repair limits and a durable escalation with the last evidence.                                      |
| The workflow output schema is empty. Delivery returns `taskDir`, `branch`, `prUrl`, and a summary.        | A caller must interpret prose to distinguish local completion from a requested PR that could not be created. | Define a workflow result contract with verification and delivery outcomes separated.                             |
| Prompts require committing task artifacts even though repository instructions may keep `.tasks/` ignored. | Following repository conventions can conflict with later checks that expect artifacts in Git.                | Respect artifact policy and record immutable review inputs through an appropriate snapshot or content reference. |

These observations come from the definition's `configure`, stage gate, `build`, `review`, `preparePr`, and exit nodes. They are proposals for starter changes, not newly discovered runtime requirements.

## One procedure for both execution modes

For direct use, preserve request-only onboarding. The connected agent can resolve the current checkout and explain a consequential decision in the conversation. It must still submit the actual answer to the durable Human input request. A new chat can resume the existing run without reconstructing approval from conversation history.

For factory use, require an explicit accessible checkout or a configured working directory, an existing execution profile or worker, a delivery policy, and sufficient decision authority. Starting a connected run does not launch an agent. Managed execution needs an enabled, authenticated local profile. Neither a starter nor a prompt provisions that infrastructure. [Connect a harness](../connect-harness.md#complete-a-run), [current execution limits](../v1.md#current-limits).

The default decision rule should remain conditional:

- Resolve technical questions from the repository and available evidence.
- Record reversible implementation assumptions that stay within the request.
- Ask when a choice changes scope, public behavior, compatibility, consequential architecture, or authorization and existing instructions do not settle it.
- Honor explicit review requirements. Silence and elapsed time never supply approval.

A complete brief can therefore run unattended. An incomplete brief can enter a durable wait without leaving an Agent claim open. The same Human input can appear on a Workflow Board or be handled by a connected agent through `workflow_requests`. The integration remains responsible for authenticating external respondents. [Human input](../workflow-boards.md#add-human-input-to-a-workflow), [external input](../external-input.md).

Factory completion needs a stronger contract. Proposed fields include the outcome, reviewed commit, artifact references, verification summary, delivery status, PR URL, and outstanding limitations. Local completion is valid when requested. If a PR is required and cannot be created, retain verified implementation while exposing delivery as blocked. Do not require another build or pretend delivery succeeded. This is a proposed contract, not the current one.

## What the runtime already supports

The current runtime provides persisted routing, workflow-level loops, Human input, fresh Agent context, context continuity groups and handoffs, Script checks, child workflows, Parallel groups, and run budgets. Most initial changes can be authored in the starter. [Execution semantics](../architecture.md), [context continuity](../context-continuity.md), [run budgets](../run-budgets.md).

Use those capabilities with their actual limits:

- An executor supplies real session isolation. Connected-agent freshness is a cooperation contract; managed execution can create fresh sessions.
- Batch item paths are acyclic. Repeated implementation and repair need an outer loop or an invoked workflow. Parallel and Batch cannot nest inline.
- Parallel reviews can read one frozen candidate. Parallel implementation needs an explicit workspace and integration policy. Shared Git writes do not become safe because the graph has Parallel branches.
- Contracts check structure, and result rules can compare captured inputs. They do not prove that a test ran or that the software meets its requirements. Script checks can enforce required criterion IDs and evidence completeness; the reviewer must inspect substantive evidence.
- Claim budgets gate new Agent reservations. Reported token and cost limits can overshoot and are not billing caps.

Keep ordinary local work as the default delivery endpoint. Authorized PR creation is a separate outcome. Merge, deployment, and post-release observation deserve their own explicit policy or workflow.

## Recommended starter shape

The logical path would be:

```text
Resolve request and repository
  -> Establish intent, specification, and plan
  -> Implement the next bounded unit
  -> Check evidence and remaining work
  -> Fresh final review
  -> Deliver the reviewed candidate
```

Every phase can return a focused question to Human input and resume after an answer. Findings route to implementation repair or to the planning phase that owns the problem. Passing checks advances the run. Repeated findings or exhausted repair limits preserve the candidate and request a decision. This is a proposed logical flow, not a validated workflow definition.

Keep the first candidate small. Replace prompt-only human gates, add structured escalation and completion outcomes, and respect repository artifact policy. Next, introduce a compact task ledger and explicit repair versus replan routing. Add the fresh-reader planning check only where design complexity justifies it. Preserve the current final review's exact-commit evidence and focused revision behavior.

A small change can have one implementation unit and brief planning artifacts. A larger change can have several dependency-ordered units. Neither needs a different starter merely because the caller is a factory. Whether to combine trivial-change planning steps is a later optimization to measure, not a prerequisite for reliable automation.

## A distinct second starter

A **Design review** starter would earn a separate place in the catalog. Its input is an existing proposal plus repository context. Its output is a consolidated review, including comprehension gaps, architectural concerns, implementation-readiness findings, and reviewers that could not run. It can finish unattended in report-only mode and does not require implementing the proposal.

For a connected agent, it answers "review this design before I build it." For a factory, it can check a proposal from another system before starting SDLC. Report completion must remain separate from the design's acceptance verdict. A caller can choose to block implementation on material findings.

Start with one fresh review assignment and a small set of review questions. Add parallel specialists only when they provide useful coverage. Optional repair would require an explicit policy for which edits the workflow may make and which decisions return to the author. That policy is not part of this recommendation's initial report-only scope.

This is a stronger reason for another starter than a second full lifecycle named after an upstream project. SDLC already serves the end-to-end change request. Design review serves existing work and can compose with it.

## Evaluation before replacing the starter

Compare the unchanged starter and a candidate on the same frozen repository snapshots and briefs. Include a small fix, a UI interaction change, a multi-file feature, an ambiguous request, and a change that exposes a planning mistake during implementation.

Evaluate connected execution and managed execution separately. Exercise interrupted work, missing verification tools, a real human decision, changed artifacts after approval, failed PR delivery, and restart during a wait. Use simulation to test routing and contracts, then live tasks to assess judgment and software quality.

Measure independent acceptance, missed defects, unnecessary changes, consequential versus unnecessary human questions, completion rate, active time, human wait, repair rounds, and assignment sizes. Report tokens and cost only when observed. Workflow completion and passing a structural contract are separate from product quality.

Earlier local comparisons give reason to keep the first revision small. The October 7 SDLC and gstack trial recorded longer execution and missed acceptance criteria for the more elaborate contender. Later experiments also recorded substantial review and evidence overhead. These are task-specific historical observations, not a ranking of today's upstream projects. Preserve their original versions, timings, and results rather than rescoring them after improvements. Local evidence remains under `.tasks/workflow-comparison-2026-10-07/` and `.tasks/agent-skills-workflow-v7/assessment.md`.

Starter updates must remain opt-in for existing libraries. Imported copies belong to their users and are never overwritten automatically. Assess input and output compatibility before shipping a revised template. [Starter lifecycle](../starter-workflows.md).

## Initial managed pilot

The installed library received SDLC baseline, SDLC experimental, and Design review, with boards created and assigned through the new MCP operations. The original SDLC remains baseline version 1. Baseline version 2 preserves its graph and agent prompts while adding executor, working-directory, model, board, and required repository-path configuration. Experimental version 1 adds native human decisions, captured artifact hashes, a build-review repair limit, typed completion outcomes, and selected prompt changes. It still uses one build assignment.

Both SDLC runs received the same board-membership reimport task in separate checkouts of commit `c5df02df9d360935aebf48ea54af7548c9024dd3`, using GPT 6.1 Sol, medium effort, standard permissions, and automatic workflow review. The [membership bug](https://github.com/dgca/interlock/issues/403) is separate from [portable stages and import-time board setup](https://github.com/dgca/interlock/issues/404). The latter remains deferred.

The first attempts failed before task work. The native Codex adapter forwarded schema features rejected by structured output: regex lookaround in SDLC and `allOf` in Design review. A local trial shim projected compatible provider schemas and supplied the original contracts in prompts. Interlock retained full original result validation. This accommodation was applied to every second-attempt run; it is not a shipped adapter fix. OpenAI documents the [supported structured-output subset](https://developers.openai.com/api/docs/guides/structured-outputs).

The second attempts produced these observations:

| Workflow          | Observed outcome                                                                                         | Harness permission requests |
| ----------------- | -------------------------------------------------------------------------------------------------------- | --------------------------- |
| SDLC baseline     | Two intent reviews requested provenance corrections; stopped during the third draft assignment           | 22                          |
| SDLC experimental | The same repeated intent-review pattern; stopped during the third draft assignment                       | 22                          |
| Design review     | Completed a report with verdict `revise`; found an approval identity defect and missing fixture coverage | 0                           |

The evaluator stopped both SDLC runs after the repeated pattern, before their 30-claim limits. Each completed five assignments: setup, two drafts, and two reviews. Neither reached specification, implementation, or final acceptance. This is an early-stop observation, not proof that either could never converge. It does not establish a winner or test the experimental implementation-repair improvements in live work.

The repeated finding concerned descriptions of `previous` in intent documents. Writers described their incoming review or setup result; reviewers compared that statement against their own, different incoming draft result. Reviewers also challenged draft-commit instructions available to writers but absent from the review assignment. Stable product scope was not the blocker. Durable planning artifacts should record decisions and authoritative sources without narrating transient execution envelopes. Reviewers need the applicable stage instructions, and planning loops need a bounded response to repeated findings.

Standard permissions required approval for routine local commands even with automatic workflow review. The user authorized inspection and approval of routine trial work; consequential decisions and broader actions remained separate. Board attention counts and person-waiting states reflected those requests. Cancellation exposed recovery requests; after confirming native sessions stopped and reconciling them, both runs were quiescent and no requests remained. Design review moved from Review to Report. The pilot did not exercise a live workflow-level Human input decision or board transitions through implementation and delivery.

Reported input tokens were 986,930 for baseline and 1,267,702 for experimental, including 772,864 and 1,038,464 cached input tokens respectively. Both totals have partial coverage because interrupted assignments lack final usage. Design review reported 578,995 input tokens, including 505,216 cached, with complete coverage. Cost was unavailable. These are cumulative reported tokens across model calls, not context-window sizes or a controlled efficiency ranking. Human and operator waiting also prevent a useful active-time comparison here.

Design review's approval defect was independently reproduced: retargeting an artifact symlink during a human wait can leave the decision script checking the old canonical target while later stages read the new target. Approval should resolve the original artifact reference again, recheck containment and identity, and reject changed evidence. This defect remains in the frozen experimental version. Additional synthetic checks passed for unresolved-decision approval, delivery outcomes, changed-HEAD rejection, and the second repair threshold. They supplement the report's missing evidence; they do not establish live implementation quality.

The pilot supports improving SDLC before promoting this experimental copy. Address the shared planning loop, native schema compatibility, permission-policy setup, and artifact identity check first. Design review remains a useful separate starter candidate: its report found a reproducible defect without modifying the proposal. Local definitions, runs, reports, fixture checks, and usage snapshots remain under `.tasks/starter-sdlc-trial/`; no trial implementation was merged or shipped.

## Follow-up fixes

The working-tree SDLC starter now keeps transient execution details in stage results, gives reviewers the relevant draft-commit instruction, and allows harmless editorial corrections without another drafting round. After three reviews of a planning artifact, further revision requests route to its existing human decision gate with findings preserved. A passing review can still advance; a human revision does not reset this per-artifact limit. Regression tests exercise intent, specification, and plan, including a further failed review after a human revision.

The Codex adapter now uses a JSON-string result transport when the original contract falls outside its conservative native schema subset. It supplies the complete contract in the assignment, decodes the returned value, and retains ordinary runtime validation. It does not project away validation rules. A real GPT 6.1 Sol smoke test passed with conditional rules, a lookaround pattern, and an optional property, without the pilot shim. Normal native permissions remain unchanged.

Corrected local trial copies are published as baseline version 3 and experimental version 2. The experimental decision scripts resolve the original artifact reference again and compare repository and task containment, canonical path, file identity, and content with captured evidence. Missing or changed evidence routes to revision. Twenty-one local cases cover all three planning stages, including same-content symlink retargets and file replacements. These scripts remain part of the local experimental workflow; they are not promoted into the shipped starter.

Original pilot definitions, results, and usage remain frozen. Follow-up evidence is under `.tasks/starter-sdlc-fixes/`. The corrected paired trial below used the tested checkout runtime without the schema shim. The installed global server remains on its installed package.

## Corrected managed trial

The corrected baseline and experimental workflows ran on fresh clones of the same `c5df02df` base with the same brief and executor settings. They used a separate library at port 4311. The installed global database uses schema 19 while the checkout supports schema 18; the checkout rejected that database without modification, and the installed server was restored at port 4310. The trial did not downgrade the installed database.

| Observation                    | Corrected baseline                                                  | Corrected experimental                                                       |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Workflow outcome               | Completed local delivery                                            | Stopped during final review to conserve the user's token allowance           |
| Final candidate                | `9494e3b9`                                                          | `5335ac59`                                                                   |
| Independent acceptance         | 10 of 10 checks passed                                              | 10 of 10 checks passed                                                       |
| Planning reviews               | Each passed on first review                                         | Intent and spec passed first; plan passed second                             |
| Implementation evidence        | 36 tests, build, formatting, independent removal/force-import check | 86 tests, build, formatting, browser export/reimport and retained-card check |
| Inspected permission approvals | 112                                                                 | 150                                                                          |

Both candidates preserve `existing?.boardId` at the shared import write. Experimental adds more rollback fixtures and browser evidence. Its first plan review requested an outer selected-import rollback test and clearer verification ownership. Its final reviewer had not submitted a verdict or completed the planned independent publication check when stopped. Passing the external acceptance probe does not replace that incomplete review. Neither candidate was merged into the working checkout or published.

Baseline's first build attempt committed a passing implementation but returned stray text inside its encoded JSON result. The adapter rejected it, and the second assignment recovered the existing candidate after repeating inspection and validation. This suggests bounded result-format repair before restarting a whole assignment. Validation must remain intact. Failed-attempt usage was also missing from the reported totals.

Reported input tokens were 4,919,199 for baseline, including 4,407,040 cached, and 12,322,064 for experimental, including 11,756,544 cached. Both have partial coverage; cost is unknown. These are cumulative reported model-call tokens, not context sizes or a measure of the user's weekly allowance. The operator's approval conversation is additional overhead. The user flagged excessive token consumption, so the remaining experimental review was cancelled and its stopped executor reconciled. Both runs are quiescent with no pending requests. Original outcomes were preserved.

The board exposed permission attention and moved runs through Planning and Implementation, then Review; baseline reached Delivery. No workflow-level human decision or live approval-identity change was exercised. Those gates retain only the earlier fixture coverage.

This trial supports the planning fixes but does not justify promoting the experimental workflow wholesale. Prefer deterministic contract and acceptance checks first, then one bounded live trial for a specific unresolved question. Agree on a consumption budget before another comparison, inspect usage between stages, and keep assignments small: claim-count limits alone do not constrain token-heavy assignments, and usage-based limits can overshoot. Preserve the known implementation without repeating discovery after a result-format error. Evidence, frozen definitions, permission records, results, and copied test/browser proof remain under `.tasks/starter-sdlc-trial-2/`.

## Integration decision

Keep one bundled SDLC starter. The integrated changes clarify planning handoffs, cap repeated revisions, and add MCP board management. The Codex adapter now recovers a complete JSON object or array followed by a short prose suffix without another model call. Original result validation still applies. The experimental workflow and Design review remain trial artifacts.

PR #406 merged the reimport fix and portable board setup before this integration. Use its import preview for suggested boards and stage mappings. Use the board MCP tools for direct board management. Issue #368 covers optional intake workflows that could start SDLC from an external tracker. It has its own polling, deduplication, and reply handling requirements. [Portable workflow stages](https://github.com/dgca/interlock/pull/406), [integration starter proposal](https://github.com/dgca/interlock/issues/368).
