# Interlock design system

Import visual building blocks from this module's `index.ts`. It exports shared Interlock controls and a curated set of Mantine controls and types. A re-export retains Mantine's interface. Add a wrapper when shared behavior or a design-system contract requires one.

The design system owns typography, tokens, theme, control appearance, and context-independent compositions. Standard single-line controls and buttons are 40px high. Attached tabs are 44px. Feature-specific graph navigation keeps its deliberate flat 32px treatment.

Keep application knowledge outside this module. It must not import features, application routes, API clients, or Interlock domain types. For example, the generic Badge belongs here; mapping run and workflow statuses to that Badge belongs in `components/StatusBadge`. WorkflowCards, Sidebar, and route-aware page navigation remain application components.

Use relative imports between design-system modules. Use the public barrel from application code. Export named controls and types explicitly. Hooks from `@mantine/hooks` define no visual appearance and may be imported directly. Hooks from `@mantine/core`, such as `useCombobox`, go through the barrel like its controls.

Configure shared control styling here before adding feature CSS. Feature styles arrange content and handle domain-specific exceptions. Remove redundant size, border, color, and shadow overrides when the shared control already supplies them.

## Lint rules

`pnpm lint` enforces this contract for `packages/ui/src` outside `design-system/`. The rules live in `scripts/eslint-design-system.js` and are configured in `eslint.config.js`. TypeScript and CSS share one ESLint run: CSS files use the `@eslint/css` language.

- `design-system/no-mantine-import`: import Mantine controls, types and `@mantine/core` hooks from this module's `index.ts`. Only `@mantine/hooks` may be imported directly.
- `design-system/no-raw-color`: no hex, `rgb()`, `hsl()` or other color-function literals in TypeScript strings or CSS values, including CSS custom properties. Use `var(--token)` from `tokens.css` or a theme color. `color-mix()` over tokens is allowed.
- `design-system/no-inline-style`: `style` objects may set only layout properties. Color, spacing, border, shadow, typography and other appearance belong in a CSS module. The allowed properties, listed in `layoutStyleProperties` in the rule file, are:
  - position: `position`, `inset`, `top`, `right`, `bottom`, `left`, `zIndex`, `display`, `visibility`, `boxSizing`
  - size: `width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, their logical `inlineSize` and `blockSize` forms, and `aspectRatio`
  - flex and grid: `flex`, `flexGrow`, `flexShrink`, `flexBasis`, `flexDirection`, `flexWrap`, `flexFlow`, `order`, `gridArea`, `gridTemplateColumns`, `gridTemplateRows`, `gridTemplateAreas`, `gridColumn`, `gridRow`, `gridAutoFlow`, `gridAutoColumns`, `gridAutoRows`
  - alignment: `alignItems`, `alignSelf`, `alignContent`, `justifyContent`, `justifyItems`, `justifySelf`, `placeItems`, `placeSelf`, `placeContent`
  - overflow and line breaking: `overflow`, `overflowX`, `overflowY`, `overflowWrap`, `wordBreak`, `whiteSpace`
  - other: `transform`, `transformOrigin`, `pointerEvents`, and CSS custom properties (`--name`), whose values CSS modules consume
  - The rule checks object literals written in the `style` attribute, including both branches of conditionals, `&&`, `as` casts, computed string keys such as `['color']`, and objects returned by style functions such as `style={() => ({ … })}`.
- `design-system/control-height`: control heights must be 32px, 40px or 44px.
  - In TypeScript it checks the `size`, `h`, `mih` and `style` heights of `Button`, `ActionIcon`, `TextInput`, `PasswordInput`, `NumberInput`, `Autocomplete`, `Select`, `MultiSelect`, `NativeSelect`, `TagsInput`, `Input`, `InputBase` and `SegmentedControl`. Mantine size names resolve through the theme: `xs` to `md` buttons and inputs are 40px.
  - In CSS it checks fixed `px` heights on selectors whose last part styles a control (`button`, `input`, `select`, `textarea`, `[role=button]`, or a class name containing button, btn, input, field, select, control, search, segment or toggle), and Mantine `--button-height-*`, `--input-height-*` and `--ai-size-*` overrides. Prefer `var(--control-height)`.

Known limits. These rules are heuristics, so review still matters:

- `no-inline-style` does not follow variables: `style={style}` and module-level style constants are not checked.
- Spacing or color routed through a CSS custom property in an inline style (`style={{ '--gap': '12px' }}`) passes `no-inline-style`. Raw colors in the value are still caught by `no-raw-color`.
- `transform` and `transformOrigin` count as layout, so inline transforms pass.
- `control-height` matches components by their plain JSX name. Namespaced or aliased components (`<M.Button h={36}>`, `const Action = ActionIcon`) are not checked.
- `control-height` checks only plain `px` values and numbers. `rem`, `em` and `calc()` heights are not checked.
- In CSS, `control-height` recognises controls by element or class name only. A control styled through an unrelated class name is not checked.
- `no-raw-color` checks hex and color functions only. Named colors such as `red` or `white` are not checked.

The documented sizes are 40px for standard controls, 44px for attached tabs, and 32px for segments and graph tools.

Existing violations are recorded in `eslint-suppressions.json` under the `design-system/*` rule names, with a count per file. A file may not add violations. When you fix some, run `pnpm lint --prune-suppressions` so the baseline shrinks. Do not add new entries with `--suppress-rule`; change the design system instead.

## Request a token or control

When a screen needs a value or control the design system lacks, add it here rather than in feature code:

- **Token:** add the custom property to `tokens.css`, and to `theme.ts` if Mantine components need it, using a value from the approved design in `packages/ui/DESIGN.md`. A value that the approved design does not contain needs design approval first; propose it in an issue labelled `area:ui`.
- **Control or variant:** re-export the Mantine control from `index.ts`, or add a wrapper when shared behavior or a size or appearance contract requires one. Configure its appearance in `theme.ts` and `theme.module.css`. A size outside 32px, 40px and 44px is a new documented size: record it in `DESIGN.md` and in the `controlHeights` list in `scripts/eslint-design-system.js` in the same change.
