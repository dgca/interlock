# Model and effort UI review

The model and thinking effort extension fits Interlock's existing dark Operate UI. The fresh finish review by `/root/impeccable_effort_finish_review` returned **ship**, with no material findings and no required fixes. Its review covered the 11 screenshots below and the affected component source.

## Comparison with the existing UI

The controls reuse Mantine's combobox, native select, input, label, action icon, and secondary text. They inherit Inter typography, dark input backgrounds, rounded borders, blue focus treatment, and the existing modal layout from `packages/ui/src/theme/theme.ts` and `theme.module.css`. No visual identity change was needed.

`Harnesses.tsx` keeps model, thinking effort, and permissions together under the existing Execution defaults group. Available tools and Available skills are removed from the form; their advanced API fields remain supported. `ModelSettings.tsx` pairs model discovery with effort choices for the effective model. `ModelPicker.tsx` retains searchable catalog entries, explicit custom IDs, and the refresh action beside the label.

`ExecutorSelect.tsx` reuses the same controls for workflow and node defaults. Short hints beneath the fields identify the effective model and its source. Inherited effort, an explicit effort override, and Use native default remain distinct choices. The native reset stores `null`, while inheritance leaves the value unset. An incompatible model and effort combination keeps its current values visible and presents a local error with a supported-level or native-default recovery path.

`SettingsDialog.tsx` and `NodeInspector.tsx` retain the existing edit and Apply changes pattern. Managed nodes can choose concrete model and effort overrides. Connected nodes show Model tier with an advisory explanation because their connected harness chooses the actual model. Switching execution modes preserves the hidden model and effort values.

## Evidence coverage

All images are under `.impeccable/review/`. Desktop harness evidence is 1440 × 1500; other desktop images are 1440 × 1100. Mobile images are 390 × 844 and intentionally scrolled to the changed fields.

| Evidence                                                      | State covered                                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `effort-harness-desktop.png`, `effort-harness-mobile.png`     | Grouped harness model, effort, and permission defaults after removing tools and skills fields |
| `effort-workflow-desktop.png`, `effort-workflow-mobile.png`   | Workflow model and effort controls with inheritance and source hints                          |
| `effort-node-inherit-desktop.png`                             | Managed node inheriting workflow settings                                                     |
| `effort-node-override-desktop.png`, `effort-node-mobile.png`  | Managed node model and effort overrides at desktop and narrow widths                          |
| `effort-node-unsupported-desktop.png`                         | Custom model with incompatible inherited effort and local recovery guidance                   |
| `effort-node-native-desktop.png`                              | Explicit native effort reset                                                                  |
| `effort-connected-desktop.png`, `effort-connected-mobile.png` | Connected node advisory tier without concrete model and effort controls                       |

The accompanying browser checks used a temporary unpublished scratch workflow. They checked native Codex catalog effort choices without starting an account task, inheritance, an incompatible custom model, native reset, and retention when switching between connected and managed execution. The automated detector output in `/tmp/interlock-effort-detect.json` was `[]`.

Source coverage included `ModelSettings.tsx`, `ModelPicker.tsx`, `ExecutorSelect.tsx`, `Harnesses.tsx`, `NodeInspector.tsx`, and `SettingsDialog.tsx`, compared with the existing theme and grouped settings.

## Limits

Claude was not installed, and this pass did not run native account tasks. Screenshot and component review do not certify accessibility across the application. Run approval and recovery UI were outside this pass. The existing mobile sidebar and horizontal node navigation remain outside scope.

`PRODUCT.md`, `DESIGN.md`, and `.impeccable/design.json` do not exist in this worktree. This note records a narrow extension against the incumbent UI and creates no system documents. Earlier design notes remain historical records.
