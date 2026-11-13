# UI review checklist

Apply this list to the screenshots in a pull request's **UI evidence** section, not to the diff. Each item cites its source; when they disagree, the source wins. [DESIGN.md](DESIGN.md#layout) covers desktop only, so narrow-width items come from [UI interaction patterns](../../docs/ui-patterns.md). Screenshots cannot show keyboard behavior, focus order, or announcements; check those in the running UI ([Review before shipping](../../docs/ui-patterns.md#review-before-shipping)).

## Layout and hierarchy

- [ ] The header shows the title and optional subtitle on the left; search, filters, and view controls on the right, followed by actions with the primary action last. ([Layout](DESIGN.md#layout), [Page layout](../../docs/ui-patterns.md#page-layout))
- [ ] A subtitle adds status, scope, or behavior; it does not repeat the title or navigation. ([Layout](DESIGN.md#layout))
- [ ] The title row lines up with the sidebar brand divider. Controls that do not fit move together into a full-width second row instead of shrinking. ([Layout](DESIGN.md#layout))
- [ ] Attached tabs sit directly below the header. The selected tab shares the fill of the content beneath it, with no underline, gradient, or shadow. ([Components](DESIGN.md#components))
- [ ] Scoped toolbars, canvas tools, and form save buttons sit beside the area they affect. ([Layout](DESIGN.md#layout))
- [ ] Structural dividers are 1px solid rules that reach both edges of their panel. ([Layout](DESIGN.md#layout), [Do's and Don'ts](DESIGN.md#dos-and-donts))

## Surfaces and controls

- [ ] Structural areas use solid fills. Forms sit in a solid form card with its soft shadow. Card gradients and button elevation are not applied to every container, badge, or icon tile. ([Elevation & Depth](DESIGN.md#elevation--depth), [Do's and Don'ts](DESIGN.md#dos-and-donts))
- [ ] Buttons, fields, selects, search inputs, and segmented controls in one row share a 40px height; attached tabs are 44px. ([Shapes](DESIGN.md#shapes))
- [ ] Controls look like the shared design-system controls, without feature-specific size, border, color, or shadow overrides. ([Design system](src/design-system/README.md#interlock-design-system))
- [ ] Primary actions use the blue treatment; low-emphasis actions use ghost buttons. ([Components](DESIGN.md#components), [UI interaction patterns](../../docs/ui-patterns.md#ui-interaction-patterns))
- [ ] Interface text uses IBM Plex Sans; code, identifiers, paths, and measurements use IBM Plex Mono. ([Typography](DESIGN.md#typography))
- [ ] Status badges keep their existing labels and readable text. ([Colors](DESIGN.md#colors))
- [ ] Focus outlines are visible and not clipped by the container or table cell. ([Shapes](DESIGN.md#shapes), [Page layout](../../docs/ui-patterns.md#page-layout))

## States

- [ ] Loading uses static skeletons shaped like the content, keeps headers and tabs in place, and shows no interactive placeholder controls. ([Loading views](../../docs/ui-patterns.md#loading-views))
- [ ] Loading, empty, no results, and error look different. Empty copy appears only after a successful read, and no view shows another query's rows. ([Loading views](../../docs/ui-patterns.md#loading-views))
- [ ] A failed refresh marks retained data as possibly out of date and offers a retry beside it. ([Loading views](../../docs/ui-patterns.md#loading-views), [Saving and connection feedback](../../docs/ui-patterns.md#saving-and-connection-feedback))
- [ ] While saving, the action keeps its label and cannot be submitted again. A rejected save keeps the input and shows the error beside the action. ([Saving and connection feedback](../../docs/ui-patterns.md#saving-and-connection-feedback))
- [ ] Field errors appear beside their field. Read-only and disabled controls look different. ([Shapes](DESIGN.md#shapes), [Modal layout](../../docs/ui-patterns.md#modal-layout))

## Dialogs and narrow widths

- [ ] Dialogs show a title and close button, a scrollable body, and a footer ending with the dismissal action then the primary action. ([Modal layout](../../docs/ui-patterns.md#modal-layout))
- [ ] A blocked action offers the available next step. ([Modal layout](../../docs/ui-patterns.md#modal-layout))
- [ ] At narrow widths, action groups wrap instead of overflowing, wide tables scroll within the workspace, and long content does not trap the page in a small pane. ([UI interaction patterns](../../docs/ui-patterns.md#ui-interaction-patterns), [Page layout](../../docs/ui-patterns.md#page-layout), [Items that need attention](../../docs/ui-patterns.md#items-that-need-attention))
- [ ] Placement, labels, and recovery match the comparable existing screens, and the pull request explains intentional differences. ([Review before shipping](../../docs/ui-patterns.md#review-before-shipping))
