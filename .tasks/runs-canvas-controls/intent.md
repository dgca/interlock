# Runs canvas controls

The runs graph and workflow editor use different viewport controls. Users switching between them should be able to navigate with the same gestures.

Source request: "double check" the difference, "update the runs view to match the workflow view", "using the SDLC workflow and then open a PR".

Scope covers graph navigation in run inspection. Preserve read-only published graphs, node inspection, progress updates, and existing workflow editing. Editing actions such as Tidy, moving nodes, and connecting nodes remain editor-only. No execution, storage, CLI, or MCP contracts change.

Use published SDLC workflow v4, run d81fd944-c47f-4a00-b63c-4858135d4cd8, with reviewPolicy auto and createPr true. Pause for unresolved consequential decisions. No such decisions are currently open.

Repository: /Users/dan/.codex/worktrees/runs-canvas-controls/interlock

Task directory: .tasks/runs-canvas-controls

Branch: codex/runs-canvas-controls

Base commit before task commits: 46a9cc48e79932f9ee2a22575ed5cb65da4d233c

The original checkout contains unrelated work. This isolated checkout starts from the remote default branch. Preserve the user's databases and use temporary data for browser checks.
