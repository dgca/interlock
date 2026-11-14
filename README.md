# Interlock

[Documentation](https://dgca.github.io/interlock/docs/) · [Website](https://dgca.github.io/interlock/)

Interlock turns a procedure you repeat with AI agents into a workflow that runs the same way every time, on your own machine. A workflow combines agent assignments with scripts, HTTP requests, branches, waits and human decisions. Interlock checks each step's data against its contract, keeps every run in a local SQLite database, and shows progress in your browser.

Use it when you want agent work to follow a known path, stop for your decisions, and leave a record you can inspect.

## Quick start

You need **Node.js 24.13 or later** on **macOS or Linux**. Bash Script steps also need `/bin/bash`.

```sh
npm install -g @type_of/interlock
interlock
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). Keep the terminal running; Ctrl+C stops Interlock. To try it without a global install, run `npx -y @type_of/interlock@latest`.

Run the Parallel checks demo. It uses only Script steps, so no agent is needed:

1. Open **Workflows → Import → GitHub folder**, enter `https://github.com/dgca/interlock/tree/main/workflows` and choose **Find workflows**.
2. Select **Parallel checks (demo)** and choose **Import workflow**.
3. Open the workflow, choose **Review & publish**, then **Publish version**.
4. Choose **Run v1** and start a run with the input `{"checks":["lint","test"]}`.
5. The run waits for you to approve its two imported Scripts. Open each request from **Runs → Needs attention**, read the code and choose **Approve and run**.

The run completes with `{"count":2,"hasTests":true}`. Open it from **Runs → History** to see each step's input and output.

Next, [connect an agent](https://dgca.github.io/interlock/docs/agents/) or import a [starter workflow](https://dgca.github.io/interlock/docs/starter-workflows/) such as the SDLC workflow, which plans, builds and reviews a code change.

## What you can do

- **Run agent steps** through any MCP client, or let Interlock launch Claude Code, Codex or Pi for you. [Run agents](https://dgca.github.io/interlock/docs/agents/)
- **Build workflows** from Agent, Script, Fetch, Branch, Wait, Human input, Workflow, Parallel and Batch steps. [Build workflows](https://dgca.github.io/interlock/docs/build-workflow/), [Parallel steps](https://dgca.github.io/interlock/docs/parallel/)
- **Start from starters** for software delivery, pull request repair, issue intake and comparison grading. [Starter workflows](https://dgca.github.io/interlock/docs/starter-workflows/)
- **Automate starts** on a schedule or when another run finishes. [Automations](https://dgca.github.io/interlock/docs/automation-guide/)
- **Inspect runs** step by step, answer requests, and pause, cancel or retry. [Inspect and manage runs](https://dgca.github.io/interlock/docs/inspect-runs/)
- **Track work on boards** across workflows, and hold starts in a backlog. [Boards](https://dgca.github.io/interlock/docs/workflow-boards/)
- **Measure and limit cost** with reports, run budgets and OpenTelemetry traces. [Reports](https://dgca.github.io/interlock/docs/reports/), [Run budgets](https://dgca.github.io/interlock/docs/run-budgets/)
- **Test changes** with saved cases, simulations and side-by-side version comparisons. [Test and improve](https://dgca.github.io/interlock/docs/testing-workflows/)
- **Carry lessons forward**: workflow memory gives later runs reviewed notes, and agents can propose workflow changes for you to approve. [Workflow memory](https://dgca.github.io/interlock/docs/memory/), [Proposed changes](https://dgca.github.io/interlock/docs/workflow-proposals/)
- **Drive it from code** with the CLI, the HTTP API or MCP. [CLI](https://dgca.github.io/interlock/docs/cli/), [HTTP API](https://dgca.github.io/interlock/docs/http-api/)

## Documentation

- [Documentation site](https://dgca.github.io/interlock/docs/): installation, guides and reference.
- [Workflows and runs](https://dgca.github.io/interlock/docs/quickstart/): the basic model.
- [Connect with MCP](https://dgca.github.io/interlock/docs/connect-mcp/) and [Connect your harness](https://dgca.github.io/interlock/docs/harness-setup/).
- [Upgrading](https://dgca.github.io/interlock/docs/upgrading/) and [Troubleshooting](https://dgca.github.io/interlock/docs/troubleshooting/).
- [Feature index](https://github.com/dgca/interlock/blob/main/docs/features.md): what is implemented, by area.
- [Current limits](https://github.com/dgca/interlock/blob/main/docs/v1.md): what is not.
- [Architecture and execution semantics](https://github.com/dgca/interlock/blob/main/docs/architecture.md) and [domain language](https://github.com/dgca/interlock/blob/main/CONTEXT.md).

## Security

Interlock is a trusted local tool for one person. Workflows run Scripts, Fetch requests and agents with your user account's access, so treat a workflow like code you run.

- The server listens only on `127.0.0.1`. Do not expose its port through a tunnel, proxy, port forward or container mapping.
- Scripts are not sandboxed. Imported Scripts need one-time approval before their first run.
- A per-install API token is sent automatically by the UI, CLI and MCP bridge. Set `INTERLOCK_REQUIRE_TOKEN=1` to reject requests without it.

Read the [full security notes](https://github.com/dgca/interlock/blob/main/docs/security.md) for Script environments and the token.

## Develop locally

From a source checkout, with Node.js 24.13 or later and pnpm 11.7:

```sh
pnpm install
pnpm dev
```

The development UI runs on [port 5173](http://127.0.0.1:5173) with the engine on port 4310, and stores data in `.interlock/interlock.db` inside the checkout. Stop any installed Interlock server on port 4310 first.

Before opening a pull request, run:

```sh
pnpm build
pnpm format:check
pnpm lint
pnpm test
```

See [AGENTS.md](https://github.com/dgca/interlock/blob/main/AGENTS.md) for repository rules and the full set of checks, and [Develop Interlock](https://github.com/dgca/interlock/blob/main/docs/development.md) for the development server, package and browser tests.

## License

[MIT](https://github.com/dgca/interlock/blob/main/LICENSE)
