---
title: Installation
description: Install and start Interlock on macOS or Linux.
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

Installed copies store workflows and run history in `~/.interlock/interlock.db`. Saved data survives restarts and upgrades. Scripts use the directory where you started Interlock as their default working directory.

## Install an update

Stop the running server with Ctrl+C, then install the latest version:

```sh
npm install -g @type_of/interlock@latest
interlock
```

Restart with the same database and working-directory options if you customized them. Interlock creates a database backup before applying a required schema upgrade. Refresh the browser and reconnect your agent after restarting.

Schema upgrades are one-way. Back up the database file before you upgrade, while the server is stopped, so you can return to the earlier version. Interlock also writes a copy to `interlock.db.backups/` beside the database before each upgrade. An earlier version refuses to open an upgraded database; restore the backup made before the upgrade instead. From database schema 21, each run's steps are stored in their own table, which earlier versions cannot read.

Continue with [Workflows and runs](quickstart.md), or [connect an agent](agents.md) if you already have a procedure to run.
