---
name: Interlock Grid
description: Approved desktop visual target from the canonical Pen design.
colors:
  structural: '#1A1A1A'
  workspace: '#151515'
  inset: '#121212'
  form: '#212121'
  divider: '#333333'
  input-border: '#3A3A3A'
  command-divider: '#333333'
  primary-top: '#3F64F7'
  primary-bottom: '#3155EB'
  neutral-top: '#303030'
  neutral-bottom: '#252525'
  nav-top: '#2F2F2F'
  segment-top: '#393939'
  segment-bottom: '#2D2D2D'
  card-top: '#262626'
  card-bottom: '#1C1C1C'
  node-top: '#292929'
  node-bottom: '#202020'
  node-selection: '#6C8AFF'
  field-focus: '#7B99FF'
  error-border: '#E28F8F'
  error-copy: '#F1A8A8'
  disabled-text: '#929292'
  heading-text: '#F1F1F1'
  field-text: '#E6E6E6'
  button-text: '#DEDEDE'
  primary-text: '#FFFFFF'
  label-text: '#B8B8B8'
  helper-text: '#A6A6A6'
  attention-text: '#EFB569'
  attention-bg: '#332A1E'
  running-text: '#88AEFF'
  running-bg: '#222B40'
  completed-text: '#8BD3A9'
  completed-bg: '#213126'
typography:
  heading:
    fontFamily: IBM Plex Sans, sans-serif
    fontSize: 28px
    fontWeight: 600
  heading-large:
    fontFamily: IBM Plex Sans, sans-serif
    fontSize: 30px
    fontWeight: 600
  section:
    fontFamily: IBM Plex Sans, sans-serif
    fontSize: 18px
    fontWeight: 600
  card-title:
    fontFamily: IBM Plex Sans, sans-serif
    fontSize: 19px
    fontWeight: 500
  body:
    fontFamily: IBM Plex Sans, sans-serif
    fontSize: 14px
  body-large:
    fontFamily: IBM Plex Sans, sans-serif
    fontSize: 15px
  label:
    fontFamily: IBM Plex Sans, sans-serif
    fontSize: 13px
    fontWeight: 500
  helper:
    fontFamily: IBM Plex Sans, sans-serif
    fontSize: 12px
  page-subtitle:
    fontFamily: IBM Plex Sans, sans-serif
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: IBM Plex Mono, monospace
rounded:
  control: 6px
  card: 12px
  node: 9px
spacing:
  gap-small: 12px
  gap-large: 24px
  form-padding: 24px
  workspace-padding: 28px
components:
  button-primary:
    textColor: '{colors.primary-text}'
    rounded: '{rounded.control}'
    height: 40px
    padding: 0 16px
  button-neutral:
    textColor: '{colors.button-text}'
    rounded: '{rounded.control}'
    height: 40px
    padding: 0 16px
  field:
    backgroundColor: '{colors.inset}'
    textColor: '{colors.field-text}'
    height: 40px
    rounded: '{rounded.control}'
    padding: 0 12px
  sidebar:
    backgroundColor: '{colors.structural}'
    width: 256px
  form-card:
    backgroundColor: '{colors.form}'
    rounded: '{rounded.card}'
    padding: '{spacing.form-padding}'
  run-card:
    typography: '{typography.card-title}'
    rounded: '{rounded.card}'
  graph-node:
    rounded: '{rounded.node}'
---

# Design System: Interlock Grid

## Overview

**Approved target design.** This document records the user-approved desktop Pen mockups. It does not describe the current shipped CSS or claim that the redesign is implemented.

The canonical visual reference is [interlock-design-directions.pen](../../interlock-design-directions.pen). The `Interlock / Design system` section `r93lT` contains the approved overview `yqQ5c`, reusable component boards, and source-backed inventory boards. Application references are Runs `YsC4K`, workflow editor `pJq1n`, schedule form `DBUrn`, and harness form `a5Faf`.

The [Pen library guide](../../designs/design-system.md), [master index](../../designs/pen-component-index.json), and [component inventory](../../designs/component-inventory.md) record reuse and coverage. Screen-derived treatments are the baseline. Newly drawn interaction states and patterns are labeled proposals; their presence in the library does not make them approved or implemented.

Grid uses solid structural containers, recessed fields, and modest elevation for controls, workflow cards, and graph nodes. Compact typography leaves space for execution data and direct authoring.

The YAML tokens define the approved values. [.impeccable/design.json](.impeccable/design.json) extends them with gradients, shadows, and static component specimens. [PRODUCT.md](PRODUCT.md) and the linked product documentation remain authoritative for capabilities and execution behavior. Mockup data represents examples, not live metrics.

## Colors

Blue identifies primary actions and focus. Neutral tones distinguish structural containers, workspace, inset areas, and forms.

Shell navigation, headers, toolbars, inspectors, and full-height preview rails share `structural`. The workspace uses `workspace`. Fields and graph canvases use `inset`. Form containers use the solid `form` fill with their approved soft shadow.

Text tokens record representative roles verified in the approved frames. Component-specific text shades still vary in the mockups. The tokens do not assert that every caption has been normalized.

Status badges use flat fills with readable status text. Permission requested and Recovery needed share the attention pair. Running uses the running pair, and Completed uses the completed pair. Existing status semantics and labels remain intact.

## Typography

IBM Plex Sans supplies interface text. IBM Plex Mono supplies code, identifiers, paths, and measurements.

Page headings use `heading` or `heading-large`. Section headings use `section`, and run-card titles use `card-title`. Body text and controls use `body` or `body-large`; labels and helper copy use their corresponding roles. No new line-height or letter-spacing scale is established here.

## Layout

This direction covers desktop screens only. Responsive breakpoints and mobile layouts remain unresolved.

