---
'@type_of/interlock': patch
---

The starter picker offers one **SDLC workflow**: the newer workflow with its own Plan review and Change review. The original SDLC workflow is no longer offered, and stays importable from `workflows/sdlc.json`. `sdlc-v2` still works as an ID for the SDLC starter in the CLI, MCP and HTTP API. Existing copies of either workflow, their versions and runs are untouched; a copy added as `sdlc-v2` is recognized as the SDLC starter, and a copy of the original is not, so adding SDLC creates a new copy beside it.
