# Interlock

Interlock defines repeatable procedures that agents and people can execute and inspect.

## Language

**Workflow**: A reusable definition of work, including its steps and execution rules.

**Workflow version**: An immutable published definition of a workflow.

**Draft**: An editable workflow definition that has not been published as a version.

**Run**: One execution of a published workflow or a Batch item path with its own inputs and progress.

**Node**: A step in a workflow. A node can invoke another workflow.

**Fetch**: A step that binds incoming data into an HTTP request and returns its response status, headers, and body.

**Batch**: A step that repeats an item path for each value in a list and sends the ordered results to its continuation after all items finish.

**Item path**: The connected work inside a Batch group, from Start to End. Each item follows this path independently and supplies its output through End.

**Node execution**: One invocation of a node within a run.

**Tool requirement**: A named capability an agent assignment requires its executor to provide.

**Context policy**: Rules governing the information and capabilities an agent execution receives.

**Work request**: A bounded assignment that a run makes available to an agent executor.

**Claim**: A time-limited reservation of a work request by an executor.

**Draft revision**: A revision number identifying an edit of a workflow draft. It distinguishes the draft a caller read from a newer edit.

**Executor**: An agent or person that claims a work request and supplies its result.

**Input or output contract**: The structure and constraints a workflow or node requires of the data it receives or returns.