The sidebar is 256px wide. Its brand container and workspace page headers share an 88px minimum height through `--page-header-height`, aligning their bottom dividers in standard desktop layouts. The logo remains 32px. Workspace padding is 28px, form padding is 24px, and typical gaps span 12px to 24px.

The v2 sidebar omits Recent workflows and a generic Settings destination. Recent workflows is outside the planned scope; dedicated settings navigation may be designed later. Apply this scope to both screen examples and the reusable sidebar. Existing feature-specific settings and editors remain part of the UI inventory.

Section headers separate title and actions from attached tabs. Place action buttons, filter controls, and presentation controls in a padded row above the tabs. Standard page headers use the shared 88px minimum height with vertically centered titles and 40px actions. Headers can grow when content or actions wrap. Only the tabs meet the content boundary. Apply corrections to this shared pattern across every screen that uses it.

Page subtitles are optional. Use them for meaningful status, scope, or behavior rather than repeating the title. Title-only and two-line headers share the same 88px minimum height. A vertical title/subtitle block has a 4px gap. Subtitles use `page-subtitle` typography and `label-text`; 40px actions remain vertically centered. Workflow editor views group draft and publication status beneath the name, replacing the separate Draft badge and publication label. Harnesses demonstrates explanatory copy beneath its heading.

Structural dividers are solid, pixel-aligned 1px layers in `divider`, including command-bar separators. The `command-divider` alias has the same color. Each divider reaches both edges of its containing panel, across content padding. Pen uses filled rectangles instead of frame-edge strokes to avoid partial-pixel coverage. Control borders retain `input-border`; focus and selection outlines retain their deliberate 2px width. Headers, navigation, and preview rails retain solid fills around the recessed graph canvas.

## Elevation & Depth

Structural containers use solid backgrounds. Form containers preserve their soft shadow. Controls use subtle top-to-bottom gradients with small offset shadows. Workflow cards, run cards, and graph nodes have their own gradient and shadow treatments.

The sidecar records these approved treatments:

| Role                       | Gradient tokens, top to bottom    | Shadow token                   |
| -------------------------- | --------------------------------- | ------------------------------ |
| Primary button             | `primary-top` to `primary-bottom` | `primary`                      |
| Neutral button             | `neutral-top` to `neutral-bottom` | `neutral`                      |
| Selected navigation        | `nav-top` to `neutral-bottom`     | `selected-nav`                 |
| Selected segmented control | `segment-top` to `segment-bottom` | No additional shadow specified |
| Workflow and run cards     | `card-top` to `card-bottom`       | `card`                         |
| Graph node                 | `node-top` to `node-bottom`       | `node`                         |
| Form container             | Solid `form`                      | `card`                         |

Some approved neutral buttons omit the shadow while retaining the gradient. Badges and icon tiles do not automatically inherit button elevation. Ordinary containers retain solid fills.

## Shapes

Standard buttons, single-line fields, selects, search inputs, and segmented controls share a 40px outer height. Segmented tracks use 4px padding around 32px-high segments. Align controls by their outer bounds when they appear in the same row. Main buttons and fields use a 6px radius. Compact canvas tools retain their purpose-specific sizes; the vertical editor stack uses 32px buttons. Attached tabs remain 44px high, navigation rows retain their own spacing, and multiline fields size to their content. Form containers and workflow or run cards use a 12px radius. Graph nodes use a 9px radius.

Input borders use `input-border`. Field focus uses a 2px `field-focus` outline. Error fields use `error-border` with `error-copy`; disabled field text uses `disabled-text`. Read-only and disabled controls remain distinct states.

## Components

The approved [Interlock logo](../../designs/interlock-logo.svg) appears at 32px beside the sidebar wordmark. Its gray-to-dark-gray gradient tile carries electric blue and orchid squares with alternating overpasses and underpasses. The Pen file retains the [previous logo](public/favicon.svg) for reference. The released favicon is unchanged.

Standard controls retain Mantine semantics and the shared theme. Shared form and contract editors retain their validation and editing behavior. Custom graph nodes retain their graph interactions. See [UI components](../../docs/architecture.md#ui-components).

Primary actions use the blue gradient and white text. Neutral buttons use the neutral gradient and light text. Selected navigation and selected segmented controls use their separate neutral gradients.

Horizontal section tabs use the approved solid attached treatment. The selected tab has 8px top corners, square bottom corners, and a 1px top and side border in `input-border`. Its solid fill matches the content surface beneath it: `workspace` for Runs and Harnesses, or `inset` for the Workflow editor canvas. Tabs are 44px high with 20px horizontal padding and 6px gaps. Selected labels use 14px semibold `heading-text`; inactive labels use 14px medium `label-text`. The boundary spans the container, with the selected tab covering its own portion to join the content surface. The strip boundary sits behind the tab items; the strip frame itself has no foreground bottom stroke. Tabs have no gradient, shadow, enclosing track, or selected-label underline. Segmented controls such as Interval/Cron and Visual/Raw retain their existing gradient treatment. The Agent modal's vertical section navigation remains unchanged.

Forms group editable content in solid, padded containers with the approved soft shadow. Full-height preview rails remain structural containers. Workflow and run cards use their dedicated gradient, while selected graph nodes retain the 2px `node-selection` outline.

The sidecar specimens document visual treatments only. They do not replace production components. The approved static frames establish no new hover treatment, animation, or transition timing.

## Do's and Don'ts

- Do use solid fills for structural containers and preserve the form-container shadow.
- Do extend dividers to the edges of their containing panel, across content padding.
- Do preserve status text, Mantine semantics, and shared form and contract editors.
- Don't apply card gradients or button elevation to every container, badge, or icon tile.
- Don't infer new capabilities, live metrics, responsive rules, or motion from the static mockups.
