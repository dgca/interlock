# Interlock

Interlock defines repeatable procedures that agents and people can execute and inspect.

## Language

**Workflow**: A reusable definition of work, including its steps and execution rules.

**Library workflow**: A workflow that has no owner and is available for reuse by other workflows.

**Child workflow**: A workflow owned by one library workflow. Only its owner can invoke it, though it can also be run directly for testing.

**Workflow version**: A published definition identified by a permanent version number. Its definition is immutable while retained.

**Draft**: An editable workflow definition that has not been published as a version.

**Run**: One execution of a published workflow or a Batch item path with its own inputs and progress.

**Detached run**: A workflow execution that continues independently after its initiating run finishes, fails, or is cancelled. It retains its parent link for inspection.

**Node**: A step in a workflow. A node can invoke another workflow.

**Stage**: An optional author-chosen label on a node. A run's stage is the deepest active label in its waited run tree.

**Waiting reason**: One structured explanation of what a run currently awaits, with its persisted start time and bounded detail.

**Run actor**: The agent, engine, or person able to move a run forward. Person applies only when every active waited branch requires intervention.

**Fetch**: A step that binds incoming data into an HTTP request and returns its response status, headers, and body.

**Wait**: A step that pauses until a persisted deadline and passes its input through unchanged, or re-runs a check on a schedule until its result matches and continues with that result merged into the input.

**Pause hold**: An independent named library or workflow record that blocks execution at boundaries. Progress requires zero applicable holds. Release names one exact ID. In-flight work may finish, while pending external-input submissions remain accepted.

**External input**: A step that waits for a caller to accept a specific revision of submitted JSON and then forwards that value.

**Branch**: A step that compares one input path against ordered cases and passes its input unchanged through the first matching route. Unmatched values fail the run unless a fallback route is configured.

**Accepted result**: Data produced by a step and accepted against its result contract and checks, before result routing or output mapping.

**Result routing**: A step's selection of its next route by comparing its accepted result against ordered cases.

**Forwarded output**: Data a completed step sends onward. It is the accepted result unless the step constructs a different set of output fields.

**Batch**: A step that repeats an item path for each value in a list and sends the ordered results to its continuation after all items finish.

**Item path**: The connected work inside a Batch group, from Start to End. Each item follows this path independently and supplies its output through End.

**Node execution**: One invocation of a node within a run.

**Tool requirement**: A named capability an agent assignment requires its executor to provide.

**Saved prompt**: Centrally maintained named Markdown instructions that Agent nodes reference in order.

**Prompt capture**: The saved prompt content and revisions selected when a workflow run starts. Batch item runs inherit capture; invoked workflows capture independently.

**Workflow variable**: A centrally managed named configuration value or secret that workflow steps reference for explicit delivery.

**Secret**: A workflow variable whose stored value cannot be read back through management or inspection.

**Variable capture**: The variable identities and value revisions selected for a run. It identifies the values used without exposing their contents.

**Portable variable binding**: An explicit local association between an imported variable identity and a compatible variable in the instance.

**Context policy**: Rules governing the information and capabilities an agent execution receives.

**Work request**: A bounded assignment that a run makes available to an agent executor.

**Claim**: A time-limited reservation of a work request by an executor.

**Draft revision**: A revision number identifying an edit of a workflow draft. It distinguishes the draft a caller read from a newer edit.

**Executor**: An agent or person that claims a work request and supplies its result.

**Input or output contract**: The structure and constraints required at a workflow boundary or for a step’s input or accepted result. A step’s accepted-result contract can differ from its forwarded output.

**Test suite**: A named, revisioned collection of representative input cases and explicit checks for one workflow.

**Workflow comparison**: An experiment that executes baseline and candidate workflow versions on the same captured suite cases and records separate execution, check and quality results.

**Comparison sample**: One baseline or candidate execution of a case at a particular repetition.

**Quality judgment**: A declared reviewer's assessment of a comparison sample against an explicit rubric, distinct from execution status and structural checks.

**Workflow trigger**: A configured cause of new runs, managed separately from a workflow draft. A schedule trigger starts runs at periodic slots under its overlap and missed-fire policies.

**Schedule fire**: One recorded attempt or policy skip for a schedule slot. Its admission outcome is distinct from the resulting run's completion outcome.

**Stall**: An observational Needs attention item emitted after an opt-in active-time threshold. Pauses and declared holds freeze its clock. Stalls preserve run status and actor; Agent active execution deadlines separately spend ordinary failure allowance. See [timers](docs/timers.md#stall-detection-and-active-attempt-deadlines).
