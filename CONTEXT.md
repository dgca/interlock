# Interlock

Interlock defines repeatable procedures that agents and people can execute and inspect.

## Language

**Workflow**: A reusable definition of work, including its steps and execution rules.

**Workflow version**: An immutable published definition of a workflow.

**Draft**: An editable workflow definition that has not been published as a version.

**Run**: One execution of a published workflow or its inline workflow with its own inputs and progress.

**Node**: A step in a workflow. A node can invoke another workflow.

**Workflow Batch**: A step that runs an inline workflow once for each item in a list and collects the item results in input order.
_Avoid_: Map

**Inline workflow**: A workflow owned by a Workflow Batch. Each item enters at "Each item" and returns through "Item result".

**Node execution**: One invocation of a node within a run.

**Tool requirement**: A named capability an agent assignment requires its executor to provide.

**Context policy**: Rules governing the information and capabilities an agent execution receives.

**Work request**: A bounded assignment that a run makes available to an agent executor.

**Claim**: A time-limited reservation of a work request by an executor.

**Draft revision**: A revision number identifying an edit of a workflow draft. It distinguishes the draft a caller read from a newer edit.

**Executor**: An agent or person that claims a work request and supplies its result.

**Input or output contract**: The structure and constraints a workflow or node requires of the data it receives or returns.
