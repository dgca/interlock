# Interlock design system

Import visual building blocks from this module's `index.ts`. It exports shared Interlock controls and a curated set of Mantine controls and types. A re-export retains Mantine's interface. Add a wrapper when shared behavior or a design-system contract requires one.

The design system owns typography, tokens, theme, control appearance, and context-independent compositions. Standard single-line controls and buttons are 40px high. Attached tabs are 44px. Feature-specific graph navigation keeps its deliberate flat 32px treatment.

Keep application knowledge outside this module. It must not import features, application routes, API clients, or Interlock domain types. For example, the generic Badge belongs here; mapping run and workflow statuses to that Badge belongs in `components/StatusBadge`. WorkflowCards, Sidebar, and route-aware page navigation remain application components.

Use relative imports between design-system modules. Use the public barrel from application code. Export named controls and types explicitly. Mantine hooks may be imported directly when they do not define visual appearance.

Configure shared control styling here before adding feature CSS. Feature styles arrange content and handle domain-specific exceptions. Remove redundant size, border, color, and shadow overrides when the shared control already supplies them.
