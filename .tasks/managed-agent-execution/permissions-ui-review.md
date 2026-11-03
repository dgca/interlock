# Permissions UI comparison

The permissions extension preserves the incumbent visual system. This documenter pass supports the finish reviewer's supplied `ship` disposition at the scope of the permissions settings. It introduces no new visual identity or system rules.

## Evidence checked

- Read `PRODUCT.md`, Impeccable's `document.md`, and the ordinary-extension requirements in `new-work.md` Step 7.
- Compared the finished changes with `packages/ui/src/theme/theme.ts`, `theme.module.css`, `styles.css`, the shared Button and PageLayout components, and the existing Harnesses and managed-execution styles. The theme and global styles have no changes in this extension.
- Inspected all five local captures under `.impeccable/review/`: `permissions-harness-desktop.png`, `permissions-harness-mobile-overview.png`, `permissions-harness-mobile.png`, `permissions-workflow-desktop.png`, and `permissions-workflow-mobile.png`. Desktop captures are 1440 × 1000; mobile captures are 390 × 844.
- Read the existing detector result at `/tmp/interlock-permissions-design-detect.json`, which contains `[]`. No second detector pass ran.
- Reviewed the changes in `Harnesses.tsx`, `Harnesses.module.css`, `ExecutorSelect.tsx`, `permissions.ts`, `ManagedExecutionPanel.tsx`, `SettingsDialog.tsx`, `NodeInspector.tsx`, and `workflowDiff.ts`.

## Comparison

The controls retain Mantine's Inter font, blue action color, dark neutral palette, rounded fields, shared buttons, and established label treatment. Harness configuration keeps its two-column desktop grid and single-column narrow layout. The added wrapping and narrow padding let actions and descriptions fit the existing page structure.

The shared preset labels are Read only, Standard, and Full access. Harness configuration labels the setting Default permissions. Workflow settings offer Use harness default and the same presets. The workflow captures show the effective mode with its inherited or workflow-override source. Node inspection reuses that selector and explanation. Managed-execution inspection adds permission mode and source to its existing detail list, with no separate visual treatment. The last two paths received source comparison only, because the supplied captures cover harness configuration and workflow settings.

The settings dialog removes a redundant introductory sentence and places permission guidance beside the control. Spacing, existing titles, field labels, and contract editors continue to carry the hierarchy.

## Existing gaps retained

At 390 pixels, the existing 175-pixel sidebar leaves a narrow harness configuration column. The captures retain that navigation behavior; redesigning the sidebar is outside this extension.

The checkout has no `DESIGN.md` or `.impeccable/design.json`. This is an existing documentation gap, not evidence of a new visual system. Neither file was created. No UI, product context, design files, or sidecar files were changed by this documenter pass.

## Follow-up comparison after runtime cutoff removal

Compared the final `Harnesses.tsx` delta and inspected `no-runtime-cutoff-desktop.png` and `no-runtime-cutoff-mobile-advanced.png` under `.impeccable/review/`. The Execution time limit field is removed. The remaining Concurrent assignment limit uses the existing Mantine NumberInput and explains that the limit is shared across workflows using the configuration, with additional assignments waiting for a slot.

The desktop grid and narrow single-column layout retain the incumbent typography, spacing, field styling, and Advanced settings disclosure. The longer label and guidance wrap within the mobile column. This comparison supports the supplied `ship` verdict for the removal and concurrency clarity only. The existing sidebar constraint remains. No design-system change or additional repair was made.
