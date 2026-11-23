---
title: Installation
description: Install and start Interlock on macOS or Linux, from npm or as a macOS app.
---

# Installation

Interlock requires **Node.js 24.13 or later** on **macOS or Linux**. Bash Script nodes also require `/bin/bash`. You do not need a model account to run code-only workflows.

## Install and start

Install the package and start the local engine:

```sh
npm install -g @type_of/interlock
interlock
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310) in your browser. The package includes the engine, editor, CLI, and MCP tools. Keep the terminal running while you use Interlock. Closing the browser does not stop the engine; Ctrl+C in the terminal does.

To run without a global installation, use:

```sh
npx -y @type_of/interlock@latest
```

Installed copies store workflows and run history in `~/.interlock/interlock.db` by default. Set `INTERLOCK_DATA_DIR` to keep engine state in an absolute directory you choose. Scripts use the directory where you started Interlock as their default working directory. See [engine state locations](architecture.md#engine-state-locations).

## macOS desktop app

On macOS you can run Interlock as an app instead of from a terminal. It includes the engine, so it does not need Node.js.

1. Open the latest release on [GitHub Releases](https://github.com/dgca/interlock/releases).
2. Download `Interlock-<version>-arm64.dmg` for a Mac with Apple silicon, or `Interlock-<version>.dmg` for an Intel Mac.
3. Open the file and drag **Interlock** to **Applications**.

The app and CLI use `~/.interlock/interlock.db` and `http://127.0.0.1:4310` by default. Give both the same `INTERLOCK_DATA_DIR` if you configure one. You can switch between the two without moving data.

- **Closing the window does not stop Interlock.** It keeps running in the Dock and the menu bar, and notifies you when a run fails or needs you. Choose **Quit Interlock** to stop it. Quitting asks first when runs are active, because it ends them.
- **If `interlock` is already running in a terminal,** the app connects to that engine. When the terminal process stops, the app starts its own engine.
- **Workflows without their own directory run in your home folder,** not the folder where you started the CLI. Pick another folder with **Change Default Working Directory…** in the menu, and set a directory on workflows that depend on one.
- **Tools on your `PATH` are available.** The app reads the `PATH` from your login shell, so Scripts and agents find tools installed with Homebrew, mise, nvm or asdf.
- **The `interlock` command is optional.** Choose **Install 'interlock' Command in PATH…** to add it at `/usr/local/bin/interlock`. macOS may ask for your password.
- **Updates install themselves.** The app downloads a new version in the background and waits for active runs to finish before it restarts. **Check for Updates…** checks immediately.

## Install an update

The desktop app updates itself. For the CLI, stop the running server with Ctrl+C, then install the latest version:

```sh
npm install -g @type_of/interlock@latest
interlock
```

Restart with the same database and working-directory options if you customized them. Interlock creates a database backup before applying a required schema upgrade. Refresh the browser and reconnect your agent after restarting.

Schema upgrades are one-way; see [Upgrading](upgrading.md) for backups, schema changes and how to restore an earlier version.

Continue with [Workflows and runs](quickstart.md), or [connect an agent](agents.md) if you already have a procedure to run.
