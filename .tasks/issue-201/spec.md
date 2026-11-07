# Run version behavior

See [intent](intent.md) for scope and authorization.

## Acceptance criteria

- AC1: Default policy is `pinned`. A start option or revision-protected run policy update enables `latest-compatible`. Policy changes preserve state, budgets, claims and continuity groups.
- AC2: Before creating each execution, opted-in runs inspect the latest retained published version. A shared cursor node and compatible resolved input allow a move. Missing nodes, input mismatch, missing captured dependencies or incompatible Batch scope retain the original binding and expose the reason. The original step can continue.
- AC3: Available, claimed and all other active executions finish with their original definition, configuration and routes. Explicit moves preview and report this boundary blocker. Per-execution version records preserve history.
- AC4: Explicit preview reports exact target, blockers and a confirmation. Apply rechecks that confirmation transactionally, requires a reason and changes nothing on rejection or write failure. History records from/to versions, time and reason; reads are bounded.
- AC5: Prompt capture stays fixed unless an operator explicitly requests recapture. Recapture honors the target version's published prompt pins. Missing new prompt, variable or model-alias captures block a move. Protected variable and alias revisions stay unchanged.
- AC6: Batch parents do not move while their execution is active. Item runs keep their own bindings; moves preserve Batch identity and cursor membership. Future item creation uses its parent's actual version. Invoked waited and detached children retain independent policies and captures; future calls use the upgraded parent's pins.
- AC7: Continue-as-new uses the predecessor's current version, policy and capture, with existing chain cap and budget history. Moves cannot introduce, remove or change chain configuration. Continuity groups remain run-local and unchanged.
- AC8: Cleanup protects active runs' actual binding and future dependencies. Historic executions remain inspectable when obsolete definitions are explicitly removed, with accurate history-loss impact.
- AC9: Shared API, CLI and MCP expose policy, preview, apply and bounded history. Start options and request receipts preserve policy identity. Both MCP transports discover equivalent contracts. Existing related guidance describes safe boundaries and capture rules consistently.
- AC10: Run inspector provides policy and explicit preview/apply controls, blockers and history using existing Mantine patterns.

## UI proposal

Place a version control beside existing run actions in the inspector. Open a dialog showing current version, selectable policy and published target version. Preview displays blockers before enabling Apply; the operator supplies a reason and may explicitly recapture prompts. Show bounded version history in the same flow. Loading disables duplicate mutations; stale or failed actions preserve controls and show the error. Successful changes refresh inspection. Standard Mantine dialog focus, Escape dismissal, labels and stacked narrow-screen controls apply. Human visual review is deferred to the combined queue review.

## Decisions

Available work is an active execution, not a boundary. This directly preserves its captured routes as well as prompt and contracts. Operators may enable policy during work; explicit apply waits for a boundary. A named workflow pause can preserve a boundary after in-flight completion.

The optional workflow-level default and child latest-dispatch alternative are omitted. Per-run start and policy controls satisfy the required scope without changing published child-call semantics.
