# Interlock v2 Pen design system

The design system is in the `Interlock / Design system` section, `r93lT`, of [the Pen file](../interlock-design-directions.pen). It contains 57 cataloged UI masters across 12 component and inventory boards, alongside the existing approved overview and logo.

The UI source pass covered all 93 TSX files and the shared theme. [The source manifest](ui-source-inventory.json) also lists all 43 stylesheets. The [70-family inventory](component-inventory.md) distinguishes existing shared components, directly used Mantine controls, repeated compositions, feature-specific editors, and v2 candidates. It reflects the working tree, including local changes already present before this task.

## Boards

| Board                | Pen frame | Purpose                                                   |
| -------------------- | --------- | --------------------------------------------------------- |
| foundations          | `aS9ja`   | Reusable specimens and usage guidance                     |
| actions              | `yI89a`   | Reusable specimens and usage guidance                     |
| fields               | `ao4U0`   | Reusable specimens and usage guidance                     |
| selection            | `HXkhB`   | Reusable specimens and usage guidance                     |
| navigation           | `Q572yF`  | Reusable specimens and usage guidance                     |
| feedback             | `D498d`   | Reusable specimens and usage guidance                     |
| compositions         | `mqoKN`   | Reusable specimens and usage guidance                     |
| product              | `q5g1i`   | Reusable specimens and usage guidance                     |
| inventoryPrimitives  | `qDeLu`   | Source ownership, implementation route, and coverage gaps |
| inventoryPatterns    | `yGlKF`   | Source ownership, implementation route, and coverage gaps |
| inventorySpecialists | `UvuPr`   | Source ownership, implementation route, and coverage gaps |
| dialogs              | `R93g55`  | Reusable specimens and usage guidance                     |

## Using the library

Use instances of the reusable masters in the component picker. Adjust content, optional icons, selected state, and the semantic surface through instance overrides. Compose labeled fields, form cards, page headers, and modal shells from those primitives. The [master index](pen-component-index.json) maps names to Pen IDs.

Standard buttons, single-line controls, and segmented tracks are 40px high. Segmented interiors are 32px plus 4px track padding. Tabs are 44px. The flat vertical canvas tools stay 32px. Pen masters use explicit numeric dimensions because variable-based size insertion resolved some new controls to content height during validation. Named size variables still document the scale; master instances share the rendered geometry.

Selected attached tabs use a solid fill matching the owned surface. Preserve the full-width boundary and the bridge beneath the selected tab. Actions belong in the padded header row above the tabs. Headers are 76px without a subtitle and 88px with meaningful status or context beneath the title.

The tab-strip boundary is a separate 1px layer behind the tab items, not a bottom stroke on the strip frame. A flexible spacer keeps it on the bottom edge at either strip height. The selected item has no bottom stroke and covers the boundary with its owned-surface fill, preventing a seam beneath the selected tab.

Structural dividers use solid, pixel-aligned 1px layers in `interlock-divider`, `#333333`, across masters and screen examples. They reach the panel edges across content padding. Pen uses filled rectangles instead of frame-edge strokes to avoid partial-pixel coverage. Input borders and 2px focus or selection outlines retain their separate roles.

The sidebar and screen examples omit Recent workflows and a generic Settings destination. Recent workflows is not planned; dedicated settings navigation can be designed later. This does not remove existing feature-specific settings, workflow actions, or editors from the inventory.

The application mockups now use 52 direct instances of library masters, including buttons, fields, segmented controls, attached strips, editor toolbars, flat canvas controls, and the node modal. Compositions contain further nested primitive instances. Full sidebar rails, run-card variants, page headers, and graph nodes retain some existing screen-local structure; their extracted masters are references for subsequent consolidation, not a claim that every layer has been converted.

## Approval and coverage

Screen-derived appearances are the baseline. New checkbox/radio/switch treatments, menus, notifications, generic confirmation and list patterns, workflow-card and timeline specimens, and newly drawn interaction states are proposals. Their boards identify this status. Do not treat every specimen as approved merely because it appears in the library.

The inventory records required variants separately from drawn coverage. Specialist editors, import and connection flows, recovery/permission/question flows, report and usage layouts, policy forms, secret replacement, and bulk cleanup remain discoverable with source owners. They need dedicated v2 coverage before their migration. A generic field or modal is not a complete design for those flows.

A Pen component does not imply a new React wrapper. Keep Mantine styling direct when possible, preserve existing shared modules, and retain feature-specific contracts for graph geometry, validation, ordered references, secrets, and execution behavior.

## Verification

- Compared the migrated controls with their original outer bounds; all 53 recorded migrations matched after resolving Pen sizing.
- Verified standard control heights and rendered representative full application screens, modal, fields, tabs, cards, and library boards.
- Checked reusable master and instance references, inventory source paths, and source-file coverage.
- Replaced 104 structural frame-edge strokes with solid divider layers and verified that existing child bounds stayed unchanged. Resolved divider instances use the shared color and integer coordinates on their thickness axis.
- Static desktop specimens do not verify keyboard behavior, focus trapping/return, portal placement, responsive layouts, or every long-content state. Existing runtime semantics remain authoritative.

No application source was changed by this design-system work.
