# GitHub folder import intent

People sharing workflow exports in GitHub repositories need to inspect and choose usable workflows without downloading every file. Add a public GitHub folder source to the local workflow library import journey. Keep local-file import available.

Success means a person can review workflow identities and dependencies, select what they want, and save that selection with the same portable identity and dependency semantics as local bundles. A rejected selection leaves the local library and prompts unchanged. Importing definitions never runs them.

## Scope and decisions

The source request is preserved in [request.md](request.md). The supplied comparison brief and acceptance checklist settle these decisions:

- Public github.com repository folder URLs only. Resolve commit and branch links, including slash-containing branches, and inspect direct files only.
- Reuse legacy single-workflow and portable bundle formats. A bundle choice represents its root and carries its workflow and saved-prompt dependencies.
- Explicit selection and import action are required. The selected set succeeds or fails together. No differing draft, published version, ownership, or prompt is overwritten.
- Identical portable reimports are no-ops. Legacy files keep create-new behavior.
- Keep local import, clear recovery states, keyboard focus, and descriptions rendered as data.
- No private authentication, recursion, automatic updates, gallery, new format, execution, or publication.
- Work in this disposable checkout and temporary databases. Local commits only; no PR, push, merge, deploy, or package publication.

The affected users are workflow authors and people importing shared workflows. The affected systems are the library UI, shared server import API, runtime validation, and storage transactions. Follow package boundaries and Mantine patterns.

## Constraints and questions

The existing AGENTS.md requires relevant tests, a TypeScript/UI build, formatting, user-facing documentation, a patch changeset, and review of affected MCP guidance. Verification observations stay outside the checkout. The comparison uses source commit 95cb57b8f9b55e63428f66f0099b62831905fda6 and frozen fixture commit 4c43bd7e54651dd9f8356456d647fb86f504252c.

There are no unresolved intent decisions. Technical questions about resolving GitHub refs, validating selections atomically, and cancelling stale previews belong to investigation and the plan.

## Task baseline

Task branch: `codex/comparison-sdlc`. Original baseCommit: `95cb57b8f9b55e63428f66f0099b62831905fda6`. Verified before the first task commit.
