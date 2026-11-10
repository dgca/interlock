# Implement and verify Parallel groups

The [intent](intent.md) owns scope. The [approved specification](spec.md) owns observable behavior and AC1–AC16. The task branch starts at `92c789d1376e93e11c5d4e6998accd4085718dc5`. Use temporary databases and servers for all checks.

## Implementation sequence

1. Add a `parallel` definition node with ordered `branches: [{id, key}]` and concurrency. Members name their `parallelId` and `parallelBranchId`. Branch ports use `branch:<id>`, the group continues on `complete`, and returns target `join`. Separate the persisted branch ID from the editable result key. Share scope and edge helpers across publication, diagnostics, Raw, bindings, and editor connection checks. Keep existing Batch rules and support incomplete drafts. Use a structured error for invalid branch or edge locations. Make group removal and edit operations preserve or deliberately remove dependent members and edges. AC1, AC3–AC6, AC10, AC15.
2. Reuse the child-run scheduler and ordinary ancestry. Capture the group version, input, and branches on one parent execution. Dispatch branch runs from the pinned graph with invocation/branch identity and inherited captures. Count direct branch node starts against their owner's retained allowance in the same transaction as recording each execution. Keep ordinary descendants' separate step budgets. Dispatch and persist parent references atomically; collect with literal own-property keys. On failure, cancel ordinary unfinished branches, preserve successful results, and recover only through the failed group. Keep the branch version pinned and enforce existing pause, admission, resource, budget, and detached boundaries. AC2–AC9.
3. Extend the existing visual grouping and settings rather than introducing a new editor. Add branch key and concurrency fields, explicit per-branch Add step controls and start ports, and one Join return boundary. Use shared sizing, layout, selection, undo/redo, and contract components. In the inspector, select the group visit before showing branch status and navigating to its runs. Surface queued branch counts and bounded summaries through existing APIs. AC10–AC13.
4. Reject Parallel in fixture simulation's preflight. Update the existing MCP tools and CLI help where authors discover the new definition and lifecycle. Keep added discovery text short and use current bounded reads. Add a deterministic example, a patch changeset, and update the affected README, glossary, architecture, data/binding, execution, limits, and simulation docs. AC13–AC16.

## Builder checks

| Criteria | Direct check and expected result |
| --- | --- |
| AC1, AC3, AC4, AC6, AC15 | Publish a valid two-branch graph as control. Test missing starts, disconnected returns, invalid membership and ports, sibling bindings, internal cycles, duplicate keys and unsupported composition. Save incomplete drafts; publish rejects with context. Round-trip Raw, export/import and stable-ID edits. Verify null and special keys survive collection. |
| AC2, AC3, AC5, AC6 | Claim two distinct reviewer assignments before returning either; finish out of order. Check the joined object, branch-local source reads, captures, and no early continuation. Loop with new input and prove no previous result or provenance leaks. Exercise a conditional path that returns through only one of two valid edges. |
| AC7 | Exhaust shared allowance across two branches and a loop using deterministic work. Compare against a sufficient-budget control. Check blocked steps produce no operation or claim, restart retains accounting, and retry does not refund completed work. |
| AC8, AC9 | In a file-backed temporary DB, finish one branch, restart with work outstanding, then fail or cancel a sibling. Confirm queued dispatch stops, late revoked submissions reject, retry retains successful output and continues eligible branches only, and detached descendants remain independent. Compare branch/parent links after an injected dispatch write failure to detect orphan records. Exercise resource/claim uncertainty with a safe reconciliation control. |
| AC10–AC12 | Run the actual editor/inspector journey below. Use existing unit suites for canvas geometry, invalid drafts, graph navigation, and editor regressions; add focused coverage for the new failure modes. |
| AC13, AC14 | Run both transports with the same valid definition. Inspect discovery and the create/edit/validate/publish/start/work/briefing/result/retry lifecycle. Assert bounded metadata and literal output keys. Verify simulation rejection before fixture consumption with a supported-definition control. Check documented CLI examples against an isolated server. |
| AC15, AC16 | Run targeted Batch, failure routes, bindings, versions, admission, budgets, cancellation, persistence, layout, simulation, starter and transport tests. Run `pnpm build`, `pnpm format:check`, and the package smoke after build if CLI startup or packaging changes. Verify related docs and the pending patch changeset. |

### Browser journey

Open an isolated server in the browser. In a draft, add Parallel, name two branches, and check keyboard navigation through branch rows. Enter a duplicate key and confirm the field reports it; correct it. Add and connect one reviewer per branch using graph controls, save, reopen, and tidy. Publish, start with controlled test input, and observe both available branches. Complete one, inspect the other, then finish and verify the joined output. At a narrow width, inspect the settings and run detail for reachable actions and legible status. Capture actual controls and outcomes, plus criterion IDs AC10–AC12, in this plan. Use deterministic executor submissions only for run setup/results; do not substitute direct state injection for the editing journey.

## Independent review

Use a fresh session or subagent without inherited implementation history. Compare the complete candidate diff against the original base, the accepted artifacts, and repository standards. Inspect evidence for each criterion at the exact candidate commit. Independently probe one boundary such as retry after a retained-success restart with a tight remaining step budget, or a cross-branch connection that can be saved incomplete but cannot publish. Check affected HTTP and stdio guidance against the actual tool registrations. Use the workflow review contract and route any findings back to implementation.

Delivery checks that the reviewed candidate is still HEAD and the accepted artifacts are committed. Finish locally.

## Evidence

Record commands, observable results, proof locations, and any gaps here during the build. Verification has not started.
