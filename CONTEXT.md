# Interlock

Interlock defines repeatable procedures that agents and people can execute and inspect.

## Language

**Workflow**: A reusable definition of work, including its steps and execution rules.

**Workflow version**: An immutable published definition of a workflow.

**Draft**: An editable workflow definition that has not been published as a version.

**Run**: One execution of a particular workflow version with its own inputs and progress.

**Node**: A step in a workflow. A node can invoke another workflow.

**Node execution**: One invocation of a node within a run.

**Tool**: A capability that a node can invoke.

**Context policy**: Rules governing the information and capabilities an agent execution receives.

**Work request**: A bounded assignment that a run makes available to an agent executor.

**Claim**: A time-limited reservation of a work request by an executor.

**Workflow revision**: A proposed change to a workflow's procedure.

**Evaluation**: Evidence about the quality of a workflow or proposed revision.
