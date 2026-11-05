# Manage reusable workflow variables and secrets

Status: intent review permits progression under the existing request. This is an
agent review, not human approval of a design. Storage and execution details belong
in the specification and remain unapproved.

## Problem

Authors currently repeat configuration and credentials in workflow definitions or
rely on host process configuration. Repetition makes rotation harder and can put
credentials into portable workflow data or execution history.

An author needs to save a named value once, select it in several consuming nodes,
and update it centrally. The next runs of already published workflows must use the
replacement without a definition edit or another publication.

## Desired outcome

Interlock has a central library of ordinary configuration variables and secrets.
Workflow definitions retain references. The server delivers referenced values only
to the consuming operations through supported, explicit fields.

Authors can discover variables, manage values, see dependent workflows, and repair
unavailable references in the browser and through the shared API. CLI and MCP
provide appropriate management and authoring access with bounded metadata reads.
The UI follows Interlock's existing library and editor patterns and explains
consequences where a user makes the relevant choice.

Secret values stay out of workflow definitions, ordinary management reads,
portable exports, and ordinary execution history. Protected storage and the
execution boundary support rotation, restart, and useful historical inspection
without promising that an old credential remains valid at its provider.

## Affected users and systems

- Workflow authors reuse and rotate values across published workflows.
- Operators provision local values, preserve access through restart, and understand
  what must be backed up or restored.
- Agent callers discover safe metadata and author references through MCP without
  receiving secrets through an ordinary read operation.
- Runtime consumers include Fetch and Script. Scope for polling Wait checks and
  any Agent delivery must be explicit in the specification.
- Import and export callers see portable requirements and deliberately provision
  or bind local values.

## Scope

Deliver an instance-wide variable library, a protected secret store, explicit
consumer references, central updates for future runs, safe inspection, dependency
management, portable requirements, and the UI and API needed to use them.

Define revision capture, rotation, retention, deletion, and missing-store behavior
together before implementation. Cover Batch items, invoked and detached workflows,
delayed execution, retries, restart, continue-as-new, and testbench comparisons.
Preserve workflows that do not use variables.

The initial feature does not need environment-specific overlays, workflow-local
overrides, remote vault services, multi-user access policies, automatic credential
rotation, or provider-side revocation. Agent delivery and executor-profile
integration are not implicit consequences of adding a variable library.

## Constraints

- Follow issue #193's acceptance criteria. Store no plaintext secrets in workflow
  JSON or unprotected database fields.
- Respect the local, single-user application model. Masking is not an access-control
  boundary, and Script remains trusted code outside a sandbox.
- Keep contracts and graph validation in core, persistence in storage, execution in
  runtime, and all callers on the shared server API.
- Preserve draft-save versus publication validation and legacy Bash behavior.
- Reuse the Mantine theme and established authoring controls. Verify the resulting
  management and reference flows at desktop and narrow widths.
- Use temporary databases, fake credentials, and temporary protected stores for
  checks. Preserve unrelated task artifacts and the user's existing workflow data.
- Update the affected documentation, CLI guidance, and complete affected MCP flow.
  Verify HTTP and stdio behavior. Add a pending patch changeset for implementation.

## Source request and settled decisions

- Task branch: `codex/workflow-variables`.
- Original base commit: `a2112c8507adaab6daa3084ae45214c1edfcc30c`.
- Source: https://github.com/dgca/interlock/issues/193, read November 3, 2026.
- The user requested implementation and thoughtful UI design in this conversation.
- On November 3, 2026, the user chose **Use the SDLC workflow**. Use the existing
  `.tasks/workflow-variables/` directory and pause at human decision steps.
- Published SDLC workflow version 4 is running with review policy `auto`. Automatic
  progression does not constitute human approval of unresolved consequential
  decisions. PR creation is not enabled in the run input.
- Existing research is background evidence, not an accepted design.

## Open questions

No ambiguity remains about the requested outcome. Technical investigation and the
specification must settle protected storage and its key lifecycle, value capture,
revision retention and revocation, supported delivery paths, output redaction, and
portable binding behavior. Present consequential tradeoffs for human decision
before implementation rather than treating research proposals as approval.
