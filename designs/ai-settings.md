# AI Settings layout proposal

This is a static desktop proposal in [the Pen file](../interlock-design-directions.pen), under `Interlock / AI settings` (`Q9js48`). It extends the current Grid design system and does not change the application.

## Views

| View                         | Pen frame | Scope                                                      |
| ---------------------------- | --------- | ---------------------------------------------------------- |
| Harnesses                    | `etJqN`   | Installation, enable state, and configuration actions      |
| Model aliases                | `xbC7P`   | Current empty state and New alias entry                    |
| New alias                    | `BvBJr`   | Focused creation editor with two ordered choices           |
| Execution settings           | `c4PmOj`  | Concurrency, stall detection, idle recovery, and retention |
| Model aliases, saved example | `uHZKS`   | Illustrative populated collection, not live saved aliases  |

## Structure

Use three attached task tabs within AI Settings: Harnesses, Model aliases, and Execution settings. They replace the long stacked settings page. Keep dirty-edit navigation protection when changing tabs or leaving an editor.

Collections and policy forms use a 1040px content column. Alias editing uses an 840px column. Both begin at the existing 28px workspace inset. These widths belong to this surface proposal, not to a new global control or layout token.

New alias opens a focused subview in the Model aliases section. Its metadata, choice fields, ordering controls, add action, and footer share one bounded container. A single solid form surface contains the model choices, with full-width dividers rather than nested cards. Two 384px field columns fit inside the padded form; the choices no longer expand to the full page width.

Header actions align to their content column. Standard controls retain 40px heights and shared Pen masters. Containers remain solid; buttons retain the approved elevation. The existing 44px attached tabs match the owned workspace surface.

The sidebar proposal includes the existing scoped AI Settings destination. It does not restore a generic Settings page or Recent workflows.

## Source behavior retained

- Harness installation state, enable controls, Configure, Check installations, Add configuration, setup guidance, and authentication caveat remain visible. Installation checks make no model calls.
- Model aliases keep ordered candidates, workflow-harness inheritance, explicit model choice, add/remove/reorder, optional description, and Save/Cancel.
- Candidate order selects the first choice with an available harness configuration. It does not retry a failed request on another model.
- Thinking effort remains conditional on a model or effort value and its available capabilities. It is not shown in the pictured blank-model draft; after selection it stays within the candidate's model column.
- The source enables Save alias for a dirty draft and validates name/model values on submit. The draft specimen preserves this behavior.
- Alias names/custom model IDs in the populated collection and draft are illustrative. Current runs retain their captured alias configuration. Preserve stable picker identities, rename guidance, revision-conflict reload behavior, and consequential deletion confirmation.
- Concurrency, stall policy, and retention keep separate save boundaries. Changing concurrency does not stop running assignments.
- A stall adds Needs attention without failing the run. Pauses and declared holds do not count; planned waits and active child workflows are excluded from run-transition stalls.
- Managed idle recovery retains its custom-launcher requirements. Enabled thresholds/recovery reveal the existing duration, recovery-count, and message controls within the same bounded section.
- Retention keeps workflow/published versions, protects active/protected history, and warns about permanent deletion of run inputs, outputs, and usage. Enabled retention reveals existing age/count fields.
- Preserve loading, refresh failure, validation, missing/disabled harnesses, unknown model capabilities, pagination, busy states, and discard protection. These are not all exhaustively drawn.

Source owners: [Harnesses](../packages/ui/src/features/executors/Harnesses.tsx), [ModelAliases](../packages/ui/src/features/executors/ModelAliases.tsx), [ModelSettings](../packages/ui/src/features/executors/ModelSettings.tsx), [ExecutionSettings](../packages/ui/src/features/executors/ExecutionSettings.tsx), [StallSettings](../packages/ui/src/features/executors/StallSettings.tsx), and [RetentionSettings](../packages/ui/src/features/runs/RetentionSettings.tsx).

## Evidence and limits

The live route was inspected at its resting state and after opening New alias at 1600px viewport width. The inline form had 640px metadata alongside choice fields spanning the approximately 1254px body, which explained the disconnected layout. The draft was cancelled without saving.

Harness states and the disabled concurrency/stall/retention save states reflect that inspection. The alias draft and saved-alias collection are illustrative. The proposal is desktop-only and does not verify keyboard/focus behavior, portal positioning, narrow layouts, or actual route changes.

Rendered previews are exported to `/tmp/interlock-ai-settings-design/`. All application controls continue to use the existing design system; the proposed information architecture and compositions await user review.

An independent finish review returned **ship** for the static desktop proposal, with no material findings across the five previews. A separate documentation review found the proposal consistent with the established system and source contracts. Neither review validates a running implementation or establishes user approval of the new layout.
