# Implementation and verification

See [spec](spec.md) for AC1–AC4 and [intent](intent.md) for scope and the fixed baseline.

1. Capture the differing navigation settings through the real RunGraph component in a focused regression test before fixing them. This deterministic component check is the diagnosis loop. A direct configuration mismatch needs no speculative instrumentation or bisection.
2. Share viewport configuration between the editor and RunGraph. Reuse useBoxZoom and its existing gesture tests. Share cursor and rectangle styles. Keep authoring-specific selection and movement in WorkflowEditor.
3. Add area-zoom handling to RunGraph. Disable shortcuts when a dialog is open. Retain run node click and hover handlers and stable viewport state across progress renders.
4. Update architecture navigation documentation and add a pending patch changeset for @type_of/interlock. Inspect README, CLI help and MCP definitions for affected guidance. No API or MCP behavior changes are expected.
5. Run focused component and box-zoom tests, pnpm build, and pnpm format:check. Exercise both real views using a temporary database and Playwright. Save check output and screenshots outside the checkout.
6. Commit the candidate. The SDLC fresh reviewer inspects the complete diff, acceptance evidence and standards, and independently exercises a relevant boundary such as cancelling area zoom or updating progress during navigation. Delivery verifies the reviewed commit before opening a PR with the repository template.

| Criterion | Build-owned check and expected result | Risk |
| --- | --- | --- |
| AC1 | Component props and browser wheel, modifier wheel, middle drag, Space drag, double-click and zoom controls in both views. Matching navigation and bounds. | Different library defaults or modifier handling. |
| AC2 | Existing boxZoom tests plus RunGraph integration and browser Z drag/cancel. Rectangle fits only a valid gesture. | Gesture conflicts or shortcuts leaking into dialogs. |
| AC3 | Component click/hover and progress rerender checks; browser node click and attempted drag. Read-only graph and viewport survive updates. Editor drag/select remains functional. | Shared configuration accidentally enables editing or breaks editor gestures. |
| AC4 | Browser render at desktop and narrow widths plus missing-definition render ownership inspection. Graph remains contained and usable. | New wrapper changes sizing. |

Independent review belongs to the existing SDLC review assignment and must use fresh context. Planning stages proceed under the user's authorization, not invented human approval. Record executed results and proof references here before candidate review.
