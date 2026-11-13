---
title: Troubleshooting
description: Check startup, waiting Agent steps, and failed executions.
---

# Troubleshooting

## Interlock does not open

Check that the terminal running `interlock` is still open. Read its startup error if the process stopped. The default browser address is `http://127.0.0.1:4310`.

With the engine running, use another terminal to check it:

```sh
interlock doctor
```

Doctor reports readiness problems without repairing or deleting data. **Diagnostics** in the sidebar shows the same checks. If you selected another port, set `INTERLOCK_URL` to that engine address for CLI commands.

## An agent cannot connect

Confirm Interlock is running, then copy the endpoint from **Connect with MCP**. Restart or reconnect your client after changing its configuration. See [Connect with MCP](connect-mcp.md) for setup and clients that require stdio.

## A run waits at an Agent step

Read the waiting reason in the run inspector. Connected assignments need your agent to claim and complete them. Ask it to continue the existing run by its run ID.

For automatic execution, check the selected harness is enabled in **AI Settings → Harnesses** and selected by the published workflow. See [Connect your harness](harness-setup.md) for setup. Open **Runs → Needs attention** for permission requests, questions, or recovery checks. Resolve the displayed blocker before retrying.

## A harness fails in the background

The engine writes JSON lines to `logs/interlock.log` beside its database (`~/.interlock/logs/` for installed copies). The file rotates at 5 MiB and keeps three older files. Set `INTERLOCK_LOG_LEVEL` to `debug`, `info` (default), `warn`, or `error` before starting Interlock to change what is written. Doctor's **Scheduler errors** check shows the most recent background failure, such as a failing launcher status command, with its time. Error text has claim tickets and tokens masked.

## A step fails

Select the failed execution and compare its input, error, and recorded result with its contracts. A command can succeed while its returned data fails validation.

For Scripts, check the selected language and output format. JavaScript returns a JSON value; Bash writes one JSON value to stdout.

Inspect external effects before retrying work that changes files or calls a service. Follow any stop-reconciliation instructions first, since an external process may still be running.

If the problem persists, [open an issue](https://github.com/dgca/interlock/issues/new) with reproduction steps and `interlock --version`. Remove credentials and private task data before sharing examples.
