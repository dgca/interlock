# Model selection UI review

The final model controls fit Interlock's incumbent dark Operate UI. No visual-system change was approved or needed. The independent finish review returned **ship**, with no material findings in this scope.

`ModelPicker.tsx` uses Mantine's combobox, input, text, loader, and action icon. It inherits the existing Inter typography, dark inputs, rounded borders, muted secondary text, and blue interaction treatment from `theme.ts` and `theme.module.css`. The catalog's model names and smaller IDs follow the existing form hierarchy. The refresh icon stays beside the field label, and the list has bounded scrolling.

`Harnesses.tsx` places **Default model** in the existing configuration grid beside permissions. **Use CLI default** makes the unset value explicit. `ExecutorSelect.tsx` adds **Agent model** to the workflow form with **Use harness default** and a separate source hint. `SettingsDialog.tsx` keeps the existing local edit and Apply changes pattern. `NodeInspector.tsx` reuses the same executor component to describe the effective workflow model without adding a node-level model editor.

The custom-ID capture shows an explicit **Use custom model** option while the catalog loads. The error capture keeps `custom-gateway-model` selected and places the refresh/custom-ID recovery message beneath the field. Source inspection confirms that search and catalog requests do not change the saved value. `ManagedExecutionPanel.tsx` adds model provenance to the existing execution-details list when a model value is present, using the same muted detail layout.

The visual evidence is in `.impeccable/review/`:

- `model-final-harness-desktop.png` and `model-final-harness-mobile.png` show the harness catalog and responsive configuration fields.
- `model-final-workflow-picker-desktop.png` and `model-final-workflow-override-desktop.png` show the workflow catalog and an explicit override with its source.
- `model-final-workflow-mobile.png` and `model-final-workflow-picker-mobile.png` show the narrow workflow dialog and open catalog.
- `model-final-custom.png` and `model-final-error.png` show custom entry during loading and the preserved selection after a catalog error.

The narrow harness capture retains the pre-existing persistent sidebar, which leaves little content width. This review does not expand scope to repair that layout. Node inspector and execution provenance were reviewed in source only, not captured. These images establish appearance for the listed states, not complete keyboard, screen-reader, or execution-flow coverage.

There is no `DESIGN.md` or `PRODUCT.md` in this worktree. This review records the extension against the incumbent theme and components. It creates no system files and does not repair unrelated drift.
