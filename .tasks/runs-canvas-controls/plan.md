# Implementation and verification

See [spec](spec.md) for AC1–AC4 and [intent](intent.md) for scope and the fixed baseline.

1. Capture the differing navigation settings through the real RunGraph component in a focused regression test before fixing them. This deterministic component check is the diagnosis loop. A direct configuration mismatch needs no speculative instrumentation or bisection.
2. Share viewport configuration between the editor and RunGraph. Reuse useBoxZoom and its existing gesture tests. Share cursor and rectangle styles. Keep authoring-specific selection and movement in WorkflowEditor.
3. Add area-zoom handling to RunGraph. Disable shortcuts when a dialog is open. Retain run node click and hover handlers and stable viewport state across progress renders.
4. Update architecture navigation documentation and add a pending patch changeset for @type_of/interlock. Inspect README, CLI help and MCP definitions for affected guidance. No API or MCP behavior changes are expected.
5. Run focused component and box-zoom tests, pnpm build, and pnpm format:check. Exercise both real views using a temporary database and Playwright. Save check output and screenshots outside the checkout.
6. Commit the candidate. The SDLC fresh reviewer inspects the complete diff, acceptance evidence and standards, and independently exercises a relevant boundary such as cancelling area zoom or updating progress during navigation. Delivery verifies the reviewed commit before opening a PR with the repository template.

| Criterion | Build-owned check and expected result                                                                                                                                           | Risk                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| AC1       | Component props and browser wheel, modifier wheel, middle drag, Space drag, double-click and zoom controls in both views. Matching navigation and bounds.                       | Different library defaults or modifier handling.                             |
| AC2       | Existing boxZoom tests plus RunGraph integration and browser Z drag/cancel. Rectangle fits only a valid gesture.                                                                | Gesture conflicts or shortcuts leaking into dialogs.                         |
| AC3       | Component click/hover and progress rerender checks; browser node click and attempted drag. Read-only graph and viewport survive updates. Editor drag/select remains functional. | Shared configuration accidentally enables editing or breaks editor gestures. |
| AC4       | Browser render at desktop and narrow widths plus missing-definition render ownership inspection. Graph remains contained and usable.                                            | New wrapper changes sizing.                                                  |

Independent review belongs to the existing SDLC review assignment and must use fresh context. Planning stages proceed under the user's authorization, not invented human approval. Record executed results and proof references here before candidate review.

## Executed checks

Proof is saved outside the checkout at `/tmp/interlock-runs-controls-proof/` so verification does not change the reviewed candidate. The code checked is committed with this record.

- Diagnosis: `pnpm exec vitest run tests/runGraphNavigation.test.ts` reproduced three navigation failures and one passing inspection check before the fix. `red.log` captures the differing drag defaults, missing area zoom and inconsistent zoom limits.
- AC1–AC3: `pnpm exec vitest run tests/runGraphNavigation.test.ts tests/boxZoom.test.ts tests/workflowEditor.test.ts` passed all 52 tests. `focused.log` includes the result. Existing workflow-editor tests emit React flushSync warnings but pass.
- AC1–AC4: Playwright CLI executed `browser.js` against a real temporary Engine and database on port 4387. `browser.log` contains 18 successful result records, the exact script and the fixture IDs. Actual mouse and keyboard gestures verified scroll panning, both modifier-scroll variants, middle drag, Space drag, no double-click zoom, Z area fitting, Escape cancellation, zoom buttons, fit-view, read-only run nodes, node inspection, progress completion without viewport reset, editor node dragging and Undo, and a usable graph at 760 pixels. Pinch uses the same enabled React Flow configuration in both graphs; native trackpad hardware was not exercised.
- Rendered proof inspected: `run-desktop.png`, `run-narrow.png`, `run-area.png`, and `editor-narrow.png`. Both graph containers retain their bounds and the area rectangle has the expected style. Hover changes stacking order, so the node immobility check compares its position transform rather than its entire style attribute.
- `pnpm build` passed TypeScript, Vite and package bundling. `build.log` contains the successful result and the existing large-chunk advisory.
- `pnpm format:check` passed. `format.log` contains the result.
- Documentation/API review: README and architecture now describe shared run/editor navigation. Checked current limits, CLI help implementation and MCP server definitions for navigation guidance and affected operations. No execution or API behavior changes; no MCP definition or transport changes require transport tests. This was a focused affected-flow check, not a comprehensive MCP audit. Package startup and versioning are unchanged, so package smoke was not required.

No scope changes or unresolved human decisions arose. The implementation shares viewport settings and rectangle styling while leaving authoring behavior in the editor. The shared area-zoom hook additionally ignores open dialogs, matching its documented shortcut rules.
