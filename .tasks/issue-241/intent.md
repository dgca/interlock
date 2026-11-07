# Lifecycle event triggers

## Problem and outcome

Run completion, failure and stall reactions require an external coordinator. Interlock should start notification and teardown workflows from persisted lifecycle events, with safe teardown after the source tree stops.

## Scope and constraints

Implement issue #241 and the M2 requirements in parent #223. Extend the existing schedule/webhook trigger model. Keep contracts in core, persistence in storage, execution in runtime, and shared API behavior across clients. Preserve existing opt-in behavior and user data. Portable imports always disable triggers.

Success means workflows can react once to relevant lifecycle transitions, receive compact context, and safely wait for detached children and uncertain activity before teardown. Cascades terminate predictably and expose suppressed events for inspection.

## Authorization

Source: https://github.com/dgca/interlock/issues/241 and parent https://github.com/dgca/interlock/issues/223. The issue explicitly requests the published SDLC workflow with reviewPolicy auto and createPr true. The unattended queue authorizes autonomous implementation, disjoint subagents and combined human UI review after the queue merges. The parent agent controls final fresh review, PR publication and merge. No new human decision is needed for ordinary implementation choices.

## Task identity

Branch: feat/issue-241

Base commit: 190464575d841a627a093e090be483be6900ca1b

SDLC run: c0597851-3a59-4ce9-8fa1-f5c99fab5aca

## Open questions

None about intent. Event schema, bounded inspection and persistence details belong to the spec and plan.
