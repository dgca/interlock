# GitHub folder import requirements

See [intent](intent.md) for the problem, outcome, scope, constraints, and settled decisions. The source request is [request.md](request.md). The numbered criteria below preserve the supplied acceptance checklist identifiers.

## Observable behavior

The library import action offers a GitHub folder source and the existing local-file source. GitHub discovery returns direct-file choices with root workflow name, description, source file, and workflow and saved-prompt dependency information. Choices start unselected. Invalid JSON, invalid export shapes, unrelated files, and incomplete bundles cannot become valid selections; useful valid choices remain visible.

The source accepts HTTPS github.com repository tree URLs. A branch name containing slashes resolves correctly. Discovery freezes the resolved ref to a commit for this preview so later branch movement cannot silently change a selected choice. An import request represents the explicitly chosen files from that preview.

The selected set is validated again at import time against current library state. Any invalid selection or conflict rejects the full set. Differing drafts, metadata, published versions, ownership, and shared prompts cannot be overwritten by this journey. Identical portable entries remain unchanged; legacy entries create a new workflow. Validation and import preserve owned-child identities, published version pins, and saved-prompt references. Import writes definitions and prompts without starting runs.

A changed URL, cancelled load, or closed dialog invalidates the prior selection. Delayed responses cannot replace the latest source or enable an import from an obsolete preview. Discovery and import have separate busy states. Failed discovery offers retry or correction. Import errors retain useful selection context for recovery. Empty folders explain that no direct workflow files were found. Closing a discovery dialog discards its selection and returns focus to Import. Standard keyboard controls operate source choice, URL, discovery, checkboxes, import, and cancellation. Descriptions render as text.

## Acceptance criteria

- AC1: The actual UI accepts the pinned public folder link and the slash-containing branch link. Both resolve the fixture files and show useful selectable workflow identities, descriptions and dependency information.
- AC2: Local-file import remains available for both legacy and bundle files. Invalid and unrelated remote files cannot be selected as valid imports. Nested workflow files are excluded from direct-folder discovery.
- AC3: No item is imported without an explicit selection and import action. Selecting only 01, 02 and 03 creates three library workflows, one owned child and one saved prompt. Owned-child identity, version pins and saved-prompt references are retained.
- AC4: Import saves definitions and prompts without starting runs or executing fixture scripts. Identical portable reimports are no-ops; legacy reimports preserve existing create-new behavior.
- AC5: Selecting conflicting exports together, or importing a conflicting export into existing state, fails without changing any workflows or prompts. A later conflict after preview must not produce partial writes or implicit overwrite.
- AC6: Invalid URL, missing folder, invalid JSON, invalid workflow shape and missing dependency produce actionable feedback. The no-workflows folder has a useful empty state. Network failures and GitHub rejection or rate limiting allow recovery without data changes. Unit/integration network fixtures can establish error states; successful real discovery and import require actual GitHub browser evidence.
- AC7: Slow or overlapping loads cannot replace the latest source selection or allow stale imports. Closing/cancelling the dialog does not import. Retry or a corrected URL can recover from an error.
- AC8: The real journey works with pointer and keyboard, including selection, import and focus recovery. Inspect representative desktop and narrow layouts using the existing theme. Broaden only for a concrete failure or uncovered behavior.
- AC9: Relevant native tests, required build and formatting checks pass on the final candidate. Document changed user/API behavior and check affected MCP guidance where applicable. No change weakens existing validation, ownership, prompt-conflict or publication rules.
- AC10: Final review independently inspects the complete task diff and observable acceptance evidence at the final commit. Record any verification gaps and risks explicitly.

## Decisions, risks, and questions

All criteria trace to the supplied request and shared acceptance checklist. Existing local-file import keeps its current single-file behavior. Remote selections use a strict no-overwrite policy even though the existing portable import API also offers explicit force and draft revision options. This does not remove those existing operations.

GitHub rate limits and inaccessible sources require actionable retry feedback. The feature uses bounded requests and file sizes to avoid unbounded discovery. Limits must be explicit in feedback. No private credentials are requested. Source contents are untrusted data. Scripts are never run during discovery or import.

No new consequential decision needs human input. Commit freezing, bounded requests, and ordinary UI choices are technical safeguards within the settled scope.
