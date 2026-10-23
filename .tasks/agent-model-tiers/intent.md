# Agent model tiers

## Source and decisions

Source: https://github.com/dgca/interlock/issues/153 and the user's instruction, "Kk, let's implement tiers for now."
The user selected the published SDLC workflow in this chat. Run: `73b9045d-5d47-4615-968a-b9de7e945117`, workflow version 4, review policy `auto`, local completion.

After local completion, the user approved the "No preference" label and explicitly requested a PR in this chat. That follow-up authorizes PR creation for the existing task branch.

The user asked whether tiers apply to both Context settings. The proposed behavior keeps tiers advisory for both current and fresh execution, with required continuity and isolation taking precedence. The preceding recommendation included portable tiers and attempt provenance, and deferred reviewer independence.

## Problem and outcome

Workflow authors currently express model preferences in prose or external node-ID tables. Executors need a structured preference before claiming work, without tying reusable workflows to vendor model names.

Success means authors can express a step's preferred capability and inspect the request alongside executor declarations and reported model usage. Existing workflows and executors retain their behavior when the preference or reporting is omitted.

## Scope and constraints

Include optional model tiers, assignment discovery, attempt attribution, Agent settings, run inspection, portable transfer, and affected agent documentation. Exclude reviewer independence, direct execution adapters, provider selection, automatic model switching, and executor-mapping comparisons.

Interlock remains responsible for workflow contracts and records. Executors map tiers and provide truthful declarations and telemetry. Preserve immutable versions, current/fresh semantics, run-local session continuity, and unknown reporting values. Use temporary databases for checks and preserve unrelated local artifacts.

## Open questions

None about intent. The specification owns tier meanings and observable reporting behavior; the plan owns implementation and verification.

## Task baseline

Branch: `codex/agent-model-tiers`. Base commit: `5c3d43bc04b79ee7b14c1083d9ab6000bd767f19`, current origin/main at setup. Unrelated untracked task directories and research files remain outside task commits.
