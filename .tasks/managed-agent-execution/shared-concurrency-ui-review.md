# Shared concurrency UI review

The shared limit fits Interlock's incumbent dark Operate UI. The independent review returned **ship**, with no material findings in the changed regions. This extension introduces no visual-system changes or new system files.

`ExecutionSettings.tsx` uses Mantine's number input and skeleton with Interlock's existing button variants. The control inherits the dark field, rounded border, Inter typography, muted guidance, and blue primary action. `Harnesses.module.css` keeps the form compact and uses the existing spacing and divider pattern. At narrow widths, the action and recovery rows wrap instead of forcing a wider layout.

`Harnesses.tsx` places one **Concurrent assignments** control above the profiles. The default is 3. This placement makes its scope visible across all harnesses and workflows, replacing the per-profile controls and previous fixed limit of 4. The nearby guidance explains that extra assignments wait and that changing the limit does not stop running assignments.

`ExecutorSelect.tsx` displays the current shared limit as a read-only workflow hint. **Manage shared limit** links directly to the control on Harnesses. The hint uses the same muted text and link treatment as the adjacent executor guidance. It adds useful context without presenting another editable setting in the workflow dialog.

The visual evidence is in `.impeccable/review/`:

- `shared-limit-final-desktop.png` and `shared-limit-final-mobile.png` show the control at 3 with **Save limit** disabled because the value is unchanged.
- `shared-limit-workflow-desktop.png` and `shared-limit-workflow-mobile.png` show the current-limit hint and management link in workflow settings.
- `shared-limit-stale.png` shows the attempted value retained after a revision conflict, with an inline error and **Reload settings** recovery action.

The mobile Harnesses image covers the visible viewport only. Its existing persistent sidebar leaves a narrow content column and remains outside this change's scope.

Source inspection also covers integer bounds of 1 through 8, initial loading, save progress, and settings lookup errors. These states were not visually captured. After the captures, the source added a reload loading guard that disables the number input and save action and displays **Loading…**. The focused regression test in `tests/executorPermissions.test.ts` passed, as reported by the implementation task. It checks that the input stays disabled during conflict recovery and then displays the reloaded value. This document does not claim a new visual capture of that guard or full keyboard and screen-reader coverage.
