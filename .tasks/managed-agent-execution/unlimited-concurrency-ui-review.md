# Unlimited concurrency UI review

The Limited and Unlimited extension preserves Interlock's incumbent Mantine settings UI. The independent reviewer returned **ship**, with no material findings in the supplied captures and source. No visual-system change or new design-system files were introduced.

`ExecutionSettings.tsx` adds explicit **Limited** and **Unlimited** radio choices to the existing concurrent-assignment control. Limited defaults to 3 and shows the numeric field. Unlimited hides that field and explains that workflow requirements and resource coordination still apply. The number input no longer has the previous ceiling of 8. Source validation requires a positive safe integer for Limited. Existing loading, saving, unchanged-value, and saved-feedback behavior remains.

`Harnesses.module.css` keeps the controls together using the existing spacing, dark fields, muted guidance, rounded shapes, and blue selection and action treatment. Controls wrap into the narrow content column on mobile. The Limited radio moves about 10 px between modes, a nonblocking alignment detail. The existing narrow mobile sidebar remains outside this change's scope.

`ExecutorSelect.tsx` keeps the workflow hint read-only and displays the Unlimited explanation beside **Manage shared limit**. The hint follows the surrounding form's typography, spacing, and link treatment. The extension uses the existing settings operation and `settings.concurrency` field, with `null` for Unlimited and larger positive integers for Limited. It adds no new MCP tool or separate settings contract.

The six `.impeccable/review/unlimited-final-{limited-desktop,unlimited-desktop,limited-mobile,unlimited-mobile,workflow-desktop,workflow-mobile}.png` captures show both modes on Harnesses and the Unlimited workflow hint at desktop and mobile sizes. The supplied browser verification saved Unlimited and 25, then restored Limited at 3. The implementation task reported 1,194 passing tests, including mode switching, null and larger-limit saves, persistence, and continued resource and capability constraints. These results support behavior beyond the captured appearance.

Keyboard and hover behavior, loading and error states, intermediate widths, and very large numeric values were not visually observed in this pass. This review covers the supplied states and three UI source files, not a full accessibility or execution-flow audit.

## Latest refinement: compact dropdown

The approved **Limit to / Unlimited** dropdown supersedes the radio presentation described above. `ExecutionSettings.tsx` now uses Mantine's `NativeSelect`, consistent with the existing permission controls. The numeric field appears only for Limit to. `Harnesses.module.css` keeps the dropdown, number, and save action together on desktop. On mobile, the dropdown spans the content column above the number and save row. The dark fields, muted guidance, and button treatment remain consistent with the incumbent UI.

The four `.impeccable/review/limit-dropdown-{limited-desktop,unlimited-desktop,limited-mobile,unlimited-mobile}.png` captures show both modes with the dropdown closed. A fresh independent reviewer returned **ship**, with no findings in these states. The implementation task reported nine focused settings tests and the build passing. This refinement changes no API, runtime, default, or null semantics and introduces no design-system files.

The open menu, focus, loading, and error states were not captured. The earlier mobile sidebar limitation remains outside scope.
