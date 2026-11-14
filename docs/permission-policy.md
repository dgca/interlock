# Allow routine Agent actions with a permission policy

A managed Agent session with **Standard** permissions asks before it edits a file or runs a command. Set `permissionPolicy` on a workflow to let its managed sessions take routine actions without asking. The policy applies only in the run's own [Git worktree](https://github.com/dgca/interlock/blob/main/docs/managed-workspaces.md), so the workflow must also set `workspace`. Workflows without a policy behave as before.

In the editor, open **Workflow settings** and fill in **Permission policy**. In a definition:

```json
{
  "permissionPolicy": {
    "allow": [
      { "kind": "read" },
      { "kind": "edit" },
      { "kind": "command", "pattern": "git status *" },
      { "kind": "command", "pattern": "pnpm test *" },
      { "kind": "tool", "name": "WebSearch" }
    ]
  }
}
```

| Rule                               | Allows                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `{ "kind": "read" }`               | Reading files inside the run workspace (Claude Code `Read`, `Glob`, `Grep`, `LS`).        |
| `{ "kind": "edit" }`               | Creating and editing files inside the run workspace.                                      |
| `{ "kind": "command", "pattern" }` | A command that matches the pattern, run from inside the run workspace.                    |
| `{ "kind": "tool", "name" }`       | One named harness tool, such as `WebSearch` or an MCP tool name. Claude Code and Pi only. |

## The policy never reaches outside the workspace

The run workspace is the run's managed Git worktree. A rule allows an action only inside it. Without a managed worktree, or while it is unavailable, the policy does not apply and every action asks. An action the policy does not allow still asks, and the request appears in **Review request** as before. **Read only** and **Full access** profiles are unchanged: a policy never widens **Read only**.

Command patterns are plain words. A final `*` allows further arguments; without it the command must match exactly. `git status *` matches `git status --short` but not `git push`. Interlock matches conservatively and asks whenever it is unsure:

- Commands joined with `&&`, `||`, `;`, `|` or new lines must each match a rule. `git status && rm -rf src` asks.
- Command substitution, variables (`$`), backticks, subshells, heredocs, background jobs, globs such as `*.ts` outside quotes, and leading `NAME=value` assignments ask.
- Every argument matched by `*`, every option value (`--option=value` and attached short values such as `-C..` or `-tdir`) and every redirection target must resolve inside the workspace. Interlock follows symbolic links and `..` the way the system does, so `cat link/../secret` or a link to a file outside the workspace asks. `/dev/null` is allowed. Writing a file through a redirection (`>`, `>>`) or an output option (`git --output`, `git format-patch -o`, `sort -o`) counts as an edit: without an `edit` rule it asks.
- Edits, redirection targets and command arguments never reach Git's own files: any path with a `.git` component, in any letter case, and anything inside the repository's Git directory ask. Writing them would let a later `git status` run a configured program. `.gitattributes` and `.gitmodules` are ordinary files; Git only runs programs that its configuration names.
- A rule cannot start with a program that runs other programs, such as `bash`, `env`, `xargs`, `sudo` or `cd`. Interlock also asks for a few arguments that run other programs or write elsewhere: `find -exec` and `-delete`, `rg --pre`, `git -c` and `tar --to-command`.

A wildcard rule trusts the program with any arguments that stay in the workspace. Wide rules such as `git *`, `sed *`, `awk *`, `node *` or `npm run *` can run anything: `sed` has an `e` command that runs its text, `awk` has `system()`, and `git config` can name programs that later Git commands run. `pnpm test *` runs whatever the repository's test script does, and `node *` runs any code. Interlock checks paths named in the command; it does not check files a program reaches on its own, such as a directory walk that follows links.

- A command asks when any directory between its working directory and the worktree root looks like a repository (a `HEAD` file or a `.git` entry), so Git and tools that call it only find the worktree's own repository. `git -C`, `--git-dir`, `--work-tree` and `--namespace` ask.
- Clustered short options are checked letter by letter: `cp -vt.. f` and `tar -xvIprog` ask.

### Limits

Command rules are a convenience for a workflow you trust, not a sandbox. A rule for a tool that runs other programs or reads configuration from the tree, such as Git, package managers, test runners and build tools, lets code in the workspace run with your permissions. With an `edit` rule, an Agent can write that code first. Keep such rules to workflows and repositories you would run yourself.

## How each harness applies it

| Harness     | Read      | Edit                        | Command      | Tool                          |
| ----------- | --------- | --------------------------- | ------------ | ----------------------------- |
| Claude Code | Yes       | Yes                         | Yes (`Bash`) | Yes                           |
| Codex       | No prompt | Yes (file change approvals) | Yes          | Asks; Codex has no tool names |
| Pi          | No prompt | Yes (`edit`, `write`)       | Yes (`bash`) | Yes                           |
| Custom      | —         | —                           | —            | —                             |

Interlock answers the harness's own approval request, so the harness's native rules and sandbox still apply first. Under a policy, Claude Code returns Bash to the session directory after each command. Custom harnesses never receive the policy; their requests still reach a person. A rule a harness cannot apply is listed in the report as not applied, and those actions ask.

Each managed execution keeps the count of actions the policy allowed and its latest 50, each with the rule that matched and the time. They are in the execution's `permissionPolicy.allowed` returned by MCP `manage_executors` and `interlock executors` with `action: "inspect"`.

## Imported and agent-written policies wait for a person

A policy grants an Agent actions, so it is reviewed like a Script. Import review lists each workflow's policy next to its Scripts and worktree settings. A policy that arrives in an import, or that an agent writes over MCP, does not apply until a person approves it: a new run waits at its entry with an **Approve permission policy** request in Review. A run already past its entry keeps going and its Agents keep asking. Approval applies to that exact policy in that workflow. A person's own edit applies without approval. With Script approval set to **Off**, policies apply without approval too.

Under a policy, an Agent that can edit workflows over MCP can still add Script nodes. Set Script approval to **Imports and agents** to make those Scripts wait for a person as well.

## Approvals in the report

The workflow report's **Permission approvals** section lists, per run, how many permission requests asked a person and how many the policy allowed, and any rule that was not applied. `workflow_report` returns the same data as `approvals`. Questions are not counted, and connected agents' own permission prompts are not visible to Interlock.
