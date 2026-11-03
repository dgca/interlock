# Interlock

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People and agents defining, executing and inspecting repeatable workflows. Confirmed uses include software development through Claude Code and Codex, and factories coordinating tasks through GitHub Projects.

## Product Purpose

A local workflow engine and editor that separates reusable procedures from the agent harness doing each assignment. Users can author through the UI or MCP and retain inspectable run history.

## Operating Context

Interlock runs on the user's computer. Workflows can start other workflows, including independent runs through scripts. Existing connected harnesses discover and claim work. Managed execution adds opt-in automatic Agent execution through locally configured harnesses.

## Capabilities and Constraints

Claude Code and Codex are required targets for the first managed-execution release. Other harnesses must fit a shared adapter interface. Channels are outside this release. Machine-specific execution configuration stays local; workflow definitions contain portable references. Existing workflows retain connected-agent behavior unless configured otherwise.

## Product Principles

- Keep the UI clear through spacing, typography and grouping. Show guidance when it explains a consequence or next action.
- Preserve existing workflow behavior and stored data.
- Treat MCP context as limited; keep responses bounded and fetch execution detail on demand.
- Expose meaningful state, permissions, failures and recovery. Do not infer success from process exit alone.

## Brand Commitments

Preserve the established Mantine theme and the node-editor patterns reviewed in this session. The OpenDesign screenshot is an example of harness discovery and configuration, not a replacement visual identity.
