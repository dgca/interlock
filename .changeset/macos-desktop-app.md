---
'@type_of/interlock': patch
---

Interlock is now packaged as a native macOS desktop application (`Interlock.app`) alongside the existing CLI and browser interface.

- **macOS desktop app (`packages/desktop`)**: Native desktop interface with Dock and Menu Bar integration that keeps Interlock running in the background when the main window is closed. Features Dock badge counts and native system notifications when runs fail or need human attention.
- **"Attach, then Take Over" coexistence**: Shares the local database (`~/.interlock/interlock.db`) and port `4310` with the `interlock` CLI. The desktop app seamlessly attaches to an already-running CLI engine if present and takes over hosting the engine if the CLI process exits. Running bare `interlock` in a terminal while an engine is already healthy on the target port detects the existing server and reports its status instead of failing.
- **Login shell PATH hydration**: Automatically imports the user's macOS login shell `PATH` at launch so tools and agent harnesses installed via Homebrew, mise, nvm, or asdf resolve inside Script and Agent executions without special wrapper scripts.
- **Configurable working directory**: Workflows default their working directory to `~`, with a folder picker in settings to configure the default directory.
- **CLI helper**: Includes an **Interlock → Install "interlock" Command in PATH…** menu item to symlink the CLI command into `/usr/local/bin` or `~/.local/bin`.
- **Safe auto-updates**: Automatically checks for updates and downloads new releases via GitHub Releases in the background, safely deferring application restart while any workflow runs remain active.
- **Child process execution**: Configures `ELECTRON_RUN_AS_NODE=1` when spawning child processes from `process.execPath` for JavaScript Script nodes, background script supervisors, and MCP fallback bridges.
