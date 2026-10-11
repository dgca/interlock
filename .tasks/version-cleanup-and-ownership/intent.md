# Clean up obsolete published versions

## Problem and outcome

Old published versions permanently prevent workflow deletion and ownership changes, even after current callers stop using a workflow. Users need to discard obsolete definitions explicitly without deleting useful workflows or splitting their identities and run history.

Success means a user can understand the consequences of cleanup, choose which obsolete versions to delete, and remove those blockers while preserving current execution and useful historical records.

## Scope and constraints

This run implements version cleanup for [issue #102](https://github.com/dgca/interlock/issues/102). Adoption and release in [issue #99](https://github.com/dgca/interlock/issues/99) follow in a separate run and PR. This sequence honors the original request to address issues one at a time with a separate PR per issue.

Provide shared server API and MCP operations. No new cleanup UI controls are required. Existing consumers must tolerate histories whose definitions were deliberately deleted. Keep normal behavior unchanged until a user explicitly requests cleanup. Preserve stored run inputs, outputs, and events.

Protect current drafts, latest published definitions, and active execution. Historical callers do not disappear silently: the user explicitly selects any obsolete caller versions that must also be deleted. Retained published definitions remain immutable. Version identifiers keep their meaning after cleanup.

Follow package boundaries and repository validation requirements. Use temporary databases for checks and preserve the user's library. Do not exercise destructive cleanup against live user data.

## Source request and settled decisions

- The original user request requires separate PRs per issue and backward compatibility where possible.
- During discussion of #99, the user said, "We should keep that" about exclusive child ownership and "we don't need a UI for this."
- The user said, "breaking historical inspection is fine as long as the user is informed and has signed off on it."
- The subsequent recommendation proposed explicit deletion with impact preview, protection of current dependencies and active runs, explicit selection of historical caller versions, preserved useful run records, and permanent version-number gaps. The user accepted it with "Love it, let's do it."
- The user explicitly selected "Use the published SDLC workflow." This run uses SDLC workflow version 4, run `25e31f2d-66b5-4e1d-9457-652648fbe11d`, with automatic planning review and pauses for unresolved human decisions.

## Task setup

Artifacts live in `.tasks/version-cleanup-and-ownership/`. The target is the isolated checkout recorded in the workflow run. The original checkout and unrelated artifacts remain untouched.

Task branch: `codex/version-cleanup-and-ownership`.

Original base commit: `d6f80ca2648c94544b5a2ef679bc1665943d0dce`.

## Questions

There are no unresolved intent decisions. Technical investigation must establish how to protect transitive active dependencies, retain history without definitions, and make deletion atomic. Observable requirements belong in [spec.md](spec.md); implementation and verification belong in [plan.md](plan.md).
