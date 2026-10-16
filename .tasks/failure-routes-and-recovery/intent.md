# Script and Fetch failure routes

Script and Fetch failures currently stop their run. Authors need a way to handle a failed operation inside the workflow, such as returning a fallback result or asking an Agent for help.

The approved outcome is an optional recovery route on these two node kinds. Existing workflows retain their behavior. A recovered run retains the failed operation and its error in history.

The user approved the recommendation in this chat and asked to "err on less is more." Use the existing editor and MCP authoring operations. Add no MCP tools. Keep JavaScript and legacy Bash behavior compatible.

Automatic retries, backoff, Workflow and Agent failure routes, and executor fallback are outside this increment. Issue #75 remains open for those broader decisions. Deliver this increment in its own PR.

Source: https://github.com/dgca/interlock/issues/75 and the user's approval in this conversation. No unresolved intent decisions remain. Error structure and failure eligibility are technical design questions for the specification.

Task branch: `codex/script-fetch-failure-routes`. Original base commit: `bff91bb46cea82e1d8b14097c50edf9b13c3fa68`.
