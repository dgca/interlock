# UI review checklist

Apply this list to a pull request's **UI evidence** screenshots, not to the diff. Each item's cited source wins on disagreement. [DESIGN.md](DESIGN.md#layout) covers desktop only. Check keyboard, focus, and announcements in the running UI ([Review before shipping](../../docs/ui-patterns.md#review-before-shipping)).

## Layout and hierarchy

- [ ] Header: title and optional subtitle left; search, filters, and view controls right, then actions, primary last. Controls that do not fit move together to a second row. ([Layout](DESIGN.md#layout), [Page layout](../../docs/ui-patterns.md#page-layout))
- [ ] A subtitle adds status, scope, or behavior and does not repeat the title. ([Layout](DESIGN.md#layout))
- [ ] Attached tabs sit directly below the header. ([Layout](DESIGN.md#layout), [Page layout](../../docs/ui-patterns.md#page-layout)) The selected tab shares the fill of the content beneath it, with no underline, gradient, or shadow. ([Components](DESIGN.md#components))
- [ ] Scoped toolbars, canvas tools, and form save buttons sit beside the area they affect. ([Layout](DESIGN.md#layout))
- [ ] Structural dividers are 1px solid rules reaching both panel edges. ([Do's and Don'ts](DESIGN.md#dos-and-donts))

## Surfaces and controls

- [ ] Structural areas use solid fills; forms sit in a solid card with a soft shadow. Not every container, badge, or icon tile gets card gradients or button elevation. ([Elevation & Depth](DESIGN.md#elevation--depth), [Do's and Don'ts](DESIGN.md#dos-and-donts))
- [ ] Buttons, fields, selects, search inputs, and segmented controls in one row share a 40px height. ([Shapes](DESIGN.md#shapes))
- [ ] Controls keep the design-system appearance, without redundant size, border, color, or shadow overrides; feature CSS arranges content and handles domain-specific exceptions. ([Design system](src/design-system/README.md#interlock-design-system))
- [ ] Primary actions are blue; low-emphasis actions use ghost buttons. ([Components](DESIGN.md#components), [Patterns](../../docs/ui-patterns.md#ui-interaction-patterns))
- [ ] Focus outlines are visible and not clipped. ([Shapes](DESIGN.md#shapes), [Page layout](../../docs/ui-patterns.md#page-layout))

## States

- [ ] Loading uses static, content-shaped skeletons; headers and tabs stay; no interactive placeholders. ([Loading views](../../docs/ui-patterns.md#loading-views))
- [ ] Loading, empty, and no-results states are distinct; a failed refresh marks retained data as possibly out of date and offers a retry. ([Page layout](../../docs/ui-patterns.md#page-layout), [Loading views](../../docs/ui-patterns.md#loading-views))
- [ ] While saving, the action keeps its label and cannot be resubmitted. ([Loading views](../../docs/ui-patterns.md#loading-views)) A rejected save keeps the input and shows the error beside the action. ([Saving and connection feedback](../../docs/ui-patterns.md#saving-and-connection-feedback))
- [ ] Field errors sit beside their field; read-only and disabled look different. ([Shapes](DESIGN.md#shapes), [Modal layout](../../docs/ui-patterns.md#modal-layout))

## Dialogs and narrow widths

- [ ] Dialogs: title and close button, scrollable body, footer ending with dismissal then primary. ([Modal layout](../../docs/ui-patterns.md#modal-layout))
- [ ] At narrow widths, action groups wrap and wide tables scroll within the workspace. ([Patterns](../../docs/ui-patterns.md#ui-interaction-patterns), [Page layout](../../docs/ui-patterns.md#page-layout))
- [ ] Placement, labels, and recovery match similar screens or the PR explains why. ([Review before shipping](../../docs/ui-patterns.md#review-before-shipping))
