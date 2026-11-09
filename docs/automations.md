# Automations

Open **Automations** in the sidebar to see triggers across workflows. Search by automation or workflow name, filter by workflow, or choose **All**, **Enabled**, **Disabled**, and **Needs attention**. Status counts follow the workflow and search filters. **Needs attention** includes enabled automations with an automatic failure pause or excessive schedule lag.

## Create an automation

1. Choose **New automation**.
2. Choose **Schedule** or **Interlock event**.
3. Name the automation and set its timing or source events.
4. Choose the workflow to start.
5. For schedules, enter workflow inputs using the selected workflow's contract.
6. Leave **Enable when created** off to save disabled, or turn it on to create enabled.
7. Choose **Create**.

Creation opens the saved automation. There is no separate review step. Enablement requires a published, unarchived target workflow. Failed immediate enablement creates no automation and keeps your form values.

Schedules offer intervals and five-field cron with an IANA timezone. Preview shows upcoming times. Choose whether overlapping runs skip the occurrence, queue one run, or overlap. New UI schedules skip missed occurrences, including while Interlock is closed. Existing missed-fire policies remain unchanged when edited. See [schedule behavior](schedules.md).

Schedule inputs use exact contract property keys even when the form displays a friendly title. A field titled Repository with key `repository` saves `{ "repository": "dgca/interlock" }`. Numbers and booleans retain their JSON types. Complex fields use JSON entry. Existing schedule metadata bindings remain intact and their bound fields cannot be edited as literals.

Interlock events watch one workflow, optionally its owned children, or any workflow. Choose completed, failed, cancelled, needs-attention, or stalled transitions. Terminal events can wait until source work has stopped. The target receives a compact event object rather than manually entered schedule inputs. See [event input](events.md#event-input-and-causal-chains) for fields and exclusions.

## Inspect and change

**Activity** shows scheduled occurrences or deliveries and their admission outcomes. Started or queued does not mean a run completed successfully. Open the linked run for its result. **Settings** shows saved configuration. **Edit** changes a schedule or workflow-handler event, preserving advanced settings not exposed by the form.

Enable or disable from the detail header. Disabling stops future starts and preserves active and queued runs. An automatically paused automation offers **Resume automation**, which clears its automatic pause and failure count. Named library or workflow pause holds remain in force. Delete removes the automation and its visible activity history while preserving existing runs and durable start/event receipts.

Use **Automations** in the sidebar and filter by workflow when needed. Old workflow trigger links redirect to the global list or the exact saved automation.

## Advanced integrations

Existing incoming webhook and outbound event-webhook records remain visible with activity, read-only configuration, enable/disable, and delete controls. Use the shared trigger API, CLI, or MCP tools to create and edit those configurations. See [webhooks](webhooks.md), [events](events.md), and [trigger commands](schedules.md#use-the-cli-and-mcp).
