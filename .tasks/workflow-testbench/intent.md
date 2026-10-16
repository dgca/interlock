# Compare workflow behavior with saved cases

Issue [#76](https://github.com/dgca/interlock/issues/76) asks for repeatable evidence that a workflow change preserves expected behavior or improves its answers. Publication diffs describe definitions; users also need representative cases, actual executions, checks and explicit quality judgments.

Success means an agent can save cases, compare two published versions on identical inputs, inspect progress and retrieve a compact report with links to ordinary run results. Existing workflows continue to behave as before.

The accepted first increment uses MCP and the shared server API for suite and comparison operations. Existing Runs views gain small labels identifying comparison, case and baseline or candidate side. No dedicated testbench dashboard, visual suite editor, direct executor adapter, captured-output replay, automatic prompt optimizer or automatic promotion is in scope. Runs use existing connected executors and execute normal Script and Fetch actions. Separate execution failures, assertion failures and quality judgments with an explicit rubric.

The original user asked for backward compatibility and one PR per addressed issue. After recommending this feature, the assistant described the practical scope above, including five cases producing ten root runs plus ordinary children. The user approved it with "Gotcha, okay, I'm on board. Let's do it". Earlier in this conversation the user selected "Use the published SDLC workflow"; that authorization remains applicable. Follow automatic planning reviews and pause for unresolved consequential decisions at human review steps.

Use `.tasks/workflow-testbench/` in `/Users/dan/.codex/worktrees/issue-103-delete-scope/interlock`. Branch `codex/workflow-testbench` starts from original base `be09383893a6d471dd1b672ba7391e131e281a5f`. SDLC workflow v4 run is `2fef3acd-65a6-4dca-b4db-b622ad0f1d82`. Preserve unrelated research in the original checkout and all user database content. Automated checks use temporary databases and deterministic fake assignments or services.

No intent decisions remain unresolved. Specification must establish exact comparison captures, bounded execution, assertion semantics and detached lifecycle handling without changing ordinary run rules.

## MCP interface refinement

After PR #112 was opened, the user asked, "Could we reduce the number of tools? This does feel excessive". Reduce the number of MCP entry points while preserving the accepted feature and already released unrelated tools. This follow-up updates the same unmerged PR. It does not change shared server operations, persisted data, runtime rules or the Runs UI.

The agent recommends six tools with strict action-specific requests, keeping reads separate from writes and comparison preview separate from execution. An optional question offered retaining all capabilities or also trimming functionality. No capability removal was requested; proceed with the stated retention recommendation while incorporating any later user steering.

The original SDLC run completed. Follow-up v4 run `6e445176-5399-42d6-8850-228a78b6970c` reuses these artifacts and branch, with the same original base. The previously reviewed candidate `b86f00fc2a9afeba8316eae72dadc55f5a9487a2` and review chain remain attributable evidence for unchanged behavior. The eleven proposed tools have not shipped; replacing their registrations needs no legacy aliases.
