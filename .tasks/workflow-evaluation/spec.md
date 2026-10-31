# Repeatable workflow evaluation

Implement #177 directly, as requested. No SDLC run was started. Base: f90eeaa.

## Scope

Ship a self-contained importable evaluation starter using ordinary Script, Agent, Condition and Batch nodes. Evaluate completed root outputs from an existing settled comparison. Keep external workspace preparation, per-side historical configurations and automatic optimization/promotion in their separate issues.

Capture comparison identity, rubric, mode and output selection in the evaluation run's immutable input, and the grader definition in its published workflow version. Normalize optional defaults once. Prepare a bounded plan using comparison/case reads. Reorder opaque sample references deterministically and omit explicit baseline/candidate/version labels from fresh-review assignments. This is best-effort blinding, not an access-control boundary.

Review mode uses a fresh Agent and requires evidence from the selected persisted output. Checks-only mode maps the original frozen structural checks to pass/5, fail/0 or unknown/0 without a model quality judgment. No checks means unknown. A failed grader, missing artifact or unresolved evidence never counts as a pass. Batch collect retains other results and the final summary distinguishes recorded, failed and unknown outcomes from execution completion.

## Receipt integrity

Extend the existing quality-write operation with optional request IDs and evaluation references. Identical request retries return the original receipt even after referenced history is removed; conflicting reuse fails. Legacy writes retain append-only behavior. Intentional independent evaluation uses a new evaluation run.

Validated evaluation receipts reference the evaluation run, accepted grader execution, immutable specification hash, exact root-output selection/hash and bounded findings. Validate ancestry, captured input, completed source/grader, fresh review declaration or deterministic-script mode, accepted score/notes and evidence hash before appending. Never return work tokens. Declared identities/context are not authenticated proof. Grade root outputs only initially; external evidence remains a declared reference assessed by the reviewer.

Add opt-in result digests to existing bounded result reads so a grader can retain an exact artifact reference without inventing a hash. Preserve default response shape. Keep metadata bounded and use existing tools, not provider-specific grader tools or an evaluator service.

## Lifecycle and accounting

Evaluation execution, captures and progress live in ordinary run history. Resume the existing run and persisted preparation result after interruption. Retrying a record assignment uses the same deterministic quality-write request ID. Source changes require a new evaluation; accepted grader output is not silently rewritten.

All evaluator assignments are descendants of the evaluation run. Return a usage reference with includeDescendants:true and document reading it after completion, including late telemetry. Evaluation cost stays separate from original trial cost; unknowns remain unknown. Bound samples and attempts, use existing run budgets, and show failed/partial grading.

## Delivery

Importable packaged starter, worked example with fake executors, runtime/API and HTTP/stdio regressions, affected docs and CLI/MCP guidance, pending root patch changeset. Preserve existing libraries and the existing fresh-library SDLC seed. No paid model calls or user databases in routine validation.
