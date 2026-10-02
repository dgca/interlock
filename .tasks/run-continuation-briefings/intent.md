# Run continuation intent

## Source and authorization

Implement [issue #73](https://github.com/dgca/interlock/issues/73). The user requested the published SDLC workflow and autonomous work on 2026-10-02. Technical and scope decisions within the issue can proceed through agent review. No deployment or merge is authorized.

SDLC run: `69765657-8b45-476e-94ab-e694a20afc5d`, workflow version 1, review policy auto.

## Outcome and scope

Agents resuming a run can determine its current state and next action without fetching its complete definition and execution history. External harnesses can wait for relevant changes with finite requests.

Provide persisted-state briefings, targeted execution/result reads, and bounded change waits through runtime, shared API, and MCP. Preserve existing inspection, assignment discovery, timers, and detached lifecycles. Existing copied handoff instructions can point agents to the continuation protocol. No new UI controls or layout changes, executor launch, transport sessions, or new event stream. This clarification follows the independent review guidance finding under the original autonomous issue authorization.

## Constraints

Follow package boundaries and existing SQLite migration rules. Preserve user databases and unrelated files. Use temporary databases for verification and a pending patch changeset. Keep claim tokens private. Distinguish independent detached work from requested-run completion.

## Questions

No unresolved intent decisions. Observable behavior and design choices belong in [spec.md](spec.md); implementation and verification belong in [plan.md](plan.md).
